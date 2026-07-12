// cspell:ignore nocapture noninteractive rfind
use clap::Parser as _;
use shareslices_cli::{
    ApiClient, Artifact, ArtifactCommand, ArtifactDeleteArgs, ArtifactExportArgs,
    ArtifactInteraction, ArtifactListArgs, ArtifactPublishArgs, ArtifactShareEditArgs,
    ArtifactShareLink, ArtifactShareViewArgs, ArtifactUnpublishArgs, ArtifactUploadArgs, AuthError,
    Cli, Command as CliCommand, CredentialStore, UploadTargetChoice, artifact_exit_code,
    run_artifact_command, run_artifact_command_with_input, run_artifact_command_with_interaction,
    run_artifact_delete, run_artifact_export_with_interaction, run_artifact_list,
    run_artifact_publish, run_artifact_share_edit, run_artifact_share_view, run_artifact_upload,
    select_artifact, select_upload_target,
};
use std::io::Cursor;
use std::io::Write as _;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use wiremock::matchers::{body_json, header_exists, method, path};
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
    run_artifact_command_with_interaction(
        ArtifactCommand::Export(args),
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
    run_artifact_command_with_interaction(
        ArtifactCommand::Export(args),
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
            .contains("ARTIFACT_ID and --version")
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
            "artifact": { "name": "CON", "processingState": "ready", "readyVersion": { "id": "version-default-773" }, "publication": null, "failure": null }
        }))).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/versions/version-default-773/export"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"default-zip"))
        .mount(&server)
        .await;
    let destination = std::path::PathBuf::from("_CON-version-default-773.zip");
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

fn share_view_args(artifact: Option<&str>, json: Option<&str>) -> ArtifactShareViewArgs {
    ArtifactShareViewArgs {
        artifact: artifact.map(str::to_owned),
        json: json.map(str::to_owned),
        jq: None,
        template: None,
    }
}

fn share_edit_args(
    artifact: Option<&str>,
    expires_at: Option<&str>,
    json: Option<&str>,
) -> ArtifactShareEditArgs {
    ArtifactShareEditArgs {
        artifact: artifact.map(str::to_owned),
        expires_at: expires_at.map(str::to_owned),
        json: json.map(str::to_owned),
        jq: None,
        template: None,
    }
}

fn delete_args(artifact: Option<&str>, yes: bool) -> ArtifactDeleteArgs {
    ArtifactDeleteArgs {
        artifact: artifact.map(str::to_owned),
        yes,
    }
}

#[test]
fn shipping_binary_parses_delete_and_rejects_unsafe_noninteractive_forms_locally() {
    let binary = env!("CARGO_BIN_EXE_shareslices");
    let confirmation = Command::new(binary)
        .args(["artifact", "delete", "artifact-1"])
        .env("SHARESLICES_PROMPT_DISABLED", "1")
        .output()
        .expect("shipping CLI");
    assert_eq!(confirmation.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&confirmation.stderr).contains("confirmation is required"));

    let omitted = Command::new(binary)
        .args(["artifact", "delete", "--yes"])
        .env("SHARESLICES_PROMPT_DISABLED", "1")
        .output()
        .expect("shipping CLI");
    assert_eq!(omitted.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&omitted.stderr).contains("requires an Artifact ID"));
}

