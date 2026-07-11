use serde::{Deserialize, Serialize};

const REPORT_LIMIT: usize = 20;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidates: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub validation_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, with = "exact_u64")]
    pub actual_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, with = "exact_u64")]
    pub limit_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, with = "exact_u64")]
    pub actual_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, with = "exact_u64")]
    pub limit_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default, with = "exact_u64")]
    pub ignored_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_file: Option<String>,
}

impl ValidationDetails {
    #[must_use]
    pub fn bounded(mut self) -> Self {
        if let Some(paths) = &mut self.paths {
            paths.truncate(REPORT_LIMIT);
        }
        if let Some(candidates) = &mut self.candidates {
            candidates.truncate(REPORT_LIMIT);
        }
        self
    }
}

#[allow(clippy::ref_option)] // Serde's `with` module contract passes `&Option<T>`.
mod exact_u64 {
    use serde::{Deserialize, Deserializer, Serializer};

    const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

    pub fn serialize<S>(value: &Option<u64>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match value {
            None => serializer.serialize_none(),
            Some(value) if *value <= MAX_SAFE_INTEGER => serializer.serialize_u64(*value),
            Some(value) => serializer.serialize_str(&value.to_string()),
        }
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum ExactU64 {
            Number(u64),
            Decimal(String),
        }
        match Option::<ExactU64>::deserialize(deserializer)? {
            None => Ok(None),
            Some(ExactU64::Number(value)) => Ok(Some(value)),
            Some(ExactU64::Decimal(value)) => {
                value.parse().map(Some).map_err(serde::de::Error::custom)
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationNotice {
    pub code: String,
    pub message: String,
    pub action: Option<String>,
    pub details: ValidationDetails,
}

impl ValidationNotice {
    #[must_use]
    pub fn for_code(code: &'static str, details: ValidationDetails) -> Self {
        let (message, action) = copy_for(code);
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
            action: action.map(str::to_owned),
            details: details.bounded(),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub primary_issue: Option<ValidationNotice>,
    pub issues: Vec<ValidationNotice>,
    pub warnings: Vec<ValidationNotice>,
}

impl ValidationReport {
    #[must_use]
    pub fn failure(issue: ValidationNotice, warnings: Vec<ValidationNotice>) -> Self {
        Self {
            primary_issue: Some(issue),
            issues: Vec::new(),
            warnings,
        }
    }

    pub fn push_issue(&mut self, issue: ValidationNotice) {
        if self.primary_issue.is_none() {
            self.primary_issue = Some(issue);
        } else if self.issues.len() < REPORT_LIMIT - 1 {
            self.issues.push(issue);
        }
    }
}

#[must_use]
pub fn primary_issue_matches_legacy_reason(
    legacy_reason_code: &str,
    primary_issue_code: &str,
) -> bool {
    match legacy_reason_code {
        "archive_size_exceeded" => primary_issue_code == "archive_too_large",
        "archive_path_traversal" => primary_issue_code == "unsafe_archive_path",
        "missing_root_index" => matches!(
            primary_issue_code,
            "missing_entry_file" | "ambiguous_entry_file"
        ),
        "unsupported_extension" => primary_issue_code == "unsupported_format",
        "invalid_content" => primary_issue_code == "invalid_file_content",
        "single_file_size_exceeded" => primary_issue_code == "single_file_too_large",
        reason_code => primary_issue_code == reason_code,
    }
}

fn copy_for(code: &str) -> (&'static str, Option<&'static str>) {
    match code {
        "archive_too_large" => (
            "The ZIP exceeds the allowed size.",
            Some("Reduce the ZIP size, then upload it again."),
        ),
        "invalid_zip" => (
            "The uploaded file is not a valid ZIP.",
            Some("Create a new ZIP and upload it again."),
        ),
        "unsafe_archive_path" => (
            "The ZIP contains an unsafe file path.",
            Some("Remove unsafe paths and create a new ZIP."),
        ),
        "duplicate_archive_path" => (
            "The ZIP contains duplicate file paths.",
            Some("Rename or remove duplicate files and create a new ZIP."),
        ),
        "unsupported_file_type" => (
            "The ZIP contains a link or special file.",
            Some("Remove links and special files, then create a new ZIP."),
        ),
        "nested_archive" => (
            "The ZIP contains another archive.",
            Some("Expand nested archives before creating the ZIP."),
        ),
        "unsupported_format" => (
            "A file format is not supported.",
            Some("Remove or convert the file, then upload a new ZIP."),
        ),
        "invalid_file_content" => (
            "A file does not match its expected format.",
            Some("Replace the file with valid content, then upload a new ZIP."),
        ),
        "expanded_size_exceeded" => (
            "The expanded files exceed the allowed size.",
            Some("Reduce the expanded content, then upload a new ZIP."),
        ),
        "file_count_exceeded" => (
            "The ZIP contains too many files.",
            Some("Reduce the number of files, then upload a new ZIP."),
        ),
        "single_file_too_large" => (
            "A file exceeds the allowed size.",
            Some("Reduce or split the file, then upload a new ZIP."),
        ),
        "missing_entry_file" => (
            "The ZIP has no root HTML entry file.",
            Some("Add one HTML file at the ZIP root."),
        ),
        "ambiguous_entry_file" => (
            "The ZIP has multiple possible root HTML entry files.",
            Some("Keep one root HTML file or name the intended file index.html."),
        ),
        "ignored_system_metadata" => ("System metadata files were ignored.", None),
        "wrapper_directory_removed" => ("A common wrapper directory was removed.", None),
        "entry_file_inferred" => (
            "The only root HTML file was selected as the entry file.",
            None,
        ),
        _ => (
            "Archive validation failed.",
            Some("Correct the ZIP and upload it again."),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{ValidationDetails, ValidationNotice};

    #[test]
    fn report_numbers_above_javascript_safe_range_serialize_exactly_as_strings() {
        let notice = ValidationNotice::for_code(
            "expanded_size_exceeded",
            ValidationDetails {
                actual_bytes: Some(u64::MAX),
                actual_count: Some(u64::MAX),
                ..ValidationDetails::default()
            },
        );

        let json = serde_json::to_value(notice).expect("serialize notice");
        assert_eq!(json["details"]["actualBytes"], u64::MAX.to_string());
        assert_eq!(json["details"]["actualCount"], u64::MAX.to_string());
    }
}
