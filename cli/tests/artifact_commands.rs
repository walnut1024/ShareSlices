// cspell:ignore nocapture noninteractive rfind
use clap::Parser;
use shareslices_cli::{
    ApiClient, Artifact, ArtifactListArgs, ArtifactPublishArgs, ArtifactShareLink,
    ArtifactUnpublishArgs, ArtifactUploadArgs, AuthError, Cli, Command as CliCommand,
    CredentialStore, artifact_exit_code, run_artifact_command, run_artifact_list,
    run_artifact_publish, run_artifact_unpublish, run_artifact_upload, select_artifact,
};
use std::io::Cursor;
use std::io::Write as _;
use std::process::Command;
use std::sync::Mutex;
use wiremock::matchers::{body_json, header_exists, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

struct Store(Mutex<Option<String>>);
impl CredentialStore for Store {
    fn get(&self) -> Result<Option<String>, AuthError> {
        Ok(self.0.lock().expect("store").clone())
    }
    fn set(&self, _value: &str) -> Result<(), AuthError> {
        unreachable!()
    }
    fn delete(&self) -> Result<(), AuthError> {
        unreachable!()
    }
}

fn publish_args(
    artifact: Option<&str>,
    version: Option<&str>,
    json: Option<&str>,
) -> ArtifactPublishArgs {
    ArtifactPublishArgs {
        artifact: artifact.map(str::to_owned),
        version: version.map(str::to_owned),
        json: json.map(str::to_owned),
        jq: None,
        template: None,
    }
}

fn unpublish_args(artifact: Option<&str>, json: Option<&str>) -> ArtifactUnpublishArgs {
    ArtifactUnpublishArgs {
        artifact: artifact.map(str::to_owned),
        json: json.map(str::to_owned),
        jq: None,
        template: None,
    }
}

#[tokio::test]
async fn publishes_explicit_ready_version_and_reports_external_access() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "state": "active", "expiresAt": "2026-08-01T00:00:00Z" },
                "publication": null }
        })))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST")).and(path("/api/artifacts/artifact-1/publications"))
        .and(header_exists("idempotency-key"))
        .and(header_exists("shareslices-cli-version"))
        .and(header_exists("shareslices-cli-os"))
        .and(body_json(serde_json::json!({ "versionId": "version-2" })))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "publication": { "id": "publication-1", "versionId": "version-2", "publishedAt": "2026-07-12T00:00:00Z" }
        }))).expect(1).mount(&server).await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut output = Vec::new();
    run_artifact_publish(
        &publish_args(
            Some("artifact-1"),
            Some("version-2"),
            Some("artifactId,versionId,accessState,expiresAt"),
        ),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut output,
        &mut Vec::new(),
    )
    .await
    .expect("publish");
    let value: serde_json::Value = serde_json::from_slice(&output).expect("json");
    assert_eq!(value["versionId"], "version-2");
    assert_eq!(value["accessState"], "accessible");
    assert_eq!(value["expiresAt"], "2026-08-01T00:00:00Z");
}

#[tokio::test]
async fn unpublishes_only_current_publication_and_preserves_expiration_in_output() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "state": "active", "expiresAt": "2026-08-01T00:00:00Z" },
                "publication": { "id": "publication-1", "versionId": "version-2" } }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/artifacts/artifact-1/publications/publication-1"))
        .and(header_exists("shareslices-cli-version"))
        .and(header_exists("shareslices-cli-os"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut output = Vec::new();
    run_artifact_unpublish(
        &unpublish_args(Some("artifact-1"), Some("artifactId,accessState,expiresAt")),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut output,
        &mut Vec::new(),
    )
    .await
    .expect("unpublish");
    let value: serde_json::Value = serde_json::from_slice(&output).expect("json");
    assert_eq!(value["accessState"], "not accessible");
    assert_eq!(value["expiresAt"], "2026-08-01T00:00:00Z");
}

#[tokio::test]
async fn noninteractive_publish_requires_both_identifiers() {
    let server = MockServer::start().await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let error = run_artifact_publish(
        &publish_args(None, None, None),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect_err("missing ids");
    assert!(
        error
            .to_string()
            .contains("requires --artifact and --version")
    );
}

#[tokio::test]
async fn unpublish_is_idempotent_when_already_unpublished() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "state": "active", "expiresAt": null }, "publication": null }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut output = Vec::new();
    run_artifact_unpublish(
        &unpublish_args(Some("artifact-1"), None),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut output,
        &mut Vec::new(),
    )
    .await
    .expect("unpublish");
    assert!(
        String::from_utf8(output)
            .expect("utf8")
            .contains("not accessible")
    );
}