#[tokio::test]
async fn delete_with_explicit_id_and_yes_uses_production_dispatcher_without_prompting() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/api/artifacts/artifact-1"))
        .and(header_exists("shareslices-cli-version"))
        .and(header_exists("shareslices-cli-os"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut interaction = ArtifactInteraction {
        prompts_enabled: false,
        is_terminal: false,
        input: &mut Cursor::new(Vec::<u8>::new()),
    };
    let mut output = Vec::new();
    run_artifact_command_with_interaction(
        ArtifactCommand::Delete(delete_args(Some("artifact-1"), true)),
        &api,
        &store,
        &mut interaction,
        &mut output,
        &mut Vec::new(),
    )
    .await
    .expect("delete");
    assert_eq!(
        String::from_utf8(output).expect("stdout"),
        "Deleted Artifact artifact-1.\n"
    );
}

#[tokio::test]
async fn interactive_delete_ignores_yes_after_selection_and_requires_confirmation() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [{
                "id": "artifact-1", "name": "Report", "updatedAt": "2026-07-12T00:00:00Z",
                "processingState": "ready",
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null },
                "publication": null
            }],
            "nextPageToken": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut input = Cursor::new(b"1\nyes\n");
    let mut diagnostics = Vec::new();
    let mut interaction = ArtifactInteraction {
        prompts_enabled: true,
        is_terminal: true,
        input: &mut input,
    };
    run_artifact_delete(
        &delete_args(None, true),
        &api,
        &store,
        &mut interaction,
        &mut Vec::new(),
        &mut diagnostics,
    )
    .await
    .expect("confirmed delete");
    let diagnostics = String::from_utf8(diagnostics).expect("diagnostics");
    assert!(diagnostics.contains("Select an Artifact"));
    assert!(diagnostics.contains("This cannot be undone"));
}

#[tokio::test]
async fn delete_cancellation_is_exit_two_and_never_mutates() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null },
                "publication": null }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(204))
        .expect(0)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut input = Cursor::new(b"no\n");
    let mut interaction = ArtifactInteraction {
        prompts_enabled: true,
        is_terminal: true,
        input: &mut input,
    };
    let error = run_artifact_delete(
        &delete_args(Some("artifact-1"), false),
        &api,
        &store,
        &mut interaction,
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect_err("cancelled");
    assert_eq!(artifact_exit_code(&error), 2);
}

#[tokio::test]
async fn delete_distinguishes_auth_state_conflict_absence_and_indeterminate_results() {
    for (status, expected, exit) in [
        (401, "Not signed in", 4),
        (404, "Artifact not found", 1),
        (409, "while processing", 1),
        (503, "could not confirm the result", 1),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("DELETE"))
            .and(path("/api/artifacts/artifact-1"))
            .respond_with(ResponseTemplate::new(status).set_body_json(serde_json::json!({
                "error": { "code": if status == 409 { "invalid_artifact_state" } else { "test_error" } }
            })))
            .expect(1)
            .mount(&server)
            .await;
        let api = ApiClient::new(&server.uri()).expect("client");
        let store = Store(Mutex::new(Some("secret".into())));
        let mut interaction = ArtifactInteraction {
            prompts_enabled: false,
            is_terminal: false,
            input: &mut Cursor::new(Vec::<u8>::new()),
        };
        let error = run_artifact_delete(
            &delete_args(Some("artifact-1"), true),
            &api,
            &store,
            &mut interaction,
            &mut Vec::new(),
            &mut Vec::new(),
        )
        .await
        .expect_err("typed failure");
        assert!(error.to_string().contains(expected), "{error}");
        assert_eq!(artifact_exit_code(&error), exit);
    }
}

#[tokio::test]
async fn complete_cli_process_deletes_explicit_and_interactively_selected_artifacts() {
    for interactive in [false, true] {
        let server = MockServer::start().await;
        if interactive {
            Mock::given(method("GET"))
                .and(path("/api/artifacts"))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "artifacts": [{
                        "id": "artifact-1", "name": "Report", "updatedAt": "2026-07-12T00:00:00Z",
                        "processingState": "ready",
                        "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null },
                        "publication": null
                    }], "nextPageToken": null
                })))
                .expect(1)
                .mount(&server)
                .await;
        }
        Mock::given(method("DELETE"))
            .and(path("/api/artifacts/artifact-1"))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;
        let executable = std::env::current_exe().expect("test executable");
        let output = tokio::task::spawn_blocking({
            let api_url = server.uri();
            move || {
                let mut command = Command::new(executable);
                command
                    .args([
                        "--ignored",
                        "--exact",
                        "process_delete_fixture",
                        "--nocapture",
                    ])
                    .env("SHARESLICES_TEST_API_URL", api_url);
                if interactive {
                    command.env("SHARESLICES_TEST_INTERACTIVE", "1");
                }
                command.output().expect("isolated CLI process")
            }
        })
        .await
        .expect("process task");
        assert_eq!(output.status.code(), Some(0));
        assert!(String::from_utf8_lossy(&output.stdout).contains("Deleted Artifact artifact-1."));
        let stderr = String::from_utf8_lossy(&output.stderr);
        if interactive {
            assert!(stderr.contains("Select an Artifact"));
            assert!(stderr.contains("This cannot be undone"));
        } else {
            assert!(stderr.is_empty(), "{stderr}");
        }
    }
}

