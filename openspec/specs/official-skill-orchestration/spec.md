# official-skill-orchestration Specification

## Purpose

TBD - created by archiving change add-resumable-agent-cli-protocol. Update Purpose after archive.

## Requirements

### Requirement: Route one explicit user intent through one official Skill

ShareSlices SHALL distribute one official Skill whose primary paths publish local content to a Share link or manage an explicitly requested Gallery listing. The same Skill SHALL support Upload-only, read-only inspection, and explicit Artifact management requests. It MUST preserve the user's selected channel and MUST NOT widen a read, Upload, Export, Publish, Unpublish, Gallery, or management request into another mutation or public channel.

#### Scenario: User requests Upload without public sharing

- **WHEN** the user asks to Upload local content or create a new Version without requesting a Share link or Gallery
- **THEN** the Skill invokes the Agent-mode Upload operation and invokes neither Publish nor Gallery share

#### Scenario: User requests a Share link for local content

- **WHEN** the user explicitly asks to Share with link or Publish selected local content through ShareSlices
- **THEN** the Skill invokes high-level Agent-mode Publish and reports a Share link only when a completed outcome returns it

#### Scenario: User requests Share to Gallery

- **WHEN** the user explicitly asks to Share a ready Artifact Version to Gallery and supplies or confirms the material Gallery choices
- **THEN** the Skill invokes only Agent-mode Gallery share and does not create or change a Publication or Share link

#### Scenario: User requests a Gallery management change

- **WHEN** the user explicitly asks to inspect, update, or withdraw an owned Gallery listing with all material decisions supplied
- **THEN** the Skill invokes only the corresponding Gallery view, update, or withdraw operation

#### Scenario: User says only Share

- **WHEN** the user asks to Share but context does not determine whether they mean Share with link or Share to Gallery
- **THEN** the Skill asks which public channel they intend and performs no mutation

#### Scenario: User requests inspection only

- **WHEN** the user asks to list Artifacts or inspect Publication or Gallery state
- **THEN** the Skill invokes only the corresponding read operation and does not mutate local or Server state

#### Scenario: User explicitly requests another management change

- **WHEN** the user explicitly requests Publish, Unpublish, Publication editing, Export, or another supported management operation with all material decisions supplied
- **THEN** the Skill invokes only that operation without a redundant confirmation unless it permanently deletes an Artifact, replaces a Share link, or withdraws a Gallery listing

#### Scenario: Delete intent is not explicit

- **WHEN** the user asks to clean up, replace, or otherwise manage content without explicitly requesting permanent Artifact deletion
- **THEN** the Skill does not infer or invoke Delete

### Requirement: Resolve only non-material ambiguity automatically

The Skill MAY resolve uncertainty automatically only when the resolution is deterministic, remains within the user's authorized workspace and selected scope, and does not change the intended operation, selected content, remote target, externally visible result, or reversibility. It SHALL ask the user before resolving any material ambiguity.

#### Scenario: One obvious input lacks an Artifact name

- **WHEN** the user authorizes one unambiguous local input and omits an Artifact name
- **THEN** the Skill may derive a mutable name from that input, tell the user which name it used, and continue

#### Scenario: Combined inputs make the name misleading

- **WHEN** multiple selected inputs or workspace context make more than one Artifact name plausible
- **THEN** the Skill asks the user for the name before invoking Upload or Publish

#### Scenario: Multiple plausible entry files exist

- **WHEN** selected content contains multiple plausible business Entry files whose choice changes the rendered Artifact
- **THEN** the Skill asks the user to choose before invoking Upload or Publish

#### Scenario: CLI resolves one deterministic entry

- **WHEN** the selected content and installed CLI contract identify exactly one Entry file without changing selected content
- **THEN** the Skill may accept the CLI's deterministic selection without asking the user

#### Scenario: Existing Artifact target is ambiguous

- **WHEN** a new-Version Upload or management request could apply to more than one Artifact or Version
- **THEN** the Skill asks the user to choose and does not depend on an interactive CLI selector

#### Scenario: User explicitly requests Publish or Unpublish

