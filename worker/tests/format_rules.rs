// cspell:ignore ftypavif

use std::io::Cursor;
use std::io::{self, Read};

use shareslices_worker::format_rules::{
    FormatError, PolicyError, PolicySnapshot, default_format_rules,
};

#[test]
fn default_rules_match_the_product_contract() {
    let actual: Vec<_> = default_format_rules()
        .iter()
        .map(|rule| (rule.extension(), rule.content_type()))
        .collect();

    assert_eq!(
        actual,
        vec![
            (".html", "text/html"),
            (".css", "text/css"),
            (".js", "text/javascript"),
            (".mjs", "text/javascript"),
            (".json", "application/json"),
            (".txt", "text/plain"),
            (".csv", "text/csv"),
            (".tsv", "text/tab-separated-values"),
            (".png", "image/png"),
            (".jpg", "image/jpeg"),
            (".jpeg", "image/jpeg"),
            (".gif", "image/gif"),
            (".webp", "image/webp"),
            (".avif", "image/avif"),
            (".svg", "image/svg+xml"),
            (".ico", "image/x-icon"),
            (".woff", "font/woff"),
            (".woff2", "font/woff2"),
        ]
    );
}

#[test]
fn validates_text_json_xml_and_binary_signatures() {
    let policy = PolicySnapshot::product_defaults();
    let valid = [
        ("index.html", b"<html></html>".as_slice()),
        ("data.json", br#"{"ready":true}"#.as_slice()),
        ("image.png", b"\x89PNG\r\n\x1a\nrest".as_slice()),
        ("image.jpg", b"\xff\xd8\xff\xe0".as_slice()),
        ("image.gif", b"GIF89a".as_slice()),
        ("image.webp", b"RIFF\x04\x00\x00\x00WEBP".as_slice()),
        (
            "image.avif",
            b"\x00\x00\x00\x18ftypavif\x00\x00\x00\x00avif".as_slice(),
        ),
        (
            "image.svg",
            br#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>"#.as_slice(),
        ),
        ("favicon.ico", b"\x00\x00\x01\x00".as_slice()),
        ("font.woff", b"wOFF".as_slice()),
        ("font.woff2", b"wOF2".as_slice()),
    ];

    for (path, body) in valid {
        let validated = policy
            .validate_file(path, Cursor::new(body))
            .unwrap_or_else(|error| panic!("{path}: {error:?}"));
        assert!(!validated.content_type().is_empty());
    }
}

#[test]
fn rejects_disabled_unknown_and_invalid_content() {
    let policy =
        PolicySnapshot::new(100, 100, 2, 100, [".html", ".json", ".png"]).expect("valid policy");

    assert_eq!(
        policy.validate_file("app.js", Cursor::new(b"export {}")),
        Err(FormatError::ExtensionDisabled)
    );
    assert_eq!(
        policy.validate_file("payload.exe", Cursor::new(b"MZ")),
        Err(FormatError::UnsupportedExtension)
    );
    assert_eq!(
        policy.validate_file("data.json", Cursor::new(b"{")),
        Err(FormatError::InvalidContent)
    );
    assert_eq!(
        policy.validate_file("image.png", Cursor::new(b"not png")),
        Err(FormatError::InvalidContent)
    );
}

#[test]
fn validates_policy_extensions_and_numeric_limits() {
    assert_eq!(
        PolicySnapshot::new(0, 100, 1, 100, [".html"]),
        Err(PolicyError::InvalidLimit)
    );
    assert_eq!(
        PolicySnapshot::new(100, 100, 1, 100, [".exe"]),
        Err(PolicyError::UnsupportedExtension)
    );

    let policy = PolicySnapshot::new(100, 8, 1, 5, [".html", ".css"]).expect("valid policy");
    assert_eq!(
        policy.check_entry("index.html", 6, 0, 0),
        Err(FormatError::SingleFileSizeExceeded)
    );
    assert_eq!(
        policy.check_entry("index.html", 5, 1, 5),
        Err(FormatError::FileCountExceeded)
    );
    assert_eq!(
        policy.check_entry("index.html", 4, 0, 5),
        Err(FormatError::ExpandedSizeExceeded)
    );
}

#[test]
fn binary_validation_consumes_the_complete_file() {
    let policy = PolicySnapshot::product_defaults();
    let reader = FailingReader {
        bytes: Cursor::new(b"\x89PNG\r\n\x1a\nrest"),
        fail_after: 8,
    };

    assert_eq!(
        policy.validate_file("image.png", reader),
        Err(FormatError::ReadFailed)
    );
}

struct FailingReader<T> {
    bytes: Cursor<T>,
    fail_after: u64,
}

impl<T: AsRef<[u8]>> Read for FailingReader<T> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.bytes.position() >= self.fail_after {
            return Err(io::Error::other("injected read failure"));
        }
        let remaining = usize::try_from(self.fail_after - self.bytes.position())
            .unwrap_or(usize::MAX)
            .min(buffer.len());
        self.bytes.read(&mut buffer[..remaining])
    }
}
