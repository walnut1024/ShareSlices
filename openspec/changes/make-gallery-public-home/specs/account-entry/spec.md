# account-entry Delta Specification

## ADDED Requirements

### Requirement: Route Web account entry through dedicated paths

The Web SHALL expose sign-in at `/sign-in`, sign-up at `/sign-up`, and the complete password-reset request, code, new-password, and completion journey at `/reset-password`. Account-entry route identity MUST derive from the path rather than a query-selected view on `/`. The Web MUST NOT redirect, alias, or generate `/?view=login`, `/?view=signup`, or `/?view=reset` as account-entry addresses.

#### Scenario: Visitor opens dedicated account entry

- **WHEN** a signed-out visitor opens `/sign-in`, `/sign-up`, or `/reset-password`
- **THEN** the Web presents the corresponding account-entry journey at that unchanged canonical path

#### Scenario: Visitor follows an account-entry link

- **WHEN** a visitor activates Sign in, Create account, Forgot password, or a return-to-sign-in action
- **THEN** the Web navigates to the corresponding dedicated account path without a `view` query parameter

#### Scenario: Obsolete query-selected account address is opened

- **WHEN** a visitor opens `/` with a former account-entry `view` query value
- **THEN** the Web does not treat that address as sign-in, sign-up, or password reset and provides no compatibility redirect

#### Scenario: Password reset advances between stages

- **WHEN** a visitor advances from password-reset request through code, new-password, and completion states
- **THEN** the Web remains on `/reset-password` because those states form one journey

### Requirement: Validate Web sign-in return destinations

When authentication is required for a trusted Web route, the Web SHALL open `/sign-in` with one encoded `returnTo` path. The Web MUST accept a return destination only when it parses as a same-origin absolute-path reference and classifies as an allowed public Gallery or authenticated management destination. It MUST reject external, protocol-relative, account-entry, device-authorization, malformed, and unknown destinations. Query and fragment components MAY be retained only after the destination route passes validation.

#### Scenario: Signed-out User opens protected management

- **WHEN** a signed-out User opens an authenticated Artifact, profile-management, or Gallery-administration route
- **THEN** the Web opens `/sign-in` with that trusted path encoded as `returnTo`

#### Scenario: Sign-in succeeds with a valid return destination

- **WHEN** sign-in succeeds with an allowed same-origin Gallery or management `returnTo`
- **THEN** the Web opens that destination

#### Scenario: Sign-in succeeds without a return destination

- **WHEN** sign-in succeeds without an accepted `returnTo`
- **THEN** the Web opens `/artifacts`

#### Scenario: Sign-in receives an unsafe return destination

- **WHEN** `returnTo` is external, protocol-relative, malformed, an account-entry loop, device authorization, or an unknown route
- **THEN** the Web ignores it and opens `/artifacts` after successful sign-in

#### Scenario: Signed-in User opens account entry

- **WHEN** a signed-in User opens `/sign-in`, `/sign-up`, or `/reset-password`
- **THEN** the Web opens an accepted `returnTo` or otherwise opens `/artifacts` without presenting account entry

### Requirement: Exclude private and account-entry Web routes from indexing

Account-entry, device-authorization, authenticated management, unavailable, and not-found pages MUST direct crawlers not to index or follow them and MUST NOT declare a public Gallery route as their canonical URL. Client-side navigation to one of these routes MUST remove any public canonical metadata left by the preceding route.

#### Scenario: Crawler opens account entry

- **WHEN** a crawler opens `/sign-in`, `/sign-up`, or `/reset-password`
- **THEN** the page directs the crawler not to index or follow it and declares no public Gallery canonical URL

#### Scenario: User navigates from Gallery to management

- **WHEN** client-side navigation moves from an indexable Gallery route to an authenticated management route
- **THEN** the Web replaces the robots directive and removes the preceding Gallery canonical link

## MODIFIED Requirements

### Requirement: Web log-in screen

The Web UI SHALL expose a dedicated `/sign-in` page with email, password, a **Sign in** action, and a **Forgot password?** action. Failed sign-in shows neutral failure feedback. Successful sign-in MUST open an accepted trusted `returnTo` destination when present and otherwise open the signed-in User's Artifact list without requiring a separate confirmation action. An unverified-account response while registration verification is required SHALL offer a protected way to request a verification code without exposing whether a submitted password was correct in other failure cases.

#### Scenario: Failed login feedback

- **WHEN** a visitor submits failing sign-in input
- **THEN** neutral failure feedback is visible and the visitor remains on `/sign-in`

#### Scenario: Successful direct login navigation

- **WHEN** a visitor submits correct sign-in input permitted by the current verification policy without an accepted return destination
- **THEN** signed-in state is retained and the Web UI opens `/artifacts` without showing a continuation action

#### Scenario: Successful returning login navigation

- **WHEN** a visitor submits correct sign-in input with an accepted trusted return destination
- **THEN** signed-in state is retained and the Web UI opens that destination without showing a continuation action

#### Scenario: Reach password reset

- **WHEN** a visitor selects **Forgot password?**
- **THEN** the Web opens `/reset-password` and asks for email

### Requirement: Web account dropdown sign out

The authenticated public or management Web shell SHALL expose an account dropdown triggered by the current User's avatar. The dropdown MUST show the current User's name and email and provide a **Sign out** action. A successful sign out or an `unauthenticated` response MUST clear local signed-in state. A public Gallery or Creator route SHALL remain at its current address with signed-out navigation; an authenticated management route SHALL replace the current history entry with `/`. A network or Server failure MUST retain local signed-in state and show neutral failure feedback.

#### Scenario: Reach Sign out from the account dropdown

- **WHEN** a signed-in User opens the avatar account dropdown on a public or management route
- **THEN** the dropdown shows the current User's name and email and exposes a **Sign out** action

#### Scenario: Complete sign out on a public route

- **WHEN** the User signs out successfully while viewing an accessible public Gallery or Creator route
- **THEN** the Web clears the current User, remains on that route, and presents signed-out navigation

#### Scenario: Complete sign out on a management route

- **WHEN** the User signs out successfully while viewing an authenticated management route
- **THEN** the Web clears the current User and replaces the current location with `/`

#### Scenario: Session already expired

- **WHEN** the User selects Sign out and the API returns `unauthenticated`
- **THEN** the Web clears the current User and applies the same public-or-management destination rule as successful sign out

#### Scenario: Sign-out request fails

- **WHEN** the User selects Sign out and the request fails because of a network or Server error
- **THEN** the Web retains the current User and shows neutral failure feedback

#### Scenario: Sign-out request is already pending

- **WHEN** the User invokes Sign out while a sign-out request is in flight
- **THEN** the Web sends no additional sign-out request
