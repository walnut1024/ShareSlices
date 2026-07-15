// cspell:ignore Deque WDJF XZPL
use async_trait::async_trait;
use shareslices_cli::{
    AuthApi, AuthCommand, AuthError, Authorization, CredentialStore, Exchange, User, run_auth,
};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

struct FailingStore;

impl CredentialStore for FailingStore {
    fn get(&self) -> Result<Option<String>, AuthError> {
        Ok(None)
    }
    fn set(&self, _value: &str) -> Result<(), AuthError> {
        Err(AuthError::CredentialStore("locked".into()))
    }
    fn delete(&self) -> Result<(), AuthError> {
        Ok(())
    }
}

#[derive(Default)]
struct MemoryStore(Mutex<Option<String>>);

impl CredentialStore for MemoryStore {
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

struct FakeApi {
    current: Mutex<Result<User, AuthError>>,
    exchanges: Mutex<VecDeque<Result<Exchange, AuthError>>>,
    revoked: Mutex<Vec<String>>,
}

#[async_trait]
impl AuthApi for FakeApi {
    async fn current_user(&self, _token: &str) -> Result<User, AuthError> {
        self.current.lock().expect("current").clone()
    }

    async fn start_authorization(&self) -> Result<Authorization, AuthError> {
        Ok(Authorization {
            device_code: "device-secret".into(),
            user_code: "WDJF-XZPL".into(),
            verification_uri: "https://app.example/device".into(),
            verification_uri_complete: "https://app.example/device?user_code=WDJFXZPL".into(),
            expires_in: 600,
            interval: 0,
        })
    }

    async fn exchange(&self, _device_code: &str) -> Result<Exchange, AuthError> {
        self.exchanges
            .lock()
            .expect("exchanges")
            .pop_front()
            .expect("exchange")
    }

