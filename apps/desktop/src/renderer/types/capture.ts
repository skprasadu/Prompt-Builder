export type EntryPurpose = "software_implementation" | "research";

export interface ImageAttachment {
  id: string;
  projectId: string;
  sourcePath: string;
  storedPath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  addedAt: string;
}

export type ImageInsightStatus = "completed" | "failed";

export interface ImageInsight {
  imageId: string;
  sha256: string;
  fileName: string;
  status: ImageInsightStatus;
  summary: string;
  visibleText: string[];
  technicalTags: string[];
  uiElements: string[];
  implementationHints: string[];
  researchConcepts: string[];
  rawAnswer: string;
  model?: string;
  error?: string;
  generatedAt: string;
}

export interface PromptWorkflowState {
  projectId: string;
  rootPath: string;
  systemPrompt: string;
  promptText: string;
  selectedPaths: string[];
  imageAttachments: ImageAttachment[];
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
  imageAttachments: ImageAttachment[];
  folderPanelWidth: number;
  updatedAt: string;
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
  imageAttachments: ImageAttachment[];
  imageInsights: ImageInsight[];
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

export interface CreateEntryInput {
  projectId: string;
  purpose: EntryPurpose;
  name: string;
  description: string;
  notes: string;
  aiOutput: string;
  systemPrompt: string;
  promptText: string;
  selectedPaths: string[];
  imageAttachments: ImageAttachment[];
  includeTree: boolean;
  includeGitChangedFiles: boolean;
  tokenCount: number;
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

export interface RagAnswer {
  answer: string;
  context: RagContextResult;
  model: string;
}
