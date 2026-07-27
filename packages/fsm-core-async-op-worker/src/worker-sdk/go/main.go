// worker-sdk/go reference binary — Go reference worker for the Activity
// Gateway.
//
// Go counterpart of ../typescript/cli.ts and ../python/cli.py: calls
// ValidateAsyncOperationFromFoldersGo against --folder-path (this repo's
// real FSM actor convention — see
// apps/fsm-core-example/fsm/creditCheck/v01/go/actors/CheckReportsTable/CheckReportsTable.go),
// filters to verified results, and hands them to ActorWorker — but unlike
// the TS/Python versions, a verified result here isn't itself callable
// (see sdk.go's package doc: Go has no dynamic-loading mechanism). So this
// binary also matches each verified result against knownHandlers
// (registry.go), a small compile-time table of actor functions that are
// actually linked into this binary; anything verified-but-unlinked is
// reported and skipped rather than silently dropped.
//
// USAGE
//
//	go run . --folder-path <path> [options]
//
// OPTIONS
//
//	--folder-path <path>      Absolute path to FSM folder (required)
//	--skip-dirs <dirs>        Comma-separated top-level directory names to skip
//	--gateway-socket <path>   Sidecar socket to connect to (default: /tmp/pgfsm-activity-gateway-workers.sock)
//	--worker-id <id>          Stable worker identity (default: go-<pid>)
//	--heartbeat-ms <ms>       Heartbeat interval (default: 5000)
package main

import (
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

func printResult(result ActorPluginValidationResult, handler ActorHandler) {
	key := fmt.Sprintf("%s@%s@%s@%s@%s@%s", result.ParentFsmName, result.ParentFsmVersion, result.FsmType, result.FsmName, result.FsmVersion, result.FsmLanguage)
	switch {
	case !result.IsVerified:
		fmt.Printf("  - %s (%s): %s\n", key, result.FsmModulePath, result.ErrorMessage)
	case handler != nil:
		fmt.Printf("  + %s (%s)\n", key, result.FsmModulePath)
	default:
		fmt.Printf("  ~ %s (%s): verified but no compiled-in handler registered (see knownHandlers in registry.go)\n", key, result.FsmModulePath)
	}
}

func main() {
	folderPath := flag.String("folder-path", "", "Absolute path to FSM folder (required)")
	skipDirsArg := flag.String("skip-dirs", "", "Comma-separated top-level directory names to skip")
	gatewaySocket := flag.String("gateway-socket", "/tmp/pgfsm-activity-gateway-workers.sock", "Sidecar socket to connect to")
	workerID := flag.String("worker-id", "", "Stable worker identity (default: go-<pid>)")
	heartbeatMs := flag.Int("heartbeat-ms", 5000, "Heartbeat interval")
	flag.Parse()

	if *folderPath == "" {
		fmt.Fprintln(os.Stderr, "--folder-path is required")
		flag.Usage()
		os.Exit(1)
	}
	resolvedFolderPath := *folderPath

	var skipDirs []string
	for _, d := range strings.Split(*skipDirsArg, ",") {
		d = strings.TrimSpace(d)
		if d != "" {
			skipDirs = append(skipDirs, d)
		}
	}

	id := *workerID
	if id == "" {
		id = fmt.Sprintf("go-%d", os.Getpid())
	}

	results := ValidateAsyncOperationFromFoldersGo(resolvedFolderPath, skipDirs)
	fmt.Printf("Discovered %d actor(s) under %s\n", len(results), resolvedFolderPath)

	var registrations []ActorRegistration
	for _, result := range results {
		var handler ActorHandler
		if result.IsVerified {
			handler = knownHandlers[result.FsmName]
		}
		printResult(result, handler)
		if handler != nil {
			registrations = append(registrations, ActorRegistration{
				Meta: RegisteredActor{
					ParentFsmName:    result.ParentFsmName,
					ParentFsmVersion: result.ParentFsmVersion,
					FsmType:          result.FsmType,
					FsmName:          result.FsmName,
					FsmVersion:       result.FsmVersion,
					FsmLanguage:      result.FsmLanguage,
				},
				Handler: handler,
			})
		}
	}

	if len(registrations) == 0 {
		fmt.Fprintln(os.Stderr, "No actors with a compiled-in handler found, refusing to start worker")
		os.Exit(1)
	}

	worker := NewActorWorker(ActorWorkerOptions{
		WorkerID:          id,
		GatewaySocketPath: *gatewaySocket,
		HeartbeatMs:       *heartbeatMs,
	}, registrations)

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-signals
		fmt.Println("Shutdown requested — stopping worker...")
		worker.Stop()
	}()

	fmt.Printf("Starting worker %s: gateway-socket=%s\n", id, *gatewaySocket)
	if err := worker.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Worker %s failed: %v\n", id, err)
		os.Exit(1)
	}
	fmt.Printf("Worker %s stopped.\n", id)
}