#[tokio::test]
async fn interactive_publish_selects_artifact_and_ready_version() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
          "artifacts": [{ "id": "artifact-1", "name": "Report", "updatedAt": "2026-07-12T00:00:00Z",
            "processingState": "ready", "shareLink": { "state": "active", "expiresAt": null }, "publication": null }],
          "nextPageToken": null
        }))).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1/versions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
          "versions": [{ "id": "version-2", "versionNumber": 2, "state": "ready" }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
          "artifact": { "id": "artifact-1", "name": "Report", "shareLink": { "state": "active", "expiresAt": null }, "publication": null }
        }))).expect(2).mount(&server).await;
    Mock::given(method("POST")).and(path("/api/artifacts/artifact-1/publications"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
          "publication": { "id": "publication-1", "versionId": "version-2", "publishedAt": "2026-07-12T00:00:00Z" }
        }))).mount(&server).await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut diagnostics = Vec::new();
    run_artifact_publish(
        &publish_args(None, None, None),
        &api,
        &store,
        true,
        &mut Cursor::new(b"1\n1\n".to_vec()),
        &mut Vec::new(),
        &mut diagnostics,
    )
    .await
    .expect("interactive publish");
    let prompts = String::from_utf8(diagnostics).expect("utf8");
    assert!(prompts.contains("Select an Artifact"));
    assert!(prompts.contains("Select a ready Version"));
}

fn args(json: Option<&str>, jq: Option<&str>, template: Option<&str>) -> ArtifactListArgs {
    ArtifactListArgs {
        publication: None,
        processing: None,
        limit: 30,
        json: json.map(str::to_owned),
        jq: jq.map(str::to_owned),
        template: template.map(str::to_owned),
        no_progress: false,
    }
}

async fn server() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [{ "id": "artifact-1", "name": "Quarterly report",
                "updatedAt": "2026-07-12T08:00:00Z", "processingState": "ready",
                "shareLink": { "state": "active", "expiresAt": null }, "publication": null }],
            "nextPageToken": null
        })))
        .mount(&server)
        .await;
    server
}

async fn mount_upload_policy(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/api/artifact-upload-policies/current"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "policy": {
                "revision": "test", "maxArchiveBytes": 52_428_800,
                "maxExpandedBytes": 209_715_200, "maxFileCount": 1000,
                "maxFileBytes": 52_428_800,
                "enabledExtensions": [".html", ".css", ".js", ".png", ".txt"]
            }
        })))
        .mount(server)
        .await;
}

#[tokio::test]
async fn prints_human_and_selectable_json_output() {
    let server = server().await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut output = Vec::new();
    run_artifact_list(&args(None, None, None), &api, &store, &mut output)
        .await
        .expect("list");
    let text = String::from_utf8(output).expect("utf8");
    assert!(text.contains("ID\tNAME\tPROCESSING\tPUBLICATION\tEXPIRES\tUPDATED"));
    assert!(text.contains("artifact-1\tQuarterly report\tready\tunpublished\tnever"));

    let mut output = Vec::new();
    run_artifact_list(
        &args(Some("id,name,publicationState"), Some(".[] | .name"), None),
        &api,
        &store,
        &mut output,
    )
    .await
    .expect("json");
    assert_eq!(
        String::from_utf8(output).expect("utf8"),
        "Quarterly report\n"
    );

    let mut output = Vec::new();
    run_artifact_list(
        &args(
            Some("id,name"),
            None,
            Some("{{range .}}{{.id}} {{.name}}{{end}}"),
        ),
        &api,
        &store,
        &mut output,
    )
    .await
    .expect("template");
    assert_eq!(
        String::from_utf8(output).expect("utf8"),
        "artifact-1 Quarterly report"
    );
}

