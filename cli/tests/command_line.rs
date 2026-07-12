use clap::Parser;
use shareslices_cli::{
    ArtifactCommand, AuthCommand, Cli, Command, ProcessingFilter, PublicationFilter,
};

#[test]
fn parses_auth_commands_without_artifact_commands() {
    for (name, expected) in [
        ("login", AuthCommand::Login),
        ("status", AuthCommand::Status),
        ("logout", AuthCommand::Logout),
    ] {
        let cli = Cli::try_parse_from(["shareslices", "auth", name]).expect("command");
        let Command::Auth { command } = cli.command else {
            panic!("auth command")
        };
        assert_eq!(format!("{command:?}"), format!("{expected:?}"));
    }
    assert!(Cli::try_parse_from(["shareslices", "upload"]).is_err());
}

#[test]
fn parses_artifact_list_options() {
    let cli = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "list",
        "--publication",
        "published",
        "--processing",
        "ready",
        "--limit",
        "12",
        "--json",
        "id,name",
    ])
    .expect("command");
    let Command::Artifact {
        command: ArtifactCommand::List(args),
    } = cli.command
    else {
        panic!("artifact list command")
    };
    assert_eq!(args.publication, Some(PublicationFilter::Published));
    assert_eq!(args.processing, Some(ProcessingFilter::Ready));
    assert_eq!(args.limit, 12);
    assert_eq!(args.json.as_deref(), Some("id,name"));
}

#[test]
fn rejects_invalid_artifact_list_options() {
    assert!(Cli::try_parse_from(["shareslices", "artifact", "list", "--limit", "0"]).is_err());
    assert!(
        Cli::try_parse_from([
            "shareslices",
            "artifact",
            "list",
            "--publication",
            "private"
        ])
        .is_err()
    );
    assert!(Cli::try_parse_from(["shareslices", "artifact", "list", "--jq", ".id"]).is_err());
}
