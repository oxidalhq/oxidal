//! Headless TONE3000 account authorization. Tokens never cross the local HTTP contract.
//! @see docs/tone3000-account.md
use crate::{Shared, failure};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;
pub(super) mod catalog;
pub(super) mod download;
pub(super) mod images;
mod storage;
#[cfg(test)]
mod tests;

const ORIGIN: &str = "https://www.tone3000.com";
const MAX_REPLY: usize = 32 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountPhase {
    Disconnected,
    Requesting,
    Waiting,
    Connected,
    Reconnecting,
    Error,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AccountState {
    pub session: String,
    pub revision: u64,
    pub phase: AccountPhase,
    /// Public application identifier, never the secret key or an access token.
    pub client_id: Option<String>,
    pub user_code: Option<String>,
    pub verification_uri: Option<String>,
    pub expires_at: Option<u64>,
    pub error: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AccountCommand {
    pub session: String,
    pub expected_revision: u64,
    pub action: AccountAction,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AccountAction {
    Connect { client_id: String },
    Cancel,
    Disconnect,
}
type Reply = Result<AccountState, &'static str>;
#[derive(Debug)]
pub(super) struct Account {
    state: watch::Receiver<AccountState>,
    access: mpsc::Sender<oneshot::Sender<Result<Access, &'static str>>>,
    requests: tokio::sync::Semaphore,
    commands: mpsc::Sender<(AccountCommand, oneshot::Sender<Reply>)>,
}
impl Account {
    pub fn new(root: PathBuf, shutdown: Option<watch::Receiver<bool>>) -> Result<Self, String> {
        Self::start(root, shutdown, ORIGIN.into())
    }
    fn start(
        root: PathBuf,
        shutdown: Option<watch::Receiver<bool>>,
        origin: String,
    ) -> Result<Self, String> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "Cannot initialize account client")?;
        let mut state = AccountState {
            session: format!(
                "account-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ),
            revision: 0,
            phase: AccountPhase::Disconnected,
            client_id: None,
            user_code: None,
            verification_uri: None,
            expires_at: None,
            error: None,
        };
        let saved = match storage::load(&root) {
            Ok(saved) => saved,
            Err(error) => {
                state.phase = AccountPhase::Error;
                state.error = Some(error.into());
                None
            }
        };
        let mut tokens = None;
        if let Some(saved) = saved {
            state.client_id = Some(saved.client_id);
            tokens = saved.tokens;
            if tokens.is_some() {
                state.phase = AccountPhase::Reconnecting;
            }
        }
        let (updates, receive) = watch::channel(state.clone());
        let (commands, inbox) = mpsc::channel(8);
        let (access, access_inbox) = mpsc::channel(4);
        let owner = Owner {
            state,
            updates,
            root,
            client,
            origin,
            tokens,
            device: None,
            job: None,
            next: Instant::now(),
            shutdown,
        };
        tokio::spawn(owner.run(inbox, access_inbox));
        Ok(Self {
            state: receive,
            commands,
            access,
            requests: tokio::sync::Semaphore::new(2),
        })
    }
    async fn access(&self) -> Result<Access, &'static str> {
        let (reply, receive) = oneshot::channel();
        self.access
            .try_send(reply)
            .map_err(|_| "Account service busy")?;
        receive.await.map_err(|_| "Account service stopped")?
    }
    fn current(&self, access: &Access) -> bool {
        let state = self.state.borrow();
        state.phase == AccountPhase::Connected && state.revision == access.revision
    }
    async fn command(&self, command: AccountCommand) -> Reply {
        let (reply, receive) = oneshot::channel();
        self.commands
            .try_send((command, reply))
            .map_err(|_| "Account service busy; refresh before retrying")?;
        receive.await.map_err(|_| "Account service stopped")?
    }
}
// Internal capability only. Never Serialize or Debug credentials.
struct Access {
    client: reqwest::Client,
    origin: String,
    token: String,
    revision: u64,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}
struct Device {
    code: String,
    deadline: Instant,
    interval: Duration,
}
type Job = Pin<Box<dyn Future<Output = Outcome> + Send>>;
enum Outcome {
    Device(Result<DeviceReply, RemoteError>),
    Token(Result<TokenReply, RemoteError>),
}
struct Owner {
    state: AccountState,
    updates: watch::Sender<AccountState>,
    root: PathBuf,
    client: reqwest::Client,
    origin: String,
    tokens: Option<Tokens>,
    device: Option<Device>,
    job: Option<Job>,
    next: Instant,
    shutdown: Option<watch::Receiver<bool>>,
}
impl Owner {
    fn publish(&mut self) {
        self.state.revision += 1;
        self.updates.send_replace(self.state.clone());
    }
    fn clear_code(&mut self) {
        self.device = None;
        self.state.user_code = None;
        self.state.verification_uri = None;
        self.state.expires_at = None;
    }
    fn fail(&mut self, message: &'static str) {
        self.job = None;
        self.clear_code();
        self.state.phase = AccountPhase::Error;
        self.state.error = Some(message.into());
        self.publish();
    }
    fn save(&self) -> Result<(), &'static str> {
        storage::save(
            &self.root,
            self.state.client_id.as_deref(),
            self.tokens.as_ref(),
        )
    }
    fn command(&mut self, command: AccountCommand) -> Reply {
        if command.session != self.state.session || command.expected_revision != self.state.revision
        {
            return Err("Account state changed; refresh before retrying");
        }
        match command.action {
            AccountAction::Connect { client_id } => {
                if !valid_client(&client_id) {
                    return Err("Enter a publishable application key, not a secret key");
                }
                if self.tokens.is_some() {
                    return Err("Disconnect the current account before connecting another");
                }
                // Commit the public identity first. A failed write must not start remote authorization.
                storage::save(&self.root, Some(&client_id), None)?;
                self.job = None;
                self.clear_code();
                self.state.client_id = Some(client_id.clone());
                self.state.phase = AccountPhase::Requesting;
                self.state.error = None;
                let client = self.client.clone();
                let origin = self.origin.clone();
                self.job = Some(Box::pin(async move {
                    Outcome::Device(
                        request(
                            &client,
                            &origin,
                            "device_authorization",
                            vec![("client_id", client_id)],
                        )
                        .await,
                    )
                }));
            }
            AccountAction::Cancel | AccountAction::Disconnect => {
                // Revoking local access must remain effective after daemon restart.
                storage::save(&self.root, self.state.client_id.as_deref(), None)?;
                self.job = None;
                self.tokens = None;
                self.clear_code();
                self.state.phase = AccountPhase::Disconnected;
                self.state.error = None;
            }
        }
        self.publish();
        Ok(self.state.clone())
    }
    fn schedule(&mut self) {
        if self.job.is_some()
            || matches!(
                self.state.phase,
                AccountPhase::Disconnected | AccountPhase::Error
            )
        {
            return;
        }
        let now = Instant::now();
        if self.device.as_ref().is_some_and(|d| now >= d.deadline) {
            self.fail("Sign-in code expired. Connect again for a new code.");
            return;
        }
        if now < self.next {
            return;
        }
        let fields = if let Some(device) = &self.device {
            vec![
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:device_code".into(),
                ),
                ("device_code", device.code.clone()),
            ]
        } else if let Some(tokens) = &self.tokens {
            vec![
                ("grant_type", "refresh_token".into()),
                ("refresh_token", tokens.refresh_token.clone()),
            ]
        } else {
            return;
        };
        let mut fields = fields;
        fields.push(("client_id", self.state.client_id.clone().unwrap()));
        let client = self.client.clone();
        let origin = self.origin.clone();
        self.job = Some(Box::pin(async move {
            Outcome::Token(request(&client, &origin, "token", fields).await)
        }));
    }
    fn completed(&mut self, outcome: Outcome) {
        self.job = None;
        match outcome {
            Outcome::Device(Ok(reply)) => {
                if !reply.valid() { self.fail("TONE3000 returned an invalid sign-in code"); return; }
                let interval = Duration::from_secs(reply.interval.unwrap_or(5).max(1));
                self.device = Some(Device { code: reply.device_code, interval,
                    deadline: Instant::now() + Duration::from_secs(reply.expires_in) });
                self.state.user_code = Some(reply.user_code);
                // Only the documented provider page is exposed. Never trust returned redirect URLs.
                self.state.verification_uri = Some(format!("{ORIGIN}/activate"));
                self.state.expires_at = Some(epoch() + reply.expires_in);
                self.state.phase = AccountPhase::Waiting; self.state.error = None;
                self.next = Instant::now() + interval; self.publish();
            }
            Outcome::Device(Err(_)) => self.fail("Could not request sign-in. Check internet access and the publishable key, then retry."),
            Outcome::Token(Ok(reply)) => {
                if !reply.valid() { self.fail("TONE3000 returned an invalid account response"); return; }
                self.tokens = Some(Tokens { access_token: reply.access_token, refresh_token: reply.refresh_token,
                    expires_at: epoch() + reply.expires_in });
                self.clear_code();
                if let Err(error) = self.save() {
                    self.tokens = None; self.fail(error); return;
                }
                self.next = Instant::now() + Duration::from_secs(reply.expires_in.saturating_sub(30).max(reply.expires_in / 2).max(1));
                self.state.phase = AccountPhase::Connected; self.state.error = None; self.publish();
            }
            Outcome::Token(Err(error)) => {
                if let Some(device) = self.device.as_mut() {
                    match error {
                        RemoteError::Pending => (),
                        RemoteError::Slow => device.interval += Duration::from_secs(5),
                        RemoteError::Transient => {
                            device.interval = device.interval.max(Duration::from_secs(10));
                            self.state.error = Some("Waiting for TONE3000. Check internet access.".into());
                        }
                        _ => { self.fail("Sign-in was declined or expired. Connect again to retry."); return; }
                    }
                    self.next = Instant::now() + device.interval; self.publish();
                } else if matches!(error, RemoteError::Invalid | RemoteError::Denied) {
                    self.tokens = None;
                    if let Err(error) = self.save() { self.fail(error); return; }
                    self.fail("Account authorization expired. Connect again.");
                } else {
                    // No outbound account requests use an expired access token. Retry refresh separately from audio.
                    self.next = Instant::now() + Duration::from_secs(30);
                    self.state.phase = AccountPhase::Reconnecting;
                    self.state.error = Some("Account reconnecting. Local presets remain available.".into()); self.publish();
                }
            }
        }
    }
    async fn run(
        mut self,
        mut inbox: mpsc::Receiver<(AccountCommand, oneshot::Sender<Reply>)>,
        mut access: mpsc::Receiver<oneshot::Sender<Result<Access, &'static str>>>,
    ) {
        let mut timer = tokio::time::interval(Duration::from_millis(250));
        loop {
            if self.shutdown.as_ref().is_some_and(|s| *s.borrow()) {
                break;
            }
            tokio::select! {
                biased;
                command = inbox.recv() => match command {
                    Some((command, reply)) => { let _ = reply.send(self.command(command)); },
                    None => break,
                },
                Some(reply) = access.recv() => {
                    let result = self.tokens.as_ref()
                        .filter(|t| self.state.phase == AccountPhase::Connected && t.expires_at > epoch() + 15)
                        .map(|t| Access { client: self.client.clone(), origin: self.origin.clone(), token: t.access_token.clone(), revision: self.state.revision })
                        .ok_or("Connect your TONE3000 account before browsing");
                    let _ = reply.send(result);
                },
                result = async { match self.job.as_mut() { Some(job) => job.await, None => std::future::pending().await } } => self.completed(result),
                _ = timer.tick() => self.schedule(),
            }
        }
    }
}
fn epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn valid_client(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !value.starts_with("t3k_cs_")
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}
#[derive(Deserialize)]
struct DeviceReply {
    device_code: String,
    user_code: String,
    expires_in: u64,
    interval: Option<u64>,
}
impl DeviceReply {
    fn valid(&self) -> bool {
        !self.device_code.is_empty()
            && self.device_code.len() <= 4096
            && !self.user_code.is_empty()
            && self.user_code.len() <= 64
            && self
                .user_code
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b' '))
            && (1..=86400).contains(&self.expires_in)
            && self.interval.is_none_or(|n| (1..=3600).contains(&n))
    }
}
#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    token_type: String,
}
impl TokenReply {
    fn valid(&self) -> bool {
        valid_token(&self.access_token)
            && valid_token(&self.refresh_token)
            && (1..=2_678_400).contains(&self.expires_in)
            && self.token_type.eq_ignore_ascii_case("bearer")
    }
}
fn valid_token(value: &str) -> bool {
    !value.is_empty() && value.len() <= 8192 && value.bytes().all(|b| b.is_ascii_graphic())
}
enum RemoteError {
    Pending,
    Slow,
    Invalid,
    Denied,
    Transient,
}
async fn request<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    origin: &str,
    endpoint: &str,
    fields: Vec<(&str, String)>,
) -> Result<T, RemoteError> {
    let mut response = client
        .post(format!("{origin}/api/v1/oauth/{endpoint}"))
        .form(&fields)
        .send()
        .await
        .map_err(|_| RemoteError::Transient)?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| RemoteError::Transient)? {
        if bytes.len() + chunk.len() > MAX_REPLY {
            return Err(RemoteError::Invalid);
        }
        bytes.extend_from_slice(&chunk);
    }
    if status.is_success() {
        return serde_json::from_slice(&bytes).map_err(|_| RemoteError::Invalid);
    }
    #[derive(Deserialize)]
    struct ErrorCode {
        error: String,
    }
    let error = serde_json::from_slice::<ErrorCode>(&bytes).ok();
    Err(match error.as_ref().map(|e| e.error.as_str()) {
        Some("authorization_pending") => RemoteError::Pending,
        Some("slow_down") => RemoteError::Slow,
        Some("access_denied") => RemoteError::Denied,
        Some("expired_token" | "invalid_grant" | "invalid_client") => RemoteError::Invalid,
        _ if status.is_server_error() || status.as_u16() == 429 => RemoteError::Transient,
        _ => RemoteError::Invalid,
    })
}
pub(super) async fn state(State(shared): State<Arc<Shared>>) -> Json<AccountState> {
    Json(shared.account.state.borrow().clone())
}
pub(super) async fn command(
    State(shared): State<Arc<Shared>>,
    Json(command): Json<AccountCommand>,
) -> Response {
    match shared.account.command(command).await {
        Ok(state) => Json(state).into_response(),
        Err(error) => failure(StatusCode::CONFLICT, error),
    }
}
