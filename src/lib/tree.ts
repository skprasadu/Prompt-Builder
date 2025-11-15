import type { Node } from "../types/fs";
import { isDirNode } from "../types/fs";

/** ===== Public constants (change here, not in the UI) ===== */
export const FILE_TREE_DEPTH_LIMIT = 4;
export const FILE_TREE_ENTRY_LIMIT = 1500;
export const FILE_TREE_SHOW_ROOT_PATH = true;

/** Collect *file* paths (used for preserving selections). */
export function collectFilePaths(root: Node): Set<string> {
  const out = new Set<string>();
  function walk(n: Node) {
    if (isDirNode(n)) for (const c of n.children) walk(c);
    else out.add(n.path);
  }
  walk(root);
  return out;
}

/** Optional overrides (kept for future/programmability) */
export interface AsciiTreeOptions {
  depthLimit?: number;
  entryLimit?: number;
  showRootPath?: boolean;
}

/** Render the in-memory tree to a compact ASCII outline. */
export function toAsciiTree(root: Node, opts: Partial<AsciiTreeOptions> = {}): string {
  const depthLimit = opts.depthLimit ?? FILE_TREE_DEPTH_LIMIT;
  const entryLimit = Math.max(50, opts.entryLimit ?? FILE_TREE_ENTRY_LIMIT);
  const showRootPath = opts.showRootPath ?? FILE_TREE_SHOW_ROOT_PATH;

  const lines: string[] = [];
  let used = 0;

  const rootLabel = showRootPath ? `${root.name} (${root.path})` : root.name;
  lines.push(rootLabel + (isDirNode(root) ? "/" : ""));
  used++;

  function walk(node: Node, prefix: string, depth: number) {
    if (!isDirNode(node)) return;
    const children = node.children;
    const lastIdx = children.length - 1;

    for (let i = 0; i < children.length; i++) {
      if (used >= entryLimit) {
        lines.push(prefix + "… (+ more)");
        return;
      }
      const child: any = children[i];
      const isLast = i === lastIdx;
      const branch = isLast ? "└── " : "├── ";
      const nextPrefix = prefix + (isLast ? "    " : "│   ");

      if (isDirNode(child)) {
        lines.push(prefix + branch + child.name + "/");
        used++;
        if (depth + 1 < depthLimit) {
          walk(child, nextPrefix, depth + 1);
        } else if (child.children.length > 0) {
          if (used < entryLimit) {
            lines.push(nextPrefix + "…");
            used++;
          }
        }
      } else {
        lines.push(prefix + branch + child.name);
        used++;
      }
      if (used >= entryLimit) return;
    }
  }

  if (isDirNode(root)) walk(root, "", 0);
  return lines.join("\n");
}