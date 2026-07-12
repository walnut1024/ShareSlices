// cspell:ignore nocapture
use clap::Parser as _;
use shareslices_cli::{
    ApiClient, Artifact, ArtifactCommand, ArtifactExportArgs, ArtifactInteraction,
    ArtifactListArgs, ArtifactShareLink, ArtifactUploadArgs, AuthError, Cli, Command as CliCommand,
    CredentialStore, UploadTargetChoice, artifact_exit_code, run_artifact_command,
    run_artifact_command_with_interaction, run_artifact_export_with_interaction, run_artifact_list,
    run_artifact_upload, select_artifact, select_upload_target,
};
use std::io::Cursor;
use std::io::Write as _;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

struct ExistingVersionThenNewVersion(Arc<AtomicUsize>);

impl Respond for ExistingVersionThenNewVersion {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        let call = self.0.fetch_add(1, Ordering::SeqCst);
        let (processing_state, version_id) = if call == 0 {
            ("processing", "version-1")
        } else {
            ("ready", "version-2")
        };
        ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "name": "Existing report",
                "processingState": processing_state,
                "readyVersion": { "id": version_id },
                "publication": {
                    "id": "publication-1",
                    "versionId": "version-1",
                    "publishedAt": "2026-07-12T08:00:00Z"
                },
                "failure": null
            }
        }))
    }
}

#[tokio::test]
async fn exports_ready_version_atomically_without_transient_stdout() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "name": "Quarterly / report", "processingState": "ready",
                "readyVersion": { "id": "version-2" }, "publication": null, "failure": null }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/versions/version-2/export"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"normalized-zip"))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let directory = tempfile::tempdir().expect("temporary directory");
    let destination = directory.path().join("copy.zip");
    let args = ArtifactExportArgs {
        artifact: Some("artifact-1".into()),
        version: Some("version-2".into()),
        output: Some(destination.clone()),
        clobber: false,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let mut input = Cursor::new(Vec::<u8>::new());
    let mut interaction = ArtifactInteraction {
        prompts_enabled: false,
        is_terminal: false,
        input: &mut input,
    };
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    run_artifact_export_with_interaction(
        &args,
        &api,
        &store,
        &mut interaction,
        &mut stdout,
        &mut stderr,
    )
    .await
    .expect("export");
    assert_eq!(
        std::fs::read(&destination).expect("exported bytes"),
        b"normalized-zip"
    );
    assert!(
        String::from_utf8(stdout)
            .expect("stdout")
            .contains("artifact-1 Version version-2")
    );
    assert!(stderr.is_empty());
}

