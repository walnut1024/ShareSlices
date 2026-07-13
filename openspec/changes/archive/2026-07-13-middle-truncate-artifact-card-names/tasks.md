# Middle-truncate Artifact card names tasks

## 1. Lock behavior

- [x] 1.1 Add focused tests for head-and-tail display, the full-name tooltip, and unchanged short-name display.

## 2. Implement grid-only display

- [x] 2.1 Add a small name-splitting helper and a grid-only title component with a full-name title tooltip.
- [x] 2.2 Preserve the full card accessible name and leave list/detail rendering unchanged.

## 3. Verify

- [x] 3.1 Run focused Web tests and TypeScript.
- [x] 3.2 Run `mise run check` and strict OpenSpec validation.
- [x] 3.3 Render long Chinese and mixed-character names at `1440x900` and verify the card visually.
