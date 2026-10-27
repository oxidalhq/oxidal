use super::*;
use axum::{Form, Router, routing::post};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::atomic::{AtomicUsize, Ordering},
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
fn root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "oxidal-account-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}
fn command(state: &AccountState, action: AccountAction) -> AccountCommand {
    AccountCommand {
        session: state.session.clone(),
        expected_revision: state.revision,
        action,
    }
}
async fn wait(account: &Account, phase: AccountPhase) -> AccountState {
    let mut state = account.state.clone();
    tokio::time::timeout(Duration::from_secs(5), state.wait_for(|s| s.phase == phase))
        .await
        .unwrap()
        .unwrap()
        .clone()
}
#[tokio::test]
async fn real_http_device_flow_restores_refreshes_and_disconnects_without_exposing_tokens() {
    let requests = Arc::new(std::sync::Mutex::new(Vec::<HashMap<String, String>>::new()));
    let captured = requests.clone();
    let app = Router::new().route("/api/v1/oauth/{step}", post(move |Form(fields): Form<HashMap<String,String>>| {
        let captured = captured.clone();
        async move {
            captured.lock().unwrap().push(fields.clone());
            let result = match fields.get("grant_type").map(String::as_str) {
                None => json!({"device_code":"device-secret", "user_code":"ABCD-EFGH", "verification_uri":"https://untrusted.invalid/", "expires_in":600,"interval":1}),
                Some("urn:ietf:params:oauth:grant-type:device_code") => {
                    assert_eq!(fields["device_code"], "device-secret");
                    json!({"access_token":"access-one", "refresh_token":"refresh-one", "token_type":"Bearer", "expires_in":3600})
                },
                Some("refresh_token") => {
                    assert_eq!(fields["refresh_token"], "refresh-one");
                    json!({"access_token":"access-two", "refresh_token":"refresh-two", "token_type":"bearer", "expires_in":3600})
                },
                _ => panic!("unexpected grant"),
            };
            assert_eq!(fields["client_id"], "fixture-client");
            Json(result)
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let root = root();
    let (shutdown, receive) = watch::channel(false);
    let account = Account::start(root.clone(), Some(receive), origin.clone()).unwrap();
    let initial = account.state.borrow().clone();
    let started = account
        .command(command(
            &initial,
            AccountAction::Connect {
                client_id: "fixture-client".into(),
            },
        ))
        .await
        .unwrap();
    assert_eq!(started.phase, AccountPhase::Requesting);
    assert!(
        account
            .command(command(&initial, AccountAction::Cancel))
            .await
            .is_err()
    );
    let waiting = wait(&account, AccountPhase::Waiting).await;
    assert_eq!(
        waiting.verification_uri.as_deref(),
        Some("https://www.tone3000.com/activate")
    );
    let wire = serde_json::to_string(&waiting).unwrap();
    assert!(!wire.contains("device-secret"));
    let connected = wait(&account, AccountPhase::Connected).await;
    let wire = serde_json::to_string(&connected).unwrap();
    for secret in ["access-one", "refresh-one", "device-secret"] {
        assert!(!wire.contains(secret));
    }
    assert!(connected.user_code.is_none());
    let saved = storage::load(&root).unwrap().unwrap();
    assert_eq!(saved.tokens.unwrap().refresh_token, "refresh-one");
    shutdown.send_replace(true);
    drop(account);
    let resumed = Account::start(root.clone(), None, origin).unwrap();
    let connected = wait(&resumed, AccountPhase::Connected).await;
    assert_eq!(
        storage::load(&root)
            .unwrap()
            .unwrap()
            .tokens
            .unwrap()
            .access_token,
        "access-two"
    );
    let disconnected = resumed
        .command(command(&connected, AccountAction::Disconnect))
        .await
        .unwrap();
    assert_eq!(disconnected.phase, AccountPhase::Disconnected);
    assert!(storage::load(&root).unwrap().unwrap().tokens.is_none());
    assert_eq!(requests.lock().unwrap().len(), 3);
    drop(resumed);
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn cancellation_does_not_wait_for_remote_http_and_stale_reply_cannot_connect() {
    let (hit, mut seen) = mpsc::channel(1);
    let app = Router::new().route(
        "/api/v1/oauth/device_authorization",
        post(move || {
            let hit = hit.clone();
            async move {
                let _ = hit.send(()).await;
                tokio::time::sleep(Duration::from_secs(1)).await;
                Json(json!({"device_code":"late", "user_code":"LATE", "expires_in":60}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let root = root();
    let account = Account::start(root.clone(), None, origin).unwrap();
    let initial = account.state.borrow().clone();
    let started = account
        .command(command(
            &initial,
            AccountAction::Connect {
                client_id: "fixture".into(),
            },
        ))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(2), seen.recv())
        .await
        .unwrap()
        .unwrap();
    let stopped = tokio::time::timeout(
        Duration::from_millis(250),
        account.command(command(&started, AccountAction::Cancel)),
    )
    .await
    .unwrap()
    .unwrap();
    tokio::time::sleep(Duration::from_millis(1100)).await;
    assert_eq!(account.state.borrow().phase, AccountPhase::Disconnected);
    assert_eq!(account.state.borrow().revision, stopped.revision);
    drop(account);
    server.abort();
    std::fs::remove_dir_all(root).unwrap();
}
fn owner(root: PathBuf) -> Owner {
    let state = AccountState {
        session: "fixture".into(),
        revision: 0,
        phase: AccountPhase::Disconnected,
        client_id: Some("fixture".into()),
        user_code: None,
        verification_uri: None,
        expires_at: None,
        error: None,
    };
    let (updates, _) = watch::channel(state.clone());
    Owner {
        state,
        updates,
        root,
        client: reqwest::Client::new(),
        origin: ORIGIN.into(),
        tokens: None,
        device: None,
        job: None,
        next: Instant::now(),
        shutdown: None,
    }
}
#[tokio::test]
async fn polling_backoff_expiry_refresh_failure_and_storage_failure_have_honest_states() {
    let root = root();
    let mut owner = owner(root.clone());
    owner.completed(Outcome::Device(Ok(DeviceReply {
        device_code: "private".into(),
        user_code: "CODE".into(),
        expires_in: 600,
        interval: Some(5),
    })));
    owner.completed(Outcome::Token(Err(RemoteError::Pending)));
    assert_eq!(owner.device.as_ref().unwrap().interval.as_secs(), 5);
    owner.completed(Outcome::Token(Err(RemoteError::Slow)));
    assert_eq!(owner.device.as_ref().unwrap().interval.as_secs(), 10);
    assert!(owner.next > Instant::now() + Duration::from_secs(9));
    owner.device.as_mut().unwrap().deadline = Instant::now();
    owner.schedule();
    assert_eq!(owner.state.phase, AccountPhase::Error);
    assert!(owner.device.is_none());
    owner.completed(Outcome::Token(Ok(TokenReply {
        access_token: "access".into(),
        refresh_token: "refresh".into(),
        expires_in: 3600,
        token_type: "bearer".into(),
    })));
    assert_eq!(owner.state.phase, AccountPhase::Connected);
    owner.completed(Outcome::Token(Err(RemoteError::Transient)));
    assert_eq!(owner.state.phase, AccountPhase::Reconnecting);
    assert!(owner.tokens.is_some());
    owner.completed(Outcome::Token(Err(RemoteError::Invalid)));
    assert_eq!(owner.state.phase, AccountPhase::Error);
    assert!(owner.tokens.is_none());
    assert!(storage::load(&root).unwrap().unwrap().tokens.is_none());
    std::fs::remove_dir_all(&root).unwrap();
    std::fs::write(&root, b"storage blocked").unwrap();
    owner.completed(Outcome::Token(Ok(TokenReply {
        access_token: "access".into(),
        refresh_token: "refresh".into(),
        expires_in: 3600,
        token_type: "bearer".into(),
    })));
    assert_eq!(owner.state.phase, AccountPhase::Error);
    assert!(owner.tokens.is_none());
    owner.schedule();
    assert!(owner.job.is_none());
    std::fs::remove_file(root).unwrap();
}
#[test]
fn storage_is_private_atomic_and_rejects_malformed_records_and_secret_keys() {
    assert!(!valid_client("t3k_cs_private"));
    assert!(!valid_client("https://evil.invalid"));
    let root = root();
    storage::save(
        &root,
        Some("fixture"),
        Some(&Tokens {
            access_token: "private-access".into(),
            refresh_token: "private-refresh".into(),
            expires_at: 123,
        }),
    )
    .unwrap();
    let path = root.join("tone3000-account.json");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    std::fs::write(root.join(".account-abandoned.tmp"), b"interrupted").unwrap();
    storage::save(&root, Some("fixture"), None).unwrap();
    assert!(storage::load(&root).unwrap().unwrap().tokens.is_none());
    let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    value["schema"] = json!(99);
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(storage::load(&root).is_err());
    storage::save(&root, None, None).unwrap();
    assert!(storage::load(&root).unwrap().is_none());
    std::fs::remove_dir_all(root).unwrap();
}
