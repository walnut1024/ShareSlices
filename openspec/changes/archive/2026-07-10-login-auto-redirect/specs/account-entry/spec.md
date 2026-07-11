# account-entry Specification Delta

## MODIFIED Requirements

### Requirement: Web log-in screen

The Web UI SHALL expose a dedicated log-in screen with email, password, and a log-in action. Failed login shows neutral failure feedback. Successful login MUST open the signed-in user's Artifact list without requiring a separate confirmation action.

#### Scenario: Failed login feedback

- **WHEN** a visitor submits failing log-in input
- **THEN** neutral failure feedback is visible and the visitor remains on the log-in screen

#### Scenario: Successful login navigation

- **WHEN** a visitor submits correct log-in input
- **THEN** signed-in state is retained and the Web UI opens `/artifacts` without showing a continuation action
