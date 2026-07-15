# Resumable Agent CLI protocol

## Why

The official Skill currently depends on command-specific output behavior and can widen an Upload-only request into Publish. The CLI also drops Server error, validation, and recovery facts that an agent needs to distinguish safe continuation, local remediation, user action, and an indeterminate result. ShareSlices needs one explicit, restartable machine contract before the Skill can safely orchestrate its complete supported CLI command surface.

## What Changes

- Add an opt-in global CLI Agent mode with local capability discovery, explicit protocol-version selection for operational invocations, one versioned JSON outcome envelope per invocation, no prompts or transient progress, and structured durable resources, errors, next actions, and authentication continuations. Existing human output and `--json`, `--jq`, and `--template` behavior remain separate and unchanged.
- Make browser authentication resumable in Agent mode: the CLI returns user authorization instructions and retains sensitive challenge state locally, while a later invocation checks or completes the same challenge. Authentication continuations never store or replay business commands.
- Preserve authoritative Server request, validation, retry, recovery, and resource facts through the HTTP and CLI boundaries. Complete the management API error contract where current OpenAPI types or declared responses omit facts already returned or newly required by Agent mode.
- Refactor the official Skill into a thin intent adapter that selects authorized local input, preserves Upload, Publish, and explicit management intent, invokes only the installed CLI Agent protocol, asks on material ambiguity or irreversible changes, and reports the structured result. It never parses human output or falls back to direct REST calls.
- Cover every command advertised by the official Skill before switching the Skill to Agent mode. Start implementation with authentication, high-level Publish, and state inspection, then extend the same protocol to Upload, Publication management, Export, and Delete.
- Version and run Skill-to-CLI behavioral and trigger evaluations, including Upload-only, Publish, ambiguous entry selection, partial outcomes, missing or outdated CLI, authentication, and irreversible operations.
- Release the additive Server/OpenAPI contract first, CLI `0.2.0` and its existing distribution channels second, and the platform-neutral Skill package last. The installer does not modify agent directories, and the Server minimum CLI version is not raised by this change.

## Capabilities

### New Capabilities

- `cli-agent-protocol`: Defines Agent-mode negotiation, the versioned outcome envelope, evidence preservation, standardized human actions, compatibility behavior, and authentication continuation handles across the official CLI command surface.
- `official-skill-orchestration`: Defines the official Skill's intent routing, local-input authority, CLI-only execution boundary, human-in-the-loop rules, structured result handling, compatibility checks, and evaluation contract.
- `management-api-error-contract`: Defines the language-neutral management API error evidence and OpenAPI coverage required for reliable CLI classification and recovery guidance.

### Modified Capabilities

- `cli-auth`: Adds non-blocking, resumable browser authorization semantics for Agent mode while preserving the existing human authentication flow.
- `cli-artifact-management`: Adds structured Agent-mode outcomes for high-level Publish and every Artifact management command advertised by the official Skill, including partial and indeterminate results.

## Impact

- Affected code: `api/openapi/`, management HTTP error mapping and contract tests, CLI command parsing, API/model mapping, outcome rendering, authentication state, and process-level tests.
- Affected agent integration: `skill/shareslices/`, its metadata, committed behavioral and trigger eval definitions, and Skill-to-CLI contract fixtures.
- Affected durable design: the Agent protocol ADR and the target Skill/CLI seam in `docs/design/modules.md`.
- Release impact: a new opt-in CLI protocol surface released as CLI `0.2.0`; existing human and field-selected JSON interfaces remain compatible.
- No product lifecycle, database schema, object-storage layout, or Viewer behavior changes.
