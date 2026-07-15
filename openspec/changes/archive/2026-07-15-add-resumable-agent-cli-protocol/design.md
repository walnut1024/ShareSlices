# Resumable Agent CLI protocol design

## Context

The official ShareSlices Skill currently shells out to command-specific CLI surfaces, but the high-level Publish command has no stable machine result and the Skill's default workflow can turn an Upload-only request into Publish. Resource commands expose selected JSON, yet that format represents resource fields rather than a complete command outcome. It cannot consistently express accepted work, partial completion, an indeterminate mutation, a required human action, or resumable authentication.

The HTTP boundary already returns useful facts such as stable error codes, request identifiers, validation reports, recoverability, and allowed actions. The CLI currently discards part of that evidence, and the checked OpenAPI document does not describe every shape or response that the Server emits. The Skill therefore cannot safely decide whether to inspect state, retry, repair local input, ask the user, or stop.

This change crosses the Server/OpenAPI, Rust CLI, and official Skill boundaries. It must preserve existing human-facing CLI behavior, keep the Server authoritative for product state, work across agent runtimes without a long-lived process, and avoid storing business commands or local content in a continuation.

## Goals / Non-Goals

**Goals:**

- Give agents one explicit, versioned, non-interactive CLI contract for every command advertised by the official Skill.
- Preserve enough authoritative evidence to distinguish completed, in-progress, partial, action-required, failed, indeterminate, and cancelled outcomes.
- Make browser authorization restartable across process invocations without exposing sensitive challenge state.
- Keep the official Skill thin: local intent and input selection in the Skill, packaging and command execution in the CLI, and product state in the Server.
- Make human-in-the-loop boundaries explicit and testable.
- Roll out additively without changing existing human output, selected-field JSON, or the Server minimum CLI version.

**Non-Goals:**

- Changing Artifact, Version, Publication, Upload, Viewer, or access-policy semantics.
- Giving the Skill a direct REST, database, object-storage, or product-state implementation.
- Letting the CLI persist or replay an interrupted business command.
- Automatically installing or upgrading the CLI, or having the CLI installer write into agent directories.
- Creating an independent Skill distribution workflow in this change.
- Raising the minimum CLI version accepted by the Server.

## Decisions

### 1. Add a separate global Agent mode

The CLI will add an explicit global `--agent` mode. It will conflict with `--json`, `--jq`, and `--template`, because those flags transform resource presentation while Agent mode describes the entire invocation. `--no-progress` may remain accepted as a compatibility no-op. Without `--agent`, current human output, prompts, progress, resource JSON, and authentication behavior remain unchanged.

Agent mode will:

- never read an interactive answer from stdin;
- suppress CLI-controlled transient progress and diagnostics;
- write exactly one JSON object to stdout for every completed invocation;
- use the envelope outcome, rather than display text or exit code alone, as the semantic result.

This is preferable to overloading selected-field JSON because it preserves that existing interface and gives high-level orchestration, errors, and continuations one common boundary.

### 2. Negotiate a protocol independently of CLI SemVer

`shareslices --agent capabilities` will be a local, no-authentication, no-network probe with a permanently additive version 1 discovery shape. Its result will report the CLI SemVer, supported Agent protocol versions, current protocol version, supported operations, outcome values, action kinds, and the Agent processing-wait budget. After choosing a mutually supported version, the caller must pass `--agent-protocol <version>` on each operational Agent invocation. The first protocol version is integer `1` and is independent of the CLI release version.

Protocol v1 permits additive optional fields and new stable error codes. Removing a field, changing a field type, changing an existing outcome's meaning, or making an optional field required requires a new protocol version. The CLI rejects an unadvertised `--agent-protocol` value locally before authentication or network access. A Skill that cannot consume any advertised version must fail closed and tell the user how to install or upgrade a compatible CLI; it must not parse human output as a fallback.

### 3. Use one common envelope with operation-specific data

Every Agent-mode invocation will emit a common envelope with these logical fields:

```json
{
  "protocolVersion": 1,
  "cliVersion": "0.2.0",
  "operation": "artifact.publish_local",
  "outcome": "completed",
  "resources": {},
  "data": {},
  "error": null,
  "nextAction": null,
  "continuation": null
}
```

- `operation` is a stable command operation identifier, not raw argv.
- `resources` contains only durable or Server-accepted resources known to exist, including the relevant Artifact, Upload session, Version, Publication, or Share link.
- `data` contains operation-specific non-resource results.
- `error` preserves the stable code, sanitized message, request ID, field errors, typed details, validation report, recoverability, allowed actions, and retry timing that are actually known.
- `nextAction` contains one command-aware action, its stable kind, a user-facing instruction, and only the structured parameters needed to perform or explain it.
- `continuation` exists only for resumable authentication and contains a non-sensitive opaque identifier, expiry, and the earliest useful check time.

