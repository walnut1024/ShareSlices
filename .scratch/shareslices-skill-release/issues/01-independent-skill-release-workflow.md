# Add an independent Skill release workflow

Status: backlog

## Parent

[Independent ShareSlices Skill release PRD](../PRD.md)

## Context

CLI `0.2.0` proved the revised platform-neutral Skill package through the existing manual release sequence. The current release intentionally distributes the checked Skill source and package only after the CLI release gate; it does not add an independent Skill release workflow.

## What to build

Design and implement a separately authorized release workflow for the official ShareSlices Skill. Keep Skill publication gated on compatible CLI availability and the committed behavior, contract, trigger, and package validations.

## Acceptance criteria

- [ ] The workflow publishes only the validated platform-neutral package from `skill/package/`.
- [ ] Publication requires the Skill behavior, Skill-to-CLI contract, trigger, and package suites to pass.
- [ ] The release declares its compatible Agent protocol and minimum CLI version without duplicating Server policy.
- [ ] The workflow does not install the CLI, mutate agent directories, contact the ShareSlices Server, or activate the Skill as a build side effect.
- [ ] Publication and activation remain explicit human-authorized operations with documented rollback steps.
- [ ] A release dry run proves artifact identity and checksum integrity before enabling external publication.

## Blocked by

None - the manual CLI `0.2.0` and revised Skill release has established the baseline.
