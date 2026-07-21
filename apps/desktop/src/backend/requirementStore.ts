import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

import type {
  RequirementCloseout,
  RequirementDetail,
  RequirementIteration,
  RequirementIterationMemory,
  RequirementIterationOutcome,
  RequirementSearchResult,
  RequirementStatus,
  RequirementSummary,
} from "@rapid-prompt/prompt-builder-contracts";

import { projectDir } from "./projectStore";

interface RequirementRow {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  status: RequirementStatus;
  createdAt: string;
  updatedAt: string;
  iterationCount: number;
}

interface IterationRow {
  id: string;
  requirementId: string;
  sequence: number;
  status: "draft" | "closed";
  instruction: string;
  assembledPrompt: string;
  aiOutput: string;
  selectedPathsJson: string;
  imageAttachmentSha256sJson: string;
  pdfAttachmentSha256sJson: string;
  patchAttachmentSha256sJson: string;
  patchChangedPathsJson: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

interface IterationMemoryRow {
  iterationId: string;
  summary: string;
  intent: string;
  outcome: RequirementIterationOutcome;
  decidedActionsJson: string;
  relevantFactsJson: string;
  unresolvedWorkJson: string;
  targetPathsJson: string;
  changedPathsJson: string;
  sourceHash: string;
  model: string;
  updatedAt: string;
}

interface CloseoutRow {
  requirementId: string;
  outcome: string;
  decisionsJson: string;
  reusablePatternsJson: string;
  rejectedApproachesJson: string;
  closedAt: string;
}

interface DraftInput {
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
}

export function createRequirement(args: {
  projectId: string;
  title: string;
  objective: string;
}): RequirementDetail {
  const now = new Date().toISOString();
  const id = `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const db = openCatalog(args.projectId);

  db.transaction(() => {
    db.prepare(`
      insert into requirements (
        id, project_id, title, objective, status, created_at, updated_at
      ) values (?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      args.projectId,
      requiredText(args.title, "Requirement title"),
      requiredText(args.objective, "Requirement objective"),
      now,
      now,
    );

    insertDraft(db, id, 1, now);
    refreshFts(db, id);
  })();

  return getRequirement({ projectId: args.projectId, requirementId: id });
}

export function listRequirements(projectId: string): RequirementSummary[] {
  const rows = openCatalog(projectId).prepare(`
    select
      r.id,
      r.project_id as projectId,
      r.title,
      r.objective,
      r.status,
      r.created_at as createdAt,
      r.updated_at as updatedAt,
      sum(case when i.status = 'closed' then 1 else 0 end) as iterationCount
    from requirements r
    left join requirement_iterations i on i.requirement_id = r.id
    where r.project_id = ?
    group by r.id
    order by case when r.status in ('completed', 'abandoned') then 1 else 0 end,
             r.updated_at desc
  `).all(projectId) as RequirementRow[];

  return rows.map(toSummary);
}

