use std::io::{Cursor, Write};

use shareslices_worker::archive_validation::{ArchiveError, validate_zip};
use shareslices_worker::format_rules::{FormatError, PolicySnapshot};
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

fn policy() -> PolicySnapshot {
    PolicySnapshot::new(
        1024 * 1024,
        1024 * 1024,
        10,
        1024 * 1024,
        [".html", ".css", ".js", ".png"],
    )
    .expect("valid policy")
}

fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (path, body) in entries {
        writer
            .start_file(*path, SimpleFileOptions::default())
            .expect("start ZIP entry");
        writer.write_all(body).expect("write ZIP entry");
    }
    writer.finish().expect("finish ZIP").into_inner()
}

#[test]
fn accepts_normalized_regular_files_with_a_root_entry() {
    let bytes = archive(&[
        ("index.html", b"<html></html>"),
        ("assets/app.js", b"export const ready = true;"),
    ]);

    let result = validate_zip(Cursor::new(bytes), &policy()).expect("valid archive");

    assert_eq!(result.entries().len(), 2);
    assert_eq!(result.entry_path(), "index.html");
    assert_eq!(result.entries()[0].effective_path(), "assets/app.js");
    assert_eq!(result.entries()[1].effective_path(), "index.html");
}

#[test]
fn ignores_macos_metadata_and_infers_the_only_root_html() {
    let bytes = archive(&[
        ("腾讯文档盘点分析报告.html", b"<html></html>"),
        (
            "__MACOSX/._腾讯文档盘点分析报告.html",
            b"\0\x05binary metadata",
        ),
        (".DS_Store", b"binary metadata"),
    ]);
    let result = validate_zip(Cursor::new(bytes), &PolicySnapshot::product_defaults())
        .expect("deterministic compatibility");
    assert_eq!(result.entry_path(), "腾讯文档盘点分析报告.html");
    assert_eq!(result.entries().len(), 1);
    assert_eq!(result.warnings()[0].code, "ignored_system_metadata");
    assert_eq!(result.warnings()[0].details.ignored_count, Some(2));
    assert_eq!(result.warnings()[1].code, "entry_file_inferred");
}

#[test]
fn preserves_source_and_effective_paths_after_one_wrapper_is_removed() {
    let bytes = archive(&[
        ("report/report.html", b"<html></html>"),
        (
            "report/assets/app.js",
            b"document.body.dataset.ready='true'",
        ),
    ]);
    let result = validate_zip(Cursor::new(bytes), &PolicySnapshot::product_defaults())
        .expect("wrapper normalization");
    assert_eq!(result.entry_path(), "report.html");
    assert_eq!(result.entries()[0].source_path(), "report/assets/app.js");
    assert_eq!(result.entries()[0].effective_path(), "assets/app.js");
    assert_eq!(result.warnings()[0].code, "wrapper_directory_removed");
}

#[test]
fn reports_missing_root_html_with_nested_candidates() {
    let bytes = archive(&[("site/index.html", b"<html></html>"), ("root.css", b"")]);

    let failure = validate_zip(Cursor::new(bytes), &policy()).unwrap_err();
    assert_eq!(failure.error, ArchiveError::MissingEntryFile);
    assert_eq!(
        failure.report.primary_issue.unwrap().details.candidates,
        Some(vec!["site/index.html".into()])
    );
}

#[test]
fn reports_ambiguous_root_html_candidates() {
    let bytes = archive(&[("a.html", b"<html></html>"), ("b.html", b"<html></html>")]);
    let failure = validate_zip(Cursor::new(bytes), &policy()).unwrap_err();
    assert_eq!(failure.error, ArchiveError::AmbiguousEntryFile);
    assert_eq!(
        failure.report.primary_issue.unwrap().details.candidates,
        Some(vec!["a.html".into(), "b.html".into()])
    );
}

