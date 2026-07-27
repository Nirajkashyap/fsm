//! Wire protocol for the gateway <-> per-language worker sidecar connection.
//!
//! Rust port of ../../sidecar/protocol.ts. Wire shapes must match that file
//! byte-for-byte (same JSON key names, same framing) since a Rust worker
//! process and the TypeScript-hosted gateway talk this protocol to each
//! other over the same Unix socket.
//!
//! Framing: 4-byte big-endian length prefix + UTF-8 JSON payload — chosen
//! over newline/stdio framing so a worker's own prints can never corrupt
//! the RPC channel (see SPEC-001).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WireEnvelope {
    pub v: String,
    pub id: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub ts_unix_ms: i64,
    pub source: String,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    pub body: Value,
}

/// One actor entrypoint a worker process serves. Mirrors
/// ActorPluginValidationResult's identity fields (see @pgfsm/compiler's
/// util.ts) — `actor_key()` is what the gateway routes on.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegisteredActor {
    #[serde(rename = "parentFsmName")]
    pub parent_fsm_name: String,
    #[serde(rename = "parentFsmVersion")]
    pub parent_fsm_version: String,
    #[serde(rename = "fsmType")]
    pub fsm_type: String,
    #[serde(rename = "fsmName")]
    pub fsm_name: String,
    #[serde(rename = "fsmVersion")]
    pub fsm_version: String,
    #[serde(rename = "fsmLanguage")]
    pub fsm_language: String,
}

pub fn actor_key(
    parent_fsm_name: &str,
    parent_fsm_version: &str,
    fsm_type: &str,
    fsm_name: &str,
    fsm_version: &str,
    fsm_language: &str,
) -> String {
    format!(
        "{}@{}@{}@{}@{}@{}",
        parent_fsm_name, parent_fsm_version, fsm_type, fsm_name, fsm_version, fsm_language
    )
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// A monotonic counter is enough uniqueness for envelope ids — the gateway
// never inspects this field's format, only `type` and `body` (see
// sidecar/gateway.ts's handleConnection), so a real UUID crate isn't needed.
static ENVELOPE_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_envelope_id() -> String {
    let n = ENVELOPE_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}", now_unix_ms(), n)
}

pub fn make_envelope(msg_type: &str, source: &str, target: &str, body: Value) -> WireEnvelope {
    WireEnvelope {
        v: "1.0".to_string(),
        id: next_envelope_id(),
        msg_type: msg_type.to_string(),
        ts_unix_ms: now_unix_ms(),
        source: source.to_string(),
        target: target.to_string(),
        trace_id: None,
        body,
    }
}

pub fn write_frame(stream: &mut UnixStream, envelope: &WireEnvelope) -> io::Result<()> {
    let payload =
        serde_json::to_vec(envelope).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    let len =
        u32::try_from(payload.len()).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    stream.write_all(&len.to_be_bytes())?;
    stream.write_all(&payload)?;
    Ok(())
}

/// Returns `Ok(None)` on a clean EOF (mirrors protocol.ts's `readFrame()`
/// returning `null`), `Err` on a real I/O error.
pub fn read_frame(stream: &mut UnixStream) -> io::Result<Option<WireEnvelope>> {
    let mut len_buf = [0u8; 4];
    if !read_exact_or_eof(stream, &mut len_buf)? {
        return Ok(None);
    }
    let len = u32::from_be_bytes(len_buf) as usize;

    let mut payload = vec![0u8; len];
    if !read_exact_or_eof(stream, &mut payload)? {
        return Ok(None);
    }

    let envelope: WireEnvelope = serde_json::from_slice(&payload)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    Ok(Some(envelope))
}

/// Like `Read::read_exact`, but treats EOF on the very first byte as a
/// clean disconnect (`Ok(false)`) instead of an error.
fn read_exact_or_eof(stream: &mut UnixStream, buf: &mut [u8]) -> io::Result<bool> {
    let mut offset = 0;
    while offset < buf.len() {
        match stream.read(&mut buf[offset..]) {
            Ok(0) => return Ok(false),
            Ok(n) => offset += n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(true)
}
