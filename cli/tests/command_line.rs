use clap::Parser;
use shareslices_cli::{AuthCommand, Cli, Command};

#[test]
fn parses_auth_commands_without_artifact_commands() {
    for (name, expected) in [
        ("login", AuthCommand::Login),
        ("status", AuthCommand::Status),
        ("logout", AuthCommand::Logout),
    ] {
        let cli = Cli::try_parse_from(["shareslices", "auth", name]).expect("command");
        let Command::Auth { command } = cli.command;
        assert_eq!(format!("{command:?}"), format!("{expected:?}"));
    }
    assert!(Cli::try_parse_from(["shareslices", "upload"]).is_err());
}