export function getRequirement(args: {
  projectId: string;
  requirementId: string;
}): RequirementDetail {
  const db = openCatalog(args.projectId);
  const row = db.prepare(`
    select
      r.id,
      r.project_id as projectId,
      r.title,
      r.objective,
      r.status,
      r.created_at as createdAt,
      r.updated_at as updatedAt,
      sum(case when i.status = 'closed' then 1 else 0 end) as iterationCount
    from requirements r
    left join requirement_iterations i on i.requirement_id = r.id
    where r.project_id = ? and r.id = ?
    group by r.id
  `).get(args.projectId, args.requirementId) as RequirementRow | undefined;

  if (!row) {
    throw new Error(`Requirement not found: ${args.requirementId}`);
  }

  const iterationRows = db.prepare(`
    select
      id,
      requirement_id as requirementId,
      sequence,
      status,
      instruction,
      coalesce(assembled_prompt, '') as assembledPrompt,
      ai_output as aiOutput,
      coalesce(selected_paths_json, '[]') as selectedPathsJson,
      coalesce(image_attachment_sha256s_json, '[]') as imageAttachmentSha256sJson,
      coalesce(pdf_attachment_sha256s_json, '[]') as pdfAttachmentSha256sJson,
      coalesce(patch_attachment_sha256s_json, '[]') as patchAttachmentSha256sJson,
      coalesce(patch_changed_paths_json, '[]') as patchChangedPathsJson,
      created_at as createdAt,
      updated_at as updatedAt,
      closed_at as closedAt
    from requirement_iterations
    where requirement_id = ?
    order by sequence
  `).all(args.requirementId) as IterationRow[];

  const memoryRows = db.prepare(`
    select
      iteration_id as iterationId,
      summary,
      intent,
      outcome,
      decided_actions_json as decidedActionsJson,
      relevant_facts_json as relevantFactsJson,
      unresolved_work_json as unresolvedWorkJson,
      target_paths_json as targetPathsJson,
      changed_paths_json as changedPathsJson,
      source_hash as sourceHash,
      model,
      updated_at as updatedAt
    from requirement_iteration_memory
    where requirement_id = ?
  `).all(args.requirementId) as IterationMemoryRow[];
  const memoryByIterationId = new Map(
    memoryRows.map((memory) => [memory.iterationId, toIterationMemory(memory)]),
  );

  const allIterations = iterationRows.map((iteration) =>
    toIteration(iteration, memoryByIterationId.get(iteration.id)),
  );
  const activeIteration = allIterations.find((item) => item.status === "draft");
  const iterations = allIterations.filter((item) => item.status === "closed");

  const closeout = db.prepare(`
    select
      requirement_id as requirementId,
      outcome,
      decisions_json as decisionsJson,
      reusable_patterns_json as reusablePatternsJson,
      rejected_approaches_json as rejectedApproachesJson,
      closed_at as closedAt
    from requirement_closeouts
    where requirement_id = ?
  `).get(args.requirementId) as CloseoutRow | undefined;

  return {
    ...toSummary(row),
    iterations,
    ...(activeIteration ? { activeIteration } : {}),
    ...(closeout ? { closeout: toCloseout(closeout) } : {}),
  };
}

export function ensureRequirementActiveIteration(args: {
  projectId: string;
  requirementId: string;
}): RequirementDetail {
  const current = getRequirement(args);

  if (
    current.status === "completed" ||
    current.status === "abandoned" ||
    current.activeIteration
  ) {
    return current;
  }

  const nextSequence =
    current.iterations.reduce(
      (maximum, iteration) =>
        Math.max(maximum, iteration.sequence),
      0,
    ) + 1;
  const now = new Date().toISOString();
  const db = openCatalog(args.projectId);

  db.transaction(() => {
    insertDraft(db, args.requirementId, nextSequence, now);

    db.prepare(`
      update requirements set status = 'active', updated_at = ?
      where project_id = ? and id = ?
    `).run(now, args.projectId, args.requirementId);

    refreshFts(db, args.requirementId);
  })();

  return getRequirement(args);
}

export function saveRequirementIteration(args: DraftInput): RequirementDetail {
  const current = getRequirement({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });
  const active = requireActive(current, args.iterationId);
  const now = new Date().toISOString();
  const db = openCatalog(args.projectId);

  db.prepare(`
    update requirement_iterations
    set instruction = ?,
        assembled_prompt = ?,
        ai_output = ?,
        selected_paths_json = ?,
        image_attachment_sha256s_json = ?,
        pdf_attachment_sha256s_json = ?,
        patch_attachment_sha256s_json = ?,
        patch_changed_paths_json = ?,
        updated_at = ?
    where id = ? and requirement_id = ? and status = 'draft'
  `).run(
    args.instruction.trim(),
    args.assembledPrompt.trim(),
    args.aiOutput.trim(),
    JSON.stringify(unique(args.selectedPaths)),
    JSON.stringify(unique(args.imageAttachmentSha256s)),
    JSON.stringify(unique(args.pdfAttachmentSha256s)),
    JSON.stringify(unique(args.patchAttachmentSha256s)),
    JSON.stringify(unique(args.patchChangedPaths)),
    now,
    active.id,
    args.requirementId,
  );

  db.prepare(`
    update requirements set updated_at = ?
    where project_id = ? and id = ?
  `).run(now, args.projectId, args.requirementId);

  refreshFts(db, args.requirementId);

  return getRequirement({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });
}

