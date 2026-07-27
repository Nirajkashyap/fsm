//! worker-sdk/rust reference binary — Rust reference worker for the
//! Activity Gateway.
//!
//! Rust counterpart of ../typescript/cli.ts and ../python/cli.py: by
//! default (--registry-source folder) calls
//! validate_async_operation_from_folders_rust against --folder-path (this
//! repo's real FSM actor convention — see
//! apps/fsm-core-example/fsm/creditCheck/v01/rust/actors/checkBureauRust/checkBureauRust.rs),
//! then matches each verified result against `registry::known_handler()`,
//! a small compile-time table of actor functions that are actually linked
//! into this binary; anything verified-but-unlinked is reported and
//! skipped rather than silently dropped. With --registry-source static,
//! skips the folder scan entirely and serves
//! `static_registrations::static_registrations()`'s hardcoded identity
//! list instead — see that module's doc for the trade-off.
//!
//! USAGE
//!   cargo run --release -- [options]
//!
//! OPTIONS
//!   --registry-source <folder|static>   Where actor registrations come from (default: folder)
//!   --folder-path <path>      Absolute path to FSM folder (required when --registry-source folder)
//!   --skip-dirs <dirs>        Comma-separated top-level directory names to skip (folder source only)
//!   --gateway-socket <path>   Sidecar socket to connect to (default: /tmp/pgfsm-activity-gateway-workers.sock)
//!   --worker-id <id>          Stable worker identity (default: rust-<pid>)
//!   --heartbeat-ms <ms>       Heartbeat interval (default: 5000)
//!   -h, --help                Show this help message

mod protocol;
mod registry;
mod sdk;
mod static_registrations;
mod validate_async_operation;

use protocol::RegisteredActor;
use registry::known_handler;
use sdk::{ActorHandler, ActorRegistration, ActorWorker, ActorWorkerOptions};
use std::env;
use std::process;
use std::sync::Arc;
use validate_async_operation::{
    validate_async_operation_from_folders_rust, ActorPluginValidationResult,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum RegistrySource {
    Folder,
    Static,
}

struct Args {
    registry_source: RegistrySource,
    folder_path: Option<String>,
    skip_dirs: Vec<String>,
    gateway_socket_path: String,
    worker_id: String,
    heartbeat_ms: u64,
}

fn print_help() {
    println!(
        "worker-sdk-rust — Rust reference worker for the Activity Gateway\n\n\
USAGE\n  cargo run --release -- [options]\n\n\
OPTIONS\n\
  --registry-source <folder|static>   Where actor registrations come from (default: folder)\n\
  --folder-path <path>      Absolute path to FSM folder (required when --registry-source folder)\n\
  --skip-dirs <dirs>        Comma-separated top-level directory names to skip (folder source only)\n\
  --gateway-socket <path>   Sidecar socket to connect to (default: /tmp/pgfsm-activity-gateway-workers.sock)\n\
  --worker-id <id>          Stable worker identity (default: rust-<pid>)\n\
  --heartbeat-ms <ms>       Heartbeat interval (default: 5000)\n\
  -h, --help                Show this help message"
    );
}

fn parse_args() -> Args {
    let mut registry_source = RegistrySource::Folder;
    let mut folder_path: Option<String> = None;
    let mut skip_dirs: Vec<String> = Vec::new();
    let mut gateway_socket_path = "/tmp/pgfsm-activity-gateway-workers.sock".to_string();
    let mut worker_id: Option<String> = None;
    let mut heartbeat_ms: u64 = 5000;

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_help();
                process::exit(0);
            }
            "--registry-source" => {
                let value = args.next().unwrap_or_else(|| {
                    eprintln!("--registry-source requires a value");
                    process::exit(1);
                });
                registry_source = match value.as_str() {
                    "folder" => RegistrySource::Folder,
                    "static" => RegistrySource::Static,
                    other => {
                        eprintln!(
                            "--registry-source must be one of: folder, static. Got: {}",
                            other
                        );
                        process::exit(1);
                    }
                };
            }
            "--folder-path" => {
                folder_path = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--folder-path requires a value");
                    process::exit(1);
                }));
            }
            "--skip-dirs" => {
                let value = args.next().unwrap_or_else(|| {
                    eprintln!("--skip-dirs requires a value");
                    process::exit(1);
                });
                skip_dirs = value
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            "--gateway-socket" => {
                gateway_socket_path = args.next().unwrap_or_else(|| {
                    eprintln!("--gateway-socket requires a value");
                    process::exit(1);
                });
            }
            "--worker-id" => {
                worker_id = Some(args.next().unwrap_or_else(|| {
                    eprintln!("--worker-id requires a value");
                    process::exit(1);
                }));
            }
            "--heartbeat-ms" => {
                let value = args.next().unwrap_or_else(|| {
                    eprintln!("--heartbeat-ms requires a value");
                    process::exit(1);
                });
                heartbeat_ms = value.parse().unwrap_or_else(|_| {
                    eprintln!("--heartbeat-ms must be a positive integer, got: {}", value);
                    process::exit(1);
                });
            }
            other => {
                eprintln!("Unknown argument: {}", other);
                print_help();
                process::exit(1);
            }
        }
    }

    let worker_id = worker_id.unwrap_or_else(|| format!("rust-{}", process::id()));
    if registry_source == RegistrySource::Folder && folder_path.is_none() {
        eprintln!("--folder-path is required when --registry-source is folder (the default)");
        print_help();
        process::exit(1);
    }

    Args {
        registry_source,
        folder_path,
        skip_dirs,
        gateway_socket_path,
        worker_id,
        heartbeat_ms,
    }
}

