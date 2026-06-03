export type DirNode = {
  name: string;
  path: string;
  isDir: true;
  children: Node[]; // directories always carry children
};

export type FileLeaf = {
  name: string;
  path: string;
  isDir: false;
  // no children
};

export type Node = DirNode | FileLeaf;

export interface FileValue {
  filePath: string;
  value: string; // ASCII only
}

// Narrowing guard
export function isDirNode(n: Node): n is DirNode {
  return n.isDir === true;
}