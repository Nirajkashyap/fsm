//! Compile-time registry of actor functions actually linked into this
//! binary, keyed by fsm_name. This is the piece Python/TypeScript get for
//! free from dynamic imports and Rust cannot: adding a new working actor
//! means writing a `#[path]` mod for it below (or a normal `mod`, once it's
//! a real crate) and adding a match arm to `known_handler()`.
//!
//! Kept separate from main.rs so the one part of this binary that changes
//! per-actor (mods + match arms) doesn't churn the CLI/orchestration code.

use crate::sdk::ActorHandler;

// The real actor from apps/fsm-core-example/fsm/creditCheck/v01/rust/actors/checkBureauRust/checkBureauRust.rs,
// included directly (no copy) via #[path] since it isn't its own crate.
// #[allow(non_snake_case)] because the function name must match the FSM
// actor name exactly (checkBureauRust, not check_bureau_rust) for
// validation/lookup.
#[allow(non_snake_case)]
#[path = "../../../../../../apps/fsm-core-example/fsm/creditCheck/v01/rust/actors/checkBureauRust/checkBureauRust.rs"]
mod check_bureau_rust;

pub fn known_handler(fsm_name: &str) -> Option<ActorHandler> {
    match fsm_name {
        "checkBureauRust" => Some(Box::new(check_bureau_rust::checkBureauRust)),
        _ => None,
    }
}