export function closeRequirementIteration(
  args: DraftInput,
): RequirementDetail {
  const current = getRequirement({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });
  const active = requireActive(current, args.iterationId);
  const instruction = requiredText(args.instruction, "Iteration instruction");
  const now = new Date().toISOString();
  const db = openCatalog(args.projectId);

  db.transaction(() => {
    db.prepare(`
      update requirement_iterations
      set status = 'closed',
          instruction = ?,
          assembled_prompt = ?,
          ai_output = ?,
          selected_paths_json = ?,
          image_attachment_sha256s_json = ?,
          pdf_attachment_sha256s_json = ?,
          patch_attachment_sha256s_json = ?,
          patch_changed_paths_json = ?,
          updated_at = ?,
          closed_at = ?
      where id = ? and requirement_id = ? and status = 'draft'
    `).run(
      instruction,
      args.assembledPrompt.trim(),
      args.aiOutput.trim(),
      JSON.stringify(unique(args.selectedPaths)),
      JSON.stringify(unique(args.imageAttachmentSha256s)),
      JSON.stringify(unique(args.pdfAttachmentSha256s)),
      JSON.stringify(unique(args.patchAttachmentSha256s)),
      JSON.stringify(unique(args.patchChangedPaths)),
      now,
      now,
      active.id,
      args.requirementId,
    );

    insertDraft(db, args.requirementId, active.sequence + 1, now);

    db.prepare(`
      update requirements set status = 'active', updated_at = ?
      where project_id = ? and id = ?
    `).run(now, args.projectId, args.requirementId);

    refreshFts(db, args.requirementId);
  })();

  return getRequirement({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });
}

export function closeRequirement(args: {
  projectId: string;
  requirementId: string;
  outcome: string;
  decisions: string[];
  reusablePatterns: string[];
  rejectedApproaches: string[];
}): RequirementDetail {
  const current = getRequirement({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });

  if (current.status === "completed") {
    throw new Error(`Requirement already completed: ${args.requirementId}`);
  }

  if (current.activeIteration && hasDraftContent(current.activeIteration)) {
    throw new Error(
      `Requirement ${args.requirementId} has unfinished Iteration ${current.activeIteration.sequence}. Close the iteration first.`,
    );
  }

  const now = new Date().toISOString();
  const db = openCatalog(args.projectId);

  db.transaction(() => {
    db.prepare(`
      delete from requirement_iterations
      where requirement_id = ? and status = 'draft'
    `).run(args.requirementId);

    db.prepare(`
      insert or replace into requirement_closeouts (
        requirement_id, outcome, decisions_json, reusable_patterns_json,
        rejected_approaches_json, changed_files_json, closed_at
      ) values (?, ?, ?, ?, ?, '[]', ?)
    `).run(
      args.requirementId,
      requiredText(args.outcome, "Requirement closeout outcome"),
      JSON.stringify(unique(args.decisions)),
      JSON.stringify(unique(args.reusablePatterns)),
      JSON.stringify(unique(args.rejectedApproaches)),
      now,
    );

    db.prepare(`
      update requirements set status = 'completed', updated_at = ?
      where project_id = ? and id = ?
    `).run(now, args.projectId, args.requirementId);

    refreshFts(db, args.requirementId);
  })();

  return getRequirement({
    projectId: args.projectId,
    requirementId: args.requirementId,
  });
}

export function refreshRequirementSearchIndex(args: {
  projectId: string;
  requirementId: string;
}): void {
  refreshFts(openCatalog(args.projectId), args.requirementId);
}

export function searchRequirements(args: {
  projectId: string;
  query: string;
  limit?: number;
}): RequirementSearchResult[] {
  const tokens = args.query.toLowerCase().match(/[a-z0-9_./-]{2,}/g);
  if (!tokens?.length) return [];

  const ftsQuery = Array.from(new Set(tokens))
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" OR ");
  const limit = Math.max(1, Math.min(args.limit ?? 30, 100));

  const rows = openCatalog(args.projectId).prepare(`
    select
      f.requirement_id as requirementId,
      f.title,
      f.objective,
      r.status,
      f.closeout_outcome as closeoutOutcome,
      bm25(requirements_fts) as rank
    from requirements_fts f
    join requirements r on r.id = f.requirement_id
    where f.project_id = ? and requirements_fts match ?
    order by rank
    limit ?
  `).all(args.projectId, ftsQuery, limit) as {
    requirementId: string;
    title: string;
    objective: string;
    status: RequirementStatus;
    closeoutOutcome: string;
    rank: number;
  }[];

  return rows.map((row) => ({
    requirementId: row.requirementId,
    title: row.title,
    objective: row.objective,
    status: row.status,
    closeoutOutcome: row.closeoutOutcome,
    score: -row.rank,
  }));
}