Capabilities advertise one `processingWaitSeconds` value from 1 through 30. After the Server accepts an Upload, Agent-mode Upload and high-level Publish use exactly that budget while checking processing state, then return `in_progress` if the work is still active. The budget is not caller-configurable in protocol version 1, which keeps execution predictable without adding another policy surface.

The envelope outcomes are:

- `completed`: the requested operation reached its requested terminal state;
- `in_progress`: accepted Server work exists but has not reached a terminal state;
- `partial`: durable requested work exists, but a later stage of the compound operation did not complete;
- `action_required`: a human decision or action is required before the operation can continue;
- `failed`: the operation is known not to have completed as requested;
- `indeterminate`: the CLI cannot prove whether a transmitted mutation took effect;
- `cancelled`: the user or caller cancelled before the requested mutation completed.

Exit codes remain coarse: `0` for `completed`, `2` for `cancelled`, `4` for `action_required`, and `1` for the other outcomes. Tests will consume both, but only the envelope carries detailed semantics.

A checked JSON Schema and golden fixtures will define the common envelope and each operation's stable resource and data projections. Agent mode will not expose credentials, cookies, raw authorization codes, local content, or object-storage locations.

### 4. Separate authoritative facts from orchestration advice

The Server remains authoritative for request IDs, error codes, field errors, limits, validation results, recoverability, allowed product actions, retry timing, and resource state. The HTTP error body will keep the common `code`, `message`, and `requestId` fields and use optional language-neutral `action`, `fields`, and typed `details` shapes. Known retry timing will be exposed consistently; unknown timing will be omitted rather than guessed.

The CLI will preserve those facts and add command-aware `nextAction` guidance. The API will not return CLI-specific commands or Skill-specific next actions. The Skill may combine the CLI result only with the user's intent and authorized local workspace evidence.

The OpenAPI contract and response-contract tests will be brought into line with actual management behavior, including CLI compatibility errors, typed validation and compatibility details, request IDs, field errors, and the complete allowed-action vocabulary. Descriptive drift that incorrectly says Upload creates a Share link will also be corrected.

### 5. Standardize actions that require a person

`nextAction.kind` will use this closed v1 set:

- `authorize`
- `resolve_ambiguity`
- `confirm_irreversible`
- `install_or_upgrade`
- `change_local_input`
- `inspect_state`
- `retry_later`
- `contact_support`

An explicit Publish or Unpublish request does not require a redundant confirmation. Permanent Delete and Share-link replacement require confirmation. If a name is missing, one obvious input may produce a mutable suggested Artifact name that the agent tells the user; combined inputs or a potentially misleading name require user direction. The CLI may choose an Entry file only when deterministic rules find one unique candidate; multiple plausible business entries require `resolve_ambiguity` before Upload or Publish.

### 6. Resume authentication, not business commands

Human `shareslices auth login` retains its current browser-opening and polling behavior. In Agent mode:

1. `auth login` validates an existing credential. If valid, it returns `completed` without creating a challenge.
2. Otherwise it creates or reuses the one active authorization challenge for the normalized API origin, stores sensitive challenge state under CLI control, and returns `action_required` with verification instructions and an opaque continuation ID. It does not open a browser or wait.
3. `auth login --continue <id>` performs one bounded status or exchange attempt. Pending authorization returns the same `action_required` continuation and retry timing; approval stores the credential before returning `completed`; denial, expiry, or an invalid continuation returns a stable failure.

The continuation record is origin-bound and contains only the authorization protocol state, timestamps, and a record schema version. It never contains access credentials, argv, cwd, local paths, Artifact content, a business operation, or an irreversible confirmation. Sensitive device authorization values live in a private application-state location with restrictive operating-system permissions and atomic writes. External continuation IDs are random and reveal no device code. Terminal records are stripped of sensitive values immediately and deleted no later than one hour after the original authorization expiry.

Concurrent starts for one API origin reuse the active challenge. A continuation check uses an exclusive claim so only one process exchanges an approved code. Credentials remain in the operating-system credential store. After authentication completes, the Skill reruns the original business operation from its own current intent and workspace context; the CLI does not replay it.

### 7. Keep the official Skill as an intent adapter

The repository will continue to ship one ShareSlices Skill. Its common path is publishing local static content, while Upload-only, state inspection, Publication management, Export, and Delete are selected only from explicit user intent.

The Skill will:

- inspect only the local inputs authorized by the user's request;
- use the local capabilities probe before relying on Agent protocol v1;
- use high-level Publish for Publish intent, stepwise Upload for Upload-only intent, and the matching resource command for explicit management intent;
- consume only Agent envelopes and invoke only the installed CLI;
- present exact human actions and resume after authorization or clarification;
- summarize confirmed durable resources and clearly distinguish partial or indeterminate work.

