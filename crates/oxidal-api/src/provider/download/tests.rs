use super::super::catalog::tests::{account, tone};
use super::*;
use axum::{Router, routing::get};
use serde_json::json;
fn model(headers: axum::http::HeaderMap) -> Json<serde_json::Value> {
    let host = headers["host"].to_str().unwrap();
    Json(
        json!({"id":9,"tone_id":7,"name":"Crunch","size":null,"architecture_version":"2","model_url":format!("http://{host}/api/v1/models/9/download/model.nam")}),
    )
}
#[tokio::test]
async fn entitled_download_is_verified_and_recalls_without_account_or_network() {
    let app = Router::new()
        .route("/api/v1/tones/7", get(|| async { Json(tone()) }))
        .route(
            "/api/v1/models/9",
            get(|headers: axum::http::HeaderMap| async move { model(headers) }),
        )
        .route(
            "/api/v1/models/9/download/model.nam",
            get(|headers: axum::http::HeaderMap| async move {
                assert_eq!(headers["authorization"], "Bearer fixture-access");
                r#"{"architecture":"Linear","weights":[1]}"#
            }),
        );
    let (account, server, root) = account(app).await;
    let cached = root.join("audition-models");
    let staged = account
        .stage_model(
            StageModel {
                tone_id: 7,
                model_id: 9,
            },
            cached.clone(),
            None,
        )
        .await
        .unwrap();
    server.abort();
    drop(account);
    let (asset, path) = ModelStore::new(cached).read(&staged.id).unwrap();
    assert_eq!(asset.sha256, staged.sha256);
    assert!(path.is_file());
    let metadata = serde_json::to_string(&asset).unwrap();
    assert!(!metadata.contains("fixture-access"));
    assert!(!metadata.contains("http://"));
    assert!(metadata.contains("oxidal-model://"));
    assert!(metadata.contains("creator"));
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn wrong_target_and_redirect_never_publish_an_asset() {
    let app = Router::new()
        .route("/api/v1/tones/7", get(|| async { Json(tone()) }))
        .route(
            "/api/v1/models/9",
            get(|headers: axum::http::HeaderMap| async move { model(headers) }),
        )
        .route(
            "/api/v1/models/10",
            get(|headers: axum::http::HeaderMap| async move { model(headers) }),
        )
        .route(
            "/api/v1/models/9/download/model.nam",
            get(|| async { axum::response::Redirect::temporary("http://127.0.0.1:1/credentials") }),
        );
    let (account, server, root) = account(app).await;
    let cached = root.join("audition-models");
    assert!(
        account
            .stage_model(
                StageModel {
                    tone_id: 7,
                    model_id: 10
                },
                cached.clone(),
                None,
            )
            .await
            .is_err()
    );
    assert_eq!(
        account
            .stage_model(
                StageModel {
                    tone_id: 7,
                    model_id: 9
                },
                cached.clone(),
                None,
            )
            .await
            .unwrap_err(),
        "Untrusted model download redirect"
    );
    assert!(!cached.exists());
    let access = account.access().await.unwrap();
    for url in [
        "http://127.0.0.1:1/",
        "https://evil.test/api/v1/models/9/download/x",
        "https://www.tone3000.com.evil.test/api/v1/models/9/download/x",
    ] {
        assert!(valid_initial(&access, url, 9).is_err());
    }
    server.abort();
    drop(account);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn empty_download_and_disconnect_during_transfer_leave_no_selectable_asset() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (seen, go) = (entered.clone(), release.clone());
    let app = Router::new()
        .route("/api/v1/tones/7", get(|| async { Json(tone()) }))
        .route(
            "/api/v1/models/9",
            get(|headers: axum::http::HeaderMap| async move { model(headers) }),
        )
        .route(
            "/api/v1/models/9/download/model.nam",
            get(move || {
                let (seen, go) = (seen.clone(), go.clone());
                async move {
                    seen.notify_one();
                    go.notified().await;
                    "downloaded model"
                }
            }),
        );
    let (account, server, root) = account(app).await;
    let account = Arc::new(account);
    let reader = account.clone();
    let cached = root.join("audition-models");
    let destination = cached.clone();
    let task = tokio::spawn(async move {
        reader
            .stage_model(
                StageModel {
                    tone_id: 7,
                    model_id: 9,
                },
                destination,
                None,
            )
            .await
    });
    entered.notified().await;
    let state = account.state.borrow().clone();
    account
        .command(super::super::AccountCommand {
            session: state.session,
            expected_revision: state.revision,
            action: super::super::AccountAction::Disconnect,
        })
        .await
        .unwrap();
    release.notify_one();
    assert_eq!(
        task.await.unwrap().unwrap_err(),
        "Account changed; retry the selection"
    );
    assert!(!cached.exists());
    server.abort();
    drop(account);
    std::fs::remove_dir_all(root).unwrap();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/api/v1/models/9/download", get(|| async { "" })),
        )
        .await
        .unwrap();
    });
    let access = Access {
        client: reqwest::Client::new(),
        origin: origin.clone(),
        token: "fixture".into(),
        revision: 0,
    };
    assert_eq!(
        download(&access, &format!("{origin}/api/v1/models/9/download"), 9)
            .await
            .unwrap_err(),
        "Model download was empty"
    );
    server.abort();
}

#[test]
fn redirects_go_only_to_public_https_names() {
    for (url, trusted) in [
        ("https://api.tone3000.com/files/a.nam", true),
        ("https://cdn.example-storage.net/o/a.nam?sig=x", true),
        ("http://cdn.example-storage.net/a.nam", false),
        ("https://127.0.0.1/a.nam", false),
        ("https://[::1]/a.nam", false),
        ("https://localhost/a.nam", false),
        ("https://oxidal.local/a.nam", false),
        ("https://intranet/a.nam", false),
        ("https://cdn.example-storage.net:8443/a.nam", false),
        ("https://user:pass@cdn.example-storage.net/a.nam", false),
        ("https://cdn.example-storage.net/a.nam#x", false),
    ] {
        let parsed = reqwest::Url::parse(url).unwrap();
        assert_eq!(trusted_redirect(&parsed), trusted, "{url}");
    }
}
