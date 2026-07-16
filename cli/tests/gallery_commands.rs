use shareslices_cli::{
    ApiClient, ArtifactGalleryCommand, ArtifactGalleryMutationArgs, ArtifactGalleryViewArgs,
    ArtifactGalleryWithdrawArgs, AuthError, CredentialStore, run_gallery_command,
};
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

struct Store;
impl CredentialStore for Store {
    fn get(&self) -> Result<Option<String>, AuthError> {
        Ok(Some("secret".into()))
    }
    fn set(&self, _: &str) -> Result<(), AuthError> {
        Ok(())
    }
    fn delete(&self) -> Result<(), AuthError> {
        Ok(())
    }
}

fn mutation() -> ArtifactGalleryMutationArgs {
    ArtifactGalleryMutationArgs {
        artifact: "artifact-1".into(),
        version: "version-1".into(),
        title: "Report".into(),
        description: None,
        tags: vec!["demo".into()],
        display_name: "Ada".into(),
        biography: None,
        profile_revision: Some(2),
        listing_id: Some("listing-1".into()),
        listing_revision: Some(3),
        grant_version: "grant-1".into(),
        accept_permission: true,
        confirm_replacement: false,
        idempotency_key: "operation-1".into(),
        agent_mode: false,
    }
}

#[tokio::test]
async fn all_four_gallery_owner_commands_use_the_checked_http_contract() {
    let server = MockServer::start().await;
    for (verb, route, status) in [
        ("POST", "/api/artifacts/artifact-1/gallery-listing", 202),
        ("PATCH", "/api/gallery-listings/listing-1", 202),
        ("DELETE", "/api/gallery-listings/listing-1", 200),
    ] {
        let mut mock = Mock::given(method(verb))
            .and(path(route))
            .and(header("idempotency-key", "operation-1"));
        if verb != "POST" {
            mock = mock.and(header("if-match", "\"3\""));
        }
        mock.respond_with(ResponseTemplate::new(status).set_body_json(serde_json::json!({
          "historicalOutcome": {
            "operationId":"goperation-1","operation":if verb == "POST" {"share_to_gallery"} else if verb == "PATCH" {"update_gallery"} else {"withdraw_from_gallery"},
            "acceptedAt":"2026-07-16T00:00:00Z","status":if verb == "DELETE" {"completed"} else {"accepted"},"committedListingRevision":4
          },
          "current":{"id":"listing-1","revision":4,"lifecycle":if verb == "DELETE" {"withdrawn"} else {"pending"},
            "proposal":if verb == "DELETE" {serde_json::Value::Null} else {serde_json::json!({"id":"proposal-1"})}}
        }))).mount(&server).await;
    }
    let listing = serde_json::json!({"listing":null});
    Mock::given(method("GET"))
        .and(path("/api/artifacts/artifact-1/gallery-listing"))
        .respond_with(ResponseTemplate::new(200).set_body_json(listing))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/gallery/permission-grant"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"grant":null})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/gallery/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"profile":null})))
        .mount(&server)
        .await;
    let api = ApiClient::new(&server.uri()).expect("client");
    for command in [
        ArtifactGalleryCommand::View(ArtifactGalleryViewArgs {
            artifact: "artifact-1".into(),
            agent_mode: false,
        }),
        ArtifactGalleryCommand::Share(mutation()),
        ArtifactGalleryCommand::Update(mutation()),
        ArtifactGalleryCommand::Withdraw(ArtifactGalleryWithdrawArgs {
            artifact: "artifact-1".into(),
            listing_id: "listing-1".into(),
            listing_revision: 3,
            confirm_withdraw: true,
            idempotency_key: "operation-1".into(),
            agent_mode: false,
        }),
    ] {
        let mut output = Vec::new();
        run_gallery_command(command, &api, &Store, &mut output)
            .await
            .expect("command");
        assert!(!output.is_empty());
        assert_ne!(output.first(), Some(&b'{'));
    }
}

#[tokio::test]
async fn irreversible_and_permission_actions_fail_before_network_without_confirmation() {
    let server = MockServer::start().await;
    let api = ApiClient::new(&server.uri()).expect("client");
    let mut share = mutation();
    share.accept_permission = false;
    assert!(
        run_gallery_command(
            ArtifactGalleryCommand::Share(share),
            &api,
            &Store,
            &mut Vec::new()
        )
        .await
        .is_err()
    );
    let withdraw = ArtifactGalleryWithdrawArgs {
        artifact: "artifact-1".into(),
        listing_id: "listing-1".into(),
        listing_revision: 3,
        confirm_withdraw: false,
        idempotency_key: "operation-1".into(),
        agent_mode: false,
    };
    assert!(
        run_gallery_command(
            ArtifactGalleryCommand::Withdraw(withdraw),
            &api,
            &Store,
            &mut Vec::new()
        )
        .await
        .is_err()
    );
    assert!(
        server
            .received_requests()
            .await
            .expect("requests")
            .is_empty()
    );
}
