# Code Quality

This repository uses root-level tooling for type checking, linting, and dead-code detection.

## Commands

```bash
npm run typecheck
npm run lint
npm run lint:fix
npm run knip
npm run check
```

## Boundaries

- UI stays in `apps/desktop/src/renderer`.
- Desktop-local filesystem and native behavior stay behind Electron IPC in `apps/desktop/src/backend`, `apps/desktop/src/main`, and `apps/desktop/src/preload`.
- Shared reusable code belongs in `packages/*`.
- Styling belongs in `packages/design-system`.

## ESLint

The root `eslint.config.mjs` uses ESLint flat config with TypeScript-aware linting.

## Knip

The root `knip.jsonc` treats executable apps and package public APIs as entries.
Generated output under `out`, `release`, and `dist` is outside the source boundary.
