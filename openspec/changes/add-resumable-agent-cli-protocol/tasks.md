# Resumable Agent CLI protocol implementation tasks

## 1. Lock the Agent protocol contract

- [ ] 1.1 Add a checked Agent protocol v1 JSON Schema covering capabilities, the common envelope, seven outcomes, eight next-action kinds, resource projections, errors, and authentication continuations.
- [ ] 1.2 Add reviewed golden fixtures for every outcome and next-action kind, including partial high-level Publish, indeterminate mutation, and pending authorization.
- [ ] 1.3 Add schema-compatibility tests proving additive optional v1 fields pass while removed, renamed, retyped, or newly required fields fail.
- [ ] 1.4 Define one stable operation registry for capabilities and the complete official Skill command surface.

## 2. Complete the Management API error contract

- [ ] 2.1 Add failing API contract fixtures for matching body/header request IDs, field errors, typed detail families, retry timing, compatibility failures, and sensitive-data exclusions.
- [ ] 2.2 Split OpenAPI error details into checked validation, CLI compatibility, request-field, size-limit, and other code-specific schemas instead of the current validation-only shape.
- [ ] 2.3 Declare `X-Request-Id`, actual Bearer-route `426 cli_upgrade_required` responses, the complete `allowedActions` vocabulary, and every implemented management error response in OpenAPI.
- [ ] 2.4 Correct OpenAPI descriptions and examples that imply Upload creates a Share link or otherwise disagree with current Artifact and Publication behavior.
- [ ] 2.5 Return bounded structured field errors for known invalid Artifact requests while preserving ownership and authentication neutrality.
- [ ] 2.6 Return `Retry-After` only for Server-owned meaningful delays and keep retry permission out of the HTTP contract.
- [ ] 2.7 Validate implemented 400, 401, 403 or neutral 404, 409, 413, 426, 429, and 500 management responses against the checked OpenAPI schemas.
- [ ] 2.8 Run `mise run api-test` and resolve every error-contract or OpenAPI drift failure without weakening validation.

## 3. Build the CLI Agent protocol core

- [ ] 3.1 Introduce typed internal command outcomes so command execution is separated from human, selected-field JSON, and Agent rendering.
- [ ] 3.2 Add the global `--agent` and operational `--agent-protocol <version>` parser paths, reject conflicting or unsupported presentation and protocol flags, disable prompts and transient progress, and render one JSON document for CLI-controlled usage and execution results.
- [ ] 3.3 Implement offline, unauthenticated `shareslices --agent capabilities` from the stable operation registry, advertise the fixed processing-wait budget, and test that discovery performs no network or credential-store access.
- [ ] 3.4 Preserve Server request IDs, error actions, fields, typed details, retry timing, validation reports, recoverability, allowed actions, and durable resource state in CLI API and model types.
- [ ] 3.5 Implement one command-aware next-action mapper for all eight v1 action kinds without branching on human-readable Server messages.
- [ ] 3.6 Validate every rendered Agent result against the checked v1 schema and assert that process exit codes match the documented coarse outcome mapping.
- [ ] 3.7 Add regression tests proving invocations without `--agent` retain current stdout, stderr, prompts, progress, `--json`, `--jq`, `--template`, help, version, and exit behavior.

## 4. Make Agent authentication resumable

- [ ] 4.1 Add a versioned authentication-continuation store Interface with an in-memory test Adapter and a private atomic operating-system state Adapter scoped by normalized API origin.
- [ ] 4.2 Store only authorization protocol state, expose only opaque continuation IDs, strip terminal secrets, enforce deletion no later than one hour after original expiry, and add negative tests for credentials, argv, cwd, local paths, Artifact content, and confirmations.
- [ ] 4.3 Implement Agent login start and reuse semantics so one active challenge exists per API origin and the command returns authorization instructions without opening a browser or polling.
- [ ] 4.4 Implement one-check `auth login --continue` handling for pending, too-early, slow-down, approved, denied, expired, invalid-origin, consumed, and credential-store-failure outcomes.
- [ ] 4.5 Add inter-process claim and terminal-marker behavior that prevents concurrent starts or continuation checks from creating duplicate challenges or CLI Sessions.
- [ ] 4.6 Implement Agent status and logout outcomes, including signed-out authorization guidance, idempotent already-signed-out logout, and credential retention after transient revocation failure.
- [ ] 4.7 Add process-level tests proving human login still opens and polls, Agent login never blocks, and authentication continuation never stores or replays a business command.

## 5. Cover the official Artifact command surface

