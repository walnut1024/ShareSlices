// cspell:ignore Deque
use std::{collections::BTreeSet, sync::Arc, time::Duration};

use async_trait::async_trait;
use serde::Serialize;
use thiserror::Error;
use tokio::{sync::watch, time::Instant};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunnerLane {
    ArtifactProcessing,
    Thumbnail,
    BundleAlias,
    GallerySafety,
    GalleryCover,
    GalleryCopy,
    Reconciliation,
    Cleanup,
    AuthenticationEmail,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaneRunOutcome {
    Claimed,
    Idle,
}

#[derive(Clone, Copy, Debug)]
pub struct ClaimPermit {
    pub wall_deadline: Option<Instant>,
}

impl ClaimPermit {
    #[must_use]
    pub fn remaining(self) -> Option<Duration> {
        self.wall_deadline
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
    }
}

#[async_trait(?Send)]
pub trait BackgroundLane: Send + Sync {
    fn lane(&self) -> RunnerLane;

    /// Claims and resolves at most one authoritative unit of work.
    ///
    /// Implementations own their existing `PostgreSQL` claim, heartbeat, fence,
    /// retry, and terminal-outcome contract. They must not begin a claim when
    /// the permit cannot cover the lane's configured termination reserve.
    async fn run_one(&self, permit: ClaimPermit) -> Result<LaneRunOutcome, RunnerError>;

    /// Read-only observation performed after the Runner stops claiming.
    async fn has_claimable_work(&self) -> Result<bool, RunnerError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunnerStopReason {
    Shutdown,
    ClaimLimit,
    Idle,
    WallDeadline,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerOutcome {
    pub claims: u64,
    pub idle_observations: u64,
    pub remaining_work: bool,
    pub stop_reason: RunnerStopReason,
}

#[derive(Clone, Copy, Debug)]
pub struct DrainLimits {
    pub maximum_claims: u64,
    pub maximum_idle_observations: u64,
    pub wall_deadline: Instant,
}

impl DrainLimits {
    /// Validates that every drain bound can terminate an execution.
    ///
    /// # Errors
    ///
    /// Returns [`RunnerError::InvalidLimits`] for zero limits or an expired
    /// deadline.
    pub fn validate(self) -> Result<Self, RunnerError> {
        if self.maximum_claims == 0 {
            return Err(RunnerError::InvalidLimits(
                "maximum claims must be positive",
            ));
        }
        if self.maximum_idle_observations == 0 {
            return Err(RunnerError::InvalidLimits(
                "maximum idle observations must be positive",
            ));
        }
        if self.wall_deadline <= Instant::now() {
            return Err(RunnerError::InvalidLimits(
                "wall deadline must be in the future",
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Error)]
pub enum RunnerError {
    #[error("invalid Runner limits: {0}")]
    InvalidLimits(&'static str),
    #[error("Runner lane {0:?} is duplicated")]
    DuplicateLane(RunnerLane),
    #[error("Runner has no enabled lanes")]
    NoEnabledLanes,
    #[error("Runner lane failed: {0}")]
    Lane(String),
}

pub struct Runner {
    lanes: Vec<Arc<dyn BackgroundLane>>,
    poll_interval: Duration,
}

impl Runner {
    /// Creates a Runner over exactly the enabled lane set.
    ///
    /// # Errors
    ///
    /// Returns an error when no lane is enabled or one lane has multiple
    /// implementations.
    pub fn new(
        lanes: impl IntoIterator<Item = Arc<dyn BackgroundLane>>,
        enabled: &BTreeSet<RunnerLane>,
        poll_interval: Duration,
    ) -> Result<Self, RunnerError> {
        let mut selected = lanes
            .into_iter()
            .filter(|lane| enabled.contains(&lane.lane()))
            .collect::<Vec<_>>();
        selected.sort_by_key(|lane| lane.lane());
        if selected.is_empty() {
            return Err(RunnerError::NoEnabledLanes);
        }
        for pair in selected.windows(2) {
            if pair[0].lane() == pair[1].lane() {
                return Err(RunnerError::DuplicateLane(pair[0].lane()));
            }
        }
        Ok(Self {
            lanes: selected,
            poll_interval,
        })
    }

    /// Runs selected lanes until shutdown while retaining resident polling.
    ///
    /// # Errors
    ///
    /// Returns the first lane or remaining-work observation failure.
    pub async fn run_resident(
        &self,
        mut shutdown: watch::Receiver<bool>,
        shutdown_grace: Duration,
    ) -> Result<RunnerOutcome, RunnerError> {
        let mut claims = 0;
        let mut idle_observations = 0;
        loop {
            if *shutdown.borrow() {
                return self
                    .outcome(claims, idle_observations, RunnerStopReason::Shutdown)
                    .await;
            }
            let mut pass_claims = 0;
            for lane in &self.lanes {
                if *shutdown.borrow() {
                    return self
                        .outcome(claims, idle_observations, RunnerStopReason::Shutdown)
                        .await;
                }
                let run = lane.run_one(ClaimPermit {
                    wall_deadline: None,
                });
                tokio::pin!(run);
                let lane_outcome = tokio::select! {
                    result = &mut run => result?,
                    changed = shutdown.changed() => {
                        if changed.is_err() || *shutdown.borrow() {
                            match tokio::time::timeout(shutdown_grace, &mut run).await {
                                Ok(result) => {
                                    let outcome = result?;
                                    if outcome == LaneRunOutcome::Claimed {
                                        claims += 1;
                                    }
                                    return self.outcome(
                                        claims,
                                        idle_observations,
                                        RunnerStopReason::Shutdown,
                                    ).await;
                                }
                                Err(_) => {
                                    return Ok(RunnerOutcome {
                                        claims,
                                        idle_observations,
                                        remaining_work: true,
                                        stop_reason: RunnerStopReason::Shutdown,
                                    });
                                }
                            }
                        }
                        continue;
                    }
                };
                if lane_outcome == LaneRunOutcome::Claimed {
                    claims += 1;
                    pass_claims += 1;
                }
            }
            if pass_claims == 0 {
                idle_observations += 1;
                tokio::select! {
                    () = tokio::time::sleep(self.poll_interval) => {}
                    changed = shutdown.changed() => {
                        if changed.is_err() || *shutdown.borrow() {
                            return self.outcome(
                                claims,
                                idle_observations,
                                RunnerStopReason::Shutdown,
                            ).await;
                        }
                    }
                }
            }
        }
    }

    /// Runs selected lanes within explicit claim, idle, and wall-clock bounds.
    ///
    /// # Errors
    ///
    /// Returns invalid limits or the first lane/observation failure.
    pub async fn run_drain(
        &self,
        limits: DrainLimits,
        mut shutdown: watch::Receiver<bool>,
    ) -> Result<RunnerOutcome, RunnerError> {
        let limits = limits.validate()?;
        let mut claims = 0;
        let mut idle_observations = 0;
        loop {
            let stop_reason = if *shutdown.borrow() {
                Some(RunnerStopReason::Shutdown)
            } else if claims >= limits.maximum_claims {
                Some(RunnerStopReason::ClaimLimit)
            } else if Instant::now() >= limits.wall_deadline {
                Some(RunnerStopReason::WallDeadline)
            } else if idle_observations >= limits.maximum_idle_observations {
                Some(RunnerStopReason::Idle)
            } else {
                None
            };
            if let Some(reason) = stop_reason {
                return self.outcome(claims, idle_observations, reason).await;
            }

            let mut pass_claims = 0;
            for lane in &self.lanes {
                if *shutdown.borrow()
                    || claims >= limits.maximum_claims
                    || Instant::now() >= limits.wall_deadline
                {
                    break;
                }
                let run = lane.run_one(ClaimPermit {
                    wall_deadline: Some(limits.wall_deadline),
                });
                let outcome = match tokio::time::timeout_at(limits.wall_deadline, run).await {
                    Ok(result) => result?,
                    Err(_) => {
                        return Ok(RunnerOutcome {
                            claims,
                            idle_observations,
                            remaining_work: true,
                            stop_reason: RunnerStopReason::WallDeadline,
                        });
                    }
                };
                if outcome == LaneRunOutcome::Claimed {
                    claims += 1;
                    pass_claims += 1;
                }
            }
            if pass_claims == 0 {
                idle_observations += 1;
                let until_deadline = limits
                    .wall_deadline
                    .saturating_duration_since(Instant::now());
                tokio::select! {
                    () = tokio::time::sleep(self.poll_interval.min(until_deadline)) => {}
                    _ = shutdown.changed() => {}
                }
            } else {
                idle_observations = 0;
            }
        }
    }

    async fn outcome(
        &self,
        claims: u64,
        idle_observations: u64,
        stop_reason: RunnerStopReason,
    ) -> Result<RunnerOutcome, RunnerError> {
        let mut remaining_work = false;
        for lane in &self.lanes {
            remaining_work |= lane.has_claimable_work().await?;
        }
        Ok(RunnerOutcome {
            claims,
            idle_observations,
            remaining_work,
            stop_reason,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::VecDeque, sync::Mutex};

    use super::*;

    struct FakeLane {
        lane: RunnerLane,
        outcomes: Mutex<VecDeque<LaneRunOutcome>>,
        calls: Mutex<Vec<ClaimPermit>>,
    }

    struct BlockingLane;

    #[async_trait(?Send)]
    impl BackgroundLane for BlockingLane {
        fn lane(&self) -> RunnerLane {
            RunnerLane::Cleanup
        }

        async fn run_one(&self, _permit: ClaimPermit) -> Result<LaneRunOutcome, RunnerError> {
            std::future::pending().await
        }

        async fn has_claimable_work(&self) -> Result<bool, RunnerError> {
            Ok(true)
        }
    }

    impl FakeLane {
        fn new(lane: RunnerLane, outcomes: impl IntoIterator<Item = LaneRunOutcome>) -> Self {
            Self {
                lane,
                outcomes: Mutex::new(outcomes.into_iter().collect()),
                calls: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait(?Send)]
    impl BackgroundLane for FakeLane {
        fn lane(&self) -> RunnerLane {
            self.lane
        }

        async fn run_one(&self, permit: ClaimPermit) -> Result<LaneRunOutcome, RunnerError> {
            self.calls.lock().expect("calls").push(permit);
            Ok(self
                .outcomes
                .lock()
                .expect("outcomes")
                .pop_front()
                .unwrap_or(LaneRunOutcome::Idle))
        }

        async fn has_claimable_work(&self) -> Result<bool, RunnerError> {
            Ok(self
                .outcomes
                .lock()
                .expect("outcomes")
                .iter()
                .any(|outcome| *outcome == LaneRunOutcome::Claimed))
        }
    }

    fn enabled(lanes: impl IntoIterator<Item = RunnerLane>) -> BTreeSet<RunnerLane> {
        lanes.into_iter().collect()
    }

    #[tokio::test]
    async fn drain_round_robins_selected_lanes_and_stops_at_claim_limit() {
        let processing = Arc::new(FakeLane::new(
            RunnerLane::ArtifactProcessing,
            [LaneRunOutcome::Claimed, LaneRunOutcome::Claimed],
        ));
        let thumbnail = Arc::new(FakeLane::new(
            RunnerLane::Thumbnail,
            [LaneRunOutcome::Claimed, LaneRunOutcome::Claimed],
        ));
        let runner = Runner::new(
            vec![
                processing.clone() as Arc<dyn BackgroundLane>,
                thumbnail.clone() as Arc<dyn BackgroundLane>,
            ],
            &enabled([RunnerLane::ArtifactProcessing, RunnerLane::Thumbnail]),
            Duration::from_millis(1),
        )
        .expect("runner");
        let (_sender, receiver) = watch::channel(false);
        let outcome = runner
            .run_drain(
                DrainLimits {
                    maximum_claims: 3,
                    maximum_idle_observations: 1,
                    wall_deadline: Instant::now() + Duration::from_secs(1),
                },
                receiver,
            )
            .await
            .expect("drain");

        assert_eq!(outcome.claims, 3);
        assert_eq!(outcome.stop_reason, RunnerStopReason::ClaimLimit);
        assert!(outcome.remaining_work);
        assert_eq!(processing.calls.lock().expect("calls").len(), 2);
        assert_eq!(thumbnail.calls.lock().expect("calls").len(), 1);
    }

    #[tokio::test]
    async fn drain_reports_idle_and_remaining_work_separately() {
        let lane = Arc::new(FakeLane::new(RunnerLane::Cleanup, [LaneRunOutcome::Idle]));
        let runner = Runner::new(
            vec![lane as Arc<dyn BackgroundLane>],
            &enabled([RunnerLane::Cleanup]),
            Duration::from_millis(1),
        )
        .expect("runner");
        let (_sender, receiver) = watch::channel(false);
        let outcome = runner
            .run_drain(
                DrainLimits {
                    maximum_claims: 2,
                    maximum_idle_observations: 1,
                    wall_deadline: Instant::now() + Duration::from_secs(1),
                },
                receiver,
            )
            .await
            .expect("drain");

        assert_eq!(outcome.stop_reason, RunnerStopReason::Idle);
        assert_eq!(outcome.idle_observations, 1);
        assert!(!outcome.remaining_work);
    }

    #[tokio::test]
    async fn shutdown_stops_new_claims_and_observes_remaining_work() {
        let lane = Arc::new(FakeLane::new(
            RunnerLane::ArtifactProcessing,
            [LaneRunOutcome::Claimed],
        ));
        let runner = Runner::new(
            vec![lane.clone() as Arc<dyn BackgroundLane>],
            &enabled([RunnerLane::ArtifactProcessing]),
            Duration::from_secs(1),
        )
        .expect("runner");
        let (sender, receiver) = watch::channel(false);
        sender.send_replace(true);
        let outcome = runner
            .run_resident(receiver, Duration::from_millis(10))
            .await
            .expect("resident");

        assert_eq!(outcome.claims, 0);
        assert_eq!(outcome.stop_reason, RunnerStopReason::Shutdown);
        assert!(outcome.remaining_work);
        assert!(lane.calls.lock().expect("calls").is_empty());
    }

    #[tokio::test]
    async fn resident_shutdown_bounds_an_in_flight_lane() {
        let runner = Runner::new(
            vec![Arc::new(BlockingLane) as Arc<dyn BackgroundLane>],
            &enabled([RunnerLane::Cleanup]),
            Duration::from_secs(1),
        )
        .expect("runner");
        let (sender, receiver) = watch::channel(false);
        let shutdown = async move {
            tokio::time::sleep(Duration::from_millis(5)).await;
            sender.send_replace(true);
        };
        let (outcome, ()) = tokio::join!(
            runner.run_resident(receiver, Duration::from_millis(10)),
            shutdown
        );
        let outcome = outcome.expect("resident");

        assert_eq!(outcome.stop_reason, RunnerStopReason::Shutdown);
        assert!(outcome.remaining_work);
    }

    #[tokio::test]
    async fn wall_deadline_cancels_an_in_flight_lane_and_reports_remaining_work() {
        let runner = Runner::new(
            vec![Arc::new(BlockingLane) as Arc<dyn BackgroundLane>],
            &enabled([RunnerLane::Cleanup]),
            Duration::from_millis(1),
        )
        .expect("runner");
        let (_sender, receiver) = watch::channel(false);
        let outcome = runner
            .run_drain(
                DrainLimits {
                    maximum_claims: 1,
                    maximum_idle_observations: 1,
                    wall_deadline: Instant::now() + Duration::from_millis(10),
                },
                receiver,
            )
            .await
            .expect("drain");

        assert_eq!(outcome.claims, 0);
        assert_eq!(outcome.stop_reason, RunnerStopReason::WallDeadline);
        assert!(outcome.remaining_work);
    }

    #[test]
    fn rejects_empty_duplicate_and_invalid_runner_configuration() {
        assert!(matches!(
            Runner::new(Vec::new(), &enabled([]), Duration::from_secs(1)),
            Err(RunnerError::NoEnabledLanes)
        ));
        let first = Arc::new(FakeLane::new(RunnerLane::Cleanup, []));
        let second = Arc::new(FakeLane::new(RunnerLane::Cleanup, []));
        assert!(matches!(
            Runner::new(
                vec![
                    first as Arc<dyn BackgroundLane>,
                    second as Arc<dyn BackgroundLane>
                ],
                &enabled([RunnerLane::Cleanup]),
                Duration::from_secs(1)
            ),
            Err(RunnerError::DuplicateLane(RunnerLane::Cleanup))
        ));
        assert!(matches!(
            DrainLimits {
                maximum_claims: 0,
                maximum_idle_observations: 1,
                wall_deadline: Instant::now() + Duration::from_secs(1),
            }
            .validate(),
            Err(RunnerError::InvalidLimits(_))
        ));
    }
}
