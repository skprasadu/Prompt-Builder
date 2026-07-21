# Clean Rebuild

Use this when the workspace needs to be reset to a clean generated state.

## Clean only

```bash
npm run clean
```

This removes generated dependency/build artifacts, including:

- root and workspace `node_modules`
- root and workspace lockfiles
- `apps/desktop/out`
- `apps/desktop/release`
- workspace `dist` folders
- common test/cache folders
- TypeScript build info files

## Clean and rebuild

```bash
npm run rebuild:fresh
```

This cleans, runs `npm install`, repairs Electron, typechecks, and builds the desktop/API apps.

## Clean and package macOS DMG

```bash
npm run rebuild:fresh:mac
```

This cleans, runs `npm install`, repairs Electron, builds, and creates the macOS DMG.

## Keep lockfile

```bash
node tools/clean-rebuild.mjs --keep-lockfiles --install --repair-electron --build
```

Use this if the lockfile should be preserved.
