# Unify Publish and sharing tasks

## 1. Lock contracts and migration

- [ ] 1.1 Add failing database tests and a checked migration for Publication expiration policies, end reasons, nullable pre-Publish links, retired-link uniqueness, and preservation of existing slugs.
- [ ] 1.2 Update the checked OpenAPI and YAML/Python contract tests for nullable Share links, four-state Publication summaries, Publish expiration and link choices, Publication edits, and irreversible replacement confirmation.
- [ ] 1.3 Add failing application and repository tests for first Publish, inherited republish defaults, atomic Version replacement, expiration, Unpublish, concurrent mutation rejection, and idempotent retries.

## 2. Move external availability into Publication

- [ ] 2.1 Stop creating Share links during new Artifact intake and remove Share-link data from accepted Upload responses.
- [ ] 2.2 Implement Publication-owned expiration policy, effective status derivation, latest Publication reads, and state-valid management actions.
- [ ] 2.3 Implement atomic Publish that creates or reuses a link, inherits defaults, supersedes an accessible Publication, and returns the effective Publication plus link.
- [ ] 2.4 Implement Publication expiration edits and idempotent Unpublish without deleting Publication history.
- [ ] 2.5 Implement confirmed link replacement that retires the old slug and commits the new link with Publish in one transaction.

## 3. Align Viewer and management surfaces

- [ ] 3.1 Update Viewer resolution and tests so Published serves content, Expired and Unpublished return generic `200` state pages, retired returns `410`, and unknown returns `404` with existing no-store behavior.
- [ ] 3.2 Replace Web Share actions with first/again Publish and Manage publication flows, including presets, custom local date-time input, explicit replacement confirmation, status labels, and Copy only while Published.
- [ ] 3.3 Preserve unrelated Artifact grid, list, detail, Preview, thumbnail, rename, export, retry, replace-file, and delete behavior.

## 4. Align CLI and Skill

- [ ] 4.1 Replace `artifact share view/edit` with Publication management commands and update human and structured outputs to the four-state model.
- [ ] 4.2 Add the high-level `shareslices publish` orchestration over packaging, Upload, ready polling, Publish defaults or flags, and final link output while retaining stepwise commands.
- [ ] 4.3 Update `cli/README.md`, the official Skill, examples, and command tests without duplicating Server lifecycle policy in the Skill.

## 5. Verify

- [ ] 5.1 Run focused database, API, Viewer, Web, CLI, and migration tests, including preserved legacy links and concurrent lifecycle mutations.
- [x] 5.2 Verify Publish, Manage publication, Expired, Unpublished, and replacement-confirmation flows at `1440x900` without mobile or tablet work.
- [ ] 5.3 Run `mise run check`, strict OpenSpec validation, and the full runtime integration suite.