#[test]
fn rejects_metadata_only_and_metadata_shaped_traversal() {
    let metadata_only = archive(&[("__MACOSX/._report.html", b"metadata")]);
    assert_eq!(
        validate_zip(Cursor::new(metadata_only), &policy())
            .unwrap_err()
            .error,
        ArchiveError::MissingEntryFile
    );
    let unsafe_metadata = archive(&[("__MACOSX/../._report.html", b"metadata")]);
    assert_eq!(
        validate_zip(Cursor::new(unsafe_metadata), &policy())
            .unwrap_err()
            .error,
        ArchiveError::UnsafePath
    );
    let nul_path = archive(&[("__MACOSX/._secret\0name", b"metadata")]);
    let failure = validate_zip(Cursor::new(nul_path), &policy()).unwrap_err();
    assert_eq!(failure.error, ArchiveError::UnsafePath);
    assert_eq!(failure.report.primary_issue.unwrap().details.path, None);
}

#[test]
fn rejects_parent_traversal_and_absolute_paths() {
    for path in [
        "../index.html",
        "assets/../index.html",
        "/index.html",
        "C:/index.html",
    ] {
        let bytes = archive(&[(path, b"<html></html>")]);
        assert_eq!(
            validate_zip(Cursor::new(bytes), &policy())
                .unwrap_err()
                .error,
            ArchiveError::UnsafePath
        );
        let bytes = archive(&[(path, b"<html></html>")]);
        let failure = validate_zip(Cursor::new(bytes), &policy()).unwrap_err();
        assert_eq!(failure.report.primary_issue.unwrap().details.path, None);
    }
}

#[test]
fn bounds_ignored_metadata_samples_while_preserving_the_full_count() {
    let mut owned = Vec::new();
    for index in 0..25 {
        owned.push((format!("._metadata-{index}"), b"metadata".as_slice()));
    }
    owned.push(("index.html".to_owned(), b"<html></html>".as_slice()));
    let borrowed: Vec<_> = owned
        .iter()
        .map(|(path, body)| (path.as_str(), *body))
        .collect();
    let result = validate_zip(Cursor::new(archive(&borrowed)), &policy()).expect("valid archive");
    let details = &result.warnings()[0].details;
    assert_eq!(details.ignored_count, Some(25));
    assert_eq!(details.paths.as_ref().unwrap().len(), 20);
}

#[test]
fn rejects_links_and_special_files() {
    let mut symlink_writer = ZipWriter::new(Cursor::new(Vec::new()));
    symlink_writer
        .start_file("index.html", SimpleFileOptions::default())
        .expect("start entry");
    symlink_writer
        .write_all(b"<html></html>")
        .expect("write entry");
    symlink_writer
        .add_symlink("assets/app.js", "../app.js", SimpleFileOptions::default())
        .expect("add symlink");
    let symlink_zip = symlink_writer.finish().expect("finish ZIP").into_inner();
    assert_eq!(
        validate_zip(Cursor::new(symlink_zip), &policy())
            .unwrap_err()
            .error,
        ArchiveError::UnsupportedFileType
    );

    let mut special_zip = archive(&[("index.html", b"<html></html>"), ("pipe.js", b"")]);
    mark_second_entry_as_fifo(&mut special_zip);
    assert_eq!(
        validate_zip(Cursor::new(special_zip), &policy())
            .unwrap_err()
            .error,
        ArchiveError::UnsupportedFileType
    );
}

#[test]
fn rejects_nested_archives() {
    let bytes = archive(&[
        ("index.html", b"<html></html>"),
        ("assets/data.zip", b"PK\x03\x04"),
    ]);

    assert_eq!(
        validate_zip(Cursor::new(bytes), &policy())
            .unwrap_err()
            .error,
        ArchiveError::NestedArchive
    );
}

