# Artifact Dashboard Prototype

## Why

The current Artifact list exposes the core lifecycle but does not match the supplied management prototype and omits owner-facing export, deletion, and Share link expiration controls.

## What Changes

- Rebuild the Artifact dashboard from the supplied prototype without the Analytics or Revoke surfaces.
- Add card-level Preview, Share, Rename, Export, and Delete actions when the Artifact state permits them.
- Treat Create link as Publish plus optional expiration and Manage share as copy plus expiration management.
- Add ready-Version ZIP export and permanent Artifact deletion.

## Capabilities

### Modified Capabilities

- `artifact-publication`: expand owned Artifact management, Share link expiration, export, deletion, and Web dashboard behavior.

## Impact

- `PRODUCT.md`: owns deletion, export, and Share link expiration policy.
- `api/`: adds management contracts and object-backed export/deletion behavior.
- `web/`: adopts the prototype dashboard and Base UI dialogs and menus.
