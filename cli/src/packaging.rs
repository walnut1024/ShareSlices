use crate::{ArtifactError, UploadPolicy};
use std::collections::BTreeMap;
use std::fs::{self, FileType};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

#[derive(Debug)]
pub struct PreparedUpload {
    pub path: PathBuf,
    pub default_name: String,
    _temporary: Option<tempfile::NamedTempFile>,
}

pub fn prepare_upload(
    inputs: &[PathBuf],
    root: Option<&Path>,
    policy: &UploadPolicy,
) -> Result<PreparedUpload, ArtifactError> {
    let inputs = expand_inputs(inputs)?;
    if inputs.len() == 1 && is_zip(&inputs[0]) {
        if root.is_some() {
            return invalid("--root cannot be used with a prepared ZIP");
        }
        let path = inputs[0]
            .canonicalize()
            .map_err(|_| invalid_error("input does not exist"))?;
        if path
            .metadata()
            .map_err(|_| invalid_error("cannot inspect ZIP"))?
            .len()
            > policy.max_archive_bytes
        {
            return invalid("ZIP exceeds the active upload archive-size limit");
        }
        return Ok(PreparedUpload {
            default_name: file_stem(&path)?,
            path,
            _temporary: None,
        });
    }
    if inputs.iter().any(|path| is_zip(path)) {
        return invalid("ZIP input cannot be combined with other inputs or repackaged");
    }

    let current =
        std::env::current_dir().map_err(|_| invalid_error("cannot read current directory"))?;
    let root = root
        .unwrap_or(&current)
        .canonicalize()
        .map_err(|_| invalid_error("root does not exist"))?;
    let single_directory = inputs.len() == 1 && inputs[0].is_dir();
    let mut entries = BTreeMap::<String, PathBuf>::new();
    for input in &inputs {
        let canonical = input
            .canonicalize()
            .map_err(|_| invalid_error("input does not exist"))?;
        reject_link(input)?;
        if !canonical.starts_with(&root) {
            return invalid("every input must be inside --root");
        }
        if canonical.is_dir() {
            collect_directory(&canonical, &root, single_directory, &mut entries)?;
        } else if canonical.is_file() {
            let relative = canonical
                .strip_prefix(&root)
                .map_err(|_| invalid_error("input is outside --root"))?
                .to_owned();
            insert_entry(&relative, canonical, &mut entries)?;
        } else {
            return invalid("special files are not supported");
        }
    }
    if entries.is_empty() {
        return invalid("the selected inputs contain no uploadable files");
    }
    validate_policy(&entries, policy)?;

    let temporary = write_archive(entries)?;
    if temporary
        .as_file()
        .metadata()
        .map_err(|_| invalid_error("cannot inspect temporary ZIP"))?
        .len()
        > policy.max_archive_bytes
    {
        return invalid("packaged ZIP exceeds the active upload archive-size limit");
    }
    let default_name = if single_directory {
        inputs[0]
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("artifact")
            .to_owned()
    } else if inputs.len() == 1 {
        file_stem(&inputs[0])?
    } else {
        root.file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("artifact")
            .to_owned()
    };
    Ok(PreparedUpload {
        path: temporary.path().to_owned(),
        default_name,
        _temporary: Some(temporary),
    })
}

fn write_archive(
    entries: BTreeMap<String, PathBuf>,
) -> Result<tempfile::NamedTempFile, ArtifactError> {
    let mut temporary = tempfile::Builder::new()
        .suffix(".zip")
        .tempfile()
        .map_err(|_| invalid_error("cannot create temporary ZIP"))?;
    let mut writer = zip::ZipWriter::new(temporary.as_file_mut());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::default());
    let mut buffer = vec![0_u8; 64 * 1024];
    for (archive_path, source) in entries {
        writer
            .start_file(archive_path, options)
            .map_err(|_| invalid_error("cannot write temporary ZIP"))?;
        let mut file =
            fs::File::open(source).map_err(|_| invalid_error("cannot read selected file"))?;
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|_| invalid_error("cannot read selected file"))?;
            if read == 0 {
                break;
            }
            writer
                .write_all(&buffer[..read])
                .map_err(|_| invalid_error("cannot write temporary ZIP"))?;
        }
    }
    writer
        .finish()
        .map_err(|_| invalid_error("cannot finish temporary ZIP"))?;
    Ok(temporary)
}

