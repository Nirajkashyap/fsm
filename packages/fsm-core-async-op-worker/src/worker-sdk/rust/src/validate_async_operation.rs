//! Discovers and verifies rust promise-actor folders.
//!
//! Rust counterpart of ../typescript/validate-async-operation.ts's
//! validateAsyncOperationFromFoldersTypescript, walking
//! <folder_path>/<fsm_name>/<version>/rust/actors/<actor_name>/<actor_name>.rs
//! (this repo's real FSM actor convention — see
//! apps/fsm-core-example/fsm/creditCheck/v01/rust/actors/checkBureau/checkBureau.rs)
//! instead of the typescript file's .../typescript/actors/... path.
//!
//! Verification inlines packages/fsm-compiler-ts/src/checkers/check_fn.rs's
//! own check (substring match for `pub fn <name>(` / `pub async fn
//! <name>(`) directly in-process, the same way the typescript and python
//! files inline their own checkers instead of shelling out — this file
//! only ever checks rust, in a process that's already... not Rust source
//! being compiled per actor, just plain text pattern matching, so no
//! subprocess/compiler invocation is needed here either.
//!
//! This is validation only, not invocation: unlike Python/TypeScript, a
//! verified result here does not carry a callable — Rust has no runtime
//! mechanism to load a function out of a `.rs` file (see sdk.rs's module
//! doc). The reference binary (main.rs) still has to match verified
//! results against a small compile-time registry of actually-linked-in
//! handler functions.

use std::fs;
use std::path::Path;

const LANG: &str = "rust";

fn is_version_folder_name(name: &str) -> bool {
    // Mirrors @pgfsm/compiler's util.ts isVersionFolderName: /^v\d{2}$/.
    let bytes = name.as_bytes();
    bytes.len() == 3 && bytes[0] == b'v' && bytes[1].is_ascii_digit() && bytes[2].is_ascii_digit()
}

fn has_fn(source: &str, fn_name: &str) -> bool {
    let patterns = [
        format!("pub fn {}(", fn_name),
        format!("pub fn {} (", fn_name),
        format!("pub async fn {}(", fn_name),
        format!("pub async fn {} (", fn_name),
    ];
    patterns.iter().any(|pat| source.contains(pat.as_str()))
}

/// Mirrors @pgfsm/compiler's ActorPluginValidationResult (util.ts) field for
/// field, for parity with the TS/Python versions — main.rs only reads a
/// subset (fsm_name, fsm_type, fsm_version, parent_fsm_*, is_verified,
/// fsm_module_path, error_message); the rest exist for completeness/future
/// consumers.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ActorPluginValidationResult {
    pub src: String,
    pub method: String,
    pub fsm_name: String,
    pub fsm_type: String,
    pub fsm_version: String,
    pub fsm_language: String,
    pub is_verified: bool,
    pub fsm_module_path: String,
    pub parent_fsm_name: String,
    pub parent_fsm_version: String,
    pub parent_fsm_path: String,
    pub error_message: Option<String>,
}

pub fn validate_async_operation_from_folders_rust(
    folder_path: &str,
    skip_dirs: &[String],
) -> Vec<ActorPluginValidationResult> {
    let mut results = Vec::new();

    let abs_folder_path = Path::new(folder_path);
    if !abs_folder_path.is_dir() {
        eprintln!("Provided path is not a directory: {}", folder_path);
        return results;
    }

    let Ok(fsm_entries) = fs::read_dir(abs_folder_path) else {
        return results;
    };
    let mut fsm_dirs: Vec<_> = fsm_entries.flatten().collect();
    fsm_dirs.sort_by_key(|e| e.file_name());

    for fsm_entry in fsm_dirs {
        let fsm_name = fsm_entry.file_name().to_string_lossy().to_string();
        if skip_dirs.iter().any(|d| d == &fsm_name) {
            continue;
        }
        let fsm_dir_path = fsm_entry.path();
        if !fsm_dir_path.is_dir() {
            continue;
        }

        let Ok(version_entries) = fs::read_dir(&fsm_dir_path) else {
            continue;
        };
        let mut version_dirs: Vec<_> = version_entries.flatten().collect();
        version_dirs.sort_by_key(|e| e.file_name());

        for version_entry in version_dirs {
            let version = version_entry.file_name().to_string_lossy().to_string();
            let version_path = version_entry.path();
            if !version_path.is_dir() || !is_version_folder_name(&version) {
                continue;
            }

            let lang_path = version_path.join(LANG);
            if !lang_path.is_dir() {
                continue;
            }

            let actors_path = lang_path.join("actors");
            if !actors_path.is_dir() {
                continue;
            }

            let Ok(actor_entries) = fs::read_dir(&actors_path) else {
                continue;
            };
            let mut actor_dirs: Vec<_> = actor_entries.flatten().collect();
            actor_dirs.sort_by_key(|e| e.file_name());

            for actor_entry in actor_dirs {
                let actor_name = actor_entry.file_name().to_string_lossy().to_string();
                let actor_dir = actor_entry.path();
                if !actor_dir.is_dir() {
                    continue;
                }

                let module_path = actor_dir.join(format!("{}.rs", actor_name));
                if !module_path.is_file() {
                    continue;
                }

                let (is_verified, error_message) = match fs::read_to_string(&module_path) {
                    Ok(source) if has_fn(&source, &actor_name) => (true, None),
                    Ok(_) => (
                        false,
                        Some(format!(
                            "Function '{}' not found in {}",
                            actor_name,
                            module_path.display()
                        )),
                    ),
                    Err(err) => (
                        false,
                        Some(format!("Failed to read {}: {}", module_path.display(), err)),
                    ),
                };

                results.push(ActorPluginValidationResult {
                    src: actor_name.clone(),
                    method: actor_name.clone(),
                    fsm_name: actor_name,
                    fsm_type: "promise".to_string(),
                    fsm_version: version.clone(),
                    fsm_language: LANG.to_string(),
                    is_verified,
                    fsm_module_path: module_path.display().to_string(),
                    parent_fsm_name: fsm_name.clone(),
                    parent_fsm_version: version.clone(),
                    parent_fsm_path: fsm_dir_path.display().to_string(),
                    error_message,
                });
            }
        }
    }

    results
}
