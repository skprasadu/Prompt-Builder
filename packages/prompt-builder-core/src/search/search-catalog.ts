export interface SearchCatalogEntry {
  id: string;
  projectId: string;
  name: string;
  description: string;
  userNotes?: string;
  summary?: string;
  changedFiles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SearchCatalogChunk {
  id: string;
  entryId: string;
  artifactId?: string;
  kind: string;
  text: string;
  tokenCount?: number;
}

export interface SearchCatalogResult {
  entryId: string;
  chunkId: string;
  entryName: string;
  chunkKind: string;
  chunkText: string;
  score: number;
}

export interface SearchCatalog {
  indexEntry(args: {
    entry: SearchCatalogEntry;
    chunks: SearchCatalogChunk[];
  }): Promise<void>;

  search(args: {
    projectId: string;
    query: string;
    limit: number;
  }): Promise<SearchCatalogResult[]>;
}
