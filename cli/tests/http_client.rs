// cspell:ignore WDJF XZPL
use shareslices_cli::{ApiClient, ArtifactError, AuthApi, AuthError};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

#[derive(Clone)]
struct PendingThenAccepted(Arc<AtomicUsize>);

impl Respond for PendingThenAccepted {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
            ResponseTemplate::new(409)
                .insert_header("Retry-After", "0")
                .set_body_json(serde_json::json!({
                    "error": { "code": "operation_in_progress", "message": "Pending", "requestId": "req-1" }
                }))
        } else {
            ResponseTemplate::new(202).set_body_json(serde_json::json!({
                "artifactId": "artifact-1", "uploadSessionId": "upload-1"
            }))
        }
    }
}

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
    let AuthError::ServerEvidence(evidence) = client
        .start_authorization()
        .await
        .expect_err("upgrade required")
    else {
        panic!("expected preserved Server evidence");
    };
    assert_eq!(evidence.code, "cli_upgrade_required");
    assert_eq!(evidence.request_id.as_deref(), Some("req-secret"));
    assert_eq!(
        evidence
            .details
            .as_ref()
            .and_then(|value| value["minimumVersion"].as_str()),
        Some("0.2.0")
    );
}

#[tokio::test]
async fn artifact_requests_preserve_actionable_upgrade_details() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
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

    let error = ApiClient::new(&server.uri())
        .expect("client")
        .artifact_state("secret", "artifact-1")
        .await
        .expect_err("upgrade required");
    let ArtifactError::ServerEvidence(evidence) = error else {
        panic!("expected preserved Server evidence");
    };
    assert_eq!(evidence.code, "cli_upgrade_required");
    assert_eq!(evidence.request_id.as_deref(), Some("req-secret"));
    assert_eq!(
        evidence
            .details
            .as_ref()
            .and_then(|value| value["currentVersion"].as_str()),
        Some("0.1.0")
    );
}

#[tokio::test]
async fn upload_replays_uncertain_acceptance_with_one_idempotency_key() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts"))
        .respond_with(PendingThenAccepted(Arc::new(AtomicUsize::new(0))))
        .expect(2)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    let zip_path = directory.path().join("report.zip");
    let file = std::fs::File::create(&zip_path).expect("ZIP");
    zip::ZipWriter::new(file).finish().expect("finish ZIP");

    let started = std::time::Instant::now();
    let accepted = ApiClient::new(&server.uri())
        .expect("client")
        .upload_artifact(
            "secret",
            Some("Report"),
            None,
            Some("index.html"),
            &zip_path,
            None,
        )
        .await
        .expect("replayed acceptance");
    assert_eq!(accepted.artifact_id, "artifact-1");
    assert!(started.elapsed() < std::time::Duration::from_millis(200));
    let requests = server.received_requests().await.expect("requests");
    let keys = requests
        .iter()
        .map(|request| request.headers.get("idempotency-key").expect("key"))
        .collect::<Vec<_>>();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1]);
}

#[tokio::test]
async fn lists_artifacts_across_server_pages_with_filters_and_compatibility_headers() {
    use shareslices_cli::{ProcessingFilter, PublicationFilter};
    use wiremock::matchers::query_param;
    let server = MockServer::start().await;
    let artifact = |id: &str| {
        serde_json::json!({
            "id": id, "name": format!("Report {id}"), "updatedAt": "2026-07-12T08:00:00Z",
            "processingState": "ready", "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null },
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
