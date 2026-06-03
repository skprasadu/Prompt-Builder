import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FileValue } from "./types";

export async function readAsciiFiles(paths: string[], maxBytes = 512 * 1024): Promise<FileValue[]> {
  const out: FileValue[] = [];

  for (const filePath of paths) {
    const fileStat = await safeStat(filePath);
    if (!fileStat?.isFile()) {
      continue;
    }

    const value = await readAsciiFile(filePath, maxBytes);
    out.push({ filePath, value });
  }

  return out;
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function readAsciiFile(filePath: string, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let seen = 0;

    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });

    stream.on("data", (chunk: string | Buffer) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (seen >= maxBytes) {
        stream.destroy();
        return;
      }

      const available = Math.max(0, maxBytes - seen);
      const taken = buffer.subarray(0, available);
      chunks.push(taken);
      seen += taken.length;

      if (seen >= maxBytes) {
        stream.destroy();
      }
    });

    stream.on("error", reject);
    stream.on("close", () => resolve(asciiOnly(Buffer.concat(chunks))));
  });
}

function asciiOnly(buffer: Buffer): string {
  let out = "";

  for (const byte of buffer) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      out += String.fromCharCode(byte);
    }
  }

  return out;
}
