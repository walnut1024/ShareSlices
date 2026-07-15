use clap::{CommandFactory, Parser};
use shareslices_cli::{
    ArtifactCommand, ArtifactPublicationCommand, AuthCommand, Cli, Command, ProcessingFilter,
    PublicationFilter,
};

#[test]
fn every_command_has_detailed_help_and_examples() {
    let root = Cli::command();
    let cases: &[(&[&str], &[&str])] = &[
        (
            &[],
            &[
                "Commands",
                "SHARESLICES_PROMPT_DISABLED",
                "EXIT CODES",
                "EXAMPLES",
            ],
        ),
        (&["publish"], &["PATHS", "--name", "--duration", "EXAMPLES"]),
        (
            &["auth"],
            &["credential", "login", "status", "logout", "EXAMPLES"],
        ),
        (
            &["auth", "login"],
            &["browser", "verification", "logout first", "EXAMPLES"],
        ),
        (&["auth", "status"], &["credential", "EXAMPLES"]),
        (&["auth", "logout"], &["Revoke", "EXAMPLES"]),
        (
            &["artifact"],
            &["lifecycle", "upload", "publication", "export", "EXAMPLES"],
        ),
        (
            &["artifact", "list"],
            &["--publication", "--processing", "--json", "EXAMPLES"],
        ),
        (
            &["artifact", "upload"],
            &[
                "PATHS",
                "--artifact",
                "--entry",
                "symbolic links",
                "EXAMPLES",
            ],
        ),
        (
            &["artifact", "publish"],
            &["--replace-link", "--expires-at", "EXAMPLES"],
        ),
        (
            &["artifact", "unpublish"],
            &["external access", "publicationState", "--json", "EXAMPLES"],
        ),
        (
            &["artifact", "delete"],
            &["Permanently", "explicit ARTIFACT_ID", "--yes", "EXAMPLES"],
        ),
        (
            &["artifact", "export"],
            &["--output", "--clobber", "--json", "EXAMPLES"],
        ),
        (
            &["artifact", "publication"],
            &["metadata", "view", "edit", "EXAMPLES"],
        ),
        (
            &["artifact", "publication", "view"],
            &["Share link", "--json", "EXAMPLES"],
        ),
        (
            &["artifact", "publication", "edit"],
            &["never", "--json", "EXAMPLES"],
        ),
    ];

    for (path, expected) in cases {
        let mut command = root.clone();
        for segment in *path {
            command = command
                .find_subcommand(segment)
                .unwrap_or_else(|| panic!("missing help command: {}", path.join(" ")))
                .clone();
        }
        let help = command.render_long_help().to_string();
        for needle in *expected {
            assert!(
                help.contains(needle),
                "help for '{}' is missing '{needle}':\n{help}",
                path.join(" ")
            );
        }
    }
}

#[test]
fn parses_auth_commands_without_artifact_commands() {
    for (name, expected) in [
        ("login", AuthCommand::Login { continuation: None }),
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
fn parses_offline_agent_capabilities_without_a_protocol_version() {
    let cli = Cli::try_parse_from(["shareslices", "--agent", "capabilities"])
        .expect("agent capabilities command");
    assert!(cli.agent);
    assert_eq!(cli.agent_protocol, None);
    assert!(matches!(cli.command, Command::Capabilities));
}

#[test]
fn agent_protocol_requires_agent_flag() {
    assert!(
        Cli::try_parse_from(["shareslices", "--agent-protocol", "1", "auth", "status"]).is_err()
    );
}

#[test]
fn parses_publication_view_and_edit_options_and_rejects_share() {
    let view = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "publication",
        "view",
        "artifact-1",
        "--json",
        "url,copyEligible",
    ])
    .expect("share view");
    let Command::Artifact {
        command:
            ArtifactCommand::Publication {
                command: ArtifactPublicationCommand::View(args),
            },
    } = view.command
    else {
        panic!("share view command")
    };
    assert_eq!(args.artifact.as_deref(), Some("artifact-1"));
    assert_eq!(args.json.as_deref(), Some("url,copyEligible"));

    let edit = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "publication",
        "edit",
        "artifact-1",
        "--expires-at",
        "never",
    ])
    .expect("share edit");
    let Command::Artifact {
        command:
            ArtifactCommand::Publication {
                command: ArtifactPublicationCommand::Edit(args),
            },
    } = edit.command
    else {
        panic!("share edit command")
    };
    assert_eq!(args.artifact.as_deref(), Some("artifact-1"));
    assert_eq!(args.expires_at.as_deref(), Some("never"));
    assert!(
        Cli::try_parse_from(["shareslices", "artifact", "share", "view", "artifact-1"]).is_err()
    );
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

    let unpublish = Cli::try_parse_from(["shareslices", "artifact", "unpublish", "artifact-1"])
        .expect("unpublish command");
    let Command::Artifact {
        command: ArtifactCommand::Unpublish(args),
    } = unpublish.command
    else {
        panic!("artifact unpublish command")
    };
    assert_eq!(args.artifact.as_deref(), Some("artifact-1"));
}

#[test]
fn parses_artifact_export_options() {
    let cli = Cli::try_parse_from([
        "shareslices",
        "artifact",
        "export",
        "artifact-1",
        "--version",
        "version-2",
        "--output",
        "saved.zip",
        "--clobber",
        "--no-progress",
        "--json",
        "artifactId,path",
        "--jq",
        ".path",
    ])
    .expect("export command");
    let Command::Artifact {
        command: ArtifactCommand::Export(args),
    } = cli.command
    else {
        panic!("artifact export command")
    };
    assert_eq!(args.artifact.as_deref(), Some("artifact-1"));
    assert_eq!(args.version.as_deref(), Some("version-2"));
    assert_eq!(
        args.output.as_deref(),
        Some(std::path::Path::new("saved.zip"))
    );
    assert!(args.clobber);
    assert!(args.no_progress);
    assert_eq!(args.json.as_deref(), Some("artifactId,path"));
    assert_eq!(args.jq.as_deref(), Some(".path"));
}
