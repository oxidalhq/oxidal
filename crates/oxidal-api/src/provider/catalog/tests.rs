use super::super::{AccountAction, AccountCommand, AccountPhase, Tokens, epoch, storage};
use super::*;
use axum::{
    Router,
    extract::RawQuery,
    routing::{get, post},
};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
static NEXT: AtomicUsize = AtomicUsize::new(0);
pub(in crate::provider) fn tone() -> serde_json::Value {
    json!({"id": 7,"title":"Fixture amp", "user":{"username":"creator","display_name":null}, "gear":"amp","format":"nam","license":"t3k","images":["https://images.example.test/amp.png"],"url":"https://www.tone3000.com/tones/fixture","models_count":1,"a2_models_count":1})
}
pub(in crate::provider) async fn account(
    app: Router,
) -> (Account, tokio::task::JoinHandle<()>, std::path::PathBuf) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let app = app.route("/api/v1/oauth/token",post(|| async { Json(json!({"access_token":"fixture-access", "refresh_token":"fixture-refresh", "expires_in":3600,"token_type":"bearer"})) }));
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let root = std::env::temp_dir().join(format!(
        "oxidal-catalog-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    storage::save(
        &root,
        Some("fixture-client"),
        Some(&Tokens {
            access_token: "old".into(),
            refresh_token: "refresh".into(),
            expires_at: epoch() + 3600,
        }),
    )
    .unwrap();
    let account = Account::start(root.clone(), None, origin).unwrap();
    let mut state = account.state.clone();
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        state.wait_for(|s| s.phase == AccountPhase::Connected),
    )
    .await
    .unwrap()
    .unwrap();
    (account, server, root)
}
fn favorites() -> ToneQuery {
    ToneQuery {
        collection: Collection::Favorites,
        page: 1,
        query: "clean & warm".into(),
        gear: None,
    }
}
#[tokio::test]
async fn catalog_uses_internal_authorization_typed_pages_and_explicit_architecture() {
    let app = Router::new()
        .route("/api/v1/tones/favorited", get(|headers:axum::http::HeaderMap, Query(query):Query<std::collections::HashMap<String,String>>| async move {
            assert_eq!(headers["authorization"],"Bearer fixture-access");
            assert_eq!(query["query"],"clean & warm"); assert_eq!(query["page_size"],"20");
            Json(json!({"data":[tone()],"page":1,"total_pages":2,"ignored_secret":"never-forward"}))
        }))
        .route("/api/v1/models", get(|RawQuery(query):RawQuery| async move {
            assert!(query.unwrap().contains("architecture=2"));
            Json(json!({"data":[{"id":9,"tone_id":7,"name":"Crunch","size":null,"architecture_version":"2","model_url":"https://provider.test/private-download"}],"page":1,"total_pages":1}))
        }))
        .route("/api/v1/tones/7", get(|| async {Json(tone())}));
    let (account, server, root) = account(app).await;
    let page = account.tones(favorites()).await.unwrap();
    assert_eq!(page.total_pages, 2);
    let wire = serde_json::to_string(&page).unwrap();
    assert!(!wire.contains("never-forward"));
    assert!(!wire.contains("fixture-access"));
    assert_eq!(account.tone(7).await.unwrap().a2_models_count, 1);
    let models = account
        .models(ModelQuery {
            tone_id: 7,
            page: 1,
            architecture: Architecture::A2,
        })
        .await
        .unwrap();
    assert_eq!(models.data[0].id, 9);
    assert!(
        !serde_json::to_string(&models)
            .unwrap()
            .contains("private-download")
    );
    server.abort();
    drop(account);
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn disconnect_rejects_inflight_catalog_without_restoring_authorization() {
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (seen, go) = (entered.clone(), release.clone());
    let app = Router::new().route(
        "/api/v1/tones/favorited",
        get(move || {
            let (seen, go) = (seen.clone(), go.clone());
            async move {
                seen.notify_one();
                go.notified().await;
                Json(json!({"data":[tone()],"page":1,"total_pages":1}))
            }
        }),
    );
    let (account, server, root) = account(app).await;
    let account = Arc::new(account);
    let reader = account.clone();
    let request = tokio::spawn(async move { reader.tones(favorites()).await });
    entered.notified().await;
    let state = account.state.borrow().clone();
    account
        .command(AccountCommand {
            session: state.session,
            expected_revision: state.revision,
            action: AccountAction::Disconnect,
        })
        .await
        .unwrap();
    release.notify_one();
    assert_eq!(
        request.await.unwrap().unwrap_err(),
        "Account changed; retry the selection"
    );
    assert!(account.tones(favorites()).await.is_err());
    server.abort();
    drop(account);
    std::fs::remove_dir_all(root).unwrap();
}
#[tokio::test]
async fn catalog_rejects_redirects_overlarge_replies_wrong_targets_and_rate_limit() {
    let app=Router::new()
        .route("/api/v1/tones/favorited",get(|| async {(StatusCode::TOO_MANY_REQUESTS,"token-containing remote error must not leak")}))
        .route("/api/v1/tones/latest",get(|| async {axum::response::Redirect::temporary("https://example.invalid/token-steal")}))
        .route("/api/v1/tones/7",get(|| async {Json(json!({"id":8}))}))
        .route("/api/v1/tones/8",get(|| async {" ".repeat(MAX_CATALOG+1)}))
        .route("/api/v1/models",get(|| async {Json(json!({"data":[{"id":9,"tone_id":99,"name":"Wrong tone","size":"standard","architecture_version":"2"}],"page":1,"total_pages":1}))}));
    let (account, server, root) = account(app).await;
    assert_eq!(
        account.tones(favorites()).await.unwrap_err(),
        "TONE3000 request limit reached; wait before retrying"
    );
    assert!(
        account
            .tones(ToneQuery {
                collection: Collection::Latest,
                page: 1,
                query: String::new(),
                gear: None
            })
            .await
            .is_err()
    );
    assert!(account.tone(7).await.is_err());
    assert_eq!(
        account.tone(8).await.unwrap_err(),
        "TONE3000 response exceeds the catalog limit"
    );
    assert!(
        account
            .models(ModelQuery {
                tone_id: 7,
                page: 1,
                architecture: Architecture::A2
            })
            .await
            .is_err()
    );
    assert!(
        account
            .tones(ToneQuery {
                collection: Collection::Favorites,
                page: 0,
                query: String::new(),
                gear: None
            })
            .await
            .is_err()
    );
    server.abort();
    drop(account);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn ir_catalog_omits_nam_architecture_filter() {
    let app = Router::new().route("/api/v1/models", get(|Query(query): Query<std::collections::HashMap<String, String>>| async move {
        assert_eq!(query["tone_id"], "17");
        assert!(!query.contains_key("architecture"));
        Json(json!({"data":[{"id":19,"tone_id":17,"name":"Cab impulse","size":null,"architecture_version":null}],"page":1,"total_pages":1}))
    }));
    let (account, server, root) = account(app).await;
    let models = account
        .models(ModelQuery {
            tone_id: 17,
            page: 1,
            architecture: Architecture::Any,
        })
        .await
        .unwrap();
    assert_eq!(models.data[0].architecture_version, None);
    server.abort();
    drop(account);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn gear_filters_on_tone3000_and_narrows_latest_here() {
    let app = Router::new()
        .route(
            "/api/v1/tones/downloaded",
            get(
                |Query(query): Query<std::collections::HashMap<String, String>>| async move {
                    assert_eq!(query["gear"], "amp-cab");
                    Json(json!({"data":[tone()],"page":1,"total_pages":1}))
                },
            ),
        )
        .route(
            "/api/v1/tones/latest",
            get(|RawQuery(query): RawQuery| async move {
                assert_eq!(query, None);
                let mut pedal = tone();
                pedal["id"] = json!(8);
                pedal["gear"] = json!("pedal");
                let mut rig = tone();
                rig["id"] = json!(9);
                rig["gear"] = json!("full-rig");
                Json(json!({"data":[tone(), pedal, rig]}))
            }),
        );
    let (account, server, root) = account(app).await;
    let downloaded = account
        .tones(ToneQuery {
            collection: Collection::Downloaded,
            page: 1,
            query: String::new(),
            gear: Some(Gear::AmpCab),
        })
        .await
        .unwrap();
    // The provider filtered; this fixture tone is an amp, so nothing is left.
    assert!(downloaded.data.is_empty());
    let latest = |gear| {
        account.tones(ToneQuery {
            collection: Collection::Latest,
            page: 1,
            query: String::new(),
            gear: Some(gear),
        })
    };
    let ids = |page: Page<Tone>| page.data.iter().map(|t| t.id).collect::<Vec<_>>();
    assert_eq!(ids(latest(Gear::Pedal).await.unwrap()), [8]);
    // Older amp-and-cab tones still say `full-rig`.
    assert_eq!(ids(latest(Gear::AmpCab).await.unwrap()), [9]);
    server.abort();
    drop(account);
    std::fs::remove_dir_all(root).unwrap();
}
