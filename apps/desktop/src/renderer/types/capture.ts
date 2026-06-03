export interface PromptWorkflowState {
  projectId: string;
  rootPath: string;
  systemPrompt: string;
  promptText: string;
  selectedPaths: string[];
  includeTree: boolean;
  tokenCount: number;
  folderPanelWidth: number;
  updatedAt: string;
}

export interface LocalProjectState {
  promptText: string;
  includeTree: boolean;
  selectedPaths: string[];
  expandedPaths: string[];
  folderPanelWidth: number;
  updatedAt: string;
}

export interface EntrySummary {
  id: string;
  projectId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
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
  entryName: string;
  entryDescription: string;
  chunkKind: string;
  chunkText: string;
  createdAt: string;
  changedFiles: string[];
  score: number;
}

export interface CreateEntryInput {
  projectId: string;
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

export interface RagContextEntry {
  entryId: string;
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

export interface RagAnswer {
  answer: string;
  context: RagContextResult;
  model: string;
}
