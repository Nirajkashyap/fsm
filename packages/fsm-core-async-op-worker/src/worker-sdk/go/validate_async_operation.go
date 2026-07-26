// Discovers and verifies go promise-actor folders.
//
// Go counterpart of ../typescript/validate-async-operation.ts's
// validateAsyncOperationFromFoldersTypescript, walking
// <folderPath>/<fsmName>/<version>/go/actors/<actorName>/<actorName>.go
// (this repo's real FSM actor convention — see
// apps/fsm-core-example/fsm/creditCheck/v01/go/actors/checkReportsTable/checkReportsTable.go)
// instead of the typescript file's .../typescript/actors/... path.
//
// Verification inlines packages/fsm-compiler-ts/src/checkers/check_fn.go's
// own check (go/ast walk for a FuncDecl matching the actor name, regardless
// of exported/unexported case — check_fn.go doesn't care) directly
// in-process, the same way the typescript/python/rust files inline their
// own checkers instead of shelling out.
//
// This is validation only, not invocation: unlike Python/TypeScript, a
// verified result here does not carry a callable — Go has no runtime
// mechanism to load a function out of a .go file (see sdk.go's package
// doc). The reference binary (main.go) still has to match verified results
// against a small compile-time registry of actually-linked-in handler
// functions — and unlike Rust, Go additionally enforces exports at compile
// time, so an unexported real-world actor function (like
// checkReportsTable, matching this repo's established stub convention)
// cannot be imported/linked at all without renaming it, which would break
// check_fn.go's own validation elsewhere in the repo. See main.go's
// knownHandler for the consequence.
package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
)

const lang = "go"

// Mirrors @pgfsm/compiler's util.ts isVersionFolderName: /^v\d{2}$/.
var versionFolderRe = regexp.MustCompile(`^v\d{2}$`)

func hasFn(path string, fnName string) (bool, error) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, path, nil, 0)
	if err != nil {
		return false, err
	}
	for _, decl := range f.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && fn.Name.Name == fnName {
			return true, nil
		}
	}
	return false, nil
}

// Mirrors @pgfsm/compiler's ActorPluginValidationResult (util.ts).
type ActorPluginValidationResult struct {
	Src              string
	Method           string
	FsmName          string
	FsmType          string
	FsmVersion       string
	FsmLanguage      string
	IsVerified       bool
	FsmModulePath    string
	ParentFsmName    string
	ParentFsmVersion string
	ParentFsmPath    string
	ErrorMessage     string
}

func sortedDirEntries(dir string) []os.DirEntry {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	return entries
}

func ValidateAsyncOperationFromFoldersGo(folderPath string, skipDirs []string) []ActorPluginValidationResult {
	var results []ActorPluginValidationResult

	skip := make(map[string]bool, len(skipDirs))
	for _, d := range skipDirs {
		skip[d] = true
	}

	info, err := os.Stat(folderPath)
	if err != nil || !info.IsDir() {
		return results
	}

	for _, fsmEntry := range sortedDirEntries(folderPath) {
		fsmName := fsmEntry.Name()
		if skip[fsmName] || !fsmEntry.IsDir() {
			continue
		}
		fsmDirPath := filepath.Join(folderPath, fsmName)

		for _, versionEntry := range sortedDirEntries(fsmDirPath) {
			version := versionEntry.Name()
			if !versionEntry.IsDir() || !versionFolderRe.MatchString(version) {
				continue
			}
			versionPath := filepath.Join(fsmDirPath, version)

			langPath := filepath.Join(versionPath, lang)
			if info, err := os.Stat(langPath); err != nil || !info.IsDir() {
				continue
			}

			actorsPath := filepath.Join(langPath, "actors")
			if info, err := os.Stat(actorsPath); err != nil || !info.IsDir() {
				continue
			}

			for _, actorEntry := range sortedDirEntries(actorsPath) {
				actorName := actorEntry.Name()
				if !actorEntry.IsDir() {
					continue
				}
				actorDir := filepath.Join(actorsPath, actorName)
				modulePath := filepath.Join(actorDir, actorName+".go")

				if info, err := os.Stat(modulePath); err != nil || info.IsDir() {
					continue
				}

				isVerified := false
				errorMessage := ""
				found, err := hasFn(modulePath, actorName)
				if err != nil {
					errorMessage = "Failed to parse " + modulePath + ": " + err.Error()
				} else if found {
					isVerified = true
				} else {
					errorMessage = "Function '" + actorName + "' not found in " + modulePath
				}

				results = append(results, ActorPluginValidationResult{
					Src:              actorName,
					Method:           actorName,
					FsmName:          actorName,
					FsmType:          "promise",
					FsmVersion:       version,
					FsmLanguage:      lang,
					IsVerified:       isVerified,
					FsmModulePath:    modulePath,
					ParentFsmName:    fsmName,
					ParentFsmVersion: version,
					ParentFsmPath:    fsmDirPath,
					ErrorMessage:     errorMessage,
				})
			}
		}
	}

	return results
}