#[tokio::test]
async fn rejects_unsupported_json_fields_before_printing() {
    let server = server().await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let error = run_artifact_list(
        &args(Some("shareSlug"), None, None),
        &api,
        &store,
        &mut Vec::new(),
    )
    .await
    .expect_err("field");
    assert!(error.to_string().contains("Unsupported JSON field"));
}

#[test]
fn complete_cli_process_returns_authentication_exit_code_without_waiting() {
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args([
            "--api-url",
            "http://127.0.0.1:1",
            "artifact",
            "list",
            "--no-progress",
        ])
        .output()
        .expect("CLI process");
    assert_eq!(output.status.code(), Some(4));
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .expect("stderr")
            .contains("Run shareslices auth login")
    );
}

#[test]
fn shipping_binary_parses_publish_and_maps_authentication_exit_code() {
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args([
            "--api-url",
            "http://127.0.0.1:2",
            "artifact",
            "publish",
            "--artifact",
            "artifact-1",
            "--version",
            "version-1",
        ])
        .output()
        .expect("CLI process");
    assert_eq!(output.status.code(), Some(4));
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .expect("stderr")
            .contains("Run shareslices auth login")
    );
}

#[test]
fn shipping_binary_rejects_noninteractive_publish_without_identifiers() {
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args(["--api-url", "http://127.0.0.1:2", "artifact", "publish"])
        .output()
        .expect("CLI process");
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .expect("stderr")
            .contains("requires --artifact and --version")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_cli_process_prints_formatted_list_without_transient_stderr() {
    let server = server().await;
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking(move || {
        Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "process_list_fixture",
                "--nocapture",
            ])
            .env("SHARESLICES_TEST_API_URL", server.uri())
            .output()
            .expect("isolated CLI process")
    })
    .await
    .expect("process task");
    assert!(output.status.success());
    let stdout = String::from_utf8(output.stdout).expect("stdout");
    assert!(stdout.contains("Quarterly report"));
    assert!(stdout.contains("artifact-1"));
    assert!(
        output.stderr.is_empty(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
#[ignore = "fixture invoked only by isolated_cli_process_prints_formatted_list_without_transient_stderr"]
async fn process_list_fixture() {
    let api_url = std::env::var("SHARESLICES_TEST_API_URL").expect("fixture API URL");
    let api = ApiClient::new(&api_url).expect("client");
    let store = Store(Mutex::new(Some("fixture-secret".into())));
    run_artifact_list(
        &args(Some("id,name"), None, None),
        &api,
        &store,
        &mut std::io::stdout(),
    )
    .await
    .expect("list");
}

#[tokio::test]
async fn uploads_prepared_zip_waits_for_ready_and_suppresses_progress() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-1", "uploadSessionId": "upload-1"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "processingState": "ready", "readyVersion": { "id": "version-1" }, "failure": null }
        }))).expect(1).mount(&server).await;
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("report.zip");
    let file = std::fs::File::create(&path).expect("zip");
    let mut writer = zip::ZipWriter::new(file);
    writer
        .start_file("index.html", zip::write::SimpleFileOptions::default())
        .expect("entry");
    writer.write_all(b"<html></html>").expect("body");
    writer.finish().expect("finish");
    let args = ArtifactUploadArgs {
        paths: vec![path],
        root: None,
        name: None,
        entry: None,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    run_artifact_upload(&args, &api, &store, &mut stdout, &mut stderr)
        .await
        .expect("upload");
    assert_eq!(
        String::from_utf8(stdout).expect("utf8"),
        "Artifact artifact-1 uploaded as Version version-1\n"
    );
    assert!(stderr.is_empty());
}

