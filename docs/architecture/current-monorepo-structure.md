# Current Monorepo Structure

This repository has been cleaned so the active architecture is the Electron/TypeScript monorepo.

## Runnable applications

- `apps/desktop` — Electron desktop workbench.
- `apps/prompt-sync-api` — Fastify API service scaffold for cloud sync.

## Shared packages

- `packages/design-system` — centralized Material UI theme and shared design defaults.
- `packages/prompt-builder-core` — reusable prompt-builder logic and shared types.
- `packages/prompt-builder-contracts` — API/data contracts shared across apps.

## Supporting folders

- `docs` — architecture notes.
- `infra` — deployment/infrastructure notes.
- `tools` — repository maintenance scripts.

## Removed legacy paths

- `src`
- `src-tauri`
- `public`
- root `index.html`
- root `vite.config.ts`
- root `tsconfig.node.json`

Generated desktop output belongs under `apps/desktop/out` and packaged artifacts belong under `apps/desktop/release`; both are ignored by git.
