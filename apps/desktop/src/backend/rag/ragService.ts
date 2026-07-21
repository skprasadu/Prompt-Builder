import {
  getEntryDetail,
  listEntries,
  type EntryDetail,
  type EntryPurpose,
  type RagContextEntry,
  type RagContextResult,
} from "../entryStore";
import { askOpenAi } from "../llm/openAiClient";

export type InsightIntentId =
  | "daily_engineering_logs"
  | "research_notes"
  | "linkedin_posts"
  | "technical_blog_drafts"
  | "architecture_explainers"
  | "implementation_summaries"
  | "lessons_learned";

export interface RagAnswer {
  answer: string;
  context: RagContextResult;
  model: string;
}

interface InsightIntentSpec {
  id: InsightIntentId;
  title: string;
  instruction: string;
  scope: "today-software" | "today-research" | "today-all" | "selected-or-best" | "selected-or-architecture" | "selected-or-today-software";
  maxEntries: number;
}

const INSIGHT_INTENTS: Record<InsightIntentId, InsightIntentSpec> = {
  daily_engineering_logs: {
    id: "daily_engineering_logs",
    title: "Daily engineering log",
    scope: "today-software",
    maxEntries: 16,
    instruction:
      "Create a daily engineering log across today's software implementation entries. Include what was built, why it mattered, key files changed, decisions, risks, lessons, and next actions. Make it publishable and concrete.",
  },
  research_notes: {
    id: "research_notes",
    title: "Research notes",
    scope: "today-research",
    maxEntries: 16,
    instruction:
      "Create rigorous research notes across today's research entries. Extract the question, investigation path, findings, evidence, assumptions, open questions, and reusable insights.",
  },
  linkedin_posts: {
    id: "linkedin_posts",
    title: "LinkedIn post",
    scope: "selected-or-best",
    maxEntries: 6,
    instruction:
      "Draft a thoughtful LinkedIn post. Lead with the hard problem, explain the insight demystified, mention the engineering or research angle, and close with a practical takeaway. Avoid hype and sales language.",
  },
  technical_blog_drafts: {
    id: "technical_blog_drafts",
    title: "Technical blog draft",
    scope: "selected-or-best",
    maxEntries: 6,
    instruction:
      "Draft a technical blog post with a title, thesis, problem context, implementation or research details, key decisions, tradeoffs, lessons learned, and conclusion.",
  },
  architecture_explainers: {
    id: "architecture_explainers",
    title: "Architecture explainer",
    scope: "selected-or-architecture",
    maxEntries: 8,
    instruction:
      "Create an architecture explainer. Explain components, boundaries, data flow, responsibilities, tradeoffs, failure modes, and why the design is pragmatic.",
  },
  implementation_summaries: {
    id: "implementation_summaries",
    title: "Implementation summary",
    scope: "selected-or-today-software",
    maxEntries: 10,
    instruction:
      "Create an implementation summary. Focus on what changed, where it changed, why it changed, important files, APIs or contracts touched, validation needed, and remaining gaps.",
  },
  lessons_learned: {
    id: "lessons_learned",
    title: "Lessons learned",
    scope: "today-all",
    maxEntries: 16,
    instruction:
      "Extract durable lessons learned across today's entries. Focus on mistakes avoided, tradeoffs discovered, reusable patterns, and principles that should guide future work.",
  },
};

export async function generateInsight(args: {
  projectId: string;
  intentId: string;
  selectedEntryId?: string;
}): Promise<RagAnswer> {
  const spec = getInsightIntentSpec(args.intentId);
  const context = buildInsightContext({
    projectId: args.projectId,
    spec,
    ...(args.selectedEntryId ? { selectedEntryId: args.selectedEntryId } : {}),
  });

  const prompt = [
    "You are Rapid Prompt's technical insights assistant.",
    "Write only from the retrieved project memory below.",
    "Produce Markdown.",
    "Be concrete, clear, technically credible, and useful for publishing.",
    "Avoid hype, filler, generic summaries, and fake certainty.",
    "If context is thin, state what is missing and produce the best useful draft possible.",
    "",
    "# Insight type",
    spec.title,
    "",
    "# Instruction",
    spec.instruction,
    "",
    context.contextMarkdown,
  ].join("\n");

  const result = await askOpenAi({ prompt });

  return {
    answer: result.answer,
    context,
    model: result.model,
  };
}

function getInsightIntentSpec(intentId: string): InsightIntentSpec {
  if (isInsightIntentId(intentId)) {
    return INSIGHT_INTENTS[intentId];
  }

  throw new Error(`Unknown insight intent: ${intentId}`);
}

function isInsightIntentId(value: string): value is InsightIntentId {
  return Object.prototype.hasOwnProperty.call(INSIGHT_INTENTS, value);
}

function buildInsightContext(args: {
  projectId: string;
  spec: InsightIntentSpec;
  selectedEntryId?: string;
}): RagContextResult {
  const details = selectInsightEntries(args);
  const entries = details.map((detail) => detailToContextEntry(detail));

  return {
    query: args.spec.title,
    entries,
    contextMarkdown: renderInsightContext(args.spec, entries),
  };
}

