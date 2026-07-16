# web-interface-consistency Specification

## ADDED Requirements

### Requirement: Present one coherent management visual language

Related surfaces SHALL appear and behave as parts of the same ShareSlices application rather than as independently styled products. Gallery administration and Creator profile management SHALL use the same management shell, hierarchy, typography system, spacing rhythm, control scale, surface treatment, and application-state language as Artifact management. Public Gallery listing, Gallery detail, and Creator surfaces SHALL retain their public navigation boundary while using the same typography, control, surface, and state language.

#### Scenario: User moves between Artifact and Gallery management

- **WHEN** a User moves between Artifact management and Gallery profile management
- **THEN** both surfaces retain the same application shell and recognizable hierarchy for page titles, supporting text, forms, actions, data surfaces, and status feedback
- **AND** neither surface introduces an independent color palette, typography system, or navigation model

#### Scenario: Authorized administrator opens Gallery administration

- **WHEN** an authorized Administrator opens the existing Gallery administration address directly
- **THEN** the administration surface uses the same management visual language without adding an Admin entry to ordinary User navigation

#### Scenario: Viewer moves between public Gallery surfaces

- **WHEN** a Viewer moves among the Gallery listing, a Gallery detail page, and a public Creator page
- **THEN** those surfaces retain the public Gallery navigation boundary and a coherent visual language with Artifact presentation
- **AND** none presents an independent application theme

#### Scenario: Affected surface renders within the supported desktop scope

- **WHEN** an affected surface renders at a supported desktop viewport
- **THEN** its primary information and actions remain readable, reachable, and free of unintended clipping or horizontal overflow

### Requirement: Expose consistent accessible control and state semantics

Ordinary actions, fields, choices, dialogs, identity, status, feedback, empty states, and data surfaces SHALL expose consistent keyboard, focus, labelling, disabled, invalid, pending, and dismissal semantics. Loading, empty, informational, success, warning, error, unavailable, and destructive states SHALL remain distinguishable without relying only on color.

#### Scenario: User operates an ordinary action

- **WHEN** a User reaches an ordinary clickable action on an affected surface
- **THEN** the action has an accessible name, keyboard activation, visible focus treatment, and a perceivable enabled, disabled, or pending state with the same availability meaning as the existing workflow

#### Scenario: User completes an affected form

- **WHEN** a User enters, validates, and submits data in an affected form
- **THEN** labels, descriptions, invalid state, error feedback, and pending state are programmatically associated with their controls

#### Scenario: User opens a composite control

- **WHEN** a User opens an affected choice, menu, dialog, popover, tooltip, toggle, or identity control
- **THEN** the control exposes the labels, grouping when present, fallback content, focus movement, and dismissal semantics required by that control

#### Scenario: A collection has no results

- **WHEN** an affected collection has no resources or no matching results
- **THEN** the interface identifies the empty condition and any available next action without presenting a false error

#### Scenario: A load or mutation fails

- **WHEN** an affected load or mutation fails
- **THEN** the interface presents bounded accessible feedback that reflects the existing failure outcome without adding retry, clearing, or recovery behavior

#### Scenario: An operation is pending

- **WHEN** an affected operation is waiting for completion
- **THEN** its pending state is perceivable and its interaction availability matches the existing workflow

### Requirement: Preserve responsive interaction quality

The standardized presentation SHALL NOT introduce redundant network work, repeated background activity, or a material regression in the production assets and named management interactions measured by the checked Web performance harness.

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
- **THEN** deterministic request counts remain unchanged and no duplicate request or new background polling is introduced