#[tokio::test]
async fn preserves_existing_export_without_request_unless_clobber_is_explicit() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "name": "Report", "processingState": "ready",
                "readyVersion": { "id": "version-2" }, "publication": null, "failure": null }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let directory = tempfile::tempdir().expect("temporary directory");
    let destination = directory.path().join("copy.zip");
    std::fs::write(&destination, b"keep-me").expect("fixture");
    let args = ArtifactExportArgs {
        artifact: Some("artifact-1".into()),
        version: Some("version-2".into()),
        output: Some(destination.clone()),
        clobber: false,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let mut input = Cursor::new(Vec::<u8>::new());
    let mut interaction = ArtifactInteraction {
        prompts_enabled: false,
        is_terminal: false,
        input: &mut input,
    };
    let error = run_artifact_export_with_interaction(
        &args,
        &api,
        &store,
        &mut interaction,
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect_err("refuse overwrite");
    assert!(matches!(
        error,
        shareslices_cli::ArtifactError::OutputExists
    ));
    assert_eq!(
        std::fs::read(destination).expect("existing bytes"),
        b"keep-me"
    );
}

#[tokio::test]
async fn interactive_export_selects_artifact_and_its_ready_version() {
    let server = server().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "name": "Quarterly report", "processingState": "ready",
                "readyVersion": { "id": "version-7" }, "publication": null, "failure": null }
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/versions/version-7/export"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"zip-seven"))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1/versions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "versions": [{ "id": "version-7", "versionNumber": 7, "state": "ready" }]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let directory = tempfile::tempdir().expect("temporary directory");
    let destination = directory.path().join("selected.zip");
    let args = ArtifactExportArgs {
        artifact: None,
        version: None,
        output: Some(destination.clone()),
        clobber: false,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let mut input = Cursor::new(b"1\n1\n".to_vec());
    let mut interaction = ArtifactInteraction {
        prompts_enabled: true,
        is_terminal: true,
        input: &mut input,
    };
    let mut diagnostics = Vec::new();
    run_artifact_export_with_interaction(
        &args,
        &api,
        &store,
        &mut interaction,
        &mut Vec::new(),
        &mut diagnostics,
    )
    .await
    .expect("interactive export");
    assert_eq!(std::fs::read(destination).expect("export"), b"zip-seven");
    let diagnostics = String::from_utf8(diagnostics).expect("diagnostics");
    assert!(diagnostics.contains("Select an Artifact"));
    assert!(diagnostics.contains("Select a ready Version"));
}

#[tokio::test]
async fn clobber_atomically_replaces_existing_export() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "name": "Report", "processingState": "ready",
                "readyVersion": { "id": "version-2" }, "publication": null, "failure": null }
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/versions/version-2/export"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"replacement"))
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let directory = tempfile::tempdir().expect("temporary directory");
    let destination = directory.path().join("copy.zip");
    std::fs::write(&destination, b"old").expect("fixture");
    let args = ArtifactExportArgs {
        artifact: Some("artifact-1".into()),
        version: Some("version-2".into()),
        output: Some(destination.clone()),
        clobber: true,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let mut input = Cursor::new(Vec::<u8>::new());
    let mut interaction = ArtifactInteraction {
        prompts_enabled: false,
        is_terminal: false,
        input: &mut input,
    };
    run_artifact_export_with_interaction(
        &args,
        &api,
        &store,
        &mut interaction,
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect("clobber");
    assert_eq!(
        std::fs::read(destination).expect("replacement"),
        b"replacement"
    );
}

#[test]
fn shipping_binary_export_requires_authentication() {
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args([
            "--api-url",
            "http://127.0.0.1:1",
            "artifact",
            "export",
            "--artifact",
            "artifact-1",
            "--version",
            "version-1",
            "--no-progress",
        ])
        .output()
        .expect("CLI process");
    assert_eq!(output.status.code(), Some(4));
    assert!(output.stdout.is_empty());
}

#[test]
fn shipping_binary_export_without_identifiers_fails_before_authentication() {
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args(["artifact", "export", "--no-progress"])
        .env("SHARESLICES_PROMPT_DISABLED", "1")
        .output()
        .expect("CLI process");
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(
        String::from_utf8(output.stderr)
            .expect("stderr")
            .contains("--artifact and --version")
    );
}

#[tokio::test]
async fn export_rejects_a_missing_output_parent_before_download() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "name": "Report", "processingState": "ready", "readyVersion": { "id": "version-2" }, "publication": null, "failure": null }
        }))).expect(1).mount(&server).await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let directory = tempfile::tempdir().expect("temporary directory");
    let args = ArtifactExportArgs {
        artifact: Some("artifact-1".into()),
        version: Some("version-2".into()),
        output: Some(directory.path().join("missing/copy.zip")),
        clobber: false,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let mut input = Cursor::new(Vec::<u8>::new());
    let mut interaction = ArtifactInteraction {
        prompts_enabled: false,
        is_terminal: false,
        input: &mut input,
    };
    let error = run_artifact_export_with_interaction(
        &args,
        &api,
        &store,
        &mut interaction,
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect_err("missing parent");
    assert!(matches!(
        error,
        shareslices_cli::ArtifactError::OutputParentMissing
    ));
}

#[tokio::test]
async fn export_uses_safe_default_filename_and_selectable_json() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/artifacts/artifact-default"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "name": "Issue07 / Default Filename", "processingState": "ready", "readyVersion": { "id": "version-default-773" }, "publication": null, "failure": null }
        }))).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/versions/version-default-773/export"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"default-zip"))
        .mount(&server)
        .await;
    let destination = std::path::PathBuf::from("Issue07-Default-Filename-version-default-773.zip");
    let _ = std::fs::remove_file(&destination);
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let args = ArtifactExportArgs {
        artifact: Some("artifact-default".into()),
        version: Some("version-default-773".into()),
        output: None,
        clobber: false,
        no_progress: true,
        json: Some("artifactId,versionId,path".into()),
        jq: None,
        template: None,
    };
    let mut input = Cursor::new(Vec::<u8>::new());
    let mut interaction = ArtifactInteraction {
        prompts_enabled: false,
        is_terminal: false,
        input: &mut input,
    };
    let mut output = Vec::new();
    run_artifact_export_with_interaction(
        &args,
        &api,
        &store,
        &mut interaction,
        &mut output,
        &mut Vec::new(),
    )
    .await
    .expect("default export");
    assert_eq!(
        std::fs::read(&destination).expect("default file"),
        b"default-zip"
    );
    let json: serde_json::Value = serde_json::from_slice(&output).expect("JSON output");
    assert_eq!(json["path"], destination.display().to_string());
    std::fs::remove_file(destination).expect("cleanup default file");
}