#[tokio::test]
async fn processing_failure_is_actionable_and_progress_is_kept_on_stderr() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-1", "uploadSessionId": "upload-1"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "processingState": "failed",
                "readyVersion": null,
                "failure": { "code": "missing_entry_file", "message": "Choose an HTML Entry file." }
            }
        })))
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("report.zip");
    write_zip(&path, &["index.html"]);
    let args = ArtifactUploadArgs {
        paths: vec![path],
        root: None,
        name: None,
        entry: None,
        no_progress: false,
        json: None,
        jq: None,
        template: None,
    };
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let error = run_artifact_upload(
        &args,
        &ApiClient::new(&server.uri()).expect("client"),
        &Store(Mutex::new(Some("secret".into()))),
        &mut stdout,
        &mut stderr,
    )
    .await
    .expect_err("processing failure");
    assert!(stdout.is_empty());
    assert!(
        String::from_utf8(stderr)
            .expect("stderr")
            .contains("Processing")
    );
    assert!(error.to_string().contains("missing_entry_file"));
    assert!(error.to_string().contains("Choose an HTML Entry file"));
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_upload_process_passes_zip_through_and_prints_stable_json() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-1", "uploadSessionId": "upload-1"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "processingState": "ready", "readyVersion": { "id": "version-1" }, "failure": null }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    let zip_path = directory.path().join("prepared.zip");
    write_zip(&zip_path, &["report.html"]);
    let submitted = std::fs::read(&zip_path).expect("ZIP bytes");
    let executable = std::env::current_exe().expect("test executable");
    let api_url = server.uri();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "process_upload_fixture",
                "--nocapture",
            ])
            .env("SHARESLICES_TEST_API_URL", api_url)
            .env("SHARESLICES_TEST_ZIP", zip_path)
            .env("SHARESLICES_TEST_ENTRY", "report.html")
            .output()
            .expect("isolated upload process")
    })
    .await
    .expect("process task");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 stdout");
    let json_start = stdout.find('{').expect("JSON start");
    let json_end = stdout.rfind('}').expect("JSON end") + 1;
    let value: serde_json::Value =
        serde_json::from_str(&stdout[json_start..json_end]).expect("JSON stdout");
    assert_eq!(value["artifact"]["id"], "artifact-1");
    assert_eq!(value["version"]["id"], "version-1");
    assert!(output.stderr.is_empty());
    let requests = server.received_requests().await.expect("requests");
    let upload = requests
        .iter()
        .find(|request| request.url.path() == "/api/artifacts")
        .expect("upload request");
    assert!(
        upload
            .body
            .windows(submitted.len())
            .any(|window| window == submitted)
    );
    let multipart = String::from_utf8_lossy(&upload.body);
    assert!(multipart.contains("report.html"));
    assert!(multipart.contains("prepared"));
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_upload_process_packages_only_the_selected_file_and_removes_temporary_zip() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-1", "uploadSessionId": "upload-1"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "processingState": "ready", "readyVersion": { "id": "version-1" }, "failure": null }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("input tree");
    let selected = directory.path().join("index.html");
    std::fs::write(&selected, "selected-content").expect("selected input");
    std::fs::write(directory.path().join("secret.txt"), "sibling-secret").expect("sibling");
    let temporary = tempfile::tempdir().expect("temporary ZIP directory");
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let api_url = server.uri();
        let temporary = temporary.path().to_owned();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_upload_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", api_url)
                .env("SHARESLICES_TEST_ZIP", selected)
                .env("SHARESLICES_TEST_ROOT", directory.path())
                .env("TMPDIR", temporary)
                .output()
                .expect("isolated upload process")
        }
    })
    .await
    .expect("process task");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let requests = server.received_requests().await.expect("requests");
    let body = &requests
        .iter()
        .find(|request| request.url.path() == "/api/artifacts")
        .expect("upload request")
        .body;
    let start = body
        .windows(4)
        .position(|bytes| bytes == b"PK\x03\x04")
        .expect("ZIP start");
    let mut archive = zip::ZipArchive::new(Cursor::new(&body[start..])).expect("submitted ZIP");
    assert_eq!(archive.len(), 1);
    let mut entry = archive.by_index(0).expect("archive entry");
    assert_eq!(entry.name(), "index.html");
    let mut content = String::new();
    std::io::Read::read_to_string(&mut entry, &mut content).expect("entry content");
    assert_eq!(content, "selected-content");
    assert_eq!(
        std::fs::read_dir(temporary.path())
            .expect("temporary directory")
            .count(),
        0
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_upload_process_removes_temporary_zip_after_local_entry_failure() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    let inputs = tempfile::tempdir().expect("input tree");
    std::fs::write(inputs.path().join("one.html"), "one").expect("first entry");
    std::fs::write(inputs.path().join("two.html"), "two").expect("second entry");
    let temporary = tempfile::tempdir().expect("temporary ZIP directory");
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let input = inputs.path().to_owned();
        let temporary_path = temporary.path().to_owned();
        let api_url = server.uri();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_upload_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", api_url)
                .env("SHARESLICES_TEST_ZIP", &input)
                .env("SHARESLICES_TEST_ROOT", &input)
                .env("TMPDIR", temporary_path)
                .output()
                .expect("isolated upload process")
        }
    })
    .await
    .expect("process task");
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("pass --entry <path>"));
    assert_eq!(
        std::fs::read_dir(temporary.path())
            .expect("temporary directory")
            .count(),
        0
    );
}