The Skill will not copy CLI syntax tables, product lifecycle rules, HTTP calls, packaging logic, validation, retry policy, or Server state machines. It will not edit Artifact content. A surrounding agent may inspect, build, or deterministically repair local input only when the original request already authorizes that work and the repair does not materially change intended content. Material content changes, multiple plausible inputs or targets, secret exposure risk, and irreversible operations require user direction. Contract-declared read-only inspection and safe retries do not.

The Skill will switch to Agent mode only after the CLI implements every command that the Skill advertises. There is no mixed mode in which unsupported commands fall back to human output parsing.

### 8. Treat Skill behavior as a tested integration contract

Versioned evaluation definitions will live beside the Skill; generated run output will not be committed. A fake CLI will capture argv and environment and return fixed envelopes so evaluations cannot create real Publications.

The first iteration compares the revised Skill with a snapshot of the current Skill on three cases: Upload-only, high-level Publish, and ambiguous Entry selection. It then expands to eight to ten behavior scenarios covering authentication, missing or old CLI, new Version Upload, Publication state and mutation, Export, Delete or link replacement, partial Publish, indeterminate mutation, and local-input repair boundaries. Twenty balanced trigger cases will cover ShareSlices intents and near misses such as deployment, local builds, archive creation, CLI development, Server debugging, and direct REST integrations. Safety assertions for unintended Publish, Delete, Share-link replacement, content selection or modification, secret exposure, direct REST use, human-output fallback, and unsupported success claims must pass 100%; aggregate quality scores cannot offset a safety failure.

### 9. Roll out from the authoritative boundary outward

Implementation order is:

1. Land schemas, fixtures, OpenAPI corrections, and API contract tests.
2. Add the CLI protocol core and tracer flows for capabilities, authentication, high-level Publish, and state inspection.
3. Extend Agent mode to every command advertised by the Skill and pass process-level outcome, partial, indeterminate, and authentication tests.
4. Refactor the Skill, complete its evaluations, and pass every repository and protocol release gate.

Release order after those gates pass is:

1. Deploy the additive Server/OpenAPI behavior while retaining compatibility with existing CLIs.
2. Release CLI `0.2.0`, then verify the existing installers, GitHub Release assets, and Homebrew channel resolve that version.
3. Publish the platform-neutral revised Skill and its evaluation definitions only after every safety assertion passes. The installer remains unaware of agent directories.

The Server minimum CLI version stays unchanged. Rollback is additive: Server fields may remain, human CLI behavior is unaffected, and the revised Skill can be withheld or rolled back without asking an older CLI to emulate Agent mode. The Skill must stop with an upgrade action when the protocol is unavailable rather than silently changing execution strategy.

## Risks / Trade-offs

- **[Protocol becomes a long-lived compatibility surface]** → Keep a small common envelope, publish a checked schema and fixtures, negotiate versions locally, and require a version bump for semantic breakage.
- **[Partial or indeterminate mutations lead to duplicate work]** → Preserve every known durable resource and idempotency fact, map uncertainty to state inspection, and never blindly retry a mutation whose result cannot be proved.
- **[Authentication continuation leaks sensitive state]** → Expose only an opaque handle, bind it to one API origin, use private atomic storage, serialize exchange, and never persist business intent or credentials in the continuation record.
- **[Skill and CLI releases become temporarily incompatible]** → Release and verify CLI `0.2.0` before the Skill, probe capabilities at runtime, and fail closed without text parsing.
- **[Machine output regresses human CLI behavior]** → Keep Agent mode opt-in and add regression tests for all existing non-Agent output and authentication flows.
- **[Action guidance drifts from Server truth]** → Keep product facts in the API, centralize command-aware mapping in the CLI, and test error fixtures across API, CLI, and Skill boundaries.
- **[Evaluation success hides a destructive edge case]** → Make safety cases hard gates at 100% and commit prompts and assertions rather than only aggregate scores.

## Migration Plan

The change is additive and requires no data migration. Server/OpenAPI corrections land first, followed by CLI `0.2.0`. The existing Skill remains published until full Agent-mode command coverage and distribution checks pass. The revised Skill then requires protocol v1 and provides an install-or-upgrade action for older CLIs. Existing human commands and resource JSON remain supported throughout.

If a release must be rolled back, stop or revert the Skill distribution first, then the CLI release if necessary. Additive Server fields and declarations can remain without affecting older clients. No rollback step enables human-output parsing or lowers validation.

## Open Questions

None. The remaining schema field names and per-operation projections are implementation details constrained by these decisions, the canonical operation identifiers, and the delta specifications; they must be fixed in checked schemas and fixtures before command implementation.