#[test]
fn rejects_invalid_zip_and_duplicate_paths() {
    assert_eq!(
        validate_zip(Cursor::new(b"not a ZIP"), &policy())
            .unwrap_err()
            .error,
        ArchiveError::InvalidZip
    );

    let mut bytes = archive(&[
        ("index.html", b"<html></html>"),
        ("other.html", b"<html>duplicate</html>"),
    ]);
    replace_all(&mut bytes, b"other.html", b"index.html");
    assert_eq!(
        validate_zip(Cursor::new(bytes), &policy())
            .unwrap_err()
            .error,
        ArchiveError::DuplicatePath
    );
}

fn replace_all(bytes: &mut [u8], from: &[u8], to: &[u8]) {
    assert_eq!(from.len(), to.len());
    let mut replaced = 0;
    for index in 0..=bytes.len() - from.len() {
        if &bytes[index..index + from.len()] == from {
            bytes[index..index + to.len()].copy_from_slice(to);
            replaced += 1;
        }
    }
    assert_eq!(replaced, 2, "local and central names must both change");
}

#[test]
fn enforces_each_snapshotted_numeric_limit_while_expanding() {
    let bytes = archive(&[("index.html", b"four")]);
    let archive_limit = PolicySnapshot::new(1, 100, 10, 100, [".html"]).expect("archive policy");
    let archive_failure = validate_zip(Cursor::new(bytes.clone()), &archive_limit).unwrap_err();
    assert_eq!(
        archive_failure.error,
        ArchiveError::Format(FormatError::ArchiveSizeExceeded)
    );
    let details = archive_failure.report.primary_issue.unwrap().details;
    assert_eq!(details.actual_bytes, Some(bytes.len() as u64));
    assert_eq!(details.limit_bytes, Some(1));

    let single_file_limit =
        PolicySnapshot::new(1_000, 100, 10, 3, [".html"]).expect("single-file policy");
    let single_failure = validate_zip(Cursor::new(bytes), &single_file_limit).unwrap_err();
    assert_eq!(
        single_failure.error,
        ArchiveError::Format(FormatError::SingleFileSizeExceeded)
    );
    let details = single_failure.report.primary_issue.unwrap().details;
    assert_eq!(
        (details.actual_bytes, details.limit_bytes),
        (Some(4), Some(3))
    );

    let multiple = archive(&[("index.html", b"123"), ("site.css", b"45")]);
    let file_count_limit =
        PolicySnapshot::new(1_000, 100, 1, 100, [".html", ".css"]).expect("count policy");
    let count_failure = validate_zip(Cursor::new(multiple.clone()), &file_count_limit).unwrap_err();
    assert_eq!(
        count_failure.error,
        ArchiveError::Format(FormatError::FileCountExceeded)
    );
    let details = count_failure.report.primary_issue.unwrap().details;
    assert_eq!(
        (details.actual_count, details.limit_count),
        (Some(2), Some(1))
    );

    let expanded_limit =
        PolicySnapshot::new(1_000, 4, 10, 100, [".html", ".css"]).expect("expanded policy");
    let expanded_failure = validate_zip(Cursor::new(multiple), &expanded_limit).unwrap_err();
    assert_eq!(
        expanded_failure.error,
        ArchiveError::Format(FormatError::ExpandedSizeExceeded)
    );
    let details = expanded_failure.report.primary_issue.unwrap().details;
    assert_eq!(
        (details.actual_bytes, details.limit_bytes),
        (Some(5), Some(4))
    );
}

fn mark_second_entry_as_fifo(bytes: &mut [u8]) {
    let mut cursor = 0;
    let mut central_entry = 0;
    while cursor + 46 <= bytes.len() {
        if bytes[cursor..].starts_with(b"PK\x01\x02") {
            central_entry += 1;
            if central_entry == 2 {
                bytes[cursor + 5] = 3;
                let mode = (0o010_644_u32 << 16).to_le_bytes();
                bytes[cursor + 38..cursor + 42].copy_from_slice(&mode);
                return;
            }
        }
        cursor += 1;
    }
    panic!("second central directory entry not found");
}