#[tokio::test]
#[ignore = "fixture invoked only by isolated_upload_process_passes_zip_through_and_prints_stable_json"]
async fn process_upload_fixture() {
    let api_url = std::env::var("SHARESLICES_TEST_API_URL").expect("API URL");
    let zip_path = std::env::var("SHARESLICES_TEST_ZIP").expect("ZIP path");
    let mut argv = vec![
        "shareslices".to_owned(),
        "--api-url".to_owned(),
        api_url,
        "artifact".to_owned(),
        "upload".to_owned(),
        zip_path,
        "--no-progress".to_owned(),
        "--json".to_owned(),
        "artifact,version,publication".to_owned(),
    ];
    if let Ok(entry) = std::env::var("SHARESLICES_TEST_ENTRY") {
        argv.extend(["--entry".to_owned(), entry]);
    }
    if let Ok(root) = std::env::var("SHARESLICES_TEST_ROOT") {
        argv.extend(["--root".to_owned(), root]);
    }
    let cli = Cli::try_parse_from(argv).expect("CLI arguments");
    let api = ApiClient::new(&cli.api_url).expect("client");
    let store = Store(Mutex::new(Some("fixture-secret".into())));
    let CliCommand::Artifact { command } = cli.command else {
        unreachable!("fixture command")
    };
    if let Err(error) = run_artifact_command(
        command,
        &api,
        &store,
        &mut std::io::stdout(),
        &mut std::io::stderr(),
    )
    .await
    {
        let code = artifact_exit_code(&error);
        eprintln!("{error}");
        std::process::exit(code);
    }
}