    async fn revoke(&self, token: &str) -> Result<(), AuthError> {
        self.revoked.lock().expect("revoked").push(token.to_owned());
        Ok(())
    }
}

fn api(
    current: Result<User, AuthError>,
    exchanges: Vec<Result<Exchange, AuthError>>,
) -> Arc<FakeApi> {
    Arc::new(FakeApi {
        current: Mutex::new(current),
        exchanges: Mutex::new(exchanges.into()),
        revoked: Mutex::new(Vec::new()),
    })
}

fn user() -> User {
    User {
        name: "Ada Lovelace".into(),
        email: "ada@example.com".into(),
    }
}

#[tokio::test]
async fn login_stores_the_credential_without_printing_it() {
    let api = api(
        Err(AuthError::Unauthenticated),
        vec![Ok(Exchange {
            access_token: "bearer-secret".into(),
            user: user(),
        })],
    );
    let store = MemoryStore::default();
    let mut output = Vec::new();

    run_auth(
        AuthCommand::Login { continuation: None },
        api.as_ref(),
        &store,
        &mut output,
        |_| Ok(()),
    )
    .await
    .expect("login");
    let text = String::from_utf8(output).expect("output");
    assert!(text.contains("WDJF-XZPL"));
    assert!(text.contains("Signed in as Ada Lovelace <ada@example.com>"));
    assert!(!text.contains("bearer-secret"));
    assert!(!text.contains("device-secret"));
    assert_eq!(
        store.get().expect("stored").as_deref(),
        Some("bearer-secret")
    );
}

#[tokio::test]
async fn status_removes_an_expired_session_and_requests_login() {
    let store = MemoryStore(Mutex::new(Some("expired-secret".into())));
    let api = api(Err(AuthError::Unauthenticated), vec![]);
    let mut output = Vec::new();
    run_auth(
        AuthCommand::Status,
        api.as_ref(),
        &store,
        &mut output,
        |_| Ok(()),
    )
    .await
    .expect("status");
    assert!(
        String::from_utf8(output)
            .expect("output")
            .contains("Run shareslices auth login")
    );
    assert!(store.get().expect("store").is_none());
}

#[tokio::test]
async fn logout_revokes_only_the_stored_session_and_reports_sign_out() {
    let store = MemoryStore(Mutex::new(Some("current-secret".into())));
    let api = api(Ok(user()), vec![]);
    let mut output = Vec::new();
    run_auth(
        AuthCommand::Logout,
        api.as_ref(),
        &store,
        &mut output,
        |_| Ok(()),
    )
    .await
    .expect("logout");
    assert!(
        String::from_utf8(output)
            .expect("output")
            .contains("Signed out of ShareSlices")
    );
    assert_eq!(
        api.revoked.lock().expect("revoked").as_slice(),
        ["current-secret"]
    );
    assert!(store.get().expect("store").is_none());
}

#[tokio::test]
async fn old_cli_error_is_actionable() {
    let store = MemoryStore::default();
    let api = api(
        Err(AuthError::Unauthenticated),
        vec![Err(AuthError::UpgradeRequired {
            current: "0.1.0".into(),
            minimum: "0.2.0".into(),
        })],
    );
    let mut output = Vec::new();
    let error = run_auth(
        AuthCommand::Login { continuation: None },
        api.as_ref(),
        &store,
        &mut output,
        |_| Ok(()),
    )
    .await
    .expect_err("upgrade");
    assert!(error.to_string().contains("Current: 0.1.0"));
    assert!(error.to_string().contains("Minimum: 0.2.0"));
}

#[tokio::test]
async fn storage_failure_revokes_the_new_server_session() {
    let api = api(
        Err(AuthError::Unauthenticated),
        vec![Ok(Exchange {
            access_token: "new-secret".into(),
            user: user(),
        })],
    );
    let mut output = Vec::new();
    let error = run_auth(
        AuthCommand::Login { continuation: None },
        api.as_ref(),
        &FailingStore,
        &mut output,
        |_| Ok(()),
    )
    .await
    .expect_err("store");
    assert!(matches!(error, AuthError::CredentialStore(_)));
    assert_eq!(
        api.revoked.lock().expect("revoked").as_slice(),
        ["new-secret"]
    );
    assert!(
        !String::from_utf8(output)
            .expect("output")
            .contains("new-secret")
    );
}

#[tokio::test]
async fn logout_network_failure_retains_the_local_credential() {
    struct NetworkApi;
    #[async_trait]
    impl AuthApi for NetworkApi {
        async fn current_user(&self, _token: &str) -> Result<User, AuthError> {
            Ok(user())
        }
        async fn start_authorization(&self) -> Result<Authorization, AuthError> {
            unreachable!()
        }
        async fn exchange(&self, _device_code: &str) -> Result<Exchange, AuthError> {
            unreachable!()
        }
        async fn revoke(&self, _token: &str) -> Result<(), AuthError> {
            Err(AuthError::Network("offline".into()))
        }
    }
    let store = MemoryStore(Mutex::new(Some("keep-secret".into())));
    let mut output = Vec::new();
    assert!(
        run_auth(
            AuthCommand::Logout,
            &NetworkApi,
            &store,
            &mut output,
            |_| Ok(())
        )
        .await
        .is_err()
    );
    assert_eq!(store.get().expect("store").as_deref(), Some("keep-secret"));
}

#[tokio::test(start_paused = true)]
async fn pending_and_slow_down_continue_until_approval() {
    let api = api(
        Err(AuthError::Unauthenticated),
        vec![
            Err(AuthError::Pending),
            Err(AuthError::SlowDown),
            Ok(Exchange {
                access_token: "approved-secret".into(),
                user: user(),
            }),
        ],
    );
    let store = MemoryStore::default();
    let mut output = Vec::new();
    run_auth(
        AuthCommand::Login { continuation: None },
        api.as_ref(),
        &store,
        &mut output,
        |_| Ok(()),
    )
    .await
    .expect("approval");
    assert_eq!(
        store.get().expect("store").as_deref(),
        Some("approved-secret")
    );
}

#[tokio::test]
async fn denial_and_expiry_create_no_local_credential() {
    for error in [AuthError::Denied, AuthError::Expired] {
        let api = api(Err(AuthError::Unauthenticated), vec![Err(error)]);
        let store = MemoryStore::default();
        let mut output = Vec::new();
        assert!(
            run_auth(
                AuthCommand::Login { continuation: None },
                api.as_ref(),
                &store,
                &mut output,
                |_| Ok(())
            )
            .await
            .is_err()
        );
        assert!(store.get().expect("store").is_none());
    }
}

#[tokio::test]
async fn browser_failure_keeps_manual_instructions_visible() {
    let api = api(
        Err(AuthError::Unauthenticated),
        vec![Ok(Exchange {
            access_token: "secret".into(),
            user: user(),
        })],
    );
    let store = MemoryStore::default();
    let mut output = Vec::new();
    run_auth(
        AuthCommand::Login { continuation: None },
        api.as_ref(),
        &store,
        &mut output,
        |_| Err(AuthError::Network("no browser".into())),
    )
    .await
    .expect("manual login");
    let text = String::from_utf8(output).expect("output");
    assert!(text.contains("Open the URL above and enter the code manually."));
}

#[tokio::test]
async fn already_signed_in_login_creates_no_authorization() {
    let store = MemoryStore(Mutex::new(Some("existing-secret".into())));
    let api = api(Ok(user()), vec![]);
    let mut output = Vec::new();
    run_auth(
        AuthCommand::Login { continuation: None },
        api.as_ref(),
        &store,
        &mut output,
        |_| Ok(()),
    )
    .await
    .expect("already signed in");
    assert!(
        String::from_utf8(output)
            .expect("output")
            .contains("Already signed in as")
    );
}

#[tokio::test]
async fn cancelling_login_leaves_the_store_empty() {
    struct PendingApi;
    #[async_trait]
    impl AuthApi for PendingApi {
        async fn current_user(&self, _token: &str) -> Result<User, AuthError> {
            Err(AuthError::Unauthenticated)
        }
        async fn start_authorization(&self) -> Result<Authorization, AuthError> {
            Ok(Authorization {
                device_code: "secret".into(),
                user_code: "WDJF-XZPL".into(),
                verification_uri: "https://example.test/device".into(),
                verification_uri_complete: "https://example.test/device?user_code=WDJFXZPL".into(),
                expires_in: 600,
                interval: 60,
            })
        }
        async fn exchange(&self, _device_code: &str) -> Result<Exchange, AuthError> {
            Err(AuthError::Pending)
        }
        async fn revoke(&self, _token: &str) -> Result<(), AuthError> {
            Ok(())
        }
    }
    let store = MemoryStore::default();
    let mut output = Vec::new();
    let login = run_auth(
        AuthCommand::Login { continuation: None },
        &PendingApi,
        &store,
        &mut output,
        |_| Ok(()),
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(1), login)
            .await
            .is_err()
    );
    assert!(store.get().expect("store").is_none());
}