- [ ] 5.1 Implement fixed Agent projections for Artifact list and Publication state inspection with processing, Publication, validation, recovery, and allowed-action evidence.
- [ ] 5.2 Implement Agent Upload outcomes for completed ready Version, bounded in-progress processing, terminal validation failure, cancellation after acceptance, and indeterminate acceptance.
- [ ] 5.3 Refactor high-level Publish to emit one final Agent envelope and classify completed, in-progress, partial, failed, cancelled, and indeterminate stages without losing known Artifact, Upload-session, Version, Publication, or Share-link resources.
- [ ] 5.4 Implement Agent outcomes for stepwise Publish, Unpublish, Publication view, and Publication edit, including confirmed rejection versus indeterminate mutation.
- [ ] 5.5 Implement Agent outcomes for atomic Export and permanent Delete, including exact output evidence and no automatic retry after an indeterminate Delete.
- [ ] 5.6 Return `confirm_irreversible` before Delete or Share-link replacement without current confirmation, while avoiding redundant confirmation for explicit Publish and Unpublish.
- [ ] 5.7 Add state-inspection tests proving an indeterminate mutation is inspected before any later replay and a proved completed state is not mutated again.
- [ ] 5.8 Add a parser-to-capabilities matrix test and process fixtures for every advertised command, outcome class, exit code, empty CLI-controlled stderr, and non-interactive boundary.
- [ ] 5.9 Run `mise run cli-test` and `mise run rust-check` and resolve every Agent, human-compatibility, formatting, lint, and Rust test failure.

## 6. Refactor and evaluate the official Skill

- [ ] 6.1 Snapshot the current official Skill and add a fake CLI harness that captures argv and environment and returns fixed v1 envelopes without contacting a live Server.
- [ ] 6.2 Commit the first three candidate-versus-snapshot behavior evaluations for Upload-only, explicit high-level Publish, and ambiguous Entry selection with hard safety assertions.
- [ ] 6.3 Rewrite `skill/shareslices/SKILL.md` as a thin intent adapter, align `agents/openai.yaml`, preserve Upload versus Publish intent, and use installed CLI capabilities and help without duplicating lifecycle, validation, retry, or REST behavior.
- [ ] 6.4 Add Skill-to-CLI contract assertions for capability probing, exact operation selection, non-interactive Agent mode, no human-output parsing, no selected-field JSON fallback, no direct REST, and no implicit Publish.
- [ ] 6.5 Pass the three first-round evaluations with 100% safety compliance, then retain only reviewed prompts and assertions rather than generated run output.
- [ ] 6.6 Expand behavior evaluations to eight through ten cases covering existing-Artifact Upload, authentication, missing or outdated CLI, Publication management, Export, Delete or link replacement, partial and indeterminate outcomes, and local-repair authority.
- [ ] 6.7 Add twenty balanced trigger evaluations covering ShareSlices operations and near misses such as deployment, local builds, archive creation, direct API integration, CLI development, and Server debugging.
- [ ] 6.8 Produce and validate one platform-neutral Skill package that contains no installer side effects or agent-directory mutation and is not activated before the CLI release gate.

## 7. Prepare documentation and pass release gates

- [ ] 7.1 Update CLI help, command tests, README, protocol compatibility notes, and release metadata for the new opt-in Agent interface and CLI version `0.2.0`.
- [ ] 7.2 Update `docs/design/modules.md` from target to current after code, command coverage, and evaluations match the implementation; keep the accepted ADR as the compatibility rationale.
- [ ] 7.3 Run `mise run api-test`, `mise run cli-test`, and `mise run rust-check` on the integrated implementation.
- [ ] 7.4 Run the committed Skill behavior, Skill-to-CLI contract, and trigger evaluation suites with every safety assertion passing.
- [ ] 7.5 Run `mise run check` and resolve every in-scope quality-gate failure without weakening repository policy.
- [ ] 7.6 Run strict OpenSpec validation for this change and all active specifications, then confirm every implemented requirement has an observable passing test or evaluation.

## 8. Perform the human-authorized rollout

- [ ] 8.1 After every task in section 7 passes, prepare additive Server/OpenAPI deployment evidence and have a human authorize the external deployment before changing shared environments; verify an older supported human CLI remains accepted afterward.
- [ ] 8.2 After task 8.1 passes, prepare CLI `0.2.0` release artifacts and have a human authorize publication; then verify the installed version from every existing installer, GitHub Release asset, and Homebrew channel.
- [ ] 8.3 Activate or distribute the platform-neutral revised Skill only after task 8.2 and every 100% safety gate pass; do not add an independent Skill release workflow or raise the Server minimum CLI version in this change.
- [ ] 8.4 Create a local follow-up issue under `.scratch/` for an independent Skill release workflow if one is still desired after the manual release is proven.