#[tokio::test]
#[ignore = "fixture invoked only by complete_cli_process_deletes_explicit_and_interactively_selected_artifacts"]
async fn process_delete_fixture() {
    let api = ApiClient::new(&std::env::var("SHARESLICES_TEST_API_URL").expect("API URL"))
        .expect("client");
    let interactive = std::env::var_os("SHARESLICES_TEST_INTERACTIVE").is_some();
    let mut arguments = vec!["shareslices", "artifact", "delete"];
    if !interactive {
        arguments.extend(["artifact-1", "--yes"]);
    }
    let cli = Cli::try_parse_from(arguments).expect("production parser");
    let CliCommand::Artifact { command } = cli.command else {
        unreachable!("Artifact command")
    };
    let store = Store(Mutex::new(Some("fixture-secret".into())));
    let result = if interactive {
        let mut interaction = ArtifactInteraction {
            prompts_enabled: true,
            is_terminal: true,
            input: &mut Cursor::new(b"1\nyes\n"),
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
        eprintln!("{error}");
        std::process::exit(artifact_exit_code(&error));
    }
}

#[tokio::test]
async fn share_view_reports_stable_link_and_effective_states() {
    for (publication, state, expires_at, expected) in [
        (
            Some(serde_json::json!({"id":"publication-1"})),
            "active",
            None,
            "accessible",
        ),
        (None, "active", None, "not accessible"),
        (
            Some(serde_json::json!({"id":"publication-1"})),
            "expired",
            Some("2020-01-01T00:00:00Z"),
            "not accessible",
        ),
    ] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/artifacts/artifact-1"))
            .and(header_exists("shareslices-cli-version"))
            .and(header_exists("shareslices-cli-os"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "artifact": {
                    "id": "artifact-1", "name": "Report",
                    "shareLink": {
                        "url": "https://viewer.example/a/stable-slug/",
                        "state": state, "expiresAt": expires_at
                    },
                    "publication": publication
                }
            })))
            .expect(1)
            .mount(&server)
            .await;
        let api = ApiClient::new(&server.uri()).expect("client");
        let store = Store(Mutex::new(Some("secret".into())));
        let mut output = Vec::new();
        run_artifact_share_view(
            &share_view_args(
                Some("artifact-1"),
                Some("url,publicationState,expiresAt,accessState"),
            ),
            &api,
            &store,
            false,
            &mut Cursor::new(Vec::<u8>::new()),
            &mut output,
            &mut Vec::new(),
        )
        .await
        .expect("share view");
        let value: serde_json::Value = serde_json::from_slice(&output).expect("json");
        assert_eq!(value["url"], "https://viewer.example/a/stable-slug/");
        assert_eq!(value["accessState"], expected);
    }
}

