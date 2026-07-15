use shareslices_cli::{
    AuthContinuationRecord, AuthContinuationStore, Authorization, CONTINUATION_RECORD_VERSION,
    MemoryAuthContinuationStore, normalized_origin,
};

fn authorization() -> Authorization {
    Authorization {
        device_code: "sensitive-device-code".to_owned(),
        user_code: "ABCD-EFGH".to_owned(),
        verification_uri: "https://app.example/device".to_owned(),
        verification_uri_complete: "https://app.example/device?user_code=ABCDEFGH".to_owned(),
        expires_in: 600,
        interval: 5,
    }
}

#[test]
fn continuation_contains_only_versioned_authorization_state() {
    let origin = normalized_origin("HTTPS://API.Example.com/path").expect("origin");
    let record = AuthContinuationRecord::new(origin, authorization());
    let value = serde_json::to_value(&record).expect("record");
    let text = serde_json::to_string(&value).expect("JSON");

    assert_eq!(record.version, CONTINUATION_RECORD_VERSION);
    assert_eq!(record.api_origin, "https://api.example.com");
    assert!(!record.id.contains("sensitive-device-code"));
    for forbidden in [
        "accessToken",
        "credential",
        "argv",
        "cwd",
        "localPath",
        "artifactContent",
        "businessOperation",
        "confirmation",
    ] {
        assert!(
            !text.contains(forbidden),
            "forbidden continuation field: {forbidden}"
        );
    }
}

#[test]
fn active_challenge_is_reused_and_claimed_once() {
    let store = MemoryAuthContinuationStore::default();
    let record = AuthContinuationRecord::new("https://api.example.com".to_owned(), authorization());
    store.write(&record).expect("write");

    assert_eq!(
        store
            .active_for_origin("https://api.example.com")
            .expect("active")
            .expect("record")
            .id,
        record.id
    );
    assert!(store.claim(&record.id).expect("first claim"));
    assert!(!store.claim(&record.id).expect("second claim"));
    store.release_claim(&record.id).expect("release");
    assert!(store.claim(&record.id).expect("claim after release"));
}

#[test]
fn terminal_record_strips_protocol_secrets_and_expires_within_one_hour() {
    let mut record =
        AuthContinuationRecord::new("https://api.example.com".to_owned(), authorization());
    record.strip_terminal_secrets();

    assert!(record.terminal);
    assert!(record.device_code.is_none());
    assert!(record.user_code.is_none());
    assert!(record.verification_uri.is_none());
    assert!(record.verification_uri_complete.is_none());
    assert_eq!(record.delete_after, record.expires_at + 3_600);
}
