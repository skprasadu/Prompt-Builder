// src/lib/formatters.ts
import type { FileValue } from "../types/fs";
import type { Node } from "../types/fs";
import { toAsciiTree } from "./tree";

export interface OutputOptions {
  includeTree?: boolean;
  treeRoot?: Node | null;

  // NEW: when in Excel/Block mode we add one focused unit
  unit?: { title?: string; body: string } | null;
  systemPrompt?: string; // NEW
}

export function formatOutput(
  textarea: string,
  files: FileValue[],
  options: OutputOptions = {}
): string {
  const parts: string[] = [];

  // System Prompt
  const sys = (options.systemPrompt ?? "").trim();
  if (sys.length > 0) {
    parts.push("# System Prompt", "", sys, "");
  }

  // Prompt
  parts.push("# Prompt", "", textarea.trimEnd(), "");

  // Focused unit (Excel/Block)
  if (options.unit && options.unit.body.trim().length > 0) {
    parts.push("## Unit", "");
    if (options.unit.title) parts.push(`**${options.unit.title}**`, "");
    const fence = fenceFor(options.unit.body);
    parts.push(fence, options.unit.body.replace(/\r\n/g, "\n"), fence, "");
  }

  // NEW: overview of selected file paths (folder mode convenience)
  if (files.length > 0) {
    parts.push("## File paths", "");
    for (const { filePath } of files) {
      parts.push(`- ${filePath}`);
    }
    parts.push("");
  }

  // Files (Folder mode)  unchanged behavior for content
  parts.push("## Files", "");
  if (files.length === 0) {
    parts.push("_(no files selected)_", "");
  } else {
    for (const { filePath, value } of files) {
      const lang = langFromPath(filePath);
      const fence = fenceFor(value);
      parts.push(
        `### ${filePath}`,
        `${fence}${lang ? lang : ""}`,
        value.replace(/\r\n/g, "\n"),
        fence,
        ""
      );
    }
  }

  // Optional file tree
  if (options.includeTree && options.treeRoot) {
    const treeText = toAsciiTree(options.treeRoot);
    const fence = fenceFor(treeText);
    parts.push("## File Tree", "");
    parts.push(fence, treeText, fence, "");
  }

  return parts.join("\n").trimEnd() + "\n";
}

/* helpers (unchanged) */
function fenceFor(content: string): string {
  let longest = 0;
  const matches = content.match(/`+/g);
  if (matches) for (const m of matches) longest = Math.max(longest, m.length);
  const len = Math.max(3, longest + 1);
  return "`".repeat(len);
}
function langFromPath(p: string): string {
  const ext = p.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "ts", tsx: "tsx", js: "javascript", jsx: "jsx",
    json: "json", md: "markdown", rs: "rust", py: "python", sh: "bash",
    yml: "yaml", yaml: "yaml", toml: "toml", css: "css", scss: "scss",
    html: "html", java: "java", kt: "kotlin", go: "go",
    c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp"
  };
  return map[ext] ?? "";
}