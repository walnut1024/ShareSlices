use std::io::{self, Write};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use shareslices_worker::logging::{
    EventContext, LogConfig, SanitizedException, Severity, WorkerEvent, subscriber,
};
use tracing::subscriber::with_default;
use tracing_subscriber::fmt::MakeWriter;

#[derive(Clone, Default)]
struct CapturedOutput(Arc<Mutex<Vec<u8>>>);

struct CapturedWriter(Arc<Mutex<Vec<u8>>>);

impl Write for CapturedWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0
            .lock()
            .expect("capture lock")
            .extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'writer> MakeWriter<'writer> for CapturedOutput {
    type Writer = CapturedWriter;

    fn make_writer(&'writer self) -> Self::Writer {
        CapturedWriter(Arc::clone(&self.0))
    }
}

impl CapturedOutput {
    fn record(&self) -> Value {
        let bytes = self.0.lock().expect("capture lock");
        let line = std::str::from_utf8(&bytes).expect("UTF-8 log output");
        assert_eq!(line.lines().count(), 1);
        serde_json::from_str(line).expect("JSON log record")
    }
}

#[test]
fn emits_the_worker_log_contract_with_correlation() {
    let output = CapturedOutput::default();
    let dispatch = subscriber(LogConfig::new("0.0.1", "test"), output.clone());

    with_default(dispatch, || {
        WorkerEvent::new(
            Severity::Info,
            "shareslices.artifact.processing.started",
            "processing started",
        )
        .with_context(EventContext {
            request_id: Some("request-1"),
            artifact_id: Some("artifact-1"),
            upload_session_id: Some("upload-1"),
            processing_job_id: Some("job-1"),
            attempt_id: Some("attempt-1"),
            retry_reason_code: None,
            trace_id: Some("0123456789abcdef0123456789abcdef"),
            span_id: Some("0123456789abcdef"),
        })
        .emit();
    });

    let record = output.record();
    assert!(
        record["timestamp"]
            .as_str()
            .is_some_and(|value| value.ends_with('Z'))
    );
    assert_eq!(record["severityText"], "INFO");
    assert_eq!(record["severityNumber"], 9);
    assert_eq!(record["body"], "processing started");
    assert_eq!(
        record["eventName"],
        "shareslices.artifact.processing.started"
    );
    assert_eq!(record["traceId"], "0123456789abcdef0123456789abcdef");
    assert_eq!(record["spanId"], "0123456789abcdef");
    assert_eq!(record["resource"]["service.name"], "shareslices-worker");
    assert_eq!(record["resource"]["service.version"], "0.0.1");
    assert_eq!(record["resource"]["deployment.environment.name"], "test");
    assert_eq!(record["attributes"]["http.request.id"], "request-1");
    assert_eq!(
        record["attributes"]["shareslices.artifact.id"],
        "artifact-1"
    );
    assert_eq!(
        record["attributes"]["shareslices.upload_session.id"],
        "upload-1"
    );
    assert_eq!(
        record["attributes"]["shareslices.processing_job.id"],
        "job-1"
    );
    assert_eq!(
        record["attributes"]["shareslices.processing_attempt.id"],
        "attempt-1"
    );
}

#[test]
fn redacts_sensitive_exception_evidence_and_preserves_retry_reason() {
    let output = CapturedOutput::default();
    let dispatch = subscriber(LogConfig::new("0.0.1", "test"), output.clone());

    with_default(dispatch, || {
        WorkerEvent::new(
            Severity::Warn,
            "shareslices.artifact.processing.retry_scheduled",
            "processing attempt will be retried",
        )
        .with_context(EventContext {
            retry_reason_code: Some("object_store_timeout"),
            ..EventContext::default()
        })
        .with_exception(SanitizedException::new(
            "StorageError",
            "authorization=Bearer-secret cookie=session-secret",
            Some("upload failed with share_slug=private-slug"),
            ["token=private-token"],
        ))
        .emit();
    });

    let record = output.record();
    assert_eq!(record["severityText"], "WARN");
    assert_eq!(record["severityNumber"], 13);
    assert_eq!(
        record["attributes"]["shareslices.retry.reason_code"],
        "object_store_timeout"
    );
    assert_eq!(record["attributes"]["exception.type"], "StorageError");

    let serialized = serde_json::to_string(&record).expect("serialize record");
    assert!(!serialized.contains("Bearer-secret"));
    assert!(!serialized.contains("session-secret"));
    assert!(!serialized.contains("private-slug"));
    assert!(!serialized.contains("private-token"));
    assert!(serialized.contains("[REDACTED]"));
}
