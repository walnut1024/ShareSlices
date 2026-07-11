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

fn asset(path: &str, size_bytes: u64) -> ManifestAsset {
    ManifestAsset {
        path: path.to_owned(),
        object_key: format!("versions/by-upload/upload-1/{path}"),
        size_bytes,
        content_type: "text/plain".to_owned(),
        sha256: "a".repeat(64),
    }
}
