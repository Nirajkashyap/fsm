// Compile-time registry of actor functions actually linked into this
// binary, keyed by FsmName. This is the piece Python/TypeScript get for
// free from dynamic imports and Go cannot: adding a new working actor here
// means writing (or importing) a real Go function and adding an entry
// below.
//
// CheckReportsTable (this repo's one real go actor, see
// apps/fsm-core-example/fsm/creditCheck/v01/go/actors/CheckReportsTable/CheckReportsTable.go)
// is imported via a local go.mod + replace directive (go.mod in this
// directory) since it isn't part of this module — Go enforces exports at
// compile time for cross-module access, so its function had to be renamed
// from the original unexported "checkReportsTable" stub to "CheckReportsTable"
// (the invoke id gavUnionDBActor's src in machine.ts/fsm.json/xstate-fsm.json
// was updated to match; the other two invokes sharing the old
// "checkReportsTable" name are typescript-language and untouched).
//
// Kept separate from main.go so the one part of this binary that changes
// per-actor (imports + map entries) doesn't churn the CLI/orchestration code.
package main

import (
	checkreportstable "fsm-core-example/creditcheck/v01/go/actors/checkreportstable"
)

var knownHandlers = map[string]ActorHandler{
	"CheckReportsTable": checkreportstable.CheckReportsTable,
}