fn validate_policy(
    entries: &BTreeMap<String, PathBuf>,
    policy: &UploadPolicy,
) -> Result<(), ArtifactError> {
    if entries.len() > policy.max_file_count {
        return invalid("selected inputs exceed the active upload file-count limit");
    }
    let mut expanded_bytes = 0_u64;
    for (archive_path, source) in entries {
        let size = source
            .metadata()
            .map_err(|_| invalid_error("cannot inspect selected file"))?
            .len();
        if size > policy.max_file_bytes {
            return invalid("a selected file exceeds the active per-file size limit");
        }
        expanded_bytes = expanded_bytes
            .checked_add(size)
            .ok_or_else(|| invalid_error("selected input size overflow"))?;
        if expanded_bytes > policy.max_expanded_bytes {
            return invalid("selected inputs exceed the active expanded-size limit");
        }
        let extension = Path::new(archive_path)
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{}", value.to_ascii_lowercase()));
        if extension.as_ref().is_none_or(|value| {
            !policy
                .enabled_extensions
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(value))
        }) {
            return invalid("a selected file type is disabled by the active upload policy");
        }
    }
    Ok(())
}

fn expand_inputs(inputs: &[PathBuf]) -> Result<Vec<PathBuf>, ArtifactError> {
    let mut expanded = Vec::new();
    for input in inputs {
        let value = input.to_string_lossy();
        if value.contains(['*', '?', '[']) {
            let matches = glob::glob(&value)
                .map_err(|_| invalid_error("invalid glob pattern"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| invalid_error("cannot expand glob pattern"))?;
            if matches.is_empty() {
                return invalid("glob pattern matched no inputs");
            }
            expanded.extend(matches);
        } else {
            expanded.push(input.clone());
        }
    }
    Ok(expanded)
}

fn collect_directory(
    directory: &Path,
    root: &Path,
    strip_wrapper: bool,
    entries: &mut BTreeMap<String, PathBuf>,
) -> Result<(), ArtifactError> {
    let base = if strip_wrapper { directory } else { root };
    let mut children = fs::read_dir(directory)
        .map_err(|_| invalid_error("cannot read selected directory"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid_error("cannot read selected directory"))?;
    children.sort_by_key(std::fs::DirEntry::file_name);
    for child in children {
        let path = child.path();
        let name = child.file_name();
        if ignored_component(&name.to_string_lossy()) {
            continue;
        }
        let kind = child
            .file_type()
            .map_err(|_| invalid_error("cannot inspect selected input"))?;
        reject_file_type(kind)?;
        if kind.is_dir() {
            collect_directory(&path, base, false, entries)?;
        } else {
            let relative = path
                .strip_prefix(base)
                .map_err(|_| invalid_error("input is outside package root"))?
                .to_owned();
            insert_entry(&relative, path, entries)?;
        }
    }
    Ok(())
}

fn insert_entry(
    relative: &Path,
    source: PathBuf,
    entries: &mut BTreeMap<String, PathBuf>,
) -> Result<(), ArtifactError> {
    if source
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.eq_ignore_ascii_case("zip"))
    {
        return invalid("nested ZIP archives are not supported");
    }
    if relative.components().any(|part| {
        matches!(
            part,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return invalid("archive paths cannot contain traversal or absolute components");
    }
    let path = relative
        .components()
        .filter_map(|part| match part {
            Component::Normal(v) => v.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/");
    if path.is_empty() || entries.insert(path.clone(), source).is_some() {
        return invalid("selected inputs produce duplicate archive paths");
    }
    Ok(())
}

fn reject_link(path: &Path) -> Result<(), ArtifactError> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| invalid_error("cannot inspect selected input"))?;
    reject_file_type(metadata.file_type())
}

fn reject_file_type(kind: FileType) -> Result<(), ArtifactError> {
    if kind.is_symlink() {
        return invalid("symbolic links are not supported");
    }
    if !kind.is_file() && !kind.is_dir() {
        return invalid("special files are not supported");
    }
    Ok(())
}

fn ignored_component(value: &str) -> bool {
    value == ".DS_Store" || value == "__MACOSX"
}
fn is_zip(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.eq_ignore_ascii_case("zip"))
}
fn file_stem(path: &Path) -> Result<String, ArtifactError> {
    path.file_stem()
        .and_then(|v| v.to_str())
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| invalid_error("cannot derive artifact name"))
}
fn invalid<T>(message: &str) -> Result<T, ArtifactError> {
    Err(invalid_error(message))
}
fn invalid_error(message: &str) -> ArtifactError {
    ArtifactError::InvalidUploadInput(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn archive_entries(path: &Path) -> Vec<String> {
        let file = fs::File::open(path).expect("archive");
        let mut archive = zip::ZipArchive::new(file).expect("zip");
        (0..archive.len())
            .map(|index| archive.by_index(index).expect("entry").name().to_owned())
            .collect()
    }

    fn policy() -> UploadPolicy {
        UploadPolicy {
            revision: "test".into(),
            max_archive_bytes: 50 * 1024 * 1024,
            max_expanded_bytes: 200 * 1024 * 1024,
            max_file_count: 1000,
            max_file_bytes: 50 * 1024 * 1024,
            enabled_extensions: vec![".html".into(), ".js".into(), ".txt".into()],
        }
    }

    #[test]
    fn standalone_file_does_not_collect_siblings() {
        let directory = tempfile::tempdir().expect("tempdir");
        fs::write(directory.path().join("index.html"), "index").expect("index");
        fs::write(directory.path().join("secret.txt"), "secret").expect("sibling");
        let prepared = prepare_upload(
            &[directory.path().join("index.html")],
            Some(directory.path()),
            &policy(),
        )
        .expect("package");
        assert_eq!(archive_entries(&prepared.path), ["index.html"]);
    }

    #[test]
    fn directory_drops_wrapper_sorts_paths_and_ignores_os_metadata() {
        let parent = tempfile::tempdir().expect("tempdir");
        let directory = parent.path().join("site");
        fs::create_dir_all(directory.join("assets")).expect("directories");
        fs::write(directory.join("index.html"), "index").expect("index");
        fs::write(directory.join("assets/app.js"), "app").expect("asset");
        fs::write(directory.join(".DS_Store"), "metadata").expect("metadata");
        let prepared =
            prepare_upload(&[directory], Some(parent.path()), &policy()).expect("package");
        assert_eq!(
            archive_entries(&prepared.path),
            ["assets/app.js", "index.html"]
        );
    }

    #[test]
    fn rejects_nested_zip_and_input_outside_root() {
        let root = tempfile::tempdir().expect("root");
        let outside = tempfile::NamedTempFile::new().expect("outside");
        assert!(
            prepare_upload(&[outside.path().to_owned()], Some(root.path()), &policy()).is_err()
        );
        let nested = root.path().join("nested.zip");
        fs::File::create(&nested)
            .expect("nested")
            .write_all(b"zip")
            .expect("write");
        assert!(prepare_upload(&[root.path().to_owned()], Some(root.path()), &policy()).is_err());
    }

    #[test]
    fn multiple_inputs_and_globs_keep_root_relative_paths() {
        let root = tempfile::tempdir().expect("root");
        fs::create_dir(root.path().join("assets")).expect("assets");
        fs::write(root.path().join("index.html"), "index").expect("index");
        fs::write(root.path().join("assets/a.js"), "a").expect("a");
        fs::write(root.path().join("assets/b.js"), "b").expect("b");
        let pattern = root.path().join("assets/*.js");
        let prepared = prepare_upload(
            &[root.path().join("index.html"), pattern],
            Some(root.path()),
            &policy(),
        )
        .expect("package");
        assert_eq!(
            archive_entries(&prepared.path),
            ["assets/a.js", "assets/b.js", "index.html"]
        );
    }

    #[test]
    fn packaging_is_byte_deterministic_and_policy_bounded() {
        let root = tempfile::tempdir().expect("root");
        fs::write(root.path().join("index.html"), "stable").expect("index");
        let first =
            prepare_upload(&[root.path().to_owned()], Some(root.path()), &policy()).expect("first");
        let second = prepare_upload(&[root.path().to_owned()], Some(root.path()), &policy())
            .expect("second");
        assert_eq!(
            fs::read(first.path).expect("first bytes"),
            fs::read(second.path).expect("second bytes")
        );

        let mut bounded = policy();
        bounded.max_file_bytes = 1;
        assert!(prepare_upload(&[root.path().to_owned()], Some(root.path()), &bounded).is_err());
    }

    #[test]
    fn unmatched_glob_is_actionable() {
        let root = tempfile::tempdir().expect("root");
        let error = prepare_upload(
            &[root.path().join("*.missing")],
            Some(root.path()),
            &policy(),
        )
        .expect_err("unmatched glob");
        assert!(error.to_string().contains("matched no inputs"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symbolic_links_inside_selected_directories() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().expect("root");
        fs::write(root.path().join("index.html"), "index").expect("index");
        symlink(
            root.path().join("index.html"),
            root.path().join("linked.html"),
        )
        .expect("link");
        assert!(prepare_upload(&[root.path().to_owned()], Some(root.path()), &policy()).is_err());
    }
}