#[tokio::test]
async fn share_edit_sends_future_expiration_and_preserves_link_and_publication() {
    let server = MockServer::start().await;
    let artifact = serde_json::json!({
        "id": "artifact-1", "name": "Report",
        "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "active", "expiresAt": "2099-08-01T08:30:00+08:00" },
        "publication": { "id": "publication-1", "versionId": "version-2" }
    });
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .and(header_exists("shareslices-cli-version"))
        .and(header_exists("shareslices-cli-os"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": artifact})),
        )
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/api/artifacts/artifact-1/share-link"))
        .and(header_exists("shareslices-cli-version"))
        .and(header_exists("shareslices-cli-os"))
        .and(body_json(
            serde_json::json!({"expiresAt":"2099-08-01T08:30:00+08:00"}),
        ))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": artifact})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut output = Vec::new();
    run_artifact_share_edit(
        &share_edit_args(
            Some("artifact-1"),
            Some("2099-08-01T08:30:00+08:00"),
            Some("url,publicationState,expiresAt,accessState"),
        ),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut output,
        &mut Vec::new(),
    )
    .await
    .expect("share edit");
    let value: serde_json::Value = serde_json::from_slice(&output).expect("json");
    assert_eq!(value["url"], "https://viewer.example/a/stable-slug/");
    assert_eq!(value["publicationState"], "published");
}

#[tokio::test]
async fn share_formatting_supports_jq_and_template_without_transient_output() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null },
                "publication": null
            }
        })))
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));

    let mut jq_args = share_view_args(Some("artifact-1"), Some("url,accessState"));
    jq_args.jq = Some(".url".into());
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();
    run_artifact_share_view(
        &jq_args,
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut output,
        &mut diagnostics,
    )
    .await
    .expect("jq output");
    assert_eq!(
        String::from_utf8(output).expect("utf8"),
        "https://viewer.example/a/stable/\n"
    );
    assert!(diagnostics.is_empty());

    let mut template_args =
        share_view_args(Some("artifact-1"), Some("publicationState,accessState"));
    template_args.template = Some("{{.publicationState}}:{{.accessState}}".into());
    let mut output = Vec::new();
    run_artifact_share_view(
        &template_args,
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut output,
        &mut Vec::new(),
    )
    .await
    .expect("template output");
    assert_eq!(
        String::from_utf8(output).expect("utf8"),
        "unpublished:not accessible"
    );
}

#[tokio::test]
async fn share_upgrade_required_stops_before_expiration_mutation() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .and(header_exists("shareslices-cli-version"))
        .and(header_exists("shareslices-cli-os"))
        .respond_with(ResponseTemplate::new(426).set_body_json(serde_json::json!({
            "error": { "code": "cli_upgrade_required", "details": { "currentVersion": "0.1.0", "minimumVersion": "0.2.0" } }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/api/artifacts/artifact-1/share-link"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let error = run_artifact_share_edit(
        &share_edit_args(Some("artifact-1"), Some("never"), None),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect_err("upgrade gate");
    assert!(matches!(
        error,
        shareslices_cli::ArtifactError::UpgradeRequired { .. }
    ));
}

#[tokio::test]
async fn share_edit_never_clears_expiration_and_invalid_input_never_mutates() {
    let server = MockServer::start().await;
    let artifact = serde_json::json!({
        "id": "artifact-1", "name": "Report",
        "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "active", "expiresAt": null },
        "publication": null
    });
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": artifact})),
        )
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/api/artifacts/artifact-1/share-link"))
        .and(body_json(serde_json::json!({"expiresAt":null})))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": artifact})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    run_artifact_share_edit(
        &share_edit_args(Some("artifact-1"), Some("never"), None),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect("clear expiration");

    for invalid in ["yesterday", "2020-01-01T00:00:00Z", "2099-01-01T00:00:00"] {
        let error = run_artifact_share_edit(
            &share_edit_args(Some("artifact-1"), Some(invalid), None),
            &api,
            &store,
            false,
            &mut Cursor::new(Vec::<u8>::new()),
            &mut Vec::new(),
            &mut Vec::new(),
        )
        .await
        .expect_err("invalid expiration");
        assert!(matches!(
            error,
            shareslices_cli::ArtifactError::InvalidShareExpiration
        ));
    }
}

#[tokio::test]
async fn prompt_disabled_share_commands_require_explicit_inputs_before_network_access() {
    let server = MockServer::start().await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let view = run_artifact_share_view(
        &share_view_args(None, None),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect_err("artifact required");
    assert!(matches!(
        view,
        shareslices_cli::ArtifactError::ShareViewSelectionUnavailable
    ));
    let edit = run_artifact_share_edit(
        &share_edit_args(Some("artifact-1"), None, None),
        &api,
        &store,
        false,
        &mut Cursor::new(Vec::<u8>::new()),
        &mut Vec::new(),
        &mut Vec::new(),
    )
    .await
    .expect_err("expiration required");
    assert!(matches!(
        edit,
        shareslices_cli::ArtifactError::ShareEditSelectionUnavailable
    ));
}

#[tokio::test]
async fn interactive_share_edit_selects_artifact_and_prompts_for_expiration() {
    let server = MockServer::start().await;
    let list_artifact = serde_json::json!({
        "id": "artifact-1", "name": "Report", "updatedAt": "2026-07-12T00:00:00Z",
        "processingState": "ready",
        "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "active", "expiresAt": null },
        "publication": null
    });
    let detail = serde_json::json!({
        "id": "artifact-1", "name": "Report",
        "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "active", "expiresAt": null },
        "publication": null
    });
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [list_artifact], "nextPageToken": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": detail})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/api/artifacts/artifact-1/share-link"))
        .and(body_json(serde_json::json!({"expiresAt":null})))
        .respond_with(
            ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": detail})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut diagnostics = Vec::new();
    run_artifact_command_with_input(
        ArtifactCommand::Share {
            command: shareslices_cli::ArtifactShareCommand::Edit(share_edit_args(None, None, None)),
        },
        &api,
        &store,
        true,
        &mut Cursor::new(b"1\nnever\n".to_vec()),
        &mut Vec::new(),
        &mut diagnostics,
    )
    .await
    .expect("interactive share edit");
    let prompts = String::from_utf8(diagnostics).expect("utf8");
    assert!(prompts.contains("Select an Artifact"));
    assert!(prompts.contains("Expiration (RFC 3339 or never)"));
}

#[test]
fn shipping_binary_rejects_noninteractive_share_edit_without_expiration() {
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args(["artifact", "share", "edit", "artifact-1"])
        .env("SHARESLICES_PROMPT_DISABLED", "1")
        .output()
        .expect("shipping binary");
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stdout).is_empty());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("requires ARTIFACT_ID and --expires-at")
    );
}

