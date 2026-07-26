// Go worker SDK: connects to the gateway's sidecar Unix socket, registers a
// compiled-in actor registry, and serves invoke requests.
//
// Unlike worker-sdk/typescript and worker-sdk/python, this has no
// folder-scanning/dynamic-import step — Go has no runtime mechanism to load
// a function out of a .go source file the way import() (TS) or importlib
// (Python) can (this is exactly the gap SPEC-001's Problem section
// describes; Go plugins exist but require exact toolchain/build-flag
// matching between the plugin and host binary and aren't practical here).
// Instead, ActorWorker takes an explicit []ActorRegistration built at
// compile time by the binary that uses this SDK (see main.go) — the actor
// functions are linked into the binary directly, and "verification"
// happens at compile time (it wouldn't build if the function didn't exist
// or had the wrong signature) rather than at worker startup.
//
// Same wire protocol (protocol.go, ported from ../../sidecar/protocol.ts),
// same ActorKey() identity, same register -> heartbeat -> serve lifecycle
// as the TypeScript/Python/Rust versions. Plain blocking net.Conn + a
// goroutine for heartbeats (stdlib only) — the natural Go shape for the
// same protocol.
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// An actor's compiled-in implementation. A returned error is reported to
// the gateway as an INTERNAL invoke error; a panic is also recovered and
// reported the same way rather than crashing the worker process — the Go
// equivalent of catching a thrown exception in the TypeScript/Python
// versions.
type ActorHandler func(input any) (any, error)

type ActorRegistration struct {
	Meta    RegisteredActor
	Handler ActorHandler
}

type ActorWorkerOptions struct {
	WorkerID          string
	GatewaySocketPath string
	HeartbeatMs       int
}

type ActorWorker struct {
	options    ActorWorkerOptions
	handlers   map[string]ActorHandler
	registered []RegisteredActor
	stopped    atomic.Bool
	conn       net.Conn
	connMu     sync.Mutex
}

func NewActorWorker(options ActorWorkerOptions, registrations []ActorRegistration) *ActorWorker {
	handlers := make(map[string]ActorHandler, len(registrations))
	registered := make([]RegisteredActor, 0, len(registrations))
	for _, reg := range registrations {
		key := ActorKey(reg.Meta.ParentFsmName, reg.Meta.ParentFsmVersion, reg.Meta.FsmType, reg.Meta.FsmName, reg.Meta.FsmVersion)
		handlers[key] = reg.Handler
		registered = append(registered, reg.Meta)
	}
	return &ActorWorker{options: options, handlers: handlers, registered: registered}
}

func (w *ActorWorker) Run() error {
	if len(w.registered) == 0 {
		return fmt.Errorf("no actors to register, refusing to start worker")
	}

	conn, err := net.Dial("unix", w.options.GatewaySocketPath)
	if err != nil {
		return err
	}
	w.connMu.Lock()
	w.conn = conn
	w.connMu.Unlock()

	registerBody := map[string]any{
		"worker_id":        w.options.WorkerID,
		"language":         "go",
		"protocol_version": "1.0",
		"actors":           w.registered,
	}
	envelope, err := MakeEnvelope("register", "worker:"+w.options.WorkerID, "gateway", registerBody)
	if err != nil {
		return err
	}
	if err := WriteFrame(conn, envelope); err != nil {
		return err
	}

	ack, err := ReadFrame(conn)
	if err != nil {
		return err
	}
	if ack == nil {
		return fmt.Errorf("gateway closed connection during register")
	}
	if ack.Type != "register_ack" {
		return fmt.Errorf("expected register_ack but got %s", ack.Type)
	}
	var ackBody struct {
		Accepted bool `json:"accepted"`
	}
	if err := json.Unmarshal(ack.Body, &ackBody); err != nil {
		return err
	}
	if !ackBody.Accepted {
		return fmt.Errorf("gateway rejected registration")
	}

	fmt.Printf("Worker %s registered %d actor(s) with the gateway\n", w.options.WorkerID, len(w.registered))

	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		interval := time.Duration(w.options.HeartbeatMs) * time.Millisecond
		for !w.stopped.Load() {
			time.Sleep(interval)
			if w.stopped.Load() {
				return
			}
			hbEnvelope, err := MakeEnvelope("heartbeat", "worker:"+w.options.WorkerID, "gateway", map[string]any{"worker_id": w.options.WorkerID})
			if err != nil {
				continue
			}
			if err := WriteFrame(conn, hbEnvelope); err != nil {
				w.stopped.Store(true)
				return
			}
		}
	}()

	err = w.serveLoop(conn)
	w.stopped.Store(true)
	<-heartbeatDone
	conn.Close()
	return err
}

func (w *ActorWorker) Stop() {
	w.stopped.Store(true)
	w.connMu.Lock()
	if w.conn != nil {
		w.conn.Close()
	}
	w.connMu.Unlock()
}

func (w *ActorWorker) serveLoop(conn net.Conn) error {
	for !w.stopped.Load() {
		envelope, err := ReadFrame(conn)
		if err != nil {
			return err
		}
		if envelope == nil {
			return nil
		}

		switch envelope.Type {
		case "cancel":
			continue
		case "unregister":
			return nil
		case "invoke":
			w.handleInvoke(conn, envelope.Body)
		}
	}
	return nil
}

func (w *ActorWorker) handleInvoke(conn net.Conn, body json.RawMessage) {
	var req struct {
		InvokeID         string `json:"invoke_id"`
		ParentFsmName    string `json:"parent_fsm_name"`
		ParentFsmVersion string `json:"parent_fsm_version"`
		FsmType          string `json:"fsm_type"`
		FsmName          string `json:"fsm_name"`
		FsmVersion       string `json:"fsm_version"`
		Input            any    `json:"input"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		// Malformed invoke body — nothing sane to reply with (no invoke_id).
		return
	}

	key := ActorKey(req.ParentFsmName, req.ParentFsmVersion, req.FsmType, req.FsmName, req.FsmVersion)
	handler, ok := w.handlers[key]
	if !ok {
		w.sendError(conn, req.InvokeID, "NOT_FOUND", fmt.Sprintf("actor not found: %s", key))
		return
	}

	output, err := safeInvoke(handler, req.Input)
	if err != nil {
		w.sendError(conn, req.InvokeID, "INTERNAL", err.Error())
		return
	}

	resultBody := map[string]any{"invoke_id": req.InvokeID, "output": output}
	envelope, err := MakeEnvelope("invoke_result", "worker:"+w.options.WorkerID, "gateway", resultBody)
	if err != nil {
		return
	}
	_ = WriteFrame(conn, envelope)
}

func safeInvoke(handler ActorHandler, input any) (output any, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("panic: %v", r)
		}
	}()
	return handler(input)
}

func (w *ActorWorker) sendError(conn net.Conn, invokeID, code, message string) {
	errorBody := map[string]any{
		"invoke_id": invokeID,
		"error":     map[string]any{"code": code, "message": message, "retriable": false},
	}
	envelope, err := MakeEnvelope("invoke_error", "worker:"+w.options.WorkerID, "gateway", errorBody)
	if err != nil {
		return
	}
	_ = WriteFrame(conn, envelope)
}
