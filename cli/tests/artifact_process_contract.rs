// cspell:ignore nocapture
use shareslices_cli::{AuthError, CredentialStore, run_cli_process};
use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Output};
use std::sync::Mutex;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "injected-process-token";

struct ProcessStore(Mutex<Option<String>>);

impl CredentialStore for ProcessStore {
    fn get(&self) -> Result<Option<String>, AuthError> {
        Ok(self.0.lock().expect("store").clone())
    }

    fn set(&self, value: &str) -> Result<(), AuthError> {
        *self.0.lock().expect("store") = Some(value.to_owned());
        Ok(())
    }

    fn delete(&self) -> Result<(), AuthError> {
        *self.0.lock().expect("store") = None;
        Ok(())
    }
}

async fn run_injected_process(server: &MockServer, arguments: &[&str], cwd: &Path) -> Output {
    run_injected_process_with_token(server, arguments, cwd, Some(TOKEN)).await
}

async fn run_injected_process_with_token(
    server: &MockServer,
    arguments: &[&str],
    cwd: &Path,
    token: Option<&str>,
) -> Output {
    let mut cli_arguments = vec![
        "shareslices".to_owned(),
        "--api-url".to_owned(),
        server.uri(),
    ];
    cli_arguments.extend(arguments.iter().map(|value| (*value).to_owned()));
    let encoded = serde_json::to_string(&cli_arguments).expect("process arguments");
    let executable = std::env::current_exe().expect("test process");
    let cwd = cwd.to_owned();
    let token = token.unwrap_or_default().to_owned();
    tokio::task::spawn_blocking(move || {
        Command::new(executable)
            .args([
                "--ignored",
                "--exact",
                "injected_cli_runner_process_fixture",
                "--nocapture",
            ])
            .env("SHARESLICES_TEST_CLI_ARGUMENTS", encoded)
            .env("SHARESLICES_TEST_TOKEN", token)
            .env("SHARESLICES_STATE_DIR", cwd.join("agent-state"))
            .env("SHARESLICES_PROMPT_DISABLED", "1")
            .current_dir(cwd)
            .output()
            .expect("injected CLI runner process")
    })
    .await
    .expect("process task")
}

#[tokio::test(flavor = "multi_thread")]
async fn agent_login_starts_once_returns_immediately_and_reuses_the_continuation() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/cli-authorizations"))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "authorization": {
                "deviceCode": "server-only-device-secret",
                "userCode": "ABCD-EFGH",
                "verificationUri": "https://example.test/device",
                "verificationUriComplete": "https://example.test/device?user_code=ABCDEFGH",
                "expiresIn": 600,
                "interval": 5
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("directory");
    let arguments = ["--agent", "--agent-protocol", "1", "auth", "login"];

    let first = run_injected_process_with_token(&server, &arguments, directory.path(), None).await;
    let second = run_injected_process_with_token(&server, &arguments, directory.path(), None).await;

    for output in [&first, &second] {
        assert_eq!(output.status.code(), Some(4));
        assert!(output.stderr.is_empty());
    }
    let first = agent_document(&first.stdout);
    let second = agent_document(&second.stdout);
    assert_eq!(first["outcome"], "action_required");
    assert_eq!(first["nextAction"]["kind"], "authorize");
    assert_eq!(first["continuation"]["id"], second["continuation"]["id"]);
    assert!(
        !serde_json::to_string(&first)
            .expect("JSON")
            .contains("server-only-device-secret")
    );
}

fn agent_document(stdout: &[u8]) -> serde_json::Value {
    let stdout = String::from_utf8_lossy(stdout);
    let document = stdout
        .lines()
        .find(|line| line.starts_with('{'))
        .expect("one Agent JSON document");
    assert_eq!(
        stdout.lines().filter(|line| line.starts_with('{')).count(),
        1
    );
    serde_json::from_str(document).expect("Agent JSON")
}

