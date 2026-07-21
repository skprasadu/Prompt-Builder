import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitChangedFilesSnapshot {
  repoRoot: string;
  branch: string;
  headSha: string;
  isGitRepo: boolean;
  isDirty: boolean;
  changedFiles: string[];
  capturedAt: string;
}

interface ParsedStatusEntry {
  filePath: string;
}

export async function getGitChangedFilesSnapshot(repoRoot: string): Promise<GitChangedFilesSnapshot> {
  const capturedAt = new Date().toISOString();

  if (!repoRoot.trim()) {
    return emptySnapshot(repoRoot, capturedAt);
  }

  try {
    const [branch, headSha, statusOutput] = await Promise.all([
      runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
      runGit(repoRoot, ["rev-parse", "HEAD"]),
      runGit(repoRoot, ["status", "--porcelain=v1", "-z"]),
    ]);

    const changedFiles = parsePorcelainStatus(statusOutput.stdout)
      .map((entry) => entry.filePath)
      .filter((filePath, index, all) => filePath.length > 0 && all.indexOf(filePath) === index)
      .sort((left, right) => left.localeCompare(right));

    return {
      repoRoot,
      branch: branch.stdout.trim(),
      headSha: headSha.stdout.trim(),
      isGitRepo: true,
      isDirty: changedFiles.length > 0,
      changedFiles,
      capturedAt,
    };
  } catch {
    return emptySnapshot(repoRoot, capturedAt);
  }
}

async function runGit(repoRoot: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("git", ["-C", repoRoot, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parsePorcelainStatus(output: string): ParsedStatusEntry[] {
  const parts = output.split("\0").filter((part) => part.length > 0);
  const entries: ParsedStatusEntry[] = [];
  let index = 0;

  while (index < parts.length) {
    const record = parts[index] ?? "";
    const status = record.slice(0, 2);
    const rawPath = record.slice(3);

    if (status.includes("R") || status.includes("C")) {
      const targetPath = parts[index + 1] ?? rawPath;
      entries.push({ filePath: targetPath });
      index += 2;
      continue;
    }

    entries.push({ filePath: rawPath });
    index += 1;
  }

  return entries;
}

function emptySnapshot(repoRoot: string, capturedAt: string): GitChangedFilesSnapshot {
  return {
    repoRoot,
    branch: "",
    headSha: "",
    isGitRepo: false,
    isDirty: false,
    changedFiles: [],
    capturedAt,
  };
}