struct InProgressThenAccepted(Arc<AtomicUsize>);

impl Respond for InProgressThenAccepted {
    fn respond(&self, _request: &Request) -> ResponseTemplate {
        if self.0.fetch_add(1, Ordering::SeqCst) == 0 {
            ResponseTemplate::new(409).set_body_json(serde_json::json!({
                "error": { "code": "operation_in_progress" }
            }))
        } else {
            ResponseTemplate::new(202).set_body_json(serde_json::json!({
                "artifactId": "artifact-existing", "uploadSessionId": "upload-2"
            }))
        }
    }
}

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
        name: Some("Report".into()),
        artifact: None,
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
async fn uploads_new_version_to_explicit_artifact_without_sending_a_name() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts/artifact-existing/upload-sessions"))
        .respond_with(InProgressThenAccepted(Arc::new(AtomicUsize::new(0))))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-existing"))
        .respond_with(ExistingVersionThenNewVersion(Arc::new(AtomicUsize::new(0))))
        .expect(2)
        .mount(&server)
        .await;
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
        artifact: Some("artifact-existing".into()),
        entry: None,
        no_progress: true,
        json: Some("artifact,version,publication".into()),
        jq: None,
        template: None,
    };
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut stdout = Vec::new();
    run_artifact_upload(&args, &api, &store, &mut stdout, &mut Vec::new())
        .await
        .expect("upload version");
    let output: serde_json::Value =
        serde_json::from_slice(&stdout).expect("structured Upload output");
    assert_eq!(output["artifact"]["name"], "Existing report");
    assert_eq!(output["version"]["id"], "version-2");
    assert_eq!(output["publication"]["versionId"], "version-1");
    assert_ne!(output["publication"]["versionId"], output["version"]["id"]);
    let request = server
        .received_requests()
        .await
        .expect("requests")
        .into_iter()
        .find(|request| request.method.as_str() == "POST")
        .expect("upload request");
    assert!(!String::from_utf8_lossy(&request.body).contains("name=\"name\""));
}

