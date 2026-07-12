// cspell:ignore WDJF XZPL
use shareslices_cli::{ApiClient, AuthApi, AuthError};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn sends_compatibility_headers_on_every_request() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/cli-authorizations"))
        .and(header("ShareSlices-CLI-Version", env!("CARGO_PKG_VERSION")))
        .and(header("ShareSlices-CLI-OS", std::env::consts::OS))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "authorization": {
                "deviceCode": "secret",
                "userCode": "WDJF-XZPL",
                "verificationUri": "https://example.test/device",
                "verificationUriComplete": "https://example.test/device?user_code=WDJFXZPL",
                "expiresIn": 600,
                "interval": 5
            }
        })))
        .mount(&server)
        .await;

    let client = ApiClient::new(&server.uri()).expect("client");
    client.start_authorization().await.expect("authorization");
}

#[tokio::test]
async fn maps_upgrade_required_without_exposing_server_internals() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/cli-authorizations"))
        .respond_with(ResponseTemplate::new(426).set_body_json(serde_json::json!({
            "error": {
                "code": "cli_upgrade_required",
                "message": "Update ShareSlices CLI to continue.",
                "requestId": "req-secret",
                "details": { "currentVersion": "0.1.0", "minimumVersion": "0.2.0" }
            }
        })))
        .mount(&server)
        .await;

    let client = ApiClient::new(&server.uri()).expect("client");
    assert!(matches!(
        client.start_authorization().await,
        Err(AuthError::UpgradeRequired { .. })
    ));
}

#[tokio::test]
async fn lists_artifacts_across_server_pages_with_filters_and_compatibility_headers() {
    use shareslices_cli::{ProcessingFilter, PublicationFilter};
    use wiremock::matchers::query_param;
    let server = MockServer::start().await;
    let artifact = |id: &str| {
        serde_json::json!({
            "id": id, "name": format!("Report {id}"), "updatedAt": "2026-07-12T08:00:00Z",
            "processingState": "ready", "shareLink": { "state": "active", "expiresAt": null },
            "publication": { "id": "publication-1" }
        })
    };
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .and(query_param("pageSize", "3"))
        .and(query_param("publication", "published"))
        .and(query_param("processing", "ready"))
        .and(header("authorization", "Bearer secret"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [artifact("one"), artifact("two")], "nextPageToken": "next"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .and(query_param("pageSize", "1"))
        .and(query_param("pageToken", "next"))
        .and(query_param("publication", "published"))
        .and(query_param("processing", "ready"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [artifact("three")], "nextPageToken": null
        })))
        .expect(1)
        .mount(&server)
        .await;

    let artifacts = ApiClient::new(&server.uri())
        .expect("client")
        .list_artifacts(
            "secret",
            Some(PublicationFilter::Published),
            Some(ProcessingFilter::Ready),
            3,
        )
        .await
        .expect("artifacts");
    assert_eq!(
        artifacts
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        ["one", "two", "three"]
    );
}
