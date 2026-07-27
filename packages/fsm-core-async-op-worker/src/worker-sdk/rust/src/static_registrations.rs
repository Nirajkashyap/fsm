//! Static (compile-time-only) actor registrations — the alternative to
//! validate_async_operation.rs's folder-scan-then-match-against-registry.rs
//! flow (see main.rs's `--registry-source` flag).
//!
//! Returns the exact `Vec<ActorRegistration>` to serve directly: no
//! `--folder-path`, no runtime text-pattern verification against the real
//! FSM folder, no "verified but unlinked" reporting for actors not yet
//! wired up — just the FSM identity + handler pairs this binary actually
//! serves, hardcoded below.
//!
//! Reuses registry.rs's `known_handler()` for the actual handler functions
//! (rather than re-declaring the same `#[path]` mods here) — the two files
//! disagree only on where the *identity* (parent_fsm_name/version, fsm_type,
//! fsm_version) comes from, not on which Rust functions implement actors.
//!
//! Trade-off vs. registry.rs + validate_async_operation.rs: simpler, and
//! honest about compiled languages having the registry as the real source
//! of truth rather than the filesystem — but the identity metadata has to
//! be kept in sync by hand here instead of being derived from the real
//! actor folder, and there's no visibility into actors that exist on disk
//! but aren't wired into `known_handler()` yet.

use crate::protocol::RegisteredActor;
use crate::registry::known_handler;
use crate::sdk::ActorRegistration;

/// (parent_fsm_name, parent_fsm_version, fsm_type, fsm_name, fsm_version)
const STATIC_ACTOR_IDENTITIES: &[(&str, &str, &str, &str, &str)] =
    &[("creditCheck", "v01", "promise", "checkBureauRust", "v01")];

pub fn static_registrations() -> Vec<ActorRegistration> {
    STATIC_ACTOR_IDENTITIES
        .iter()
        .filter_map(
            |&(parent_fsm_name, parent_fsm_version, fsm_type, fsm_name, fsm_version)| {
                let handler = known_handler(fsm_name).or_else(|| {
                    eprintln!(
                        "static registration {}@{}@{}@{}@{} has no known_handler() entry, skipping",
                        parent_fsm_name, parent_fsm_version, fsm_type, fsm_name, fsm_version
                    );
                    None
                })?;

                Some(ActorRegistration {
                    meta: RegisteredActor {
                        parent_fsm_name: parent_fsm_name.to_string(),
                        parent_fsm_version: parent_fsm_version.to_string(),
                        fsm_type: fsm_type.to_string(),
                        fsm_name: fsm_name.to_string(),
                        fsm_version: fsm_version.to_string(),
                        fsm_language: "rust".to_string(),
                    },
                    handler,
                })
            },
        )
        .collect()
}