#[tokio::test]
async fn missing_upload_target_fails_before_any_request_without_a_terminal() {
    let args = ArtifactUploadArgs {
        paths: vec!["missing.zip".into()],
        root: None,
        name: None,
        artifact: None,
        entry: None,
        no_progress: true,
        json: None,
        jq: None,
        template: None,
    };
    let api = ApiClient::new("http://127.0.0.1:1").expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let error = run_artifact_upload(&args, &api, &store, &mut Vec::new(), &mut Vec::new())
        .await
        .expect_err("selection unavailable");
    assert!(error.to_string().contains("--name or --artifact"));
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_process_packages_only_selected_file_and_uploads_it() {
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
    let selected = directory.path().join("index.html");
    std::fs::write(&selected, "selected-content").expect("selected");
    std::fs::write(directory.path().join("secret.txt"), "sibling-secret").expect("sibling");
    let executable = std::env::current_exe().expect("test executable");
    let uri = server.uri();
    let output = tokio::task::spawn_blocking(move || {
        Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "process_package_fixture",
                "--nocapture",
            ])
            .env("SHARESLICES_TEST_API_URL", uri)
            .env("SHARESLICES_TEST_UPLOAD_PATH", "index.html")
            .current_dir(directory.path())
            .output()
            .expect("isolated CLI process")
    })
    .await
    .expect("process task");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("uploaded as Version version-1"));
    let requests = server.received_requests().await.expect("requests");
    let upload = requests
        .iter()
        .find(|request| request.method.as_str() == "POST")
        .expect("upload request");
    let body = String::from_utf8_lossy(&upload.body);
    assert!(body.contains("index.html"));
    assert!(!body.contains("secret.txt"));
    assert!(!body.contains("sibling-secret"));
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_process_uploads_an_explicit_new_version() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts/artifact-existing/upload-sessions"))
        .respond_with(InProgressThenAccepted(Arc::new(AtomicUsize::new(0))))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-existing"))
        .respond_with(ExistingVersionThenNewVersion(Arc::new(AtomicUsize::new(0))))
        .expect(2)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::write(directory.path().join("index.html"), "version two").expect("input");
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let uri = server.uri();
        let working_directory = directory.path().to_owned();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_package_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", uri)
                .env("SHARESLICES_TEST_UPLOAD_PATH", "index.html")
                .env("SHARESLICES_TEST_ARTIFACT_ID", "artifact-existing")
                .current_dir(working_directory)
                .output()
                .expect("isolated CLI process")
        }
    })
    .await
    .expect("process task");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("Version version-2"));
    let requests = server.received_requests().await.expect("requests");
    let keys = requests
        .iter()
        .filter(|request| request.method.as_str() == "POST")
        .map(|request| request.headers.get("idempotency-key").expect("key"))
        .collect::<Vec<_>>();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1]);
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn isolated_production_entrypoint_reports_accepted_version_upload_on_sigint() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts/artifact-existing/upload-sessions"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-existing", "uploadSessionId": "upload-cancelled"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-existing"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_delay(std::time::Duration::from_secs(10))
                .set_body_json(serde_json::json!({
                    "artifact": {
                        "name": "Existing report",
                        "processingState": "processing",
                        "readyVersion": { "id": "version-1" },
                        "failure": null
                    }
                })),
        )
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::write(directory.path().join("index.html"), "version two").expect("input");
    let executable = std::env::current_exe().expect("test executable");
    let child = Command::new(executable)
        .args([
            "--ignored",
            "--exact",
            "process_package_fixture",
            "--nocapture",
        ])
        .env("SHARESLICES_TEST_API_URL", server.uri())
        .env("SHARESLICES_TEST_UPLOAD_PATH", "index.html")
        .env("SHARESLICES_TEST_ARTIFACT_ID", "artifact-existing")
        .current_dir(directory.path())
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
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Server processing continues"));
    assert!(stderr.contains("artifact-existing"));
    assert!(stderr.contains("upload-cancelled"));
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_production_entrypoint_reports_terminal_version_failure() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts/artifact-existing/upload-sessions"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-existing", "uploadSessionId": "upload-failed"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-existing"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "name": "Existing report",
                "processingState": "failed",
                "readyVersion": { "id": "version-1" },
                "publication": null,
                "failure": { "code": "invalid_zip", "message": "Replace the ZIP." }
            }
        })))
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::write(directory.path().join("index.html"), "version two").expect("input");
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let api_url = server.uri();
        let working_directory = directory.path().to_owned();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_package_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", api_url)
                .env("SHARESLICES_TEST_UPLOAD_PATH", "index.html")
                .env("SHARESLICES_TEST_ARTIFACT_ID", "artifact-existing")
                .current_dir(working_directory)
                .output()
                .expect("isolated CLI process")
        }
    })
    .await
    .expect("process task");
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("upload-failed"));
    assert!(stderr.contains("artifact-existing"));
    assert!(stderr.contains("invalid_zip"));
    assert!(stderr.contains("retry explicitly with --artifact"));
}