fn assert_success(output: &Output) {
    assert!(
        output.status.success(),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn artifact(id: &str, publication: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "name": "Quarterly report",
        "updatedAt": "2026-07-13T00:00:00Z",
        "processingState": "ready",
        "shareLink": {
            "url": "https://viewer.example/a/stable/",
            "state": "active"
        },
        "publicationStatus": if publication.is_null() { "not_published" } else { "published" },
        "publication": publication
    })
}

async fn mount_upload_policy(server: &MockServer, count: u64) {
    Mock::given(method("GET"))
        .and(path("/api/artifact-upload-policies/current"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "policy": {
                "revision": "test",
                "maxArchiveBytes": 10_000_000,
                "maxExpandedBytes": 10_000_000,
                "maxFileCount": 100,
                "maxFileBytes": 10_000_000,
                "enabledExtensions": [".html", ".css", ".js", ".json", ".txt"]
            }
        })))
        .expect(count)
        .mount(server)
        .await;
}

async fn mount_successful_upload(server: &MockServer, count: u64) {
    Mock::given(method("POST"))
        .and(path("/api/artifacts"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(202).set_body_json(serde_json::json!({
            "artifactId": "artifact-uploaded",
            "uploadSessionId": "upload-process"
        })))
        .expect(count)
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-uploaded"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "name": "Uploaded",
                "processingState": "ready",
                "readyVersion": { "id": "version-uploaded" },
                "publication": null,
                "failure": null
            }
        })))
        .expect(count)
        .mount(server)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn injected_runner_process_lists_artifacts_through_parser_http_and_stdio() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [artifact("artifact-list", &serde_json::Value::Null)],
            "nextPageToken": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("directory");

    let output = run_injected_process(
        &server,
        &["artifact", "list", "--json", "id,name"],
        directory.path(),
    )
    .await;

    assert_success(&output);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("artifact-list"));
    assert!(stdout.contains("Quarterly report"));
    assert!(output.stderr.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn injected_runner_agent_list_emits_one_typed_document_and_empty_stderr() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifacts": [{
                "id": "artifact-agent-list",
                "name": "Agent report",
                "updatedAt": "2026-07-13T00:00:00Z",
                "processingState": "failed",
                "shareLink": null,
                "publicationStatus": "not_published",
                "publication": null,
                "readyVersion": null,
                "validationReport": { "primaryIssue": { "code": "missing_entry" } },
                "failure": { "code": "validation_failed", "message": "Entry is missing.", "recoverable": true },
                "allowedActions": ["replace_file", "delete"]
            }],
            "nextPageToken": null
        })))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("directory");

    let output = run_injected_process(
        &server,
        &["--agent", "--agent-protocol", "1", "artifact", "list"],
        directory.path(),
    )
    .await;

    assert_success(&output);
    assert!(output.stderr.is_empty());
    // The subprocess is the Rust test harness, so `--nocapture` surrounds the CLI's stdout with
    // harness status lines. Parse the one JSON line emitted by `run_cli_process` itself.
    let value = agent_document(&output.stdout);
    assert_eq!(value["operation"], "artifact.list");
    assert_eq!(value["outcome"], "completed");
    assert_eq!(
        value["data"]["artifacts"][0]["validationReport"]["primaryIssue"]["code"],
        "missing_entry"
    );
    assert_eq!(
        value["data"]["artifacts"][0]["failure"]["recoverable"],
        true
    );
    assert_eq!(
        value["data"]["artifacts"][0]["allowedActions"],
        serde_json::json!(["replace_file", "delete"])
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn indeterminate_publish_requires_state_inspection_before_any_replay() {
    let server = MockServer::start().await;
    let publication = serde_json::json!({
        "id": "publication-current",
        "versionId": "version-current",
        "publishedAt": "2026-07-13T00:00:00Z",
        "expirationKind": "permanent",
        "durationSeconds": null,
        "expiresAt": null,
        "endedAt": null,
        "endReason": null
    });
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-uncertain"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": artifact("artifact-uncertain", &publication)
        })))
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts/artifact-uncertain/publications"))
        .respond_with(ResponseTemplate::new(500).set_body_json(serde_json::json!({
            "error": {
                "code": "internal_error",
                "message": "The result could not be confirmed.",
                "requestId": "request-uncertain"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("directory");

    let mutation = run_injected_process(
        &server,
        &[
            "--agent",
            "--agent-protocol",
            "1",
            "artifact",
            "publish",
            "artifact-uncertain",
            "--version",
            "version-next",
        ],
        directory.path(),
    )
    .await;
    assert_eq!(mutation.status.code(), Some(1));
    assert!(mutation.stderr.is_empty());
    let result = agent_document(&mutation.stdout);
    assert_eq!(result["outcome"], "indeterminate");
    assert_eq!(result["resources"]["artifact"]["id"], "artifact-uncertain");
    assert_eq!(result["error"]["requestId"], "request-uncertain");
    assert_eq!(result["nextAction"]["kind"], "inspect_state");

    let inspection = run_injected_process(
        &server,
        &[
            "--agent",
            "--agent-protocol",
            "1",
            "artifact",
            "publication",
            "view",
            "artifact-uncertain",
        ],
        directory.path(),
    )
    .await;
    assert_success(&inspection);
    let state = agent_document(&inspection.stdout);
    assert_eq!(state["outcome"], "completed");
    assert_eq!(
        state["resources"]["artifact"]["publication"]["id"],
        "publication-current"
    );
}

#[tokio::test(flavor = "multi_thread")]
#[allow(clippy::too_many_lines)]
async fn injected_runner_process_exercises_publish_unpublish_share_and_delete() {
    let server = MockServer::start().await;
    let publication = serde_json::json!({
        "id": "publication-1",
        "versionId": "version-1",
        "publishedAt": "2026-07-13T00:00:00Z",
        "expirationKind": "permanent",
        "durationSeconds": null,
        "expiresAt": null,
        "endedAt": null,
        "endReason": null
    });
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": artifact("artifact-1", &publication)
        })))
        .expect(4)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/artifacts/artifact-1/publications"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({
            "publication": {
                "id": "publication-2",
                "versionId": "version-2",
                "publishedAt": "2026-07-13T01:00:00Z",
                "expirationKind": "permanent",
                "durationSeconds": null,
                "expiresAt": null,
                "endedAt": null,
                "endReason": null
            },
            "shareLink": {
                "url": "https://viewer.example/a/stable/",
                "state": "active"
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/artifacts/artifact-1/publications/publication-1"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .and(path("/api/artifacts/artifact-1/publications/publication-1"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": artifact("artifact-1", &serde_json::Value::Null)
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/artifacts/artifact-1"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("directory");

    let publish = run_injected_process(
        &server,
        &[
            "artifact",
            "publish",
            "artifact-1",
            "--version",
            "version-2",
        ],
        directory.path(),
    )
    .await;
    assert_success(&publish);
    assert!(String::from_utf8_lossy(&publish.stdout).contains("Version version-2"));
    assert!(publish.stderr.is_empty());

    let unpublish = run_injected_process(
        &server,
        &["artifact", "unpublish", "artifact-1"],
        directory.path(),
    )
    .await;
    assert_success(&unpublish);
    assert!(String::from_utf8_lossy(&unpublish.stdout).contains("not accessible"));

    let share_view = run_injected_process(
        &server,
        &["artifact", "publication", "view", "artifact-1"],
        directory.path(),
    )
    .await;
    assert_success(&share_view);
    assert!(
        String::from_utf8_lossy(&share_view.stdout).contains("https://viewer.example/a/stable/")
    );

    let share_edit = run_injected_process(
        &server,
        &[
            "artifact",
            "publication",
            "edit",
            "artifact-1",
            "--expires-at",
            "never",
        ],
        directory.path(),
    )
    .await;
    assert_success(&share_edit);
    assert!(String::from_utf8_lossy(&share_edit.stdout).contains("Expires: never"));

    let delete = run_injected_process(
        &server,
        &["artifact", "delete", "artifact-1", "--yes"],
        directory.path(),
    )
    .await;
    assert_success(&delete);
    assert!(String::from_utf8_lossy(&delete.stdout).contains("Deleted Artifact artifact-1"));
    assert!(delete.stderr.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn injected_runner_process_exports_to_the_requested_file() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-export"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "artifact": {
                "name": "Exported report",
                "processingState": "ready",
                "readyVersion": { "id": "version-export" },
                "publication": null,
                "failure": null
            }
        })))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/versions/version-export/export"))
        .and(header("authorization", format!("Bearer {TOKEN}")))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(b"exported-zip"))
        .expect(1)
        .mount(&server)
        .await;
    let directory = tempfile::tempdir().expect("directory");
    let destination = directory.path().join("download.zip");
    let destination_text = destination.to_string_lossy().into_owned();

    let output = run_injected_process(
        &server,
        &[
            "artifact",
            "export",
            "artifact-export",
            "--version",
            "version-export",
            "--output",
            &destination_text,
            "--no-progress",
        ],
        directory.path(),
    )
    .await;

    assert_success(&output);
    assert_eq!(std::fs::read(destination).expect("export"), b"exported-zip");
    assert!(String::from_utf8_lossy(&output.stdout).contains("Version version-export"));
    assert!(output.stderr.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn injected_runner_process_uploads_a_prepared_zip_without_repackaging() {
    let server = MockServer::start().await;
    mount_upload_policy(&server, 1).await;
    mount_successful_upload(&server, 1).await;
    let directory = tempfile::tempdir().expect("directory");
    let archive_path = directory.path().join("prepared.zip");
    let file = std::fs::File::create(&archive_path).expect("archive");
    let mut archive = zip::ZipWriter::new(file);
    archive
        .start_file("index.html", zip::write::SimpleFileOptions::default())
        .expect("entry");
    archive.write_all(b"prepared-body").expect("body");
    archive.finish().expect("finish");

    let output = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "prepared.zip",
            "--name",
            "Prepared",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;

    assert_success(&output);
    assert!(String::from_utf8_lossy(&output.stdout).contains("Version version-uploaded"));
    assert!(output.stderr.is_empty());
    let upload = server
        .received_requests()
        .await
        .expect("requests")
        .into_iter()
        .find(|request| request.method.as_str() == "POST")
        .expect("upload");
    let body = String::from_utf8_lossy(&upload.body);
    assert!(body.contains("prepared.zip"));
    assert!(body.contains("index.html"));
}

#[tokio::test(flavor = "multi_thread")]
async fn injected_runner_process_packages_directory_multiple_glob_and_ignores_metadata() {
    let server = MockServer::start().await;
    mount_upload_policy(&server, 4).await;
    mount_successful_upload(&server, 4).await;
    let directory = tempfile::tempdir().expect("directory");

    let site = directory.path().join("site");
    std::fs::create_dir(&site).expect("site");
    std::fs::write(site.join("index.html"), "directory-index").expect("index");
    std::fs::write(site.join("style.css"), "directory-style").expect("style");
    let directory_upload = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "site",
            "--name",
            "Directory",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;
    assert_success(&directory_upload);

    std::fs::write(directory.path().join("index.html"), "multiple-index").expect("index");
    std::fs::write(directory.path().join("data.json"), "multiple-data").expect("data");
    let multiple_upload = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "index.html",
            "data.json",
            "--root",
            ".",
            "--name",
            "Multiple",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;
    assert_success(&multiple_upload);

    std::fs::write(directory.path().join("alternate.html"), "glob-alternate").expect("alternate");
    let glob_upload = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "*.html",
            "--name",
            "Glob",
            "--entry",
            "index.html",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;
    assert_success(&glob_upload);

    let metadata = directory.path().join("metadata");
    std::fs::create_dir_all(metadata.join("__MACOSX")).expect("metadata directory");
    std::fs::write(metadata.join("index.html"), "metadata-index").expect("index");
    std::fs::write(metadata.join(".DS_Store"), "private-metadata").expect("metadata");
    std::fs::write(metadata.join("__MACOSX/ignored.txt"), "private-resource").expect("resource");
    let metadata_upload = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "metadata",
            "--name",
            "Metadata",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;
    assert_success(&metadata_upload);

    let uploads = server
        .received_requests()
        .await
        .expect("requests")
        .into_iter()
        .filter(|request| request.method.as_str() == "POST")
        .collect::<Vec<_>>();
    assert_eq!(uploads.len(), 4);
    let bodies = uploads
        .iter()
        .map(|request| String::from_utf8_lossy(&request.body))
        .collect::<Vec<_>>();
    assert!(bodies.iter().any(|body| body.contains("style.css")));
    assert!(bodies.iter().any(|body| body.contains("data.json")));
    assert!(bodies.iter().any(|body| body.contains("alternate.html")));
    assert!(bodies.iter().all(|body| !body.contains(".DS_Store")));
    assert!(bodies.iter().all(|body| !body.contains("__MACOSX")));
    assert!(bodies.iter().all(|body| !body.contains("private-metadata")));
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn injected_runner_process_rejects_links_nested_zip_and_unmatched_glob_before_upload() {
    use std::os::unix::fs::symlink;

    let server = MockServer::start().await;
    mount_upload_policy(&server, 3).await;
    let directory = tempfile::tempdir().expect("directory");

    let linked = directory.path().join("linked");
    std::fs::create_dir(&linked).expect("linked directory");
    std::fs::write(linked.join("index.html"), "index").expect("index");
    symlink("index.html", linked.join("alias.html")).expect("link");
    let link_output = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "linked",
            "--name",
            "Linked",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;
    assert_eq!(link_output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&link_output.stderr).contains("symbolic links"));

    let nested = directory.path().join("nested");
    std::fs::create_dir(&nested).expect("nested directory");
    std::fs::write(nested.join("index.html"), "index").expect("index");
    let nested_file = std::fs::File::create(nested.join("child.zip")).expect("nested ZIP");
    zip::ZipWriter::new(nested_file)
        .finish()
        .expect("finish ZIP");
    let nested_output = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "nested",
            "--name",
            "Nested",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;
    assert_eq!(nested_output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&nested_output.stderr).contains("nested ZIP"));

    let unmatched_output = run_injected_process(
        &server,
        &[
            "artifact",
            "upload",
            "missing-*.html",
            "--name",
            "Missing",
            "--no-progress",
        ],
        directory.path(),
    )
    .await;
    assert_eq!(unmatched_output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&unmatched_output.stderr).contains("matched no inputs"));

    assert!(
        server
            .received_requests()
            .await
            .expect("requests")
            .iter()
            .all(|request| request.method.as_str() != "POST")
    );
}

#[tokio::test]
#[ignore = "subprocess fixture for injected runner process tests"]
async fn injected_cli_runner_process_fixture() {
    let arguments = serde_json::from_str::<Vec<String>>(
        &std::env::var("SHARESLICES_TEST_CLI_ARGUMENTS").expect("CLI arguments"),
    )
    .expect("valid CLI arguments");
    let token = std::env::var("SHARESLICES_TEST_TOKEN").expect("test token");
    let store = ProcessStore(Mutex::new((!token.is_empty()).then_some(token)));
    let code = run_cli_process(
        arguments,
        |_| Ok(store),
        &mut std::io::stdout(),
        &mut std::io::stderr(),
    )
    .await;
    if code != 0 {
        std::process::exit(code);
    }
}