- **WHEN** the user supplies a complete, explicit Publish or Unpublish intent
- **THEN** the Skill executes it without a second confirmation

#### Scenario: User has not confirmed permanent deletion

- **WHEN** the user requests Artifact deletion but has not affirmatively confirmed the irreversible deletion in the current task
- **THEN** the Skill asks for confirmation and performs no Delete

#### Scenario: User has not confirmed Share-link replacement

- **WHEN** the user requests replacement of an existing Share link but has not affirmatively confirmed that the old link will permanently stop working
- **THEN** the Skill asks for confirmation and performs no link replacement

### Requirement: Preserve local-content authority and integrity

The Skill SHALL inspect and select only paths authorized by the user's request and SHALL preserve the selected content boundary. It MUST NOT add unselected sibling files, credentials, environment files, private keys, or unrelated output. The Skill itself MUST NOT edit Artifact content to satisfy packaging, Upload, or Server validation.

A surrounding agent MAY inspect, build, or perform a deterministic local repair only when the original request already authorizes that work, the result preserves the user's selected-content intent, and the work does not bypass CLI or Server validation. A material content change requires user direction.

#### Scenario: Selection contains a likely secret

- **WHEN** selected input includes a credential, environment file, private key, or another likely secret
- **THEN** the Skill stops before invoking the CLI and identifies the risky input without publishing it

#### Scenario: Validation remediation changes content

- **WHEN** CLI or Server validation fails and remediation would rewrite HTML, assets, links, or other Artifact content
- **THEN** the Skill reports the evidence and does not modify or silently exclude content

#### Scenario: Deterministic prerequisite is already authorized

- **WHEN** an authorized repository has one documented build or path-resolution step that produces the already requested input without changing intent
- **THEN** the surrounding agent may perform that step and retry the same authorized ShareSlices operation

### Requirement: Use only the installed CLI Agent protocol

Before an operational command, the Skill SHALL locate the installed `shareslices` executable and negotiate its advertised Agent capabilities. After migration, every operational invocation MUST explicitly select a mutually supported Agent protocol version, consume exactly one outcome envelope, and use installed CLI help as the command-syntax authority.

The Skill MUST NOT parse human-readable command results, use selected-field `--json` as a fallback, depend on interactive CLI prompts, issue direct REST requests, or duplicate lifecycle, packaging, validation, retry, or Server-state rules.

#### Scenario: Installed CLI supports the requested operation

- **WHEN** capability discovery reports Agent protocol version 1 and the requested operation
- **THEN** the Skill invokes that operation with `--agent-protocol 1` and consumes exactly one version 1 outcome envelope

#### Scenario: CLI is missing

- **WHEN** `shareslices` is not installed or cannot be located
- **THEN** the Skill identifies the missing executable, gives applicable official installation guidance, does not install it automatically, and performs no ShareSlices operation

#### Scenario: CLI is incompatible

- **WHEN** the installed CLI does not advertise Agent protocol version 1 or does not advertise the requested operation
- **THEN** the Skill reports the installed capability, the required capability, and applicable official upgrade guidance without using text-result, selected-field JSON, or REST fallback

#### Scenario: Advertised command coverage is incomplete

- **WHEN** release validation finds any command advertised by the Skill without a version 1 Agent outcome
- **THEN** the Agent-mode Skill package is not released or activated

### Requirement: Follow structured human actions without replaying unintended work

The Skill SHALL present the CLI's structured human action with an exact, concise instruction and SHALL preserve the original operation boundary while waiting. Authentication is the only version 1 continuation: the Skill MAY pass its opaque continuation back to the CLI to check authorization, but the continuation MUST NOT store or replay the business command.

The Skill MAY perform contract-declared read-only state inspection or a safe retry when it remains inside the original authorization. It MUST NOT blindly repeat an indeterminate mutation or continue when a new material decision is required.

#### Scenario: Browser authentication is required

- **WHEN** an Agent outcome returns `action_required` with an `authorize` action and authentication continuation
- **THEN** the Skill presents the verification instructions without exposing secrets and uses that continuation only to check authorization

#### Scenario: Authentication completes

- **WHEN** the authentication continuation returns a completed outcome
- **THEN** the Skill may invoke the original still-authorized business operation once from current user intent and workspace context

