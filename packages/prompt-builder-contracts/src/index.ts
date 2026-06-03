export interface ContextPackFileRef {
  relativePath: string;
  contentHash?: string;
  sizeBytes?: number;
}

export interface ContextPackDraft {
  workspaceId: string;
  title: string;
  systemPrompt: string;
  userPrompt: string;
  selectedFiles: ContextPackFileRef[];
  includeTree: boolean;
  tokenCount: number;
  payloadObjectPath?: string;
}

export interface AiRunDraft {
  contextPackId: string;
  modelProvider: string;
  modelName: string;
  rawOutputObjectPath?: string;
  rawOutputText?: string;
}

export interface DevelopmentEpisodeDraft {
  workspaceId: string;
  title: string;
  bugFixed?: string;
  changeSummary?: string;
  contextPack?: ContextPackDraft;
  aiRun?: AiRunDraft;
  changedFiles?: ContextPackFileRef[];
}

export interface ApiAcceptedResponse {
  status: "accepted";
  id?: string;
}
