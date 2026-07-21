import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import type { Ignore } from "ignore";
import type { FileNode } from "./types";

const HIDDEN_DIR_NAMES = new Set([".git"]);

export async function scanDir(rootPath: string): Promise<FileNode> {
  const rootStat = await stat(rootPath);

  if (!rootStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${rootPath}`);
  }

  const matcher = await loadRootGitignore(rootPath);
  return buildTree(rootPath, rootPath, matcher);
}

async function loadRootGitignore(rootPath: string): Promise<Ignore | null> {
  try {
    const raw = await readFile(path.join(rootPath, ".gitignore"), "utf8");
    return ignore().add(raw);
  } catch {
    return null;
  }
}

async function buildTree(rootPath: string, dirPath: string, matcher: Ignore | null): Promise<FileNode> {
  const children: FileNode[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const childPath = path.join(dirPath, entry.name);
    const isDir = entry.isDirectory();

    if (isDir && HIDDEN_DIR_NAMES.has(entry.name)) {
      continue;
    }

    if (matcher && isIgnored(rootPath, childPath, isDir, matcher)) {
      continue;
    }

    if (isDir) {
      children.push(await buildTree(rootPath, childPath, matcher));
    } else if (entry.isFile()) {
      children.push({
        name: entry.name,
        path: childPath,
        isDir: false,
      });
    }
  }

  children.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }

    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return {
    name: path.basename(dirPath) || dirPath,
    path: dirPath,
    isDir: true,
    children,
  };
}

function isIgnored(rootPath: string, candidatePath: string, isDir: boolean, matcher: Ignore): boolean {
  const relativePath = path.relative(rootPath, candidatePath).split(path.sep).join("/");
  const target = isDir ? `${relativePath}/` : relativePath;

  if (!target || target.startsWith("..")) {
    return false;
  }

  return matcher.ignores(target);
}
