import { readFile } from "node:fs/promises";
import type { ApiTable, PromptUnit } from "./types";

export async function fetchApiTable(endpoint: string, filePath: string): Promise<ApiTable> {
  const data = await readFile(filePath, "utf8");
  const response = await postJson(endpoint, { data });
  return toApiTable(response);
}

export async function fetchApiTableFromUrl(endpoint: string, url: string): Promise<ApiTable> {
  const html = await fetchText(url);
  const response = await postJson(endpoint, { data: html });
  return toApiTable(response);
}

export async function extractApiUnits(
  endpoint: string,
  filePath: string,
  which: string,
  headers?: Record<string, string>,
): Promise<PromptUnit[]> {
  const html = await readFile(filePath, "utf8");
  const response = await postJson(endpoint, { html }, headers);
  const list = findArray(response) ?? [response];
  const bodyKey = which.toLowerCase().startsWith("n") ? "notes_text" : "items_text";
  const units: PromptUnit[] = [];

  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }

    const id = stringValue(item.code).trim();
    const body = stringValue(item[bodyKey]).trim();

    if (id && body) {
      units.push({ id, body });
    }
  }

  return units;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) RapidPrompt/1.0",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}`);
  }

  return response.text();
}

async function postJson(
  endpoint: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status} from ${endpoint}`);
  }

  return response.json() as Promise<unknown>;
}

function toApiTable(value: unknown): ApiTable {
  const objects = findArrayOfObjects(value);

  if (objects.length === 0) {
    throw new Error("No array of objects in API response.");
  }

  const columns = Array.from(
    objects.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  ).sort();

  const rows = objects.map((row) => {
    const out: Record<string, string> = {};

    for (const column of columns) {
      out[column] = stringValue(row[column]);
    }

    return out;
  });

  return { columns, rows };
}

function findArrayOfObjects(value: unknown): Record<string, unknown>[] {
  const array = findArray(value);

  if (!array) {
    return [];
  }

  return array.filter(isRecord);
}

function findArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const key of ["items", "rows", "data", "result", "notes", "records"]) {
    const candidate = value[key];

    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  for (const candidate of Object.values(value)) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}
