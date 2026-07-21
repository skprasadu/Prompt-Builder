export interface SearchChunk {
  id: string;
  entryId: string;
  artifactId?: string;
  kind: string;
  text: string;
  tokenCount?: number;
}

export interface SearchResult {
  entryId: string;
  chunkId: string;
  entryName: string;
  chunkKind: string;
  chunkText: string;
  score: number;
}