function openCatalog(projectId: string): Database.Database {
  const dir = path.join(projectDir(projectId), "index");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(path.join(dir, "rapid-prompt.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    create table if not exists requirements (
      id text primary key,
      project_id text not null,
      title text not null,
      objective text not null,
      status text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists requirement_iterations (
      id text primary key,
      requirement_id text not null,
      sequence integer not null,
      instruction text not null,
      assembled_prompt text not null,
      ai_output text not null,
      selected_paths_json text not null,
      image_attachment_sha256s_json text not null,
      pdf_attachment_sha256s_json text not null,
      patch_attachment_sha256s_json text not null,
      patch_changed_paths_json text not null,
      created_at text not null,
      updated_at text not null,
      closed_at text,
      unique(requirement_id, sequence),
      foreign key (requirement_id) references requirements(id) on delete cascade
    );

    create table if not exists requirement_closeouts (
      requirement_id text primary key,
      outcome text not null,
      decisions_json text not null,
      reusable_patterns_json text not null,
      rejected_approaches_json text not null,
      changed_files_json text not null,
      closed_at text not null,
      foreign key (requirement_id) references requirements(id) on delete cascade
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
  `);

  addColumn(db, "requirement_iterations", "status", "text not null default 'closed'");
  addColumn(db, "requirement_iterations", "assembled_prompt", "text not null default ''");
  addColumn(db, "requirement_iterations", "image_attachment_sha256s_json", "text not null default '[]'");
  addColumn(db, "requirement_iterations", "pdf_attachment_sha256s_json", "text not null default '[]'");
  addColumn(db, "requirement_iterations", "patch_attachment_sha256s_json", "text not null default '[]'");
  addColumn(db, "requirement_iterations", "patch_changed_paths_json", "text not null default '[]'");
  addColumn(db, "requirement_iterations", "updated_at", "text not null default ''");
  addColumn(db, "requirement_iterations", "closed_at", "text");

  db.exec(`
    update requirement_iterations
    set updated_at = created_at
    where updated_at = '';

    update requirement_iterations
    set closed_at = created_at
    where status = 'closed' and closed_at is null;
  `);

  const names = new Set(
    (
      db.prepare(
        "select name from pragma_table_info('requirements_fts')",
      ).all() as { name: string }[]
    ).map((item) => item.name),
  );

  if (!names.has("knowledge_text")) {
    db.exec(`
      drop table if exists requirements_fts;
      create virtual table requirements_fts using fts5(
        requirement_id unindexed,
        project_id unindexed,
        title,
        objective,
        knowledge_text,
        closeout_outcome,
        tokenize='porter unicode61'
      );
    `);

    const ids = db.prepare("select id from requirements").all() as {
      id: string;
    }[];
    ids.forEach(({ id }) => refreshFts(db, id));
  }
}

function addColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as {
    name: string;
  }[];

  if (!columns.some((item) => item.name === column)) {
    db.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

function insertDraft(
  db: Database.Database,
  requirementId: string,
  sequence: number,
  now: string,
): void {
  const tableColumns = db
    .prepare("pragma table_info(requirement_iterations)")
    .all() as {
    name: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }[];

  const valuesByColumn: Record<string, string | number | null> = {
    id: `iter_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    requirement_id: requirementId,
    sequence,
    status: "draft",
    instruction: "",
    assembled_prompt: "",
    ai_output: "",
    selected_paths_json: "[]",
    image_attachment_sha256s_json: "[]",
    pdf_attachment_sha256s_json: "[]",
    patch_attachment_sha256s_json: "[]",
    patch_changed_paths_json: "[]",
    created_at: now,
    updated_at: now,
    closed_at: null,

    // Legacy columns retained by databases created before the
    // simplified iteration model. They are populated only when present.
    kind: "code_change",
    memory_note: "",
    validation_notes: "",
    changed_files_json: "[]",
    branch: "",
    head_sha: "",
  };

  const insertColumns: string[] = [];
  const insertValues: (string | number | null)[] = [];

  for (const column of tableColumns) {
    if (Object.prototype.hasOwnProperty.call(valuesByColumn, column.name)) {
      insertColumns.push(column.name);
      insertValues.push(valuesByColumn[column.name] ?? null);
      continue;
    }

    const requiresExplicitValue =
      column.notnull === 1 &&
      column.dflt_value === null &&
      column.pk === 0;

    if (requiresExplicitValue) {
      throw new Error(
        `Unsupported required requirement_iterations column: ${column.name}`,
      );
    }
  }

  const placeholders = insertColumns.map(() => "?").join(", ");

  db.prepare(`
    insert into requirement_iterations (
      ${insertColumns.join(", ")}
    ) values (${placeholders})
  `).run(...insertValues);
}

function refreshFts(db: Database.Database, requirementId: string): void {
  const row = db.prepare(`
    select
      r.id,
      r.project_id as projectId,
      r.title,
      r.objective,
      coalesce((
        select group_concat(k.text, char(10))
        from requirement_knowledge k
        where k.requirement_id = r.id
      ), '') as knowledgeText,
      coalesce(c.outcome, '') as closeoutOutcome
    from requirements r
    left join requirement_closeouts c on c.requirement_id = r.id
    where r.id = ?
    group by r.id
  `).get(requirementId) as {
    id: string;
    projectId: string;
    title: string;
    objective: string;
    knowledgeText: string;
    closeoutOutcome: string;
  } | undefined;

  if (!row) {
    throw new Error(`Requirement missing while indexing: ${requirementId}`);
  }

  db.prepare("delete from requirements_fts where requirement_id = ?").run(requirementId);
  db.prepare(`
    insert into requirements_fts (
      requirement_id, project_id, title, objective,
      knowledge_text, closeout_outcome
    ) values (?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.projectId,
    row.title,
    row.objective,
    row.knowledgeText,
    row.closeoutOutcome,
  );
}

function toSummary(row: RequirementRow): RequirementSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    objective: row.objective,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    iterationCount: Number(row.iterationCount ?? 0),
  };
}

function toIteration(
  row: IterationRow,
  memory: RequirementIterationMemory | undefined,
): RequirementIteration {
  return {
    id: row.id,
    requirementId: row.requirementId,
    sequence: row.sequence,
    status: row.status,
    instruction: row.instruction,
    assembledPrompt: row.assembledPrompt,
    aiOutput: row.aiOutput,
    selectedPaths: parseStrings(row.selectedPathsJson, row.id),
    imageAttachmentSha256s: parseStrings(row.imageAttachmentSha256sJson, row.id),
    pdfAttachmentSha256s: parseStrings(row.pdfAttachmentSha256sJson, row.id),
    patchAttachmentSha256s: parseStrings(
      row.patchAttachmentSha256sJson,
      row.id,
    ),
    patchChangedPaths: parseStrings(row.patchChangedPathsJson, row.id),
    ...(memory ? { memory } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
    ...(row.closedAt ? { closedAt: row.closedAt } : {}),
  };
}

function toIterationMemory(
  row: IterationMemoryRow,
): RequirementIterationMemory {
  return {
    summary: row.summary,
    intent: row.intent,
    outcome: row.outcome,
    decidedActions: parseStrings(row.decidedActionsJson, row.iterationId),
    relevantFacts: parseStrings(row.relevantFactsJson, row.iterationId),
    unresolvedWork: parseStrings(row.unresolvedWorkJson, row.iterationId),
    targetPaths: parseStrings(row.targetPathsJson, row.iterationId),
    changedPaths: parseStrings(row.changedPathsJson, row.iterationId),
    sourceHash: row.sourceHash,
    model: row.model,
    updatedAt: row.updatedAt,
  };
}

function toCloseout(row: CloseoutRow): RequirementCloseout {
  return {
    requirementId: row.requirementId,
    outcome: row.outcome,
    decisions: parseStrings(row.decisionsJson, row.requirementId),
    reusablePatterns: parseStrings(row.reusablePatternsJson, row.requirementId),
    rejectedApproaches: parseStrings(row.rejectedApproachesJson, row.requirementId),
    closedAt: row.closedAt,
  };
}

function requireActive(
  requirement: RequirementDetail,
  iterationId: string,
): RequirementIteration {
  if (
    requirement.status === "completed" ||
    requirement.status === "abandoned"
  ) {
    throw new Error(`Requirement ${requirement.id} is ${requirement.status}.`);
  }

  const active = requirement.activeIteration;

  if (!active) {
    throw new Error(`Requirement ${requirement.id} has no active iteration.`);
  }

  if (active.id !== iterationId) {
    throw new Error(
      `Active iteration mismatch for requirement ${requirement.id}: expected ${active.id}, received ${iterationId}.`,
    );
  }

  return active;
}

function hasDraftContent(iteration: RequirementIteration): boolean {
  return Boolean(
    iteration.instruction.trim() ||
      iteration.aiOutput.trim() ||
      iteration.selectedPaths.length ||
      iteration.imageAttachmentSha256s.length ||
      iteration.pdfAttachmentSha256s.length ||
      iteration.patchAttachmentSha256s.length,
  );
}

function parseStrings(raw: string, owner: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error(`Invalid requirement string array: ${owner}`);
  }
  return parsed;
}

function unique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort();
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}
