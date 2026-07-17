# Local Development Stack Delta

## ADDED Requirements

### Requirement: Canonical local lifecycle

The repository SHALL expose `mise run dev` as the single supported command for starting or restarting the complete local application stack, and the command SHALL build current sources, apply migrations, recreate required services, and wait for readiness before succeeding.

#### Scenario: Start from a stopped workspace

- **WHEN** a developer runs `mise run dev` with the local stack stopped
- **THEN** Web, API, isolated content, Worker, PostgreSQL, object storage, and Mailpit start from the current workspace sources and report healthy before the command succeeds

#### Scenario: Restart after a Worker change

- **WHEN** Worker source changed since the previous local start and the developer runs `mise run dev` again
- **THEN** the running Worker image contains the current source without requiring a separate rebuild task

### Requirement: Stable isolated local origins

The canonical local topology SHALL use `http://app.localhost:5173` for trusted Web and API traffic and `http://content.localhost:7460` for untrusted Gallery content, regardless of current Gallery availability.

#### Scenario: Gallery is not yet eligible

- **WHEN** the local database has not completed explicit Gallery policy and Administrator bootstrap
- **THEN** the trusted application remains available at `http://app.localhost:5173` while Gallery fails closed without redirecting the application to `127.0.0.1`

### Requirement: Loopback-only publication

Every service port published by the canonical local and test stacks SHALL bind to a loopback interface unless an operator explicitly selects a deployment profile that permits remote access.

#### Scenario: Inspect local port publication

- **WHEN** the canonical local stack is running with default configuration
- **THEN** PostgreSQL, object storage, SMTP, Mailpit, API, isolated content, and Web published ports are not bound to all host interfaces

### Requirement: Unified diagnostics and shutdown

The repository SHALL expose lifecycle diagnostics and shutdown through the same stack controller used by startup, including commands for status, logs, and shutdown.

#### Scenario: Inspect a healthy stack

- **WHEN** a developer runs `mise run dev-status`
- **THEN** the command reports container state and probes the canonical Web, API, content, Mailpit, and SMTP endpoints

#### Scenario: Stop the stack

- **WHEN** a developer runs `mise run dev-down` after any canonical local start
- **THEN** the controller stops the complete local Compose project without requiring the developer to remember an overlay file

### Requirement: Test stack isolation

Repository integration tests SHALL use a dedicated Compose project and dedicated published ports and SHALL NOT stop, recreate, or reconfigure the canonical developer stack.

#### Scenario: Run API integration tests during development

- **WHEN** the canonical developer stack is healthy and a developer runs `mise run api-test`
- **THEN** tests use isolated infrastructure and application endpoints, clean up only the test project, and leave the developer stack healthy and unchanged

### Requirement: Operational commands remain explicit

Operations that mutate durable Gallery authority or retry state SHALL remain separate from local lifecycle commands and SHALL have names that identify them as operations.

#### Scenario: Start without choosing an Administrator

- **WHEN** a developer starts a fresh local stack
- **THEN** startup does not grant Gallery Administrator authority and reports the explicit bootstrap operation required to do so