#[test]
fn shipping_binary_rejects_invalid_share_expiration_before_authentication() {
    let output = Command::new(env!("CARGO_BIN_EXE_shareslices"))
        .args([
            "artifact",
            "share",
            "edit",
            "artifact-1",
            "--expires-at",
            "2020-01-01T00:00:00Z",
        ])
        .env("SHARESLICES_PROMPT_DISABLED", "1")
        .output()
        .expect("shipping binary");
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stdout).is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("future RFC 3339"));
}

#[tokio::test]
async fn complete_cli_process_views_share_through_production_dispatcher() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "active", "expiresAt": null },
                "publication": { "id": "publication-1" }
            }
        }))).expect(1).mount(&server).await;
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let api_url = server.uri();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_share_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", api_url)
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
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 stdout");
    let start = stdout.find('{').expect("JSON start");
    let end = stdout.rfind('}').expect("JSON end") + 1;
    let value: serde_json::Value = serde_json::from_str(&stdout[start..end]).expect("JSON stdout");
    assert_eq!(value["url"], "https://viewer.example/a/stable-slug/");
    assert_eq!(value["accessState"], "accessible");
    assert!(String::from_utf8_lossy(&output.stderr).is_empty());
}

#[tokio::test]
async fn complete_cli_process_reports_expired_unpublished_share() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "expired", "expiresAt": "2020-01-01T00:00:00Z" },
                "publication": null
            }
        }))).expect(1).mount(&server).await;
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let api_url = server.uri();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_share_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", api_url)
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
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 stdout");
    assert!(stdout.contains("\"publicationState\": \"unpublished\""));
    assert!(stdout.contains("\"accessState\": \"not accessible\""));
    assert!(stdout.contains("2020-01-01T00:00:00Z"));
}

