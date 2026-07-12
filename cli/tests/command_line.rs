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

#[test]
fn parses_prepared_zip_upload_options() {
    let cli = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "upload",
        "report.zip",
        "--name",
        "Report",
        "--entry",
        "report.html",
        "--no-progress",
        "--json",
        "artifact,version",
        "--jq",
        ".artifact.id",
    ])
    .expect("upload command");
    let Command::Artifact {
        command: ArtifactCommand::Upload(args),
    } = cli.command
    else {
        panic!("artifact upload command")
    };
    assert_eq!(args.paths, vec![std::path::PathBuf::from("report.zip")]);
    assert!(args.root.is_none());
    assert_eq!(args.name.as_deref(), Some("Report"));
    assert_eq!(args.entry.as_deref(), Some("report.html"));
    assert!(args.no_progress);
    assert_eq!(args.json.as_deref(), Some("artifact,version"));
    assert_eq!(args.jq.as_deref(), Some(".artifact.id"));
    let multiple = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "upload",
        "index.html",
        "assets",
        "--root",
        ".",
    ])
    .expect("multiple local inputs");
    let Command::Artifact {
        command: ArtifactCommand::Upload(args),
    } = multiple.command
    else {
        panic!("artifact upload command")
    };
    assert_eq!(args.paths.len(), 2);
    assert_eq!(args.root.as_deref(), Some(std::path::Path::new(".")));
}

#[test]
fn parses_publish_and_unpublish_options() {
    let publish = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "publish",
        "--artifact",
        "artifact-1",
        "--version",
        "version-2",
        "--json",
        "artifactId,accessState",
    ])
    .expect("publish command");
    let Command::Artifact {
        command: ArtifactCommand::Publish(args),
    } = publish.command
    else {
        panic!("artifact publish command")
    };
    assert_eq!(args.artifact.as_deref(), Some("artifact-1"));
    assert_eq!(args.version.as_deref(), Some("version-2"));

    let unpublish = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "unpublish",
        "--artifact",
        "artifact-1",
    ])
    .expect("unpublish command");
    let Command::Artifact {
        command: ArtifactCommand::Unpublish(args),
    } = unpublish.command
    else {
        panic!("artifact unpublish command")
    };
    assert_eq!(args.artifact.as_deref(), Some("artifact-1"));
}
