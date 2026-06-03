
import type { Node } from "../types/fs";
import { isDirNode } from "../types/fs";
import { collectFilePaths } from "./tree";

interface IndexedNode {
  node: Node;
  ancestorDirPaths: string[];
}

export interface TreePathSelectionResult {
  inputCount: number;
  matchedInputs: string[];
  unmatchedInputs: string[];
  selectedFilePaths: string[];
  expandedDirPaths: string[];
}

export function resolveTreeSelectionFromPathInput(args: {
  rootPath: string;
  tree: Node;
  input: string;
}): TreePathSelectionResult {
  const inputs = parsePathSelectionInput(args.input);
  const index = buildNodePathIndex(args.tree);

  const matchedInputs: string[] = [];
  const unmatchedInputs: string[] = [];
  const selectedFilePaths = new Set<string>();
  const expandedDirPaths = new Set<string>();

  for (const inputPath of inputs) {
    const absoluteCandidate = toAbsoluteCandidate(args.rootPath, inputPath);
    const match = index.get(toComparablePath(absoluteCandidate));

    if (!match) {
      unmatchedInputs.push(inputPath);
      continue;
    }

    matchedInputs.push(inputPath);
    match.ancestorDirPaths.forEach((path) => expandedDirPaths.add(path));

    if (isDirNode(match.node)) {
      expandedDirPaths.add(match.node.path);
      collectFilePaths(match.node).forEach((path) => selectedFilePaths.add(path));
    } else {
      selectedFilePaths.add(match.node.path);
    }
  }

  return {
    inputCount: inputs.length,
    matchedInputs,
    unmatchedInputs,
    selectedFilePaths: Array.from(selectedFilePaths).sort(),
    expandedDirPaths: Array.from(expandedDirPaths).sort(),
  };
}

function parsePathSelectionInput(input: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const cleaned = stripWrappingQuotes(rawLine.trim());

    if (!cleaned || cleaned.startsWith("#")) {
      continue;
    }

    const key = toComparablePath(cleaned);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    paths.push(cleaned);
  }

  return paths;
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);

  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'") ||
    (first === "`" && last === "`")
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function buildNodePathIndex(root: Node): Map<string, IndexedNode> {
  const index = new Map<string, IndexedNode>();

  function walk(node: Node, ancestorDirPaths: string[]): void {
    index.set(toComparablePath(node.path), { node, ancestorDirPaths });

    if (!isDirNode(node)) {
      return;
    }

    const nextAncestors = [...ancestorDirPaths, node.path];
    node.children.forEach((child) => walk(child, nextAncestors));
  }

  walk(root, []);
  return index;
}

function toAbsoluteCandidate(rootPath: string, inputPath: string): string {
  const cleaned = normalizeSeparators(inputPath.trim());

  if (isAbsolutePath(cleaned)) {
    return cleaned;
  }

  const root = trimTrailingSlash(normalizeSeparators(rootPath.trim()));
  const relative = cleaned.replace(/^\.?\//, "");

  return `${root}/${relative}`;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value) || value.startsWith("//");
}

function toComparablePath(value: string): string {
  return trimTrailingSlash(normalizeSegments(normalizeSeparators(value.trim())));
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function trimTrailingSlash(value: string): string {
  if (value.length <= 1) {
    return value;
  }

  return value.replace(/\/+$/, "");
}

function normalizeSegments(value: string): string {
  const isWindowsDrive = /^[A-Za-z]:\//.test(value);
  const isPosixAbsolute = value.startsWith("/");
  const prefix = isWindowsDrive ? value.slice(0, 2) : "";
  const body = isWindowsDrive ? value.slice(2) : value;

  const parts = body
    .split("/")
    .filter((part) => part.length > 0 && part !== ".");

  const stack: string[] = [];

  for (const part of parts) {
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isPosixAbsolute && !isWindowsDrive) {
        stack.push(part);
      }
      continue;
    }

    stack.push(part);
  }

  const joined = stack.join("/");

  if (isWindowsDrive) {
    return joined ? `${prefix}/${joined}` : `${prefix}/`;
  }

  if (isPosixAbsolute) {
    return `/${joined}`;
  }

  return joined;
}