#[tokio::test]
async fn complete_cli_process_edits_future_and_permanent_expiration() {
    for (requested, response_expiration) in [
        ("2099-08-01T08:30:00+08:00", Some("2099-08-01T00:30:00Z")),
        ("never", None),
    ] {
        let server = MockServer::start().await;
        let before = serde_json::json!({
            "id": "artifact-1", "name": "Report",
            "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "active", "expiresAt": null },
            "publication": { "id": "publication-1" }
        });
        let after = serde_json::json!({
            "id": "artifact-1", "name": "Report",
            "shareLink": { "url": "https://viewer.example/a/stable-slug/", "state": "active", "expiresAt": response_expiration },
            "publication": { "id": "publication-1" }
        });
        Mock::given(method("GET"))
            .and(path("/api/artifacts/artifact-1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": before})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let expected_request = if requested == "never" {
            serde_json::json!({"expiresAt":null})
        } else {
            serde_json::json!({"expiresAt":requested})
        };
        Mock::given(method("PATCH"))
            .and(path("/api/artifacts/artifact-1/share-link"))
            .and(body_json(expected_request))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"artifact": after})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let executable = std::env::current_exe().expect("test executable");
        let output = tokio::task::spawn_blocking({
            let api_url = server.uri();
            let requested = requested.to_owned();
            move || {
                Command::new(executable)
                    .args([
                        "--ignored",
                        "--exact",
                        "process_share_fixture",
                        "--nocapture",
                    ])
                    .env("SHARESLICES_TEST_API_URL", api_url)
                    .env("SHARESLICES_TEST_SHARE_EXPIRATION", requested)
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
        let stdout = String::from_utf8(output.stdout).expect("UTF-8 stdout");
        assert!(stdout.contains("https://viewer.example/a/stable-slug/"));
        assert!(stdout.contains("\"publicationState\": \"published\""));
    }
}

#[tokio::test]
async fn complete_cli_process_maps_share_authentication_to_exit_four() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(401).set_body_json(serde_json::json!({
            "error": { "code": "unauthenticated" }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let executable = std::env::current_exe().expect("test executable");
    let output = tokio::task::spawn_blocking({
        let api_url = server.uri();
        move || {
            Command::new(executable)
                .args([
                    "--ignored",
                    "--exact",
                    "process_share_fixture",
                    "--nocapture",
                ])
                .env("SHARESLICES_TEST_API_URL", api_url)
                .output()
                .expect("isolated CLI process")
        }
    })
    .await
    .expect("process task");
    assert_eq!(output.status.code(), Some(4));
    assert!(!String::from_utf8_lossy(&output.stdout).contains("https://"));
    assert!(String::from_utf8_lossy(&output.stderr).contains("Not signed in"));
}

#[tokio::test]
#[ignore = "fixture invoked only by complete_cli_process_views_share_through_production_dispatcher"]
async fn process_share_fixture() {
    let api = ApiClient::new(&std::env::var("SHARESLICES_TEST_API_URL").expect("API URL"))
        .expect("client");
    let mut arguments = vec![
        "shareslices".to_owned(),
        "artifact".to_owned(),
        "share".to_owned(),
    ];
    if let Ok(expiration) = std::env::var("SHARESLICES_TEST_SHARE_EXPIRATION") {
        arguments.extend([
            "edit".to_owned(),
            "artifact-1".to_owned(),
            "--expires-at".to_owned(),
            expiration,
        ]);
    } else {
        arguments.extend(["view".to_owned(), "artifact-1".to_owned()]);
    }
    arguments.extend([
        "--json".to_owned(),
        "url,publicationState,expiresAt,accessState".to_owned(),
    ]);
    let cli = Cli::try_parse_from(arguments).expect("production parser");
    let CliCommand::Artifact { command } = cli.command else {
        unreachable!("Artifact command")
    };
    let store = Store(Mutex::new(Some("fixture-secret".into())));
    if let Err(error) = run_artifact_command(
        command,
        &api,
        &store,
        &mut std::io::stdout(),
        &mut std::io::stderr(),
    )
    .await
    {
        eprintln!("{error}");
        std::process::exit(artifact_exit_code(&error));
    }
}

#[tokio::test]
async fn publishes_explicit_ready_version_and_reports_external_access() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": "2026-08-01T00:00:00Z" },
                "publication": null }
        })))
        .expect(1)
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
    run_artifact_command_with_input(
        ArtifactCommand::Publish(publish_args(
            Some("artifact-1"),
            Some("version-2"),
            Some("artifactId,versionId,accessState,expiresAt"),
        )),
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
async fn published_version_reports_expired_share_link_as_not_accessible() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "expired", "expiresAt": "2020-01-01T00:00:00Z" },
                "publication": null }
        })))
        .mount(&server)
        .await;
    Mock::given(method("POST")).and(path("/api/artifacts/artifact-1/publications"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "publication": { "id": "publication-1", "versionId": "version-2", "publishedAt": "2026-07-12T00:00:00Z" }
        }))).mount(&server).await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut output = Vec::new();
    run_artifact_command_with_input(
        ArtifactCommand::Publish(publish_args(
            Some("artifact-1"),
            Some("version-2"),
            Some("accessState,expiresAt"),
        )),
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
    assert_eq!(value["accessState"], "not accessible");
    assert_eq!(value["expiresAt"], "2020-01-01T00:00:00Z");
}