fn print_result(result: &ActorPluginValidationResult, handler: &Option<ActorHandler>) {
    let key = format!(
        "{}@{}@{}@{}@{}@{}",
        result.parent_fsm_name,
        result.parent_fsm_version,
        result.fsm_type,
        result.fsm_name,
        result.fsm_version,
        result.fsm_language
    );
    if !result.is_verified {
        println!(
            "  - {} ({}): {}",
            key,
            result.fsm_module_path,
            result.error_message.as_deref().unwrap_or("not verified")
        );
    } else if handler.is_some() {
        println!("  + {} ({})", key, result.fsm_module_path);
    } else {
        println!(
            "  ~ {} ({}): verified but no compiled-in handler registered (see known_handler() in registry.rs)",
            key, result.fsm_module_path
        );
    }
}

fn registrations_from_folder(folder_path: &str, skip_dirs: &[String]) -> Vec<ActorRegistration> {
    let results = validate_async_operation_from_folders_rust(folder_path, skip_dirs);
    println!(
        "Discovered {} actor(s) under {}",
        results.len(),
        folder_path
    );

    let mut registrations = Vec::new();
    for result in &results {
        let handler = if result.is_verified {
            known_handler(&result.fsm_name)
        } else {
            None
        };
        print_result(result, &handler);
        if let Some(handler) = handler {
            registrations.push(ActorRegistration {
                meta: RegisteredActor {
                    parent_fsm_name: result.parent_fsm_name.clone(),
                    parent_fsm_version: result.parent_fsm_version.clone(),
                    fsm_type: result.fsm_type.clone(),
                    fsm_name: result.fsm_name.clone(),
                    fsm_version: result.fsm_version.clone(),
                    fsm_language: result.fsm_language.clone(),
                },
                handler,
            });
        }
    }
    registrations
}

fn main() {
    let args = parse_args();

    let registrations = match args.registry_source {
        RegistrySource::Folder => {
            // Safe: parse_args() already required --folder-path for this source.
            let folder_path = args.folder_path.as_deref().unwrap();
            registrations_from_folder(folder_path, &args.skip_dirs)
        }
        RegistrySource::Static => {
            let registrations = static_registrations::static_registrations();
            println!(
                "Using {} static registration(s) (--registry-source static)",
                registrations.len()
            );
            registrations
        }
    };

    if registrations.is_empty() {
        eprintln!("No actors with a compiled-in handler found, refusing to start worker");
        process::exit(1);
    }

    let worker = Arc::new(ActorWorker::new(
        ActorWorkerOptions {
            worker_id: args.worker_id.clone(),
            gateway_socket_path: args.gateway_socket_path.clone(),
            heartbeat_ms: args.heartbeat_ms,
        },
        registrations,
    ));

    let worker_for_signal = worker.clone();
    ctrlc::set_handler(move || {
        println!("Shutdown requested — stopping worker...");
        worker_for_signal.stop();
    })
    .expect("failed to set SIGINT/SIGTERM handler");

    println!(
        "Starting worker {}: gateway-socket={}",
        args.worker_id, args.gateway_socket_path
    );

    if let Err(err) = worker.run() {
        eprintln!("Worker {} failed: {}", args.worker_id, err);
        process::exit(1);
    }

    println!("Worker {} stopped.", args.worker_id);
}
