# Web interface consistency specification

## MODIFIED Requirements

### Requirement: Preserve responsive interaction quality

The standardized presentation SHALL NOT introduce redundant network work, repeated unbounded background activity, or a material regression in the production assets and named management interactions measured by the checked Web performance harness. A client MAY perform bounded background reads only for a Server-accepted asynchronous operation that the current User explicitly initiated when no push result channel exists. Such monitoring MUST be scoped to the known operation resource, deduplicated, limited to one in-flight request per resource, paused while the document is hidden, use increasing delays, stop continuous timers at a checked bound, and terminate at a known terminal result. A later route entry or document-focus event MAY trigger one recovery read for a still-known accepted operation after that bound.

#### Scenario: Production assets are compared

- **WHEN** the completed Web application is built and compared with the pre-change build by the same checked harness
- **THEN** production JavaScript gzip growth does not exceed the larger of 1 percent or 5 KiB
- **AND** production CSS gzip growth does not exceed the larger of 2 percent or 2 KiB

#### Scenario: Named interactions are measured

- **WHEN** the named management interactions are replayed after the presentation change with fixed fixtures, browser, viewport, and measurement boundaries
- **THEN** their deterministic request counts match the locked workflow expectations
- **AND** the evidence explicitly identifies any interaction timing for which no valid pre-change capture exists instead of inventing a comparison baseline

#### Scenario: Affected workflows are replayed

- **WHEN** affected browser workflows run after the presentation change
- **THEN** deterministic request counts match the checked workflow contract, no duplicate request occurs, and no unbounded background polling is introduced

#### Scenario: Accepted Gallery share awaits an asynchronous result

- **WHEN** a User explicitly completes Share to Gallery and the accepted listing remains non-terminal
- **THEN** the Web runs at most one visibility-aware bounded monitor for that Artifact, increases its delay, prevents overlapping reads, and stops continuous monitoring at the checked time bound or a terminal result

#### Scenario: User returns after the active monitoring bound

- **WHEN** an accepted Gallery share remains unresolved after continuous monitoring stops and the User later focuses or re-enters authenticated management
- **THEN** the Web performs at most one deduplicated recovery read for that known operation without restarting an unbounded timer