#### Scenario: Read-only inspection is required

- **WHEN** an outcome returns `inspect_state` after a partial or indeterminate operation
- **THEN** the Skill performs only the declared read operation and does not repeat the mutation until evidence makes that safe

#### Scenario: Outcome requires a new material decision

- **WHEN** an outcome requires another Artifact, Version, Entry file, irreversible confirmation, or externally visible policy choice
- **THEN** the Skill asks the user before continuing

### Requirement: Report only evidenced durable outcomes

The Skill SHALL derive an operational result report only from the negotiated Agent envelope and current user action. A missing or incompatible CLI report MAY additionally use the local executable lookup and capabilities-probe result. The Skill SHALL distinguish every protocol outcome and report relevant durable resources, exact Share links or Export paths, errors, and outstanding human actions. It MUST NOT claim a resource or state that the available evidence does not establish.

#### Scenario: Publish completes

- **WHEN** Agent-mode Publish returns `completed` with Artifact, Version, Publication, and Share-link resources
- **THEN** the Skill reports those durable identifiers, Publication state and expiration, and the exact returned Share link

#### Scenario: Upload succeeds but Publish does not

- **WHEN** high-level Publish returns `partial` with a durable Artifact or Version but no completed Publication
- **THEN** the Skill reports the created resources, states that Publish did not complete, and does not claim external accessibility or invent a Share link

#### Scenario: Server work remains active

- **WHEN** an operation returns `in_progress`
- **THEN** the Skill reports the accepted resources and the exact inspection or delayed-retry action without claiming completion

#### Scenario: Mutating outcome is indeterminate

- **WHEN** an outcome cannot establish whether a transmitted mutation completed
- **THEN** the Skill reports the uncertainty, does not automatically repeat the mutation, and presents the structured inspection action

#### Scenario: Export completes

- **WHEN** Export returns `completed`
- **THEN** the Skill reports the exact local output path and relevant Artifact and Version identifiers

#### Scenario: User action remains

- **WHEN** the outcome requires installation, upgrade, authorization, confirmation, or another user decision
- **THEN** the Skill reports that action as outstanding and does not claim the requested operation completed

### Requirement: Release one compatible platform-neutral Skill

The Agent-mode Skill SHALL remain one platform-neutral package and SHALL be released only after the additive Server/OpenAPI contract and CLI `0.2.0` Agent protocol are available through the existing verified distribution channels. Existing CLI installers MUST NOT install or modify agent Skill directories. Requiring Agent protocol version 1 for the official Skill MUST NOT by itself raise the Server's minimum accepted CLI version for human CLI users.

#### Scenario: Compatible release sequence completes

- **WHEN** the Server contract is released, CLI `0.2.0` is available through existing distribution channels, and every advertised Skill command passes Agent protocol validation
- **THEN** the single official Skill package may be released

#### Scenario: Older human CLI remains supported

- **WHEN** the Server accepts a pre-Agent CLI for existing human workflows
- **THEN** it continues to accept that CLI even though the official Agent-mode Skill requires protocol version 1

### Requirement: Evaluate routing, safety, reporting, and triggering

The repository SHALL version the official Skill's behavioral prompts, objective assertions, and trigger labels. It SHALL NOT commit generated run output, credentials, live Publication data, timing artifacts, grading output, or review workspaces.

Evaluation of an existing Skill revision SHALL compare the candidate against a snapshot of the previous Skill using the same prompts, local fixtures, fake CLI outcomes, and run conditions. Evaluations MUST NOT mutate a live ShareSlices deployment. Any unintended Publish, Delete, Share-link replacement, content edit, secret exposure, direct REST call, output fallback, or unsupported success claim MUST fail the candidate regardless of aggregate score.

#### Scenario: First draft is evaluated

- **WHEN** the first revised Skill draft is ready
- **THEN** it is compared with the previous Skill on three prompts covering Upload-only, explicit Publish, and ambiguous Entry selection

#### Scenario: Candidate is prepared for release

