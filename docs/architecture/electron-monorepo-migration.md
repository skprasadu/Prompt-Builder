# Electron Monorepo Migration

This repository now has a migration scaffold for a desktop-first TypeScript architecture.

## Direction

- `apps/desktop` is the Electron desktop workbench.
- `apps/prompt-sync-api` is the first cloud API seam.
- `packages/design-system` centralizes the MUI theme.
- `packages/prompt-builder-core` holds reusable prompt-builder logic.
- `packages/prompt-builder-contracts` holds API/shared contracts.

## Cutover approach

The current Tauri app is intentionally left in place. The Electron app is created beside it so the migration can be validated without breaking the working flow.

Recommended cutover order:

1. Run `npm install` at the repository root.
2. Run `npm run desktop:dev`.
3. Validate folder scanning, file selection, prompt copy, session save/load, Excel extraction, block extraction, and API extraction.
4. Move stable shared logic from `apps/desktop/src/renderer/lib` into `packages/prompt-builder-core`.
5. Remove Tauri only after Electron parity is confirmed.

## Desktop boundaries

Renderer UI should stay clean. Local filesystem, clipboard, dialogs, Excel parsing, HTML parsing, API calls, and future Git capture belong behind the Electron preload/main IPC boundary.

## Cloud boundaries

Cloud APIs should receive durable product records: context packs, AI runs, development episodes, changed files, summaries, and comments. They should not own local filesystem access.
