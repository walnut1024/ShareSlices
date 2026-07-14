use shareslices_worker::manifest::{ManifestAsset, ReadyManifest};

#[test]
fn manifest_serialization_is_path_sorted_and_deterministic() {
    let first = ReadyManifest::new(
        "report.html".to_owned(),
        vec![asset("z.js", 2), asset("report.html", 4)],
    );
    let second = ReadyManifest::new(
        "report.html".to_owned(),
        vec![asset("report.html", 4), asset("z.js", 2)],
    );

    assert_eq!(first.entry_path, "report.html");
    assert_eq!(first.files[0].path, "report.html");
    assert_eq!(first.file_count(), 2);
    assert_eq!(first.total_size_bytes(), 6);
    assert_eq!(
        first.to_json().expect("serialize"),
        second.to_json().expect("serialize")
    );
}

#[test]
fn content_identity_has_a_stable_versioned_test_vector() {
    let manifest = ReadyManifest::new(
        "index.html".to_owned(),
        vec![
            asset_with_digest(
                "assets/app.js",
                17,
                "text/javascript",
                "4a1b21d876bae38e40e0cc835a7dc96a0a017ebd12a26f68aa30fdcbea1f06d8",
            ),
            asset_with_digest(
                "index.html",
                13,
                "text/html",
                "b633a587c652d02386c4f16f8c6f6aab7352d97f16367c3c40576214372dd628",
            ),
        ],
    );

    assert_eq!(
        manifest
            .content_identity("content-identity-v1")
            .expect("valid identity")
            .as_hex(),
        "a6213ec980aad9767c633ff78e9ee3f6fa94d9c224cb5a8ec35d3670d048a2ef"
    );
}

#[test]
fn content_identity_includes_revision_entry_path_and_normalized_asset_metadata() {
    let base = ReadyManifest::new("index.html".to_owned(), vec![asset("index.html", 4)]);
    let different_object_key = ReadyManifest::new(
        "index.html".to_owned(),
        vec![ManifestAsset {
            object_key: "another/opaque/key".to_owned(),
            ..asset("index.html", 4)
        }],
    );
    let different_entry = ReadyManifest::new("other.html".to_owned(), vec![asset("index.html", 4)]);
    let different_path = ReadyManifest::new("index.html".to_owned(), vec![asset("home.html", 4)]);
    let different_type = ReadyManifest::new(
        "index.html".to_owned(),
        vec![ManifestAsset {
            content_type: "application/xhtml+xml".to_owned(),
            ..asset("index.html", 4)
        }],
    );

    let identity = base
        .content_identity("content-identity-v1")
        .expect("valid identity");
    assert_eq!(
        identity,
        different_object_key
            .content_identity("content-identity-v1")
            .expect("valid identity")
    );
    assert_ne!(
        identity,
        base.content_identity("content-identity-v2")
            .expect("valid identity")
    );
    assert_ne!(
        identity,
        different_entry
            .content_identity("content-identity-v1")
            .expect("valid identity")
    );
    assert_ne!(
        identity,
        different_path
            .content_identity("content-identity-v1")
            .expect("valid identity")
    );
    assert_ne!(
        identity,
        different_type
            .content_identity("content-identity-v1")
            .expect("valid identity")
    );
}

fn asset(path: &str, size_bytes: u64) -> ManifestAsset {
    ManifestAsset {
        path: path.to_owned(),
        object_key: format!("versions/by-upload/upload-1/{path}"),
        size_bytes,
        content_type: "text/plain".to_owned(),
        sha256: "a".repeat(64),
    }
}

fn asset_with_digest(
    path: &str,
    size_bytes: u64,
    content_type: &str,
    sha256: &str,
) -> ManifestAsset {
    ManifestAsset {
        path: path.to_owned(),
        object_key: format!("versions/by-upload/upload-1/{path}"),
        size_bytes,
        content_type: content_type.to_owned(),
        sha256: sha256.to_owned(),
    }
}
