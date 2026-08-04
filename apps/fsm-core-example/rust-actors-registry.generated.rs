#[path = "fsm/creditCheck/v01/rust/actors/mod.rs"]
mod creditcheck_v01;

pub struct ActorRegistration {
    pub parent_fsm_name: &'static str,
    pub parent_fsm_version: &'static str,
    pub fsm_type: &'static str,
    pub fsm_name: &'static str,
    pub fsm_version: &'static str,
    pub fsm_language: &'static str,
    pub handler: fn(serde_json::Value) -> serde_json::Value,
}

pub fn actor_registrations() -> Vec<ActorRegistration> {
    vec![
        ActorRegistration {
            parent_fsm_name: "creditCheck",
            parent_fsm_version: "v01",
            fsm_type: "promise",
            fsm_name: "checkBureauRust",
            fsm_version: "v01",
            fsm_language: "rust",
            handler: creditcheck_v01::checkBureauRust,
        },
    ]
}
