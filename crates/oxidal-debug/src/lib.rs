//! Explicit, bounded debugging on an isolated unprivileged service account.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[cfg(unix)]
pub mod ipc;
#[cfg(unix)]
pub mod runner;
pub const SOCKET: &str = "/run/oxidal-debug/control.sock";
pub const OUTPUT_LIMIT: usize = 8192;
#[derive(Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Status {},
    Enable {},
    Disable {},
    Run { command: String },
    Cancel { id: String },
}
impl std::fmt::Debug for Command {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Debug command [content omitted]")
    }
}
impl Command {
    pub fn validate(&self) -> Result<(), &'static str> {
        match self {
            Self::Run { command }
                if command.trim().is_empty() || command.len() > 2048 || command.contains('\0') =>
            {
                Err("Command must contain 1–2048 bytes without NUL")
            }
            Self::Cancel { id } if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) => {
                Err("Invalid debug job")
            }
            _ => Ok(()),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Job {
    pub id: String,
    pub phase: String,
    pub output: String,
    pub exit_code: Option<i32>,
    pub elapsed_ms: u64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub available: bool,
    pub enabled: bool,
    pub remaining_seconds: u64,
    pub identity: String,
    pub directory: String,
    pub job: Option<Job>,
    pub message: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reply {
    pub state: Option<State>,
    pub error: Option<String>,
}