- **WHEN** the candidate passes the first iteration
- **THEN** the behavior set expands to eight through ten cases covering existing-Artifact Upload, explicit management, authentication, missing or outdated CLI, partial and indeterminate outcomes, irreversible operations, local-content boundaries, and result reporting

#### Scenario: Trigger behavior is evaluated

- **WHEN** the Skill description is prepared for release
- **THEN** twenty realistic trigger cases cover both operational ShareSlices requests and close non-triggering requests such as deployment, local build work, archive creation, direct API integration, CLI development, and Server debugging

#### Scenario: Safety assertion fails

- **WHEN** any evaluation violates a defined safety assertion
- **THEN** the candidate fails evaluation even if its aggregate score otherwise improves

#### Scenario: Evaluation artifacts are committed

- **WHEN** an evaluation iteration finishes
- **THEN** only reviewed prompts, assertions, and trigger labels are retained in version control

### Requirement: Keep Gallery choices and permission explicit

The Skill SHALL treat the Gallery channel, target Artifact, fixed ready Version, public metadata, first-share Creator display name, permission-grant revision and exact text, update revision, and permanent withdrawal as material decisions. It MAY accept the latest ready Version or Artifact name-derived title only when the requested operation and CLI contract make that default deterministic and it tells the user what it selected. It MUST NOT derive a public Creator display name from email, infer permission acceptance, or infer permanent URL retirement. When Agent output returns `accept_permission`, the Skill SHALL present the exact structured grant revision and exact text supplied by the CLI, obtain acceptance for that revision, and MUST NOT recast the permission decision as `confirm_irreversible`.

#### Scenario: Latest ready Version is deterministic

- **WHEN** the user explicitly requests Share to Gallery for one Artifact, supplies the required metadata and grant acceptance, and omits Version while exactly one latest ready Version is authoritative
- **THEN** the Skill may use that Version, identify it in the result, and continue without asking the user to repeat the default

#### Scenario: Multiple Gallery Versions are plausible

- **WHEN** the user's request or Server state leaves more than one materially plausible ready Version
- **THEN** the Skill asks the user to choose and invokes no Gallery mutation

#### Scenario: Gallery permission is not accepted

- **WHEN** the user has not accepted the exact grant revision required for Gallery share, a Version-changing update, or a metadata-only update subject to policy renewal
- **THEN** the Skill presents the `accept_permission` action with the exact grant revision and exact text and performs no Gallery mutation
- **AND** it does not describe permission acceptance as irreversible confirmation

#### Scenario: First Gallery share needs a Creator display name

- **WHEN** the user explicitly requests Share to Gallery but has no Creator profile and has not supplied a public display name
- **THEN** the Skill asks for that material choice and performs no mutation
- **AND** it does not prefill the email address or its local part as a public identity

#### Scenario: User accepts the evidenced Gallery permission

- **WHEN** the user accepts the exact grant revision returned by `artifact gallery view` or an `accept_permission` next action
- **THEN** the Skill may invoke the requested Gallery mutation with acceptance of that same revision
- **AND** it requests fresh acceptance instead of proceeding if the Server reports a newer current revision

#### Scenario: Metadata-only update requires renewed permission

- **WHEN** the Server requires current grant acceptance for a metadata-only update
- **THEN** the Skill presents the exact `accept_permission` evidence and does not infer acceptance from the unchanged Version

#### Scenario: Gallery withdrawal is not confirmed

- **WHEN** the user requests cleanup or removal without confirming that the Gallery URL will retire permanently
- **THEN** the Skill asks for irreversible confirmation and does not invoke Gallery withdraw

#### Scenario: Replacement after reversed removal is not confirmed

- **WHEN** Gallery share would permanently forfeit restoration of a previously public `administrator_removal` listing and the user has not confirmed that consequence
- **THEN** the Skill presents the exact old-listing consequence, asks for irreversible confirmation, and does not invoke Gallery share

### Requirement: Report only evidenced Gallery outcomes

