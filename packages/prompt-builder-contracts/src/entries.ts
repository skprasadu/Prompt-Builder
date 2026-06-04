export type EntryKind = "manual_capture" | "insight" | "imported";

export type EntryPurpose = "software_implementation" | "research";

export type ArtifactType =
  | "system_prompt"
  | "prompt"
  | "assistant_output"
  | "notes"
  | "selected_files"
  | "git_changed_files"
  | "git_changed_files_text"
  | "manifest"
  | "chunks";

export type ArtifactStorageState =
  | "local_only"
  | "sync_pending"
  | "synced_cached"
  | "synced_evicted"
  | "sync_failed";

export interface EntryManifest {
  id: string;
  projectId: string;
  kind: EntryKind;
  purpose: EntryPurpose;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  retentionDays: number;
  expiresAt: string;
  source: {
    captureMethod: "manual-save" | "generated-insight" | "import";
    model?: string;
  };
  artifacts: ArtifactManifest[];
  tags: string[];
  keywords: string[];
  changedFiles: string[];
  summary?: string;
}

export interface ArtifactManifest {
  id: string;
  entryId: string;
  type: ArtifactType;
  path: string;
  sha256: string;
  sizeBytes: number;
  localPath?: string;
  objectKey?: string;
  uri?: string;
  storageState: ArtifactStorageState;
}
