import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageJsonsToCheck = [
  path.join(repoRoot, "package.json"),
  path.join(repoRoot, "apps", "desktop", "package.json"),
];

function resolveElectronPath(packageJsonPath) {
  const localRequire = createRequire(packageJsonPath);
  const electronPath = localRequire("electron");

  if (typeof electronPath !== "string") {
    throw new Error(`The electron package did not return a binary path from ${packageJsonPath}.`);
  }

  if (!existsSync(electronPath)) {
    throw new Error(`Electron binary path does not exist from ${packageJsonPath}: ${electronPath}`);
  }

  return electronPath;
}

function installElectronBinary(packageJsonPath) {
  const localRequire = createRequire(packageJsonPath);
  const electronPackageJson = localRequire.resolve("electron/package.json");
  const electronPackageDir = path.dirname(electronPackageJson);
  const installScript = path.join(electronPackageDir, "install.js");

  if (!existsSync(installScript)) {
    throw new Error(`Electron install script not found: ${installScript}`);
  }

  const env = { ...process.env };
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;

  const result = spawnSync(process.execPath, [installScript], {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  });

  if (result.status !== 0) {
    throw new Error(`Electron install script failed with exit code ${result.status ?? "unknown"}.`);
  }
}

for (const packageJsonPath of packageJsonsToCheck) {
  try {
    const electronPath = resolveElectronPath(packageJsonPath);
    console.log(`Electron binary OK for ${packageJsonPath}: ${electronPath}`);
  } catch (beforeError) {
    console.warn(`Electron binary is missing or incomplete for ${packageJsonPath}.`);
    console.warn(beforeError instanceof Error ? beforeError.message : String(beforeError));
    console.warn("Running Electron binary installer...");

    installElectronBinary(packageJsonPath);

    const electronPath = resolveElectronPath(packageJsonPath);
    console.log(`Electron binary repaired for ${packageJsonPath}: ${electronPath}`);
  }
}
