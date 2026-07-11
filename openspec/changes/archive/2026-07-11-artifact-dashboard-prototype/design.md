# Artifact Dashboard Prototype — Design

## Context

Artifact creation already allocates one stable Share link and ready content is published through a Publication. The prototype's Create link action therefore maps to publishing the ready Version and applying an optional expiration to that existing link. Manual Revoke and Analytics are excluded.

## Decisions

- Preserve one stable Share link per Artifact; no link rotation is introduced.
- Store expiration on the existing Share link. A missing value means permanent.
- Create link publishes the ready Version, then applies the requested expiration.
- Manage share updates expiration without changing Publication or slug.
- Export streams a ZIP assembled from committed manifest assets through the authenticated API.
- Delete is allowed only outside accepted and processing states. Database deletion is authoritative; object keys captured before deletion are removed afterward.
- The Web uses existing shadcn Base UI Button, Card, Dialog, Dropdown Menu, Input, Toggle Group, Alert, Badge, Tooltip, and Empty components.

## Error Handling

Unauthorized and non-owner requests reveal no Artifact data. Invalid or past expiration dates are rejected. Export requires a ready Version. Delete returns a conflict while processing and remains absent after success.

## Testing

API service and route tests cover ownership, expiration, export, delete, and state gates. Web component tests cover prototype card actions and dialogs. The final UI is checked at 1440×900 and the repository passes `mise run check`.
