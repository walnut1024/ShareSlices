// cspell:ignore nocapture
use shareslices_cli::{
    ApiClient, Artifact, ArtifactListArgs, ArtifactShareLink, ArtifactUploadArgs, AuthError,
    CredentialStore, run_artifact_list, run_artifact_upload, select_artifact,
};
use std::io::Cursor;
use std::io::Write as _;
use std::process::Command;
use std::sync::Mutex;
use wiremock::matchers::{method, path};
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
        path,
        name: None,
        entry: None,
        no_progress: true,
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