#[tokio::test(flavor = "multi_thread")]
async fn isolated_production_dispatcher_selects_an_existing_artifact_interactively() {
    let server = MockServer::start().await;
    mount_upload_policy(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [{
                "id": "artifact-existing",
                "name": "Existing report",
                "updatedAt": "2026-07-12T08:00:00Z",
                "processingState": "ready",
                "shareLink": { "state": "active", "expiresAt": null },
                "publication": null
            }],
            "nextPageToken": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts/artifact-existing/upload-sessions"))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-existing", "uploadSessionId": "upload-interactive"
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-existing"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "name": "Existing report",
                "processingState": "ready",
                "readyVersion": { "id": "version-2" },
                "publication": null,
                "failure": null
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("tempdir");
    std::fs::write(directory.path().join("index.html"), "version two").expect("input");
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let api_url = server.uri();
        let working_directory = directory.path().to_owned();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_package_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", api_url)
                .env("SHARESLICES_TEST_UPLOAD_PATH", "index.html")
                .env("SHARESLICES_TEST_INTERACTIVE", "1")
                .current_dir(working_directory)
                .output()
                .expect("isolated CLI process")
        }
    })
    .await
    .expect("process task");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("Version version-2"));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("Upload a new Version to an existing Artifact"));
    assert!(stderr.contains("Existing report"));
}

#[tokio::test]
#[ignore = "fixture invoked only by isolated process tests"]
async fn process_package_fixture() {
    let api = ApiClient::new(&std::env::var("SHARESLICES_TEST_API_URL").expect("API URL"))
        .expect("client");
    let mut arguments = vec![
        "shareslices".to_owned(),
        "artifact".to_owned(),
        "upload".to_owned(),
        std::env::var("SHARESLICES_TEST_UPLOAD_PATH").expect("upload path"),
        "--no-progress".to_owned(),
    ];
    let interactive = std::env::var_os("SHARESLICES_TEST_INTERACTIVE").is_some();
    if interactive {
        // Target and Artifact are selected through the injected terminal input below.
    } else if let Ok(artifact_id) = std::env::var("SHARESLICES_TEST_ARTIFACT_ID") {
        arguments.extend(["--artifact".to_owned(), artifact_id]);
    } else {
        arguments.extend(["--name".to_owned(), "Process package".to_owned()]);
    }
    let cli = Cli::try_parse_from(arguments).expect("production command parser");
    let CliCommand::Artifact { command } = cli.command else {
        unreachable!("fixture parses Artifact command")
    };
    assert!(matches!(command, ArtifactCommand::Upload(_)));
    let store = Store(Mutex::new(Some("fixture-secret".into())));
    let result = if interactive {
        let mut interaction = ArtifactInteraction {
            prompts_enabled: true,
            is_terminal: true,
            input: &mut Cursor::new(b"2\n1\n"),
        };
        run_artifact_command_with_interaction(
            command,
            &api,
            &store,
            &mut interaction,
            &mut std::io::stdout(),
            &mut std::io::stderr(),
        )
        .await
    } else {
        run_artifact_command(
            command,
            &api,
            &store,
            &mut std::io::stdout(),
            &mut std::io::stderr(),
        )
        .await
    };
    if let Err(error) = result {
        let code = artifact_exit_code(&error);
        eprintln!("{error}");
        std::process::exit(code);
    }
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

#[test]
fn upload_target_prompt_selects_new_or_existing_and_never_waits_when_disabled() {
    let mut output = Vec::new();
    assert_eq!(
        select_upload_target(true, true, &mut Cursor::new(b"1\n"), &mut output)
            .expect("new target"),
        UploadTargetChoice::New
    );
    assert!(
        String::from_utf8(output)
            .expect("prompt")
            .contains("new Version")
    );
    assert_eq!(
        select_upload_target(true, true, &mut Cursor::new(b"2\n"), &mut Vec::new())
            .expect("existing target"),
        UploadTargetChoice::Existing
    );
    assert!(select_upload_target(false, true, &mut Cursor::new(b"1\n"), &mut Vec::new()).is_err());
}
