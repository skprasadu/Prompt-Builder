import { readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { HtmlConfig, PromptUnit, RegexConfig } from "./types";

export async function extractRegexBlocks(filePath: string, config: RegexConfig): Promise<PromptUnit[]> {
  const text = await readFile(filePath, "utf8");
  const delimiter = new RegExp(config.delimiter, normalizeRegexFlags(config.flags, true));
  const idRegex = config.idCapture ? new RegExp(config.idCapture, normalizeRegexFlags(config.flags, false)) : null;

  const starts = Array.from(text.matchAll(delimiter))
    .map((match) => match.index ?? 0)
    .filter((index, position, values) => position === 0 || values[position - 1] !== index);

  if (starts.length === 0) {
    const body = text.trim();

    if (!body) {
      return [];
    }

    return [
      {
        id: captureId(body, idRegex) ?? "1",
        body,
      },
    ];
  }

  const boundaries = [0, ...starts, text.length]
    .filter((value, index, values) => index === 0 || values[index - 1] !== value)
    .sort((a, b) => a - b);

  const units: PromptUnit[] = [];

  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index] ?? 0;
    const end = boundaries[index + 1] ?? text.length;
    const body = text.slice(start, end).trim();

    if (!body) {
      continue;
    }

    units.push({
      id: captureId(body, idRegex) ?? String(units.length + 1),
      body,
    });
  }

  return units;
}

export async function extractHtmlBlocks(filePath: string, config: HtmlConfig): Promise<PromptUnit[]> {
  const text = await readFile(filePath, "utf8");
  const $ = cheerio.load(text);
  const units: PromptUnit[] = [];
  const idAttr = config.idAttr ?? "id";

  $(config.itemSelector).each((index, element) => {
    const item = $(element);
    const resolvedId = resolveHtmlId(item, idAttr, config.idSelector);
    const id = resolvedId.length > 0 ? resolvedId : String(index + 1);
    const body = resolveHtmlBody($, item, config.descSelector).trim();

    if (!body) {
      return;
    }

    units.push({ id, body });
  });

  return units;
}

function resolveHtmlId(
  item: cheerio.Cheerio<AnyNode>,
  idAttr: string,
  idSelector?: string,
): string {
  if (idSelector) {
    const selected = item.find(idSelector).first();

    if (selected.length > 0) {
      const attrValue = selected.attr(idAttr)?.trim();
      return attrValue && attrValue.length > 0 ? attrValue : selected.text().trim();
    }
  }

  return item.attr(idAttr)?.trim() ?? "";
}

function resolveHtmlBody(
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<AnyNode>,
  descSelector?: string,
): string {
  if (!descSelector) {
    return item.text().trim();
  }

  const parts: string[] = [];
  item.find(descSelector).each((_index, element) => {
    const text = $(element).text().trim();

    if (text) {
      parts.push(text);
    }
  });

  return parts.length > 0 ? parts.join("\n") : item.text().trim();
}

function captureId(body: string, regex: RegExp | null): string | null {
  if (!regex) {
    return null;
  }

  const match = regex.exec(body);
  return match?.[1] ?? null;
}

function normalizeRegexFlags(flags: string | undefined, forceGlobal: boolean): string {
  const out = new Set<string>();
  const allowed = new Set(["g", "i", "m", "s", "u", "y"]);

  for (const char of flags ?? "") {
    if (allowed.has(char)) {
      out.add(char);
    }
  }

  if (forceGlobal) {
    out.add("g");
  } else {
    out.delete("g");
  }

  return Array.from(out).join("");
}
