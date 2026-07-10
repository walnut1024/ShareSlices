use std::time::Duration;

use shareslices_worker::object_storage::{
    AwsS3ObjectStorage, InMemoryObjectStorage, ObjectStorage,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn streams_raw_reads_and_staging_writes() {
    let storage = InMemoryObjectStorage::new();
    storage
        .put_raw_for_test("raw/artifact/upload.zip", b"zip-content".to_vec())
        .await;

    let mut raw = storage
        .read_raw_archive("raw/artifact/upload.zip")
        .await
        .expect("raw object should exist");
    let mut raw_bytes = Vec::new();
    raw.read_to_end(&mut raw_bytes)
        .await
        .expect("raw stream should remain readable");
    assert_eq!(raw_bytes, b"zip-content");

    let (mut writer, reader) = tokio::io::duplex(3);
    let producer = tokio::spawn(async move {
        writer.write_all(b"abc").await.expect("first chunk");
        tokio::time::sleep(Duration::from_millis(5)).await;
        writer.write_all(b"def").await.expect("second chunk");
    });

    storage
        .write_staging_object(
            "staging/attempt/index.html",
            6,
            "text/html",
            Box::pin(reader),
        )
        .await
        .expect("staging write should accept a streaming reader");
    producer.await.expect("producer should finish");

    assert_eq!(
        storage
            .staging_bytes_for_test("staging/attempt/index.html")
            .await,
        Some(b"abcdef".to_vec())
    );
}

#[tokio::test]
async fn reports_missing_raw_objects() {
    let storage = InMemoryObjectStorage::new();

    let Err(error) = storage.read_raw_archive("raw/missing.zip").await else {
        panic!("missing raw object must fail");
    };

    assert!(error.to_string().contains("raw/missing.zip"));
}

#[tokio::test]
async fn promotion_preserves_bytes_and_content_type_and_cleanup_is_prefix_scoped() {
    let storage = InMemoryObjectStorage::new();
    storage
        .write_staging_object(
            "staging/upload-1/attempt-1/index.html",
            5,
            "text/html",
            Box::pin(std::io::Cursor::new(b"ready".to_vec())),
        )
        .await
        .expect("stage object");
    storage
        .write_staging_object(
            "staging/upload-1/attempt-2/index.html",
            4,
            "text/html",
            Box::pin(std::io::Cursor::new(b"keep".to_vec())),
        )
        .await
        .expect("stage sibling attempt");

    storage
        .promote_staging_object(
            "staging/upload-1/attempt-1/index.html",
            "versions/by-upload/upload-1/index.html",
            5,
            "text/html",
        )
        .await
        .expect("promote object");
    let committed = storage
        .committed_object_for_test("versions/by-upload/upload-1/index.html")
        .await
        .expect("committed object");
    assert_eq!(committed.bytes, b"ready");
    assert_eq!(committed.content_type, "text/html");

    assert_eq!(
        storage
            .remove_staging_prefix("staging/upload-1/attempt-1/")
            .await
            .expect("clean attempt"),
        1
    );
    assert!(
        storage
            .staging_bytes_for_test("staging/upload-1/attempt-1/index.html")
            .await
            .is_none()
    );
    assert_eq!(
        storage
            .staging_bytes_for_test("staging/upload-1/attempt-2/index.html")
            .await,
        Some(b"keep".to_vec())
    );
}

#[tokio::test]
async fn aws_adapter_round_trip_is_available_for_local_minio() {
    if std::env::var("S3_INTEGRATION").as_deref() != Ok("1") {
        eprintln!("skipping S3 integration test: set S3_INTEGRATION=1");
        return;
    }
    let endpoint = std::env::var("S3_ENDPOINT").expect("S3_ENDPOINT");
    let region = std::env::var("S3_REGION").expect("S3_REGION");
    let bucket = std::env::var("S3_BUCKET").expect("S3_BUCKET");
    let access_key = std::env::var("S3_ACCESS_KEY_ID").expect("S3_ACCESS_KEY_ID");
    let secret_key = std::env::var("S3_SECRET_ACCESS_KEY").expect("S3_SECRET_ACCESS_KEY");
    let config = aws_sdk_s3::Config::builder()
        .behavior_version_latest()
        .endpoint_url(endpoint)
        .region(aws_sdk_s3::config::Region::new(region))
        .credentials_provider(aws_sdk_s3::config::Credentials::new(
            access_key,
            secret_key,
            None,
            None,
            "worker-test",
        ))
        .force_path_style(true)
        .build();
    let client = aws_sdk_s3::Client::from_conf(config);
    let prefix = format!("worker-integration/{}/", uuid::Uuid::new_v4());
    let source = format!("{prefix}staging/index.html");
    let destination = format!("{prefix}committed/index.html");
    let storage = AwsS3ObjectStorage::new(client.clone(), &bucket);

    storage
        .write_staging_object(
            &source,
            5,
            "text/html",
            Box::pin(std::io::Cursor::new(b"ready".to_vec())),
        )
        .await
        .expect("write S3 staging object");
    storage
        .promote_staging_object(&source, &destination, 5, "text/html")
        .await
        .expect("promote S3 staging object");
    let committed = client
        .get_object()
        .bucket(&bucket)
        .key(&destination)
        .send()
        .await
        .expect("read committed S3 object");
    assert_eq!(committed.content_type(), Some("text/html"));
    assert_eq!(
        committed.body.collect().await.expect("body").into_bytes(),
        b"ready"[..]
    );
    assert_eq!(
        storage
            .remove_staging_prefix(&prefix)
            .await
            .expect("remove S3 test prefix"),
        2
    );
}