#[test]
fn ambiguous_entry_fails_locally_without_a_terminal_or_request() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("ambiguous.zip");
    write_zip(&path, &["one.html", "two.html"]);
    let args = ArtifactUploadArgs {
        paths: vec![path],
        root: None,
        name: Some("Ambiguous".into()),
        entry: None,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let runtime = tokio::runtime::Runtime::new().expect("runtime");
    let error = runtime
        .block_on(run_artifact_upload(
            &args,
            &ApiClient::new("http://127.0.0.1:1").expect("client"),
            &Store(Mutex::new(Some("secret".into()))),
            &mut Vec::new(),
            &mut Vec::new(),
        ))
        .expect_err("ambiguous entry");
    assert!(matches!(
        error,
        shareslices_cli::ArtifactError::AmbiguousEntry
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_upload_process_reports_ambiguous_entry_without_a_request() {
    let directory = tempfile::tempdir().expect("tempdir");
    let zip_path = directory.path().join("ambiguous.zip");
    write_zip(&zip_path, &["one.html", "two.html"]);
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking(move || {
        Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "process_upload_fixture",
                "--nocapture",
            ])
            .env("SHARESLICES_TEST_API_URL", "http://127.0.0.1:1")
            .env("SHARESLICES_TEST_ZIP", zip_path)
            .output()
            .expect("isolated upload process")
    })
    .await
    .expect("process task");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("pass --entry <path>"));
}

#[test]
fn shipping_binary_maps_ambiguous_preflight_to_failure_before_authentication() {
    let directory = tempfile::tempdir().expect("tempdir");
    let path = directory.path().join("ambiguous.zip");
    write_zip(&path, &["one.html", "two.html"]);
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args(["artifact", "upload"])
        .arg(path)
        .arg("--no-progress")
        .output()
        .expect("shipping CLI process");
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("pass --entry <path>"));
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn isolated_production_entrypoint_maps_sigint_to_exit_two() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-1", "uploadSessionId": "upload-1"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_secs(10))
                .set_body_json(serde_json::json!({
                    "artifact": { "processingState": "processing", "readyVersion": null, "failure": null }
                })),
        )
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    let input_path = directory.path().join("index.html");
    std::fs::write(&input_path, "cancelled-content").expect("input");
    let temporary = tempfile::tempdir().expect("temporary ZIP directory");
    let executable = std::env::current_exe().expect("test executable");
    let child = Command::new(executable)
        .args([
            "--ignored",
            "--exact",
            "process_upload_fixture",
            "--nocapture",
        ])
        .env("SHARESLICES_TEST_API_URL", server.uri())
        .env("SHARESLICES_TEST_ZIP", input_path)
        .env("SHARESLICES_TEST_ROOT", directory.path())
        .env("TMPDIR", temporary.path())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("isolated CLI process");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let signal = Command::new("kill")
        .args(["-INT", &child.id().to_string()])
        .status()
        .expect("send SIGINT");
    assert!(signal.success());
    let output = child.wait_with_output().expect("CLI output");
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("cancelled"));
    assert_eq!(
        std::fs::read_dir(temporary.path())
            .expect("temporary directory")
            .count(),
        0
    );
}

fn write_zip(path: &std::path::Path, entries: &[&str]) {
    let file = std::fs::File::create(path).expect("ZIP");
    let mut writer = zip::ZipWriter::new(file);
    for entry in entries {
        writer
            .start_file(*entry, zip::write::SimpleFileOptions::default())
            .expect("entry");
        writer.write_all(b"<html></html>").expect("body");
    }
    writer.finish().expect("finish");
}

#[test]
fn shared_selector_never_prompts_when_disabled_or_without_a_terminal() {
    let artifacts = vec![Artifact {
        id: "artifact-1".into(),
        name: "Report".into(),
        updated_at: "2026-07-12T08:00:00Z".into(),
        processing_state: "ready".into(),
        share_link: ArtifactShareLink {
            state: "active".into(),
            expires_at: None,
        },
        publication: None,
    }];
    for (prompts, terminal) in [(false, true), (true, false)] {
        let mut output = Vec::new();
        assert!(
            select_artifact(
                &artifacts,
                prompts,
                terminal,
                &mut Cursor::new(b"1\n"),
                &mut output
            )
            .is_err()
        );
        assert!(output.is_empty());
    }
    let selected = select_artifact(
        &artifacts,
        true,
        true,
        &mut Cursor::new(b"1\n"),
        &mut Vec::new(),
    )
    .expect("selection");
    assert_eq!(selected.id, "artifact-1");
}
