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
    assert_eq!(result.entries()[0].path(), "index.html");
    assert_eq!(result.entries()[1].path(), "assets/app.js");
}

#[test]
fn rejects_missing_root_index() {
    let bytes = archive(&[("site/index.html", b"<html></html>")]);

    assert_eq!(
        validate_zip(Cursor::new(bytes), &policy()).unwrap_err(),
        ArchiveError::MissingRootIndex
    );
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
            validate_zip(Cursor::new(bytes), &policy()).unwrap_err(),
            ArchiveError::UnsafePath
        );
    }
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
        validate_zip(Cursor::new(symlink_zip), &policy()).unwrap_err(),
        ArchiveError::UnsupportedFileType
    );

    let mut special_zip = archive(&[("index.html", b"<html></html>"), ("pipe.js", b"")]);
    mark_second_entry_as_fifo(&mut special_zip);
    assert_eq!(
        validate_zip(Cursor::new(special_zip), &policy()).unwrap_err(),
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
        validate_zip(Cursor::new(bytes), &policy()).unwrap_err(),
        ArchiveError::NestedArchive
    );
}

#[test]
fn rejects_invalid_zip_and_duplicate_paths() {
    assert_eq!(
        validate_zip(Cursor::new(b"not a ZIP"), &policy()).unwrap_err(),
        ArchiveError::InvalidZip
    );

    let mut bytes = archive(&[
        ("index.html", b"<html></html>"),
        ("other.html", b"<html>duplicate</html>"),
    ]);
    replace_all(&mut bytes, b"other.html", b"index.html");
    assert_eq!(
        validate_zip(Cursor::new(bytes), &policy()).unwrap_err(),
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
    assert_eq!(
        validate_zip(Cursor::new(bytes.clone()), &archive_limit).unwrap_err(),
        ArchiveError::Format(FormatError::ArchiveSizeExceeded)
    );

    let single_file_limit =
        PolicySnapshot::new(1_000, 100, 10, 3, [".html"]).expect("single-file policy");
    assert_eq!(
        validate_zip(Cursor::new(bytes), &single_file_limit).unwrap_err(),
        ArchiveError::Format(FormatError::SingleFileSizeExceeded)
    );

    let multiple = archive(&[("index.html", b"123"), ("site.css", b"45")]);
    let file_count_limit =
        PolicySnapshot::new(1_000, 100, 1, 100, [".html", ".css"]).expect("count policy");
    assert_eq!(
        validate_zip(Cursor::new(multiple.clone()), &file_count_limit).unwrap_err(),
        ArchiveError::Format(FormatError::FileCountExceeded)
    );

    let expanded_limit =
        PolicySnapshot::new(1_000, 4, 10, 100, [".html", ".css"]).expect("expanded policy");
    assert_eq!(
        validate_zip(Cursor::new(multiple), &expanded_limit).unwrap_err(),
        ArchiveError::Format(FormatError::ExpandedSizeExceeded)
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
