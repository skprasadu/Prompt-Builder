import { existsSync, mkdirSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

import { getGitChangedFilesSnapshot, type GitChangedFilesSnapshot } from "./git/gitService";
import { getLocalProject, projectDir } from "./projectStore";

export type EntryPurpose = "software_implementation" | "research";

export interface CreateEntryArgs {
  projectId: string;
  purpose: EntryPurpose;
  name: string;
  description: string;
  notes: string;
  aiOutput: string;
  systemPrompt: string;
  promptText: string;
  selectedPaths: string[];
  includeTree: boolean;
  includeGitChangedFiles: boolean;
  tokenCount: number;
}

export interface EntrySummary {
  id: string;
  projectId: string;
  purpose: EntryPurpose;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  retentionDays: number;
  expiresAt: string;
  captureDir: string;
  changedFiles: string[];
}

export interface EntryArtifact {
  id: string;
  entryId: string;
  type: string;
  localPath: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
}

export interface EntryChunk {
  id: string;
  entryId: string;
  artifactId?: string;
  kind: string;
  text: string;
  tokenCount?: number;
}

export interface EntryDetail extends EntrySummary {
  userNotes: string;
  summary: string;
  syncStatus: string;
  artifacts: EntryArtifact[];
  chunks: EntryChunk[];
}

export interface EntrySearchResult {
  entryId: string;
  chunkId: string;
  entryPurpose: EntryPurpose;
  entryName: string;
  entryDescription: string;
  chunkKind: string;
  chunkText: string;
  createdAt: string;
  changedFiles: string[];
  score: number;
}

export interface DeleteEntryResult {
  entryId: string;
  deleted: boolean;
  captureDir: string;
}

export interface RagContextEntry {
  entryId: string;
  purpose: EntryPurpose;
  name: string;
  description: string;
  createdAt: string;
  changedFiles: string[];
  chunks: {
    chunkId: string;
    kind: string;
    text: string;
  }[];
}

export interface RagContextResult {
  query: string;
  contextMarkdown: string;
  entries: RagContextEntry[];
}

interface ArtifactRecord {
  id: string;
  type: string;
  fileName: string;
  localPath: string;
  sha256: string;
  sizeBytes: number;
}

interface ChunkRecord {
  id: string;
  kind: string;
  text: string;
  artifactId: string | null;
}

interface SqlEntryRow {
  id: string;
  projectId: string;
  purpose: EntryPurpose | null;
  name: string;
  description: string | null;
  userNotes: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  retentionDays: number | null;
  expiresAt: string | null;
  syncStatus: string;
  captureDir: string;
}

interface SqlArtifactRow {
  id: string;
  entryId: string;
  type: string;
  localPath: string | null;
  objectKey: string | null;
  sha256: string | null;
  sizeBytes: number | null;
}

interface SqlChunkRow {
  id: string;
  entryId: string;
  artifactId: string | null;
  kind: string;
  text: string;
  tokenCount: number | null;
}

interface SqlSearchRow {
  entryId: string;
  chunkId: string;
  entryPurpose: EntryPurpose | null;
  entryName: string;
  entryDescription: string | null;
  chunkKind: string;
  chunkText: string;
  createdAt: string;
  score: number;
}

interface SqlChangedFileRow {
  filePath: string;
}

interface SqlEntryPathRow {
  captureDir: string;
}

export async function createEntry(args: CreateEntryArgs): Promise<EntrySummary> {
  const now = new Date().toISOString();
  const retentionDays = 90;
  const expiresAt = addDaysIso(now, retentionDays);
  const entryId = `entry_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const captureDir = captureDirectory(args.projectId, now, entryId, args.name);
  const project = await getLocalProject(args.projectId);

  await mkdir(captureDir, { recursive: true });

  const gitSnapshot = args.includeGitChangedFiles
    ? await getGitChangedFilesSnapshot(project.rootPath)
    : null;

  const artifacts: ArtifactRecord[] = [];
  artifacts.push(await writeArtifact(entryId, captureDir, "system_prompt", "system-prompt.md", args.systemPrompt));
  artifacts.push(await writeArtifact(entryId, captureDir, "prompt", "prompt.md", args.promptText));
  artifacts.push(await writeArtifact(entryId, captureDir, "assistant_output", "output.md", args.aiOutput));
  artifacts.push(await writeArtifact(entryId, captureDir, "notes", "notes.md", args.notes));
  artifacts.push(
    await writeArtifact(
      entryId,
      captureDir,
      "selected_files",
      "selected-files.json",
      `${JSON.stringify(args.selectedPaths, null, 2)}\n`,
    ),
  );

  if (gitSnapshot) {
    artifacts.push(
      await writeArtifact(
        entryId,
        captureDir,
        "git_changed_files",
        "git-changed-files.json",
        `${JSON.stringify(gitSnapshot, null, 2)}\n`,
      ),
    );
    artifacts.push(
      await writeArtifact(
        entryId,
        captureDir,
        "git_changed_files_text",
        "git-changed-files.txt",
        gitSnapshot.changedFiles.join("\n") + (gitSnapshot.changedFiles.length > 0 ? "\n" : ""),
      ),
    );
  }

  const chunks = buildChunks(entryId, artifacts, {
    systemPrompt: args.systemPrompt,
    promptText: args.promptText,
    aiOutput: args.aiOutput,
    notes: args.notes,
    selectedPaths: args.selectedPaths,
    gitSnapshot,
  });

  await writeFile(
    path.join(captureDir, "chunks.jsonl"),
    chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + "\n",
    "utf8",
  );

  const changedFiles = gitSnapshot?.changedFiles ?? [];
  const manifest = {
    id: entryId,
    projectId: args.projectId,
    purpose: args.purpose,
    name: args.name,
    description: args.description,
    createdAt: now,
    updatedAt: now,
    retentionDays,
    expiresAt,
    source: {
      captureMethod: "manual-save",
    },
    includeTree: args.includeTree,
    includeGitChangedFiles: args.includeGitChangedFiles,
    tokenCount: args.tokenCount,
    changedFiles,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      path: artifact.fileName,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    })),
  };

  await writeFile(
    path.join(captureDir, "entry.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  indexEntry({
    projectId: args.projectId,
    entryId,
    purpose: args.purpose,
    name: args.name,
    description: args.description,
    notes: args.notes,
    createdAt: now,
    updatedAt: now,
    retentionDays,
    expiresAt,
    captureDir,
    artifacts,
    chunks,
    changedFiles,
  });

  return {
    id: entryId,
    projectId: args.projectId,
    purpose: args.purpose,
    name: args.name,
    description: args.description,
    createdAt: now,
    updatedAt: now,
    retentionDays,
    expiresAt,
    captureDir,
    changedFiles,
  };
}

export function listEntries(projectId: string): EntrySummary[] {
  const db = openCatalog(projectId);
  const rows = db
    .prepare(
      `
      select
        id,
        project_id as projectId,
        purpose,
        name,
        description,
        created_at as createdAt,
        updated_at as updatedAt,
        retention_days as retentionDays,
        expires_at as expiresAt,
        capture_dir as captureDir
      from entries
      where project_id = ?
      order by created_at desc
      limit 100
      `,
    )
    .all(projectId) as Omit<EntrySummary, "changedFiles">[];

  return rows.map((row) => ({
    ...row,
    description: row.description ?? "",
    purpose: row.purpose ?? "software_implementation",
    retentionDays: row.retentionDays ?? 90,
    expiresAt: row.expiresAt ?? "",
    changedFiles: getChangedFiles(db, row.id),
  }));
}

export function getEntryDetail(args: {
  projectId: string;
  entryId: string;
}): EntryDetail {
  const db = openCatalog(args.projectId);
  const row = db
    .prepare(
      `
      select
        id,
        project_id as projectId,
        purpose,
        name,
        description,
        user_notes as userNotes,
        summary,
        created_at as createdAt,
        updated_at as updatedAt,
        retention_days as retentionDays,
        expires_at as expiresAt,
        sync_status as syncStatus,
        capture_dir as captureDir
      from entries
      where project_id = ? and id = ?
      `,
    )
    .get(args.projectId, args.entryId) as SqlEntryRow | undefined;

  if (!row) {
    throw new Error(`Entry not found: ${args.entryId}`);
  }

  const artifacts = db
    .prepare(
      `
      select
        id,
        entry_id as entryId,
        type,
        local_path as localPath,
        object_key as objectKey,
        sha256,
        size_bytes as sizeBytes
      from artifacts
      where entry_id = ?
      order by type
      `,
    )
    .all(args.entryId) as SqlArtifactRow[];

  const chunks = db
    .prepare(
      `
      select
        id,
        entry_id as entryId,
        artifact_id as artifactId,
        kind,
        text,
        token_count as tokenCount
      from chunks
      where entry_id = ?
      order by id
      limit 80
      `,
    )
    .all(args.entryId) as SqlChunkRow[];

  return {
    id: row.id,
    projectId: row.projectId,
    purpose: row.purpose ?? "software_implementation",
    name: row.name,
    description: row.description ?? "",
    userNotes: row.userNotes ?? "",
    summary: row.summary ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    retentionDays: row.retentionDays ?? 90,
    expiresAt: row.expiresAt ?? "",
    syncStatus: row.syncStatus,
    captureDir: row.captureDir,
    changedFiles: getChangedFiles(db, row.id),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      entryId: artifact.entryId,
      type: artifact.type,
      localPath: artifact.localPath ?? "",
      objectKey: artifact.objectKey ?? "",
      sha256: artifact.sha256 ?? "",
      sizeBytes: artifact.sizeBytes ?? 0,
    })),
    chunks: chunks.map((chunk) => ({
      id: chunk.id,
      entryId: chunk.entryId,
      ...(chunk.artifactId ? { artifactId: chunk.artifactId } : {}),
      kind: chunk.kind,
      text: chunk.text,
      ...(chunk.tokenCount !== null ? { tokenCount: chunk.tokenCount } : {}),
    })),
  };
}

export async function deleteEntry(args: {
  projectId: string;
  entryId: string;
}): Promise<DeleteEntryResult> {
  const db = openCatalog(args.projectId);
  const row = db
    .prepare(
      `
      select capture_dir as captureDir
      from entries
      where project_id = ? and id = ?
      `,
    )
    .get(args.projectId, args.entryId) as SqlEntryPathRow | undefined;

  if (!row) {
    throw new Error(`Entry not found: ${args.entryId}`);
  }

  const deleteTx = db.transaction(() => {
    db.prepare(
      `
      delete from chunk_index_map
      where entry_id = ?
      `,
    ).run(args.entryId);

    db.prepare(
      `
      delete from chunks
      where entry_id = ?
      `,
    ).run(args.entryId);

    db.prepare(
      `
      delete from artifacts
      where entry_id = ?
      `,
    ).run(args.entryId);

    db.prepare(
      `
      delete from changed_files
      where entry_id = ?
      `,
    ).run(args.entryId);

    db.prepare(
      `
      delete from entry_tags
      where entry_id = ?
      `,
    ).run(args.entryId);

    db.prepare(
      `
      delete from sync_queue
      where entry_id = ?
      `,
    ).run(args.entryId);

    db.prepare(
      `
      delete from entries
      where project_id = ? and id = ?
      `,
    ).run(args.projectId, args.entryId);
  });

  deleteTx();

  await rm(row.captureDir, {
    recursive: true,
    force: true,
  });

  return {
    entryId: args.entryId,
    deleted: true,
    captureDir: row.captureDir,
  };
}

export function searchEntries(args: {
  projectId: string;
  query: string;
  limit?: number;
}): EntrySearchResult[] {
  const query = args.query.trim();

  if (!query) {
    return [];
  }

  const db = openCatalog(args.projectId);
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100));

  const rows = db
    .prepare(
      `
      select
        m.entry_id as entryId,
        m.chunk_id as chunkId,
        e.purpose as entryPurpose,
        e.name as entryName,
        e.description as entryDescription,
        c.kind as chunkKind,
        c.text as chunkText,
        e.created_at as createdAt,
        bm25(chunks_fts) as score
      from chunks_fts
      join chunk_index_map m on m.fts_rowid = chunks_fts.rowid
      join entries e on e.id = m.entry_id
      join chunks c on c.id = m.chunk_id
      where e.project_id = ? and chunks_fts match ?
      order by score
      limit ?
      `,
    )
    .all(args.projectId, toFtsQuery(query), limit) as SqlSearchRow[];

  return rows.map((row) => ({
    entryId: row.entryId,
    chunkId: row.chunkId,
    entryPurpose: row.entryPurpose ?? "software_implementation",
    entryName: row.entryName,
    entryDescription: row.entryDescription ?? "",
    chunkKind: row.chunkKind,
    chunkText: row.chunkText,
    createdAt: row.createdAt,
    changedFiles: getChangedFiles(db, row.entryId),
    score: row.score,
  }));
}

export function buildRagContext(args: {
  projectId: string;
  query: string;
  selectedEntryId?: string;
  limit?: number;
}): RagContextResult {
  const entriesById = new Map<string, RagContextEntry>();

  if (args.selectedEntryId) {
    const detail = getEntryDetail({
      projectId: args.projectId,
      entryId: args.selectedEntryId,
    });
    entriesById.set(detail.id, detailToRagEntry(detail));
  }

  const results = searchEntries({
    projectId: args.projectId,
    query: args.query,
    limit: args.limit ?? 8,
  });

  for (const result of results) {
    const current = entriesById.get(result.entryId) ?? {
      entryId: result.entryId,
      purpose: result.entryPurpose,
      name: result.entryName,
      description: result.entryDescription,
      createdAt: result.createdAt,
      changedFiles: result.changedFiles,
      chunks: [],
    };

    if (!current.chunks.some((chunk) => chunk.chunkId === result.chunkId)) {
      current.chunks.push({
        chunkId: result.chunkId,
        kind: result.chunkKind,
        text: result.chunkText,
      });
    }

    entriesById.set(result.entryId, current);
  }

  if (entriesById.size === 0) {
    for (const entry of listEntries(args.projectId).slice(0, 3)) {
      const detail = getEntryDetail({
        projectId: args.projectId,
        entryId: entry.id,
      });
      entriesById.set(detail.id, detailToRagEntry(detail));
    }
  }

  const entries = Array.from(entriesById.values());
  const contextMarkdown = renderRagContext(args.query, entries);

  return {
    query: args.query,
    contextMarkdown,
    entries,
  };
}

function indexEntry(args: {
  projectId: string;
  entryId: string;
  purpose: EntryPurpose;
  name: string;
  description: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  retentionDays: number;
  expiresAt: string;
  captureDir: string;
  artifacts: ArtifactRecord[];
  chunks: ChunkRecord[];
  changedFiles: string[];
}): void {
  const db = openCatalog(args.projectId);
  const insertEntry = db.prepare(
    `
    insert or replace into entries (
      id,
      project_id,
      purpose,
      name,
      description,
      user_notes,
      summary,
      created_at,
      updated_at,
      retention_days,
      expires_at,
      sync_status,
      storage_provider,
      bucket,
      object_prefix,
      content_sha256,
      capture_dir
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const insertArtifact = db.prepare(
    `
    insert or replace into artifacts (
      id,
      entry_id,
      type,
      local_path,
      object_key,
      sha256,
      size_bytes
    ) values (?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const insertChunk = db.prepare(
    `
    insert or replace into chunks (
      id,
      entry_id,
      artifact_id,
      kind,
      text,
      token_count,
      object_key,
      byte_start,
      byte_end
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const insertFts = db.prepare(
    `
    insert into chunks_fts (
      entry_name,
      entry_description,
      user_notes,
      summary,
      chunk_text,
      tags,
      changed_files
    ) values (?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const insertMap = db.prepare(
    `
    insert or replace into chunk_index_map (
      fts_rowid,
      chunk_id,
      entry_id
    ) values (?, ?, ?)
    `,
  );

  const insertChangedFile = db.prepare(
    `
    insert into changed_files (
      entry_id,
      file_path
    ) values (?, ?)
    `,
  );

  const tx = db.transaction(() => {
    insertEntry.run(
      args.entryId,
      args.projectId,
      args.purpose,
      args.name,
      args.description,
      args.notes,
      "",
      args.createdAt,
      args.updatedAt,
      args.retentionDays,
      args.expiresAt,
      "local_only",
      "local",
      "",
      "",
      "",
      args.captureDir,
    );

    for (const artifact of args.artifacts) {
      insertArtifact.run(
        artifact.id,
        args.entryId,
        artifact.type,
        artifact.localPath,
        "",
        artifact.sha256,
        artifact.sizeBytes,
      );
    }

    for (const changedFile of args.changedFiles) {
      insertChangedFile.run(args.entryId, changedFile);
    }

    const changedFilesText = args.changedFiles.join("\n");

    for (const chunk of args.chunks) {
      insertChunk.run(
        chunk.id,
        args.entryId,
        chunk.artifactId,
        chunk.kind,
        chunk.text,
        estimateTokenCount(chunk.text),
        "",
        null,
        null,
      );

      const ftsResult = insertFts.run(
        args.name,
        args.description,
        args.notes,
        "",
        chunk.text,
        "",
        changedFilesText,
      );

      insertMap.run(Number(ftsResult.lastInsertRowid), chunk.id, args.entryId);
    }
  });

  tx();
}

function openCatalog(projectId: string): Database.Database {
  const dir = path.join(projectDir(projectId), "index");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path.join(dir, "rapid-prompt.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);

  return db;
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    create table if not exists entries (
      id text primary key,
      project_id text not null,
      purpose text not null default 'software_implementation',
      name text not null,
      description text,
      user_notes text,
      summary text,
      created_at text not null,
      updated_at text not null,
      retention_days integer not null default 90,
      expires_at text,
      sync_status text not null,
      storage_provider text,
      bucket text,
      object_prefix text,
      content_sha256 text,
      capture_dir text not null
    );

    create table if not exists artifacts (
      id text primary key,
      entry_id text not null,
      type text not null,
      local_path text,
      object_key text,
      sha256 text,
      size_bytes integer,
      foreign key (entry_id) references entries(id)
    );

    create table if not exists chunks (
      id text primary key,
      entry_id text not null,
      artifact_id text,
      kind text not null,
      text text not null,
      token_count integer,
      object_key text,
      byte_start integer,
      byte_end integer,
      foreign key (entry_id) references entries(id)
    );

    create virtual table if not exists chunks_fts using fts5(
      entry_name,
      entry_description,
      user_notes,
      summary,
      chunk_text,
      tags,
      changed_files,
      content='',
      tokenize='porter unicode61'
    );

    create table if not exists chunk_index_map (
      fts_rowid integer primary key,
      chunk_id text not null,
      entry_id text not null
    );

    create table if not exists entry_tags (
      entry_id text not null,
      tag text not null
    );

    create table if not exists changed_files (
      entry_id text not null,
      file_path text not null
    );

    create table if not exists sync_queue (
      id text primary key,
      entry_id text not null,
      operation text not null,
      status text not null,
      retry_count integer default 0,
      last_error text,
      created_at text not null,
      updated_at text not null
    );
  `);

  ensureEntrySchemaMigrations(db);
}

function ensureEntrySchemaMigrations(db: Database.Database): void {
  const rows = db.prepare("pragma table_info(entries)").all() as { name: string }[];
  const columns = new Set(rows.map((row) => row.name));

  if (!columns.has("purpose")) {
    db.exec("alter table entries add column purpose text not null default 'software_implementation'");
  }

  if (!columns.has("retention_days")) {
    db.exec("alter table entries add column retention_days integer not null default 90");
  }

  if (!columns.has("expires_at")) {
    db.exec("alter table entries add column expires_at text");
  }
}

async function writeArtifact(
  entryId: string,
  captureDir: string,
  type: string,
  fileName: string,
  contents: string,
): Promise<ArtifactRecord> {
  const filePath = path.join(captureDir, fileName);
  await writeFile(filePath, contents, "utf8");

  const fileStats = await stat(filePath);

  return {
    id: `${entryId}_${type}`,
    type,
    fileName,
    localPath: filePath,
    sha256: sha256(contents),
    sizeBytes: fileStats.size,
  };
}

function buildChunks(
  entryId: string,
  artifacts: ArtifactRecord[],
  content: {
    systemPrompt: string;
    promptText: string;
    aiOutput: string;
    notes: string;
    selectedPaths: string[];
    gitSnapshot: GitChangedFilesSnapshot | null;
  },
): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];

  addTextChunks(chunks, entryId, "system_prompt", content.systemPrompt, artifactId(artifacts, "system_prompt"));
  addTextChunks(chunks, entryId, "prompt", content.promptText, artifactId(artifacts, "prompt"));
  addTextChunks(chunks, entryId, "assistant_output", content.aiOutput, artifactId(artifacts, "assistant_output"));
  addTextChunks(chunks, entryId, "notes", content.notes, artifactId(artifacts, "notes"));
  addTextChunks(chunks, entryId, "selected_files", content.selectedPaths.join("\n"), artifactId(artifacts, "selected_files"));

  if (content.gitSnapshot) {
    addTextChunks(
      chunks,
      entryId,
      "git_changed_files",
      content.gitSnapshot.changedFiles.join("\n"),
      artifactId(artifacts, "git_changed_files_text"),
    );
  }

  return chunks;
}

function addTextChunks(
  chunks: ChunkRecord[],
  entryId: string,
  kind: string,
  text: string,
  artifactIdValue: string | null,
): void {
  const cleanText = text.trim();

  if (!cleanText) {
    return;
  }

  const maxLength = 2000;
  let index = 0;

  for (let offset = 0; offset < cleanText.length; offset += maxLength) {
    const slice = cleanText.slice(offset, offset + maxLength).trim();

    if (!slice) {
      continue;
    }

    index += 1;
    chunks.push({
      id: `${entryId}_${kind}_${String(index).padStart(4, "0")}`,
      kind,
      text: slice,
      artifactId: artifactIdValue,
    });
  }
}

function getChangedFiles(db: Database.Database, entryId: string): string[] {
  const rows = db
    .prepare(
      `
      select file_path as filePath
      from changed_files
      where entry_id = ?
      order by file_path
      `,
    )
    .all(entryId) as SqlChangedFileRow[];

  return rows.map((row) => row.filePath);
}

function detailToRagEntry(detail: EntryDetail): RagContextEntry {
  return {
    entryId: detail.id,
    purpose: detail.purpose,
    name: detail.name,
    description: detail.description,
    createdAt: detail.createdAt,
    changedFiles: detail.changedFiles,
    chunks: detail.chunks.slice(0, 12).map((chunk) => ({
      chunkId: chunk.id,
      kind: chunk.kind,
      text: chunk.text,
    })),
  };
}

function renderRagContext(query: string, entries: RagContextEntry[]): string {
  const lines: string[] = [
    "# Query",
    query,
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
    lines.push("Matched chunks:");
    entry.chunks.slice(0, 5).forEach((chunk) => {
      lines.push(`- ${chunk.kind}: ${chunk.text}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

function artifactId(artifacts: ArtifactRecord[], type: string): string | null {
  return artifacts.find((artifact) => artifact.type === type)?.id ?? null;
}

function captureDirectory(
  projectId: string,
  createdAt: string,
  entryId: string,
  name: string,
): string {
  const date = new Date(createdAt);
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const slug = sanitizeName(name).slice(0, 48);

  return path.join(
    projectDir(projectId),
    "captures",
    year,
    month,
    day,
    `${entryId}_${slug}`,
  );
}

function sanitizeName(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "entry";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function estimateTokenCount(value: string): number {
  return Math.ceil(value.length / 4);
}

function toFtsQuery(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.replace(/["']/g, "").trim())
    .filter((part) => part.length > 0)
    .map((part) => `"${part}"`)
    .join(" ");
}

function addDaysIso(value: string, days: number): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