The Skill SHALL report Gallery outcomes only from the negotiated Agent envelope. It SHALL distinguish a confirmed listing from an intended listing and a non-public proposal from a committed public revision, identify the known committed and proposed Version, lifecycle, review status, effective-access status and blocking category, current terminal closure reason when present, listing and proposal revisions, permission-grant revision, and exact active URL when returned, and preserve in-progress, partial, or indeterminate evidence without claiming a cross-channel effect. For an unlisted Gallery view or permission-required outcome, it SHALL preserve the exact current grant revision and exact text when present so the user can make an evidenced acceptance decision. If the envelope reports no current grant, the Skill SHALL report stable unavailability, preserve any historical acceptance evidence, and MUST NOT invent terms, ask for acceptance, or invoke share or update.

#### Scenario: Gallery share completes

- **WHEN** Agent-mode Gallery share returns completed with confirmed Artifact, Version, and Gallery-listing resources
- **THEN** the Skill reports those resources, the exact Gallery URL, lifecycle, review status, and grant revision without claiming a Publication or Share link changed

#### Scenario: Gallery update is rejected

- **WHEN** the Server confirms that a Gallery update did not complete
- **THEN** the Skill reports the known previous listing revision and Version and does not claim the requested content or metadata is public

#### Scenario: Initial Gallery proposal awaits review

- **WHEN** Agent-mode Gallery share returns `in_progress` with a Pending or Reviewing initial proposal
- **THEN** the Skill reports that review remains active, preserves the proposal evidence, and does not present a public Gallery URL or claim that the proposed Version or metadata is public

#### Scenario: Gallery update proposal awaits review

- **WHEN** Agent-mode Gallery update returns `in_progress` with an open proposal and an unchanged committed listing
- **THEN** the Skill reports the current public revision separately from the proposed revision and follows only the structured state-inspection or delayed-retry action

#### Scenario: Gallery withdrawal completes

- **WHEN** Agent-mode Gallery withdraw confirms Withdrawn and URL retirement
- **THEN** the Skill reports permanent Gallery closure and states that link sharing remains independent

#### Scenario: Gallery mutation is indeterminate

- **WHEN** an Agent Gallery mutation returns indeterminate
- **THEN** the Skill reports known listing evidence, performs no blind replay, and follows only the structured state-inspection action

#### Scenario: Unlisted Gallery view returns current permission evidence

- **WHEN** Agent-mode Gallery view reports no listing and returns a configured current grant revision with exact text
- **THEN** the Skill reports that no listing exists and preserves that grant evidence without implying acceptance or a completed share

#### Scenario: Gallery view reports no current permission

- **WHEN** Agent-mode Gallery view reports that no current permission grant is configured
- **THEN** the Skill reports unavailability, preserves any listing and historical accepted-grant evidence, and does not request acceptance or invoke Gallery share or update

### Requirement: Evaluate Gallery routing and safety

Official Skill evaluations SHALL add Gallery cases before release. They MUST cover explicit link versus Gallery intent, ambiguous generic Share wording, deterministic and ambiguous Version selection, missing first-share Creator display name, email non-disclosure, unlisted read-only grant discovery, missing current grant, missing and stale grant acceptance, metadata-only policy renewal, the `accept_permission` action, rejection of `confirm_irreversible` for permission acceptance, Pending or Reviewing initial and update proposals, eligible fresh share after each Removed history, irreversible replacement after reversed Administrator Removal, revision conflict, confirmed and indeterminate update, permanent withdrawal confirmation, unsupported CLI capability, and the prohibition on REST or human-output fallback.

#### Scenario: Gallery routing evaluation runs

- **WHEN** the revised Skill is prepared for Gallery release
- **THEN** its evaluation set distinguishes Upload-only, Share with link, Share to Gallery, Gallery update, Gallery withdraw, and ambiguous Share prompts

#### Scenario: Gallery safety assertion fails

- **WHEN** an evaluation creates a Gallery listing without explicit Gallery intent and exact-revision grant acceptance, maps permission acceptance to `confirm_irreversible`, or changes a Share link while executing Gallery intent
- **THEN** the candidate Skill fails regardless of aggregate score

#### Scenario: Installed CLI lacks Gallery support

- **WHEN** an evaluation returns Agent capabilities without the requested Gallery operation
- **THEN** the Skill reports the compatibility gap and performs no REST, human-output, or selected-field fallback
