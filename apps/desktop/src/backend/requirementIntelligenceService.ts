import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import type {
  RequirementCloseoutDraft,
  RequirementDetail,
  RequirementIterationOutcome,
  RequirementKnowledgeKind,
  RequirementPromptCompilation,
} from "@rapid-prompt/prompt-builder-contracts";

import { askOpenAi } from "./llm/openAiClient";
import { projectDir } from "./projectStore";
import {
  closeRequirementIteration,
  getRequirement,
  refreshRequirementSearchIndex,
} from "./requirementStore";

interface KnowledgeCandidate {
  kind: RequirementKnowledgeKind;
  text: string;
  keywords: string[];
}

interface KnowledgeRow {
  id: string;
  kind: RequirementKnowledgeKind;
  text: string;
  keywordsJson: string;
}

interface IterationMemoryCandidate {
  summary: string;
  intent: string;
  outcome: RequirementIterationOutcome;
  decidedActions: string[];
  relevantFacts: string[];
  unresolvedWork: string[];
}

export async function extractRequirementIterationKnowledge(args: {
  projectId: string;
  requirementId: string;
  iterationId: string;
  instruction: string;
  aiOutput: string;
  selectedPaths: string[];
  patchAttachmentSha256s: string[];
  patchChangedPaths: string[];
}): Promise<void> {
  if (!args.aiOutput.trim()) {
    return;
  }

  const sourceHash = createHash("sha256")
    .update(
      JSON.stringify({
        instruction: args.instruction.trim(),
        aiOutput: args.aiOutput.trim(),
        selectedPaths: [...args.selectedPaths].sort(),
        patchAttachmentSha256s: [...args.patchAttachmentSha256s].sort(),
        patchChangedPaths: [...args.patchChangedPaths].sort(),
      }),
    )
    .digest("hex");

  const db = openCatalog(args.projectId);
  const existingKnowledge = db.prepare(`
    select count(*) as count
    from requirement_knowledge
    where project_id = ?
      and requirement_id = ?
      and iteration_id = ?
      and source_hash = ?
  `).get(
    args.projectId,
    args.requirementId,
    args.iterationId,
    sourceHash,
  ) as { count: number };
  const existingMemory = db.prepare(`
    select count(*) as count
    from requirement_iteration_memory
    where requirement_id = ?
      and iteration_id = ?
      and source_hash = ?
  `).get(
    args.requirementId,
    args.iterationId,
    sourceHash,
  ) as { count: number };

  if (existingKnowledge.count > 0 && existingMemory.count > 0) {
    return;
  }

  const result = await askOpenAi({
    prompt: [
      "Extract high-signal engineering memory from this iteration.",
      "Return JSON only:",
      '{"memory":{"summary":"2 or 3 concise sentences","intent":"one concise sentence","outcome":"completed|partial|failed|unknown","decidedActions":["concise action"],"relevantFacts":["durable fact"],"unresolvedWork":["remaining work"]},"items":[{"kind":"decision|implementation|constraint|issue","text":"one concise factual sentence","keywords":["search terms"]}]}',
      "The summary must be under 700 characters.",
      "Return at most 5 decided actions, 6 relevant facts, 4 unresolved items, and 10 knowledge items.",
      "Exclude patch source, shell commands, generic validation advice, repeated prose, and temporary syntax details unless they reveal a durable engineering lesson.",
      "Do not invent successful validation, changed files, or completed work.",
      "",
      "# Instruction",
      args.instruction.trim(),
      "",
      "# Selected files",
      ...(args.selectedPaths.length
        ? args.selectedPaths.map((value) => `- ${value}`)
        : ["- None"]),
      "",
      "# Deterministic changed files",
      ...(args.patchChangedPaths.length
        ? args.patchChangedPaths.map((value) => `- ${value}`)
        : ["- None"]),
      "",
      "# AI response",
      truncate(args.aiOutput, 12000),
    ].join("\n"),
  });

  const parsed = parseJson(result.answer);
  const memory = parseIterationMemory(parsed?.memory);
  const candidates = parseKnowledgeItems(parsed?.items);
  const now = new Date().toISOString();

  db.transaction(() => {
    const oldIds = db.prepare(`
      select id
      from requirement_knowledge
      where project_id = ?
        and requirement_id = ?
        and iteration_id = ?
    `).all(
      args.projectId,
      args.requirementId,
      args.iterationId,
    ) as { id: string }[];

    for (const row of oldIds) {
      db.prepare(
        "delete from requirement_knowledge_fts where id = ?",
      ).run(row.id);
    }

    db.prepare(`
      delete from requirement_knowledge
      where project_id = ?
        and requirement_id = ?
        and iteration_id = ?
    `).run(
      args.projectId,
      args.requirementId,
      args.iterationId,
    );

    const insert = db.prepare(`
      insert into requirement_knowledge (
        id, project_id, requirement_id, iteration_id,
        kind, text, keywords_json, source_hash,
        created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      insert into requirement_knowledge_fts (
        id, project_id, requirement_id, iteration_id,
        kind, text, keywords
      ) values (?, ?, ?, ?, ?, ?, ?)
    `);

    db.prepare(`
      insert into requirement_iteration_memory (
        iteration_id, requirement_id, summary, intent, outcome,
        decided_actions_json, relevant_facts_json,
        unresolved_work_json, target_paths_json, changed_paths_json,
        source_hash, model, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(iteration_id) do update set
        summary = excluded.summary,
        intent = excluded.intent,
        outcome = excluded.outcome,
        decided_actions_json = excluded.decided_actions_json,
        relevant_facts_json = excluded.relevant_facts_json,
        unresolved_work_json = excluded.unresolved_work_json,
        target_paths_json = excluded.target_paths_json,
        changed_paths_json = excluded.changed_paths_json,
        source_hash = excluded.source_hash,
        model = excluded.model,
        updated_at = excluded.updated_at
    `).run(
      args.iterationId,
      args.requirementId,
      memory.summary,
      memory.intent,
      memory.outcome,
      JSON.stringify(memory.decidedActions),
      JSON.stringify(memory.relevantFacts),
      JSON.stringify(memory.unresolvedWork),
      JSON.stringify(unique(args.selectedPaths)),
      JSON.stringify(unique(args.patchChangedPaths)),
      sourceHash,
      result.model,
      now,
      now,
    );

    for (const candidate of candidates) {
      const id = `know_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const keywords = unique(candidate.keywords).slice(0, 12);

      insert.run(
        id,
        args.projectId,
        args.requirementId,
        args.iterationId,
        candidate.kind,
        candidate.text,
        JSON.stringify(keywords),
        sourceHash,
        now,
        now,
      );
      insertFts.run(
        id,
        args.projectId,
        args.requirementId,
        args.iterationId,
        candidate.kind,
        candidate.text,
        keywords.join(" "),
      );
    }
  })();

  refreshRequirementSearchIndex({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });
}

export async function refreshRequirementIterationMemories(args: {
  projectId: string;
  requirementId: string;
}): Promise<RequirementDetail> {
  const requirement = getRequirement(args);

  for (const iteration of requirement.iterations) {
    await extractRequirementIterationKnowledge({
      projectId: args.projectId,
      requirementId: args.requirementId,
      iterationId: iteration.id,
      instruction: iteration.instruction,
      aiOutput: iteration.aiOutput,
      selectedPaths: iteration.selectedPaths,
      patchAttachmentSha256s: iteration.patchAttachmentSha256s,
      patchChangedPaths: iteration.patchChangedPaths,
    });
  }

  return getRequirement(args);
}

export async function compileRequirementPrompt(args: {
  projectId: string;
  requirementId: string;
  instruction: string;
  baseSystemPrompt: string;
  selectedPaths: string[];
}): Promise<RequirementPromptCompilation> {
  const requirement = getRequirement({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });
  const knowledge = searchKnowledge({
    projectId: args.projectId,
    requirementId: args.requirementId,
    query: `${args.instruction} ${args.selectedPaths.join(" ")}`,
  });

  const result = await askOpenAi({
    prompt: [
      "Create a system prompt for one engineering request.",
      "Return only 4 or 5 concise sentences.",
      "No heading, bullets, preamble, or Markdown.",
      "Use only constraints and implementation facts relevant to the current instruction.",
      "Do not repeat the instruction and do not mention irrelevant subsystems.",
      "",
      "# Project baseline",
      truncate(args.baseSystemPrompt, 5000) || "No baseline provided.",
      "",
      "# Requirement",
      requirement.title,
      requirement.objective,
      "",
      "# Current instruction",
      args.instruction.trim(),
      "",
      "# Selected files",
      ...(args.selectedPaths.length
        ? args.selectedPaths.map((value) => `- ${value}`)
        : ["- None"]),
      "",
      "# Relevant knowledge",
      ...(knowledge.length
        ? knowledge.map((item) => `- [${item.kind}] ${item.text}`)
        : ["- No extracted knowledge matched."]),
    ].join("\n"),
  });

  const systemPrompt = normalizeSentences(result.answer, 5);

  if (!systemPrompt) {
    throw new Error("LLM prompt compilation returned an empty system prompt.");
  }

  return {
    systemPrompt,
    model: result.model,
  };
}

export async function prepareRequirementCloseout(args: {
  projectId: string;
  requirementId: string;
}): Promise<RequirementCloseoutDraft> {
  const requirement = getRequirement(args);
  const knowledge = listKnowledge(args);

  const result = await askOpenAi({
    prompt: [
      "Prepare a requirement closeout for user review.",
      "Return one concise paragraph of 3 to 5 sentences.",
      "State the outcome, durable decisions, and unresolved work.",
      "No headings, bullets, boilerplate, patch scripts, or invented validation.",
      "",
      "# Requirement",
      requirement.title,
      requirement.objective,
      "",
      "# Iteration instructions",
      ...requirement.iterations.map(
        (iteration) =>
          `- Iteration ${iteration.sequence}: ${truncate(iteration.instruction, 700)}`,
      ),
      "",
      "# Extracted knowledge",
      ...(knowledge.length
        ? knowledge.map((item) => `- [${item.kind}] ${item.text}`)
        : ["- No extracted knowledge is available."]),
    ].join("\n"),
  });

  const summary = result.answer.replace(/\s+/g, " ").trim();

  if (!summary) {
    throw new Error("LLM requirement closeout returned an empty summary.");
  }

  return {
    summary: summary.slice(0, 1600),
    model: result.model,
  };
}

export async function closeRequirementIterationWithKnowledge(args: {
  projectId: string;
  requirementId: string;
  iterationId: string;
  instruction: string;
  assembledPrompt: string;
  aiOutput: string;
  selectedPaths: string[];
  imageAttachmentSha256s: string[];
  pdfAttachmentSha256s: string[];
  patchAttachmentSha256s: string[];
  patchChangedPaths: string[];
}) {
  await extractRequirementIterationKnowledge({
    projectId: args.projectId,
    requirementId: args.requirementId,
    iterationId: args.iterationId,
    instruction: args.instruction,
    aiOutput: args.aiOutput,
    selectedPaths: args.selectedPaths,
    patchAttachmentSha256s: args.patchAttachmentSha256s,
    patchChangedPaths: args.patchChangedPaths,
  });

  return closeRequirementIteration(args);
}

function openCatalog(projectId: string): Database.Database {
  const dir = path.join(projectDir(projectId), "index");

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path.join(dir, "rapid-prompt.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    create table if not exists requirement_knowledge (
      id text primary key,
      project_id text not null,
      requirement_id text not null,
      iteration_id text not null,
      kind text not null,
      text text not null,
      keywords_json text not null,
      source_hash text not null,
      created_at text not null,
      updated_at text not null,
      foreign key (requirement_id) references requirements(id) on delete cascade,
      foreign key (iteration_id) references requirement_iterations(id) on delete cascade
    );

    create unique index if not exists idx_requirement_knowledge_source
      on requirement_knowledge(
        project_id,
        requirement_id,
        iteration_id,
        source_hash,
        kind,
        text
      );

    create table if not exists requirement_iteration_memory (
      iteration_id text primary key,
      requirement_id text not null,
      summary text not null,
      intent text not null,
      outcome text not null,
      decided_actions_json text not null,
      relevant_facts_json text not null,
      unresolved_work_json text not null,
      target_paths_json text not null,
      changed_paths_json text not null,
      source_hash text not null,
      model text not null,
      created_at text not null,
      updated_at text not null,
      foreign key (requirement_id) references requirements(id) on delete cascade,
      foreign key (iteration_id) references requirement_iterations(id) on delete cascade
    );

    create virtual table if not exists requirement_knowledge_fts using fts5(
      id unindexed,
      project_id unindexed,
      requirement_id unindexed,
      iteration_id unindexed,
      kind,
      text,
      keywords,
      tokenize='porter unicode61'
    );
  `);
  return db;
}

function searchKnowledge(args: {
  projectId: string;
  requirementId: string;
  query: string;
}): KnowledgeRow[] {
  const tokens = args.query.toLowerCase().match(/[a-z0-9_./-]{2,}/g);
  const db = openCatalog(args.projectId);

  if (!tokens?.length) {
    return listKnowledge(args).slice(-12);
  }

  const query = Array.from(new Set(tokens))
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" OR ");

  return db.prepare(`
    select
      k.id,
      k.kind,
      k.text,
      k.keywords_json as keywordsJson
    from requirement_knowledge_fts f
    join requirement_knowledge k on k.id = f.id
    where f.project_id = ?
      and f.requirement_id = ?
      and requirement_knowledge_fts match ?
    order by bm25(requirement_knowledge_fts)
    limit 12
  `).all(
    args.projectId,
    args.requirementId,
    query,
  ) as KnowledgeRow[];
}

function listKnowledge(args: {
  projectId: string;
  requirementId: string;
}): KnowledgeRow[] {
  return openCatalog(args.projectId).prepare(`
    select
      id,
      kind,
      text,
      keywords_json as keywordsJson
    from requirement_knowledge
    where project_id = ?
      and requirement_id = ?
    order by created_at, id
  `).all(
    args.projectId,
    args.requirementId,
  ) as KnowledgeRow[];
}

function parseIterationMemory(value: unknown): IterationMemoryCandidate {
  if (!isRecord(value)) {
    throw new Error("LLM iteration memory extraction returned no memory object.");
  }

  const summary = normalizedText(value.summary, 700);
  const intent = normalizedText(value.intent, 320);
  const outcome = toOutcome(value.outcome);

  if (!summary || !intent || !outcome) {
    throw new Error("LLM iteration memory extraction returned invalid memory.");
  }

  return {
    summary,
    intent,
    outcome,
    decidedActions: stringArray(value.decidedActions, 5),
    relevantFacts: stringArray(value.relevantFacts, 6),
    unresolvedWork: stringArray(value.unresolvedWork, 4),
  };
}

function parseKnowledgeItems(value: unknown): KnowledgeCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error("LLM knowledge extraction returned no items array.");
  }

  const output: KnowledgeCandidate[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const kind = toKind(item.kind);
    const text = normalizedText(item.text, 320);
    const keywords = Array.isArray(item.keywords)
      ? item.keywords.filter(
          (keyword): keyword is string => typeof keyword === "string",
        )
      : [];

    if (!kind || !text) {
      continue;
    }

    const key = `${kind}:${text.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push({ kind, text, keywords });
    }

    if (output.length >= 10) {
      break;
    }
  }

  if (!output.length) {
    throw new Error("LLM knowledge extraction returned no valid items.");
  }

  return output;
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      const value = JSON.parse(raw.slice(start, end + 1)) as unknown;
      return isRecord(value) ? value : null;
    } catch {
      return null;
    }
  }
}

function toKind(value: unknown): RequirementKnowledgeKind | null {
  return value === "decision" ||
    value === "implementation" ||
    value === "constraint" ||
    value === "issue"
    ? value
    : null;
}

function toOutcome(value: unknown): RequirementIterationOutcome | null {
  return value === "completed" ||
    value === "partial" ||
    value === "failed" ||
    value === "unknown"
    ? value
    : null;
}

function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return unique(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizedText(item, 320))
      .filter(Boolean),
  ).slice(0, limit);
}

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function normalizeSentences(value: string, limit: number): string {
  const cleaned = value
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^#+\s*/gm, "")
    .trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];

  return sentences
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, limit)
    .join(" ");
}

function unique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort();
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength).trimEnd()}\n...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
