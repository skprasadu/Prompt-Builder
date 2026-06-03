import { existsSync } from "node:fs";
import { rm, readdir, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

const shouldInstall = args.has("--install");
const shouldRepairElectron = args.has("--repair-electron");
const shouldBuild = args.has("--build");
const shouldPackageMac = args.has("--package-mac");
const keepLockfiles = args.has("--keep-lockfiles");

const workspaceRoots = ["apps", "packages"];

async function main() {
  assertRepoRoot();

  const packageDirs = await findPackageDirs();

  const targets = [
    path.join(repoRoot, "node_modules"),
    path.join(repoRoot, ".vite"),
    path.join(repoRoot, ".turbo"),
    path.join(repoRoot, "coverage"),
    path.join(repoRoot, "test-results"),
    path.join(repoRoot, "tmp"),
    ...packageDirs.flatMap((dir) => [
      path.join(dir, "node_modules"),
      path.join(dir, "dist"),
      path.join(dir, "out"),
      path.join(dir, "release"),
      path.join(dir, ".vite"),
      path.join(dir, "coverage"),
      path.join(dir, "test-results"),
      path.join(dir, "tmp"),
    ]),
  ];

  if (!keepLockfiles) {
    targets.push(path.join(repoRoot, "package-lock.json"));
    targets.push(...packageDirs.map((dir) => path.join(dir, "package-lock.json")));
    targets.push(...packageDirs.map((dir) => path.join(dir, "npm-shrinkwrap.json")));
  }

  await removeTargets(targets);
  await removeGeneratedFiles(repoRoot);

  if (shouldInstall) {
    run("npm", ["install"]);
  }

  if (shouldRepairElectron) {
    run("npm", ["run", "desktop:prepare-native"]);
  }

  if (shouldBuild) {
    run("npm", ["run", "typecheck"]);
    run("npm", ["run", "desktop:build"]);
    run("npm", ["run", "api:build"]);
  }

  if (shouldPackageMac) {
    run("npm", ["run", "desktop:package:mac"]);
  }

  printNextSteps();
}

function assertRepoRoot() {
  const packageJsonPath = path.join(repoRoot, "package.json");

  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at expected repository root: ${packageJsonPath}`);
  }
}

async function findPackageDirs() {
  const dirs = [];

  for (const workspaceRoot of workspaceRoots) {
    const absoluteRoot = path.join(repoRoot, workspaceRoot);

    if (!existsSync(absoluteRoot)) {
      continue;
    }

    const entries = await readdir(absoluteRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(absoluteRoot, entry.name);

      if (existsSync(path.join(candidate, "package.json"))) {
        dirs.push(candidate);
      }
    }
  }

  return dirs.sort();
}

async function removeTargets(targets) {
  const uniqueTargets = Array.from(new Set(targets)).sort((a, b) => b.length - a.length);

  for (const target of uniqueTargets) {
    await removePath(target);
  }
}

async function removePath(target) {
  if (!existsSync(target)) {
    return;
  }

  const relative = path.relative(repoRoot, target) || ".";

  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });

  console.log(`removed ${relative}`);
}

async function removeGeneratedFiles(root) {
  if (!existsSync(root)) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      await removeGeneratedFiles(fullPath);
      continue;
    }

    if (entry.name.endsWith(".tsbuildinfo") || entry.name === "vite.config.ts.timestamp") {
      await unlink(fullPath);
      console.log(`removed ${path.relative(repoRoot, fullPath)}`);
    }
  }
}

function run(command, commandArgs) {
  console.log("");
  console.log(`running ${command} ${commandArgs.join(" ")}`);

  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? "unknown"}`);
  }
}

function printNextSteps() {
  console.log("");
  console.log("clean/rebuild script finished");

  if (!shouldInstall) {
    console.log("");
    console.log("install dependencies with:");
    console.log("  npm install");
  }

  if (!shouldBuild && !shouldPackageMac) {
    console.log("");
    console.log("build with:");
    console.log("  npm run desktop:build");
    console.log("  npm run api:build");
  }

  if (!shouldPackageMac) {
    console.log("");
    console.log("package mac DMG with:");
    console.log("  npm run desktop:package:mac");
  }
}

main().catch((error) => {
  console.error("");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
