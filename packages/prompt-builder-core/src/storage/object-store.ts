export interface ObjectStore {
  putObject(args: {
    key: string;
    body: Uint8Array | string;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ bucket: string; key: string; uri: string }>;

  getObject(args: {
    key: string;
  }): Promise<Uint8Array>;

  listObjects(args: {
    prefix: string;
  }): Promise<{ key: string; size: number; updatedAt?: string }[]>;
}
