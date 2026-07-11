use crate::{AuthApi, AuthCommand, AuthError, CredentialStore};
use std::io::Write;
use std::time::{Duration, Instant};

/// Runs one CLI authentication command against injected adapters.
///
/// # Errors
/// Returns an [`AuthError`] when the API, compatibility check, browser handoff, or credential store fails.
pub async fn run_auth(
    command: AuthCommand,
    api: &dyn AuthApi,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    open_browser: impl Fn(&str) -> Result<(), AuthError>,
) -> Result<(), AuthError> {
    match command {
        AuthCommand::Login => login(api, store, output, open_browser).await,
        AuthCommand::Status => status(api, store, output).await,
        AuthCommand::Logout => logout(api, store, output).await,
    }
}

async fn login(
    api: &dyn AuthApi,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
    open_browser: impl Fn(&str) -> Result<(), AuthError>,
) -> Result<(), AuthError> {
    if let Some(token) = store.get()? {
        match api.current_user(&token).await {
            Ok(user) => {
                writeln!(
                    output,
                    "Already signed in as {} <{}>",
                    user.name, user.email
                )
                .ok();
                return Ok(());
            }
            Err(AuthError::Unauthenticated) => store.delete()?,
            Err(error) => return Err(error),
        }
    }

    let authorization = api.start_authorization().await?;
    writeln!(
        output,
        "Your verification code: {}",
        authorization.user_code
    )
    .ok();
    writeln!(output, "Open: {}", authorization.verification_uri).ok();
    if open_browser(&authorization.verification_uri_complete).is_err() {
        writeln!(output, "Open the URL above and enter the code manually.").ok();
    }
    writeln!(output, "Waiting for approval in the browser...").ok();

    let deadline = Instant::now() + Duration::from_secs(authorization.expires_in);
    let mut interval = authorization.interval;
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if Instant::now() >= deadline {
            return Err(AuthError::Expired);
        }
        match api.exchange(&authorization.device_code).await {
            Ok(exchange) => {
                if let Err(error) = store.set(&exchange.access_token) {
                    let _ = api.revoke(&exchange.access_token).await;
                    return Err(error);
                }
                writeln!(output, "Approved").ok();
                writeln!(
                    output,
                    "Signed in as {} <{}>",
                    exchange.user.name, exchange.user.email
                )
                .ok();
                writeln!(output, "Credentials stored securely").ok();
                return Ok(());
            }
            Err(AuthError::Pending) => {}
            Err(AuthError::SlowDown) => interval = interval.saturating_add(5),
            Err(error) => return Err(error),
        }
    }
}

async fn status(
    api: &dyn AuthApi,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), AuthError> {
    let Some(token) = store.get()? else {
        writeln!(
            output,
            "Not signed in. Run shareslices auth login to sign in."
        )
        .ok();
        return Ok(());
    };
    match api.current_user(&token).await {
        Ok(user) => {
            writeln!(output, "Signed in to ShareSlices").ok();
            writeln!(output, "Account  {} <{}>", user.name, user.email).ok();
            writeln!(output, "Session  Active").ok();
            Ok(())
        }
        Err(AuthError::Unauthenticated) => {
            store.delete()?;
            writeln!(
                output,
                "Your CLI session is no longer valid. Run shareslices auth login to sign in again."
            )
            .ok();
            Ok(())
        }
        Err(error) => Err(error),
    }
}

async fn logout(
    api: &dyn AuthApi,
    store: &dyn CredentialStore,
    output: &mut dyn Write,
) -> Result<(), AuthError> {
    let Some(token) = store.get()? else {
        writeln!(output, "Not signed in.").ok();
        return Ok(());
    };
    api.revoke(&token).await?;
    store.delete()?;
    writeln!(output, "Signed out of ShareSlices").ok();
    writeln!(
        output,
        "Only this CLI session was signed out. Browser and other CLI sessions are unaffected."
    )
    .ok();
    Ok(())
}