function selectInsightEntries(args: {
  projectId: string;
  spec: InsightIntentSpec;
  selectedEntryId?: string;
}): EntryDetail[] {
  if (shouldUseSelectedEntry(args.spec, args.selectedEntryId)) {
    return [
      getEntryDetail({
        projectId: args.projectId,
        entryId: args.selectedEntryId,
      }),
    ];
  }

  const summaries = listEntries(args.projectId);
  const today = summaries.filter((entry) => isToday(entry.createdAt));

  switch (args.spec.scope) {
    case "today-software":
      return detailsFor(args.projectId, fallbackRecent(filterPurpose(today, "software_implementation"), summaries), args.spec.maxEntries);

    case "today-research":
      return detailsFor(args.projectId, fallbackRecent(filterPurpose(today, "research"), summaries), args.spec.maxEntries);

    case "today-all":
      return detailsFor(args.projectId, fallbackRecent(today, summaries), args.spec.maxEntries);

    case "selected-or-today-software":
      return detailsFor(args.projectId, fallbackRecent(filterPurpose(today, "software_implementation"), summaries), args.spec.maxEntries);

    case "selected-or-architecture": {
      const architectureEntries = summaries.filter(isArchitectureRelated);
      return detailsFor(args.projectId, fallbackRecent(architectureEntries, summaries), args.spec.maxEntries);
    }

    case "selected-or-best":
      return detailsFor(args.projectId, rankBest(fallbackRecent(today, summaries)), args.spec.maxEntries);
  }
}

function shouldUseSelectedEntry(
  spec: InsightIntentSpec,
  selectedEntryId: string | undefined,
): selectedEntryId is string {
  return Boolean(
    selectedEntryId &&
      (spec.scope === "selected-or-best" ||
        spec.scope === "selected-or-architecture" ||
        spec.scope === "selected-or-today-software"),
  );
}

function detailsFor(
  projectId: string,
  entries: { id: string }[],
  maxEntries: number,
): EntryDetail[] {
  return entries.slice(0, maxEntries).map((entry) =>
    getEntryDetail({
      projectId,
      entryId: entry.id,
    }),
  );
}

function filterPurpose<T extends { purpose: EntryPurpose }>(
  entries: T[],
  purpose: EntryPurpose,
): T[] {
  return entries.filter((entry) => entry.purpose === purpose);
}

function fallbackRecent<T>(primary: T[], fallback: T[]): T[] {
  return primary.length > 0 ? primary : fallback;
}

function rankBest<T extends {
  description: string;
  changedFiles: string[];
  createdAt: string;
}>(entries: T[]): T[] {
  return [...entries].sort((a, b) => scoreEntry(b) - scoreEntry(a));
}

function scoreEntry(entry: {
  description: string;
  changedFiles: string[];
  createdAt: string;
}): number {
  return (
    (entry.description.trim() ? 10 : 0) +
    Math.min(entry.changedFiles.length, 10) +
    new Date(entry.createdAt).getTime() / 1_000_000_000_000
  );
}

function isArchitectureRelated(entry: {
  name: string;
  description: string;
  changedFiles: string[];
}): boolean {
  const text = `${entry.name} ${entry.description} ${entry.changedFiles.join(" ")}`.toLowerCase();

  return [
    "architecture",
    "architect",
    "design",
    "boundary",
    "workflow",
    "rag",
    "sqlite",
    "storage",
    "cloud",
    "electron",
    "ipc",
    "service",
  ].some((term) => text.includes(term));
}

function isToday(value: string): boolean {
  return localDateKey(new Date(value)) === localDateKey(new Date());
}

function detailToContextEntry(detail: EntryDetail): RagContextEntry {
  return {
    entryId: detail.id,
    purpose: detail.purpose,
    name: detail.name,
    description: detail.description,
    createdAt: detail.createdAt,
    changedFiles: detail.changedFiles,
    chunks: selectImportantChunks(detail).map((chunk) => ({
      chunkId: chunk.id,
      kind: chunk.kind,
      text: truncateText(chunk.text, 1400),
    })),
  };
}

function selectImportantChunks(detail: EntryDetail): EntryDetail["chunks"] {
  const preferredKinds = [
    "notes",
    "assistant_output",
    "git_changed_files",
    "prompt",
    "selected_files",
  ];

  const selected = detail.chunks
    .filter((chunk) => preferredKinds.includes(chunk.kind))
    .slice(0, 8);

  return selected.length > 0 ? selected : detail.chunks.slice(0, 8);
}

function renderInsightContext(
  spec: InsightIntentSpec,
  entries: RagContextEntry[],
): string {
  const lines: string[] = [
    "# Scope",
    describeScope(spec),
    "",
    "# Retrieved Entries",
    "",
  ];

  if (entries.length === 0) {
    lines.push("No matching entries were found.");
    return lines.join("\n");
  }

  for (const entry of entries) {
    lines.push(`## ${entry.name}`);
    lines.push(`Entry ID: ${entry.entryId}`);
    lines.push(`Purpose: ${entry.purpose}`);
    lines.push(`Created: ${entry.createdAt}`);

    if (entry.description) {
      lines.push(`Description: ${entry.description}`);
    }

    if (entry.changedFiles.length > 0) {
      lines.push("");
      lines.push("Changed files:");
      entry.changedFiles.slice(0, 40).forEach((filePath) => {
        lines.push(`- ${filePath}`);
      });
    }

    lines.push("");
    lines.push("Evidence:");
    entry.chunks.forEach((chunk) => {
      lines.push(`### ${chunk.kind}`);
      lines.push(chunk.text);
      lines.push("");
    });
  }

  return lines.join("\n");
}

function describeScope(spec: InsightIntentSpec): string {
  switch (spec.scope) {
    case "today-software":
      return "All today's Software Implementation entries. Falls back to recent entries if needed.";
    case "today-research":
      return "All today's Research entries. Falls back to recent entries if needed.";
    case "today-all":
      return "Today's entries across both purposes. Falls back to recent entries if needed.";
    case "selected-or-best":
      return "Selected entry if present; otherwise today's best entries.";
    case "selected-or-architecture":
      return "Selected entry if present; otherwise architecture-related entries.";
    case "selected-or-today-software":
      return "Selected entry if present; otherwise today's Software Implementation entries.";
  }
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}\n...`;
}