#[tokio::test]
async fn publish_dispatcher_surfaces_authorization_and_ready_version_gates() {
    for (artifact_status, publish_status, expected) in
        [(401, 0, "Not signed in"), (200, 409, "unexpected response")]
    {
        let server = MockServer::start().await;
        let artifact_response = if artifact_status == 200 {
            ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "artifact": { "id": "artifact-1", "name": "Report",
                    "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null }, "publication": null }
            }))
        } else {
            ResponseTemplate::new(401)
                .set_body_json(serde_json::json!({ "error": { "code": "unauthenticated" } }))
        };
        Mock::given(method("GET"))
            .and(path("/api/artifacts/artifact-1"))
            .respond_with(artifact_response)
            .mount(&server)
            .await;
        if publish_status != 0 {
            Mock::given(method("POST"))
                .and(path("/api/artifacts/artifact-1/publications"))
                .respond_with(ResponseTemplate::new(publish_status).set_body_json(
                    serde_json::json!({
                        "error": { "code": "version_not_ready" }
                    }),
                ))
                .mount(&server)
                .await;
        }
        let api = ApiClient::new(&server.uri()).expect("client");
        let store = Store(Mutex::new(Some("secret".into())));
        let error = run_artifact_command_with_input(
            ArtifactCommand::Publish(publish_args(Some("artifact-1"), Some("version-2"), None)),
            &api,
            &store,
            false,
            &mut Cursor::new(Vec::<u8>::new()),
            &mut Vec::new(),
            &mut Vec::new(),
        )
        .await
        .expect_err("publish gate");
        assert!(error.to_string().contains(expected), "{error}");
    }
}

#[tokio::test]
async fn unpublishes_only_current_publication_and_preserves_expiration_in_output() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": "2026-08-01T00:00:00Z" },
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
    run_artifact_command_with_input(
        ArtifactCommand::Unpublish(unpublish_args(
            Some("artifact-1"),
            Some("artifactId,accessState,expiresAt"),
        )),
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
            .contains("requires ARTIFACT_ID and --version")
    );
}

#[tokio::test]
async fn unpublish_is_idempotent_when_already_unpublished() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": { "id": "artifact-1", "name": "Report",
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null }, "publication": null }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut output = Vec::new();
    run_artifact_command_with_input(
        ArtifactCommand::Unpublish(unpublish_args(Some("artifact-1"), None)),
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
            "processingState": "ready", "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null }, "publication": null }],
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
          "artifact": { "id": "artifact-1", "name": "Report", "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null }, "publication": null }
        }))).expect(1).mount(&server).await;
    Mock::given(method("POST")).and(path("/api/artifacts/artifact-1/publications"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
          "publication": { "id": "publication-1", "versionId": "version-2", "publishedAt": "2026-07-12T00:00:00Z" }
        }))).mount(&server).await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let store = Store(Mutex::new(Some("secret".into())));
    let mut diagnostics = Vec::new();
    run_artifact_command_with_input(
        ArtifactCommand::Publish(publish_args(None, None, None)),
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
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null }, "publication": null }],
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
            .contains("requires ARTIFACT_ID and --version")
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
                "shareLink": { "url": "https://viewer.example/a/stable/", "state": "active", "expiresAt": null },
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
            url: "https://viewer.example/a/stable/".into(),
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
