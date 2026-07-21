use std::{collections::BTreeSet, time::Duration};

use thiserror::Error;

use crate::runner::RunnerLane;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DrainCommand {
    pub lanes: BTreeSet<RunnerLane>,
    pub maximum_claims: u64,
    pub maximum_idle_observations: u64,
    pub wall_time: Duration,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum DrainCommandError {
    #[error("missing required drain option {0}")]
    Missing(&'static str),
    #[error("unknown drain option {0}")]
    UnknownOption(String),
    #[error("drain option {name} has an invalid value: {message}")]
    Invalid {
        name: &'static str,
        message: &'static str,
    },
}

impl DrainCommand {
    /// Parses the bounded drain command's required lane and termination bounds.
    ///
    /// # Errors
    ///
    /// Returns [`DrainCommandError`] when an option is missing, duplicated,
    /// unknown, or does not contain a supported positive value.
    pub fn parse(arguments: &[String]) -> Result<Self, DrainCommandError> {
        let mut lanes = None;
        let mut maximum_claims = None;
        let mut maximum_idle_observations = None;
        let mut wall_time = None;
        let mut index = 0;
        while index < arguments.len() {
            let option = arguments[index].as_str();
            let value = arguments
                .get(index + 1)
                .ok_or_else(|| DrainCommandError::UnknownOption(option.to_owned()))?;
            match option {
                "--lanes" => lanes = Some(parse_lanes(value)?),
                "--maximum-claims" => {
                    maximum_claims = Some(parse_positive("--maximum-claims", value)?);
                }
                "--maximum-idle-observations" => {
                    maximum_idle_observations =
                        Some(parse_positive("--maximum-idle-observations", value)?);
                }
                "--wall-time-seconds" => {
                    wall_time = Some(Duration::from_secs(parse_positive(
                        "--wall-time-seconds",
                        value,
                    )?));
                }
                _ => return Err(DrainCommandError::UnknownOption(option.to_owned())),
            }
            index += 2;
        }
        Ok(Self {
            lanes: lanes.ok_or(DrainCommandError::Missing("--lanes"))?,
            maximum_claims: maximum_claims.ok_or(DrainCommandError::Missing("--maximum-claims"))?,
            maximum_idle_observations: maximum_idle_observations
                .ok_or(DrainCommandError::Missing("--maximum-idle-observations"))?,
            wall_time: wall_time.ok_or(DrainCommandError::Missing("--wall-time-seconds"))?,
        })
    }
}

fn parse_lanes(value: &str) -> Result<BTreeSet<RunnerLane>, DrainCommandError> {
    let mut lanes = BTreeSet::new();
    for lane in value.split(',') {
        let parsed = match lane {
            "artifact-processing" => RunnerLane::ArtifactProcessing,
            "thumbnail" => RunnerLane::Thumbnail,
            "bundle-alias" => RunnerLane::BundleAlias,
            "gallery-safety" => RunnerLane::GallerySafety,
            "gallery-cover" => RunnerLane::GalleryCover,
            "gallery-copy" => RunnerLane::GalleryCopy,
            _ => {
                return Err(DrainCommandError::Invalid {
                    name: "--lanes",
                    message: "contains an unknown or unavailable lane",
                });
            }
        };
        if !lanes.insert(parsed) {
            return Err(DrainCommandError::Invalid {
                name: "--lanes",
                message: "must not contain duplicate lanes",
            });
        }
    }
    if lanes.is_empty() {
        return Err(DrainCommandError::Invalid {
            name: "--lanes",
            message: "must select at least one lane",
        });
    }
    Ok(lanes)
}

fn parse_positive(name: &'static str, value: &str) -> Result<u64, DrainCommandError> {
    value
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or(DrainCommandError::Invalid {
            name,
            message: "must be a positive integer",
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_required_bounds_and_selected_lanes() {
        let command = DrainCommand::parse(&arguments(&[
            "--lanes",
            "gallery-copy,artifact-processing",
            "--maximum-claims",
            "8",
            "--maximum-idle-observations",
            "2",
            "--wall-time-seconds",
            "30",
        ]))
        .expect("command");

        assert_eq!(command.maximum_claims, 8);
        assert_eq!(command.maximum_idle_observations, 2);
        assert_eq!(command.wall_time, Duration::from_secs(30));
        assert_eq!(
            command.lanes,
            BTreeSet::from([RunnerLane::ArtifactProcessing, RunnerLane::GalleryCopy])
        );
    }

    #[test]
    fn rejects_missing_zero_unknown_and_duplicate_inputs() {
        assert_eq!(
            DrainCommand::parse(&arguments(&[])),
            Err(DrainCommandError::Missing("--lanes"))
        );
        assert!(matches!(
            DrainCommand::parse(&arguments(&[
                "--lanes",
                "thumbnail",
                "--maximum-claims",
                "0"
            ])),
            Err(DrainCommandError::Invalid {
                name: "--maximum-claims",
                ..
            })
        ));
        assert!(matches!(
            parse_lanes("thumbnail,thumbnail"),
            Err(DrainCommandError::Invalid {
                name: "--lanes",
                ..
            })
        ));
        assert!(matches!(
            parse_lanes("authentication-email"),
            Err(DrainCommandError::Invalid {
                name: "--lanes",
                ..
            })
        ));
    }

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }
}
