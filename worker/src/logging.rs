use std::collections::BTreeMap;
use std::fmt;
use std::io;

use serde::Serialize;
use serde_json::{Map, Value};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tracing::Subscriber;
use tracing::field::{Field, Visit};
use tracing_subscriber::fmt::FmtContext;
use tracing_subscriber::fmt::format::{FormatEvent, FormatFields, Writer};
use tracing_subscriber::fmt::writer::MakeWriter;
use tracing_subscriber::registry::LookupSpan;

const SERVICE_NAME: &str = "shareslices-worker";
const REDACTED: &str = "[REDACTED]";
const SENSITIVE_MARKERS: [&str; 8] = [
    "authorization",
    "cookie",
    "password",
    "session_cookie",
    "session cookie",
    "share_slug",
    "share slug",
    "token",
];

#[derive(Clone, Debug)]
pub struct LogConfig {
    service_version: String,
    deployment_environment: String,
}

impl LogConfig {
    #[must_use]
    pub fn new(
        service_version: impl Into<String>,
        deployment_environment: impl Into<String>,
    ) -> Self {
        Self {
            service_version: service_version.into(),
            deployment_environment: deployment_environment.into(),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Severity {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

impl Severity {
    const fn text(self) -> &'static str {
        match self {
            Self::Trace => "TRACE",
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
            Self::Fatal => "FATAL",
        }
    }

    const fn number(self) -> u64 {
        match self {
            Self::Trace => 1,
            Self::Debug => 5,
            Self::Info => 9,
            Self::Warn => 13,
            Self::Error => 17,
            Self::Fatal => 21,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct EventContext<'a> {
    pub request_id: Option<&'a str>,
    pub artifact_id: Option<&'a str>,
    pub upload_session_id: Option<&'a str>,
    pub processing_job_id: Option<&'a str>,
    pub attempt_id: Option<&'a str>,
    pub retry_reason_code: Option<&'a str>,
    pub trace_id: Option<&'a str>,
    pub span_id: Option<&'a str>,
}

#[derive(Clone, Debug)]
pub struct SanitizedException {
    exception_type: String,
    message: String,
    stacktrace: Option<String>,
    cause_chain: Vec<String>,
}

impl SanitizedException {
    #[must_use]
    pub fn new<I, S>(
        exception_type: impl AsRef<str>,
        message: impl AsRef<str>,
        stacktrace: Option<impl AsRef<str>>,
        cause_chain: I,
    ) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Self {
            exception_type: sanitize(exception_type.as_ref()),
            message: sanitize(message.as_ref()),
            stacktrace: stacktrace.map(|value| sanitize(value.as_ref())),
            cause_chain: cause_chain
                .into_iter()
                .map(|cause| sanitize(cause.as_ref()))
                .collect(),
        }
    }
}

#[derive(Debug)]
pub struct WorkerEvent<'a> {
    severity: Severity,
    event_name: &'a str,
    body: &'a str,
    context: EventContext<'a>,
    exception: Option<SanitizedException>,
}

impl<'a> WorkerEvent<'a> {
    #[must_use]
    pub fn new(severity: Severity, event_name: &'a str, body: &'a str) -> Self {
        Self {
            severity,
            event_name,
            body,
            context: EventContext::default(),
            exception: None,
        }
    }

    #[must_use]
    pub fn with_context(mut self, context: EventContext<'a>) -> Self {
        self.context = context;
        self
    }

    #[must_use]
    pub fn with_exception(mut self, exception: SanitizedException) -> Self {
        self.exception = Some(exception);
        self
    }

    pub fn emit(self) {
        let exception_type = self
            .exception
            .as_ref()
            .map_or("", |exception| exception.exception_type.as_str());
        let exception_message = self
            .exception
            .as_ref()
            .map_or("", |exception| exception.message.as_str());
        let exception_stacktrace = self
            .exception
            .as_ref()
            .and_then(|exception| exception.stacktrace.as_deref())
            .unwrap_or_default();
        let exception_cause_chain = self.exception.as_ref().map_or_else(
            || "[]".to_owned(),
            |exception| {
                serde_json::to_string(&exception.cause_chain).unwrap_or_else(|_| "[]".to_owned())
            },
        );

        macro_rules! emit_at {
            ($level:ident) => {
                tracing::event!(
                    tracing::Level::$level,
                    severity_text = self.severity.text(),
                    severity_number = self.severity.number(),
                    event_name = self.event_name,
                    body = self.body,
                    request_id = self.context.request_id.unwrap_or_default(),
                    artifact_id = self.context.artifact_id.unwrap_or_default(),
                    upload_session_id = self.context.upload_session_id.unwrap_or_default(),
                    processing_job_id = self.context.processing_job_id.unwrap_or_default(),
                    attempt_id = self.context.attempt_id.unwrap_or_default(),
                    retry_reason_code = self.context.retry_reason_code.unwrap_or_default(),
                    trace_id = self.context.trace_id.unwrap_or_default(),
                    span_id = self.context.span_id.unwrap_or_default(),
                    exception_type,
                    exception_message,
                    exception_stacktrace,
                    exception_cause_chain,
                )
            };
        }

        match self.severity {
            Severity::Trace => emit_at!(TRACE),
            Severity::Debug => emit_at!(DEBUG),
            Severity::Info => emit_at!(INFO),
            Severity::Warn => emit_at!(WARN),
            Severity::Error | Severity::Fatal => emit_at!(ERROR),
        }
    }
}

pub fn subscriber<W>(config: LogConfig, writer: W) -> impl Subscriber + Send + Sync
where
    W: for<'writer> MakeWriter<'writer> + Send + Sync + 'static,
{
    tracing_subscriber::fmt()
        .event_format(WorkerJsonFormatter::new(config))
        .with_writer(writer)
        .finish()
}

/// Installs the worker JSON subscriber for the current process.
///
/// # Errors
///
/// Returns an error when another global tracing subscriber is already installed.
pub fn init(config: LogConfig) -> Result<(), tracing::subscriber::SetGlobalDefaultError> {
    tracing::subscriber::set_global_default(subscriber(config, io::stdout))
}

#[derive(Clone, Debug)]
struct WorkerJsonFormatter {
    resource: BTreeMap<&'static str, String>,
}

impl WorkerJsonFormatter {
    fn new(config: LogConfig) -> Self {
        Self {
            resource: BTreeMap::from([
                ("deployment.environment.name", config.deployment_environment),
                ("service.name", SERVICE_NAME.to_owned()),
                ("service.version", config.service_version),
            ]),
        }
    }
}

impl<S, N> FormatEvent<S, N> for WorkerJsonFormatter
where
    S: Subscriber + for<'lookup> LookupSpan<'lookup>,
    N: for<'writer> FormatFields<'writer> + 'static,
{
    fn format_event(
        &self,
        _context: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &tracing::Event<'_>,
    ) -> fmt::Result {
        let mut visitor = JsonVisitor::default();
        event.record(&mut visitor);

        let severity_text = visitor
            .take_string("severity_text")
            .unwrap_or_else(|| event.metadata().level().as_str().to_owned());
        let severity_number = visitor
            .fields
            .remove("severity_number")
            .and_then(|value| value.as_u64())
            .unwrap_or_else(|| severity_number(*event.metadata().level()));
        let event_name = visitor
            .take_string("event_name")
            .unwrap_or_else(|| event.metadata().target().to_owned());
        let body = visitor
            .take_string("body")
            .or_else(|| visitor.take_string("message"))
            .unwrap_or_else(|| event_name.clone());
        let trace_id = visitor.take_non_empty_string("trace_id");
        let span_id = visitor.take_non_empty_string("span_id");

        let attributes = visitor.into_attributes();
        let record = LogRecord {
            timestamp: OffsetDateTime::now_utc()
                .format(&Rfc3339)
                .map_err(|_| fmt::Error)?,
            severity_text,
            severity_number,
            body,
            event_name,
            trace_id,
            span_id,
            resource: &self.resource,
            attributes,
        };
        let json = serde_json::to_string(&record).map_err(|_| fmt::Error)?;
        writeln!(writer, "{json}")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogRecord<'a> {
    timestamp: String,
    severity_text: String,
    severity_number: u64,
    body: String,
    event_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    span_id: Option<String>,
    resource: &'a BTreeMap<&'static str, String>,
    attributes: Map<String, Value>,
}

#[derive(Default)]
struct JsonVisitor {
    fields: Map<String, Value>,
}

impl JsonVisitor {
    fn take_string(&mut self, name: &str) -> Option<String> {
        self.fields
            .remove(name)
            .and_then(|value| value.as_str().map(ToOwned::to_owned))
    }

    fn take_non_empty_string(&mut self, name: &str) -> Option<String> {
        self.take_string(name).filter(|value| !value.is_empty())
    }

    fn into_attributes(mut self) -> Map<String, Value> {
        let mappings = [
            ("request_id", "http.request.id"),
            ("artifact_id", "shareslices.artifact.id"),
            ("upload_session_id", "shareslices.upload_session.id"),
            ("processing_job_id", "shareslices.processing_job.id"),
            ("attempt_id", "shareslices.processing_attempt.id"),
            ("retry_reason_code", "shareslices.retry.reason_code"),
            ("exception_type", "exception.type"),
            ("exception_message", "exception.message"),
            ("exception_stacktrace", "exception.stacktrace"),
        ];

        for (source, destination) in mappings {
            if let Some(value) = self.fields.remove(source)
                && !matches!(&value, Value::String(text) if text.is_empty())
            {
                self.fields.insert(destination.to_owned(), value);
            }
        }

        if let Some(Value::String(cause_chain)) = self.fields.remove("exception_cause_chain")
            && let Ok(causes) = serde_json::from_str(&cause_chain)
            && causes != Value::Array(Vec::new())
        {
            self.fields
                .insert("exception.cause_chain".to_owned(), causes);
        }

        self.fields
    }
}

impl Visit for JsonVisitor {
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.fields.insert(field.name().to_owned(), value.into());
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.fields.insert(field.name().to_owned(), value.into());
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.fields.insert(field.name().to_owned(), value.into());
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        if let Some(number) = serde_json::Number::from_f64(value) {
            self.fields
                .insert(field.name().to_owned(), Value::Number(number));
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.fields
            .insert(field.name().to_owned(), value.to_owned().into());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.fields
            .insert(field.name().to_owned(), format!("{value:?}").into());
    }
}

fn sanitize(value: &str) -> String {
    let normalized = value.to_ascii_lowercase();
    if SENSITIVE_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        REDACTED.to_owned()
    } else {
        value.to_owned()
    }
}

fn severity_number(level: tracing::Level) -> u64 {
    if level == tracing::Level::TRACE {
        1
    } else if level == tracing::Level::DEBUG {
        5
    } else if level == tracing::Level::INFO {
        9
    } else if level == tracing::Level::WARN {
        13
    } else {
        17
    }
}
