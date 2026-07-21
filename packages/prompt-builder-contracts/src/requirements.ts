export type RequirementStatus =
  | "draft"
  | "active"
  | "blocked"
  | "validating"
  | "completed"
  | "abandoned";

export type RequirementIterationStatus = "draft" | "closed";

export type RequirementKnowledgeKind =
  | "decision"
  | "implementation"
  | "constraint"
  | "issue";

export type RequirementIterationOutcome =
  | "completed"
  | "partial"
  | "failed"
  | "unknown";

export interface RequirementIterationMemory {
  summary: string;
  intent: string;
  outcome: RequirementIterationOutcome;
  decidedActions: string[];
  relevantFacts: string[];
  unresolvedWork: string[];
  targetPaths: string[];
  changedPaths: string[];
  sourceHash: string;
  model: string;
  updatedAt: string;
}

export interface RequirementPromptCompilation {
  systemPrompt: string;
  model: string;
}

export interface RequirementCloseoutDraft {
  summary: string;
  model: string;
}

export interface PythonPatchAttachment {
  id: string;
  projectId: string;
  sourcePath: string;
  storedPath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  changedPaths: string[];
  addedAt: string;
}

export interface BinaryAttachmentPreview {
  kind: "image" | "pdf";
  fileName: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  sha256: string;
}

export interface PythonAttachmentPreview {
  kind: "python";
  fileName: string;
  text: string;
  truncated: boolean;
  sizeBytes: number;
  sha256: string;
}

export type AttachmentPreview =
  | BinaryAttachmentPreview
  | PythonAttachmentPreview;

export interface RequirementSummary {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  status: RequirementStatus;
  createdAt: string;
  updatedAt: string;
  iterationCount: number;
}

export interface RequirementIteration {
  id: string;
  requirementId: string;
  sequence: number;
  status: RequirementIterationStatus;
  instruction: string;
  assembledPrompt: string;
  aiOutput: string;
  selectedPaths: string[];
  imageAttachmentSha256s: string[];
  pdfAttachmentSha256s: string[];
  patchAttachmentSha256s: string[];
  patchChangedPaths: string[];
  memory?: RequirementIterationMemory;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface RequirementCloseout {
  requirementId: string;
  outcome: string;
  decisions: string[];
  reusablePatterns: string[];
  rejectedApproaches: string[];
  closedAt: string;
}

export interface RequirementDetail extends RequirementSummary {
  iterations: RequirementIteration[];
  activeIteration?: RequirementIteration;
  closeout?: RequirementCloseout;
}

export interface RequirementSearchResult {
  requirementId: string;
  title: string;
  objective: string;
  status: RequirementStatus;
  closeoutOutcome: string;
  score: number;
}
