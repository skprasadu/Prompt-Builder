# Electron Native Modules

`better-sqlite3` is a native Node module. Native modules must be rebuilt against Electron's Node/V8 ABI, not only the system Node.js ABI.

This repo pins Electron to `41.5.2` because the current `better-sqlite3` native build path fails against Electron 42.x.

If the app logs an error like:

```txt
NODE_MODULE_VERSION ...
```

or if `better-sqlite3` fails to load, run:

```bash
npm run desktop:prepare-native
```

The root `desktop:dev` and `desktop:package:mac` scripts run this automatically before starting/building the desktop app.
