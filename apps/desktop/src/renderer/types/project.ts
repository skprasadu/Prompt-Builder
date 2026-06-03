export interface LocalProject {
  id: string;
  name: string;
  rootPath: string;
  rootPathHash: string;
  cloudProjectId?: string;
  defaultSystemPromptPath: string;
  createdAt: string;
  updatedAt: string;
}
