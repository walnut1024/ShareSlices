use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

use thiserror::Error;

pub const DEFAULT_READY_FILE: &str = "/tmp/shareslices/worker-ready";

#[derive(Debug, Error)]
pub enum HealthError {
    #[error("worker readiness file is unavailable: {0}")]
    NotReady(#[source] io::Error),
    #[error("worker readiness file contains an invalid process id")]
    InvalidProcessId,
    #[error("worker process {0} is no longer running")]
    ProcessStopped(u32),
    #[error("Chromium health check could not start: {0}")]
    ChromiumStart(#[source] io::Error),
    #[error("Chromium health check failed with status {0}")]
    ChromiumFailed(std::process::ExitStatus),
}

#[derive(Debug)]
pub struct ReadyFile {
    path: PathBuf,
}

impl ReadyFile {
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Removes a stale readiness marker before startup.
    ///
    /// # Errors
    ///
    /// Returns an error when an existing marker cannot be removed.
    pub fn clear(&self) -> io::Result<()> {
        match fs::remove_file(&self.path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    /// Marks the Worker ready and returns a guard that removes the marker when
    /// the running Worker shuts down.
    ///
    /// # Errors
    ///
    /// Returns an error when the marker directory or file cannot be written.
    pub fn mark_ready(&self) -> io::Result<ReadyGuard> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&self.path, format!("{}\n", std::process::id()))?;
        Ok(ReadyGuard {
            path: self.path.clone(),
        })
    }

    /// Checks startup readiness and verifies that Chromium remains executable.
    ///
    /// # Errors
    ///
    /// Returns an error when the marker is missing, Chromium cannot be started,
    /// or its version command exits unsuccessfully.
    pub fn check(&self, chromium_path: &Path) -> Result<(), HealthError> {
        let process_id = fs::read_to_string(&self.path)
            .map_err(HealthError::NotReady)?
            .trim()
            .parse::<u32>()
            .map_err(|_| HealthError::InvalidProcessId)?;
        #[cfg(not(target_os = "linux"))]
        let _ = process_id;
        #[cfg(target_os = "linux")]
        if !Path::new("/proc").join(process_id.to_string()).exists() {
            return Err(HealthError::ProcessStopped(process_id));
        }
        let status = Command::new(chromium_path)
            .arg("--version")
            .status()
            .map_err(HealthError::ChromiumStart)?;
        if status.success() {
            Ok(())
        } else {
            Err(HealthError::ChromiumFailed(status))
        }
    }
}

#[derive(Debug)]
pub struct ReadyGuard {
    path: PathBuf,
}

impl Drop for ReadyGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{HealthError, ReadyFile};

    #[test]
    fn readiness_requires_the_marker_and_an_executable_chromium() {
        let directory = tempdir().expect("temporary directory");
        let marker = directory.path().join("worker-ready");
        let chromium = directory.path().join("chromium");
        fs::write(&chromium, "not executable").expect("fake Chromium");
        let ready = ReadyFile::new(&marker);

        assert!(matches!(
            ready.check(&chromium),
            Err(HealthError::NotReady(_))
        ));
        let _guard = ready.mark_ready().expect("mark ready");
        assert!(matches!(
            ready.check(&chromium),
            Err(HealthError::ChromiumStart(_))
        ));
    }

    #[test]
    fn drop_removes_the_readiness_marker() {
        let directory = tempdir().expect("temporary directory");
        let marker = directory.path().join("worker-ready");
        {
            let ready = ReadyFile::new(&marker);
            let _guard = ready.mark_ready().expect("mark ready");
            assert!(marker.exists());
        }
        assert!(!marker.exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn readiness_rejects_a_stale_worker_process() {
        let directory = tempdir().expect("temporary directory");
        let marker = directory.path().join("worker-ready");
        fs::write(&marker, "4294967295\n").expect("stale marker");

        assert!(matches!(
            ReadyFile::new(marker).check(std::path::Path::new("/bin/true")),
            Err(HealthError::ProcessStopped(4_294_967_295))
        ));
    }
}
