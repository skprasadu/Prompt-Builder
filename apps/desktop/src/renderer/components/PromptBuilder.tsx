// src/App.tsx
import { useEffect, useRef, useState, type JSX } from "react";
import {
  getDesktopWindow as getCurrentWindow,
  invoke,
  openDialog as open,
  writeClipboardText as writeText,
} from "../lib/desktop";

import type { Node, FileValue } from "../types/fs";
import type { LocalProject } from "../types/project";
import { isDirNode } from "../types/fs";
import { formatOutput, type OutputOptions } from "../lib/formatters";
import { countTokens } from "../lib/tokenize";
import { toErrorMessage } from "../lib/errors";
import { TreeView } from "../components/TreeView";
import { ResizableSplitter } from "../components/ResizableSplitter";
import { FolderPathSelector } from "../components/FolderPathSelector";
import { collectFilePaths } from "../lib/tree";
import { resolveTreeSelectionFromPathInput } from "../lib/pathSelection";

import type { SessionFileV4 } from "../types/session";
import {
  toSessionV4,
  exportSession,
  importSession,
  resolveSelected,
  resolveUnitSource,
  toRelative,            // <-- add this
} from "../lib/session";

import type {
  PromptUnit,
  ExcelInspector,
  ExcelConfig,
  RegexConfig,
  HtmlConfig,
  Mode,
  UnitConfig,
  ApiTable,
} from "../types/units";

// MUI
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
  Checkbox,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  ToggleButton,
  ToggleButtonGroup,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";

import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import brandSvg from "../assets/brand.svg";

function normalizeRootFromRust(raw: Node): Node {
  if (isDirNode(raw)) return { ...raw, children: raw.children ?? [] };
  return raw;
}

const FOLDER_PANEL_DEFAULT_WIDTH = 360;
const FOLDER_PANEL_MIN_WIDTH = 280;
const FOLDER_PANEL_MAX_WIDTH = 640;
const FOLDER_PANEL_SPLITTER_WIDTH = 8;

export interface PromptBuilderProps {
  project?: LocalProject | null;
}

export default function PromptBuilder({ project = null }: PromptBuilderProps): JSX.Element {
  const [mode, setMode] = useState<Mode>("folder");

  const [rootPath, setRootPath] = useState<string>("");
  const [tree, setTree] = useState<Node | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const [systemPrompt, setSystemPrompt] = useState<string>(""); // NEW
  const [text, setText] = useState<string>("");
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Folder-only toggle
  const [includeTree, setIncludeTree] = useState<boolean>(false);

  // Units (Excel/Block/API)
  const [unitSource, setUnitSource] = useState<string>(""); // absolute path
  const [units, setUnits] = useState<PromptUnit[]>([]);
  const [unitIndex, setUnitIndex] = useState<number>(0);

  // Excel inspector + config
  const [excelInspect, setExcelInspect] = useState<ExcelInspector | null>(null);
  const [excelSheet, setExcelSheet] = useState<string>("");
  const [excelIdCol, setExcelIdCol] = useState<string>("");
  const [excelDescCols, setExcelDescCols] = useState<string[]>([]);

  // Block config
  const [blockKind, setBlockKind] = useState<"regex" | "html" | "api">("regex");
  const [regexDelimiter, setRegexDelimiter] = useState<string>("^ID:\\s");
  const [regexIdCapture, setRegexIdCapture] = useState<string>("^ID:\\s*(\\S+)");
  const [regexFlags, setRegexFlags] = useState<string>("m");

  const [htmlItemSel, setHtmlItemSel] = useState<string>(".item");
  const [htmlIdSel, setHtmlIdSel] = useState<string>("");
  const [htmlIdAttr, setHtmlIdAttr] = useState<string>("id");
  const [htmlDescSel, setHtmlDescSel] = useState<string>("");

  // API (table mapping)
  const [apiColumns, setApiColumns] = useState<string[]>([]);
  const [apiEndpoint, setApiEndpoint] = useState<string>("");
  const [apiKeyColumn, setApiKeyColumn] = useState<string>("");
  const [apiDescColumns, setApiDescColumns] = useState<string[]>([]);
  const [apiRows, setApiRows] = useState<Record<string, string>[]>([]);
  const [folderPanelWidth, setFolderPanelWidth] = useState<number>(
    FOLDER_PANEL_DEFAULT_WIDTH
  );
  const [folderPathSelectorOpen, setFolderPathSelectorOpen] = useState<boolean>(false);
  const [folderPathInput, setFolderPathInput] = useState<string>("");
  const [folderPathSelectionStatus, setFolderPathSelectionStatus] = useState<string>("");

  const debounceRef = useRef<number | null>(null);
  const systemPromptSaveRef = useRef<number | null>(null); // NEW
  const [selectedDialogOpen, setSelectedDialogOpen] = useState<boolean>(false);

  useEffect(() => {
    void getCurrentWindow().setTitle("Rapid Prompt - Workbench").catch((err: unknown) => {
      console.warn("setTitle failed:", err);
    });
  }, []);

  // Load persisted System Prompt from backend (if any)
  useEffect(() => {
    void (async () => {
      try {
        const saved = await invoke<string>("load_system_prompt", {
          ...(project?.id ? { projectId: project.id } : {}),
        });
        setSystemPrompt(typeof saved === "string" ? saved : "");
      } catch (e: unknown) {
        console.warn("load_system_prompt failed:", e);
      }
    })();
  }, [project?.id]);

  // Persist System Prompt whenever it changes (debounced)
  useEffect(() => {
    if (systemPromptSaveRef.current) {
      window.clearTimeout(systemPromptSaveRef.current);
    }

    systemPromptSaveRef.current = window.setTimeout(() => {
      void invoke("save_system_prompt", {
        value: systemPrompt,
        ...(project?.id ? { projectId: project.id } : {}),
      }).catch((e: unknown) => {
        console.warn("save_system_prompt failed:", e);
      });
    }, 400);

    return () => {
      if (systemPromptSaveRef.current) {
        window.clearTimeout(systemPromptSaveRef.current);
      }
    };
  }, [project?.id, systemPrompt]);

  useEffect(() => {
    if (!project?.rootPath) {
      return;
    }

    setRootPath(project.rootPath);
    void loadTree(project.rootPath, false);
  }, [project?.id, project?.rootPath]);

  // Auto-expand ancestor directories so selected files are visible in the tree.
  useEffect(() => {
    if (!tree || selected.size === 0) return;
    const mustOpen = dirsToExpandForSelected(tree, selected);
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const d of mustOpen) {
        if (!next.has(d)) {
          next.add(d);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tree, selected]);

  /* ---------------- Folder: pick folder, load tree ---------------- */

  async function chooseFolder(): Promise<void> {
    setError(null);
    try {
      const path = await open({ directory: true, multiple: false });
      if (typeof path === "string" && path.length > 0) {
        setRootPath(path);
        await loadTree(path, /*preserveSelected*/ false);
      }
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  }

  async function loadTree(path: string, preserveSelected: boolean): Promise<Node | null> {
    setError(null);
    setBusy(true);
    try {
      const prevSelected = new Set(selected);
      const raw = await invoke<Node>("scan_dir", { path });
      const normalized = normalizeRootFromRust(raw);
      setTree(normalized);

      // ensure the root is open
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(normalized.path);
        return next;
      });

      if (preserveSelected) {
        const reachable = collectFilePaths(normalized);
        setSelected(new Set(Array.from(prevSelected).filter((p) => reachable.has(p))));
      } else {
        setSelected(new Set());
      }

      return normalized;
    } catch (e: unknown) {
      setError(toErrorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function toggleDir(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function findNodeByPath(root: Node, targetPath: string): Node | null {
    if (root.path === targetPath) {
      return root;
    }

    if (isDirNode(root)) {
      for (const child of root.children) {
        const found = findNodeByPath(child, targetPath);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  function toggleFile(path: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);

      // If we dont have a tree yet, fall back to simple behavior.
      if (!tree) {
        if (checked) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      }

      const target = findNodeByPath(tree, path);

      // If we cant find the node or its a file, just toggle that single path.
      if (!target || !isDirNode(target)) {
        if (checked) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      }

      // Directory: select/deselect all descendant files.
      const filePaths = collectFilePaths(target);

      if (checked) {
        filePaths.forEach((p) => next.add(p));
      } else {
        filePaths.forEach((p) => next.delete(p));
      }

      return next;
    });
  }

  function updateFolderPathInput(value: string): void {
    setFolderPathInput(value);
    if (folderPathSelectionStatus) {
      setFolderPathSelectionStatus("");
    }
  }

  function applyFolderPathSelection(): void {
    if (!rootPath) {
      setError("Choose a folder before applying path selections.");
      return;
    }

    if (!tree) {
      setError("The folder tree is not loaded. Choose a folder or refresh the tree before applying path selections.");
      return;
    }

    const result = resolveTreeSelectionFromPathInput({
      rootPath,
      tree,
      input: folderPathInput,
    });

    if (result.inputCount === 0) {
      setFolderPathSelectionStatus("");
      setError("Paste at least one file or folder path before applying.");
      return;
    }

    if (result.matchedInputs.length === 0) {
      setFolderPathSelectionStatus("No matching paths found.");
      setError(formatUnmatchedPathMessage(result.unmatchedInputs));
      return;
    }

    setSelected(new Set(result.selectedFilePaths));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(tree.path);
      result.expandedDirPaths.forEach((path) => next.add(path));
      return next;
    });

    const selectedLabel = result.selectedFilePaths.length === 1
      ? "1 file"
      : `${result.selectedFilePaths.length} files`;
    const matchedLabel = result.matchedInputs.length === 1
      ? "1 path"
      : `${result.matchedInputs.length} paths`;

    setFolderPathSelectionStatus(`Selected ${selectedLabel} from ${matchedLabel}.`);

    if (result.unmatchedInputs.length > 0) {
      setError(formatUnmatchedPathMessage(result.unmatchedInputs));
    } else {
      setError(null);
    }
  }

  function formatUnmatchedPathMessage(paths: string[]): string {
    const shown = paths.slice(0, 5).join("; ");
    const suffix = paths.length > 5 ? `; +${paths.length - 5} more` : "";
    return `Paths not found in the loaded folder tree: ${shown}${suffix}. Add the missing file/folder under the chosen folder or correct the path.`;
  }
  /* ---------------- Excel mode ---------------- */

  async function chooseExcel(): Promise<void> {
    setError(null);
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Excel/CSV", extensions: ["xlsx", "xls", "csv"] }],
      });
      if (typeof picked !== "string" || picked.length === 0) return;

      setUnitSource(picked);

      const insp = await invoke<ExcelInspector>("inspect_excel", { path: picked });
      setExcelInspect(insp);

      const first = insp.sheets[0];
      const idCol = first?.columns?.[0] ?? "";

      setExcelSheet(first?.name ?? "");
      setExcelIdCol(idCol);
      setExcelDescCols(first ? first.columns.filter((c: string) => c !== idCol).slice(0, 1) : []);

      setUnits([]);
      setUnitIndex(0);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  }

  async function buildExcelUnits(): Promise<void> {
    if (!unitSource || !excelSheet || !excelIdCol || excelDescCols.length === 0) {
      setError("Select sheet, ID and Description columns.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const cfg: ExcelConfig = {
        kind: "excel",
        sheet: excelSheet,
        idColumn: excelIdCol,
        descriptionColumns: excelDescCols,
      };
      const u = await invoke<PromptUnit[]>("extract_excel_units", {
        path: unitSource,
        config: cfg,
      });
      setUnits(u);
      setUnitIndex(0);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- Block mode (Regex / HTML / API) ---------------- */

  async function chooseBlockFile(): Promise<void> {
    setError(null);
    try {
      const picked = await open({ multiple: false });
      if (typeof picked !== "string" || picked.length === 0) return;
      setUnitSource(picked);
      setUnits([]);
      setUnitIndex(0);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  }

  async function buildRegexUnits(): Promise<void> {
    if (!unitSource) {
      setError("Pick a file first.");
      return;
    }
    // With exactOptionalPropertyTypes, omit fields instead of sending `undefined`
    const cfg: RegexConfig = {
      kind: "regex",
      delimiter: regexDelimiter,
      ...(regexIdCapture ? { idCapture: regexIdCapture } : {}),
      ...(regexFlags ? { flags: regexFlags } : {}),
    };
    setError(null);
    setBusy(true);
    try {
      const u = await invoke<PromptUnit[]>("extract_regex_blocks", {
        path: unitSource,
        config: cfg,
      });
      setUnits(u);
      setUnitIndex(0);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function buildHtmlUnits(): Promise<void> {
    if (!unitSource) {
      setError("Pick a file first.");
      return;
    }
    const cfg: HtmlConfig = {
      kind: "html",
      itemSelector: htmlItemSel,
      ...(htmlIdSel ? { idSelector: htmlIdSel } : {}),
      ...(htmlIdAttr ? { idAttr: htmlIdAttr } : {}),
      ...(htmlDescSel ? { descSelector: htmlDescSel } : {}),
    };
    setError(null);
    setBusy(true);
    try {
      const u = await invoke<PromptUnit[]>("extract_html_blocks", {
        path: unitSource,
        config: cfg,
      });
      setUnits(u);
      setUnitIndex(0);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // ---- API flow: Extract -> choose columns -> Build
  async function extractApi(): Promise<void> {
    if (!unitSource) {
      setError("Pick a file first.");
      return;
    }
    if (!apiEndpoint.trim()) {
      setError("Enter API endpoint.");
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const table = await invoke<ApiTable>("fetch_api_table", {
        endpoint: apiEndpoint,
        path: unitSource,
      });
      setApiColumns(table.columns);
      setApiRows(table.rows);
      setApiKeyColumn(table.columns[0] ?? "");
      setApiDescColumns(table.columns.slice(1, 2)); // sensible default
      setUnits([]); // clear units until we map columns
      setUnitIndex(0);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function buildApiUnits(): void {
    if (!apiKeyColumn || apiDescColumns.length === 0) {
      setError("Choose ID column and at least one Description column.");
      return;
    }
    const built: PromptUnit[] = apiRows
      .map((r, i) => {
        const idRaw = r[apiKeyColumn] ?? `${i + 1}`;
        const id = String(idRaw).trim() || `${i + 1}`;
        const body = apiDescColumns
          .map((c: string) => String(r[c] ?? "").trim())
          .filter(Boolean)
          .join("\n");
        return { id, body }; // omit meta instead of `meta: undefined`
      })
      .filter((u) => u.body.length > 0);

    setUnits(built);
    setUnitIndex(0);
  }

  /* ---------------- Copy & tokens ---------------- */

  function outputWithFolderSelections(files: FileValue[], opts: OutputOptions): string {
    return formatOutput(text, files, { ...opts, systemPrompt });
  }


  // --- replace your existing outputWithUnit() with this version ---

  function outputWithUnit(unit: PromptUnit | null): string {
    let body = unit?.body ?? "";

    if (unit && mode === "excel" && excelDescCols.length > 0) {
      const vals = splitIntoPartsKeepRemainder(unit.body, excelDescCols.length);
      body = renderLabeledList(excelDescCols, vals);
    }

    const opts: OutputOptions = {
      includeTree: false,
      treeRoot: null,
      unit: unit ? { title: unit.id, body } : null,
      systemPrompt, // NEW
    };
    return formatOutput(text, [], opts);
  }

  async function recomputeTokens(): Promise<void> {
    try {
      if (mode === "folder") {
        const paths = Array.from(selected);
        const ascii = paths.length
          ? await invoke<FileValue[]>("read_ascii_files", {
            paths,
            maxBytes: 512 * 1024,
          })
          : [];
        const payloadStr = outputWithFolderSelections(ascii, {
          includeTree,
          treeRoot: includeTree ? tree : null,
        });
        setTokenCount(countTokens(payloadStr));
      } else {
        const unit = units[unitIndex] ?? null;
        const payloadStr = outputWithUnit(unit);
        setTokenCount(countTokens(payloadStr));
      }
    } catch (e: unknown) {
      // non-fatal
      console.warn("token recompute failed:", e);
    }
  }

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void recomputeTokens(), 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [mode, text, systemPrompt, selected, includeTree, units, unitIndex, tree]);

  async function copyPrompt(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      let payloadStr: string;
      if (mode === "folder") {
        const paths = Array.from(selected);
        const ascii = paths.length
          ? await invoke<FileValue[]>("read_ascii_files", {
            paths,
            maxBytes: 512 * 1024,
          })
          : [];
        payloadStr = outputWithFolderSelections(ascii, {
          includeTree,
          treeRoot: includeTree ? tree : null,
        });
      } else {
        const unit = units[unitIndex] ?? null;
        payloadStr = outputWithUnit(unit);
      }
      await writeText(payloadStr);
      setTokenCount(countTokens(payloadStr));
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- Save / Load session (v4) ---------------- */

  async function saveSession(): Promise<void> {
    if (!rootPath) {
      setError("Choose a folder before saving a session.");
      return;
    }

    let unitConfig: UnitConfig | undefined;
    if (mode === "excel") {
      unitConfig = {
        kind: "excel",
        sheet: excelSheet,
        idColumn: excelIdCol,
        descriptionColumns: excelDescCols,
      };
    } else if (mode === "block") {
      if (blockKind === "regex") {
        unitConfig = {
          kind: "regex",
          delimiter: regexDelimiter,
          ...(regexIdCapture ? { idCapture: regexIdCapture } : {}),
          ...(regexFlags ? { flags: regexFlags } : {}),
        };
      } else if (blockKind === "html") {
        unitConfig = {
          kind: "html",
          itemSelector: htmlItemSel,
          ...(htmlIdSel ? { idSelector: htmlIdSel } : {}),
          ...(htmlIdAttr ? { idAttr: htmlIdAttr } : {}),
          ...(htmlDescSel ? { descSelector: htmlDescSel } : {}),
        };
      } else {
        // API: endpoint required; id/desc are optional until chosen
        unitConfig = {
          kind: "api",
          endpoint: apiEndpoint,
          ...(apiKeyColumn ? { idColumn: apiKeyColumn } : {}),
          ...(apiDescColumns.length ? { descriptionColumns: apiDescColumns } : {}),
        };
      }
    }

    const currentId = units[unitIndex]?.id;
    const s: SessionFileV4 = toSessionV4({
      rootPath,
      textarea: text,
      selectedAbsolute: Array.from(selected),
      includeTree: includeTree,
      mode,
      ...(unitSource ? { unitSourceAbs: unitSource } : {}),
      ...(unitConfig ? { unitConfig } : {}),
      ...(mode === "folder"
        ? {}
        : { cursor: { index: unitIndex, ...(currentId ? { id: currentId } : {}) } }),
      savedTokenCount: tokenCount,
    });

    try {
      await exportSession(s);
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  }

  async function loadSession(): Promise<void> {
    try {
      const s = await importSession();
      if (!s) return;

      setText(s.textarea);
      setMode(s.mode);
      setIncludeTree(!!s.includeTree);
      setRootPath(s.rootPath);

      const loadedTree = await loadTree(s.rootPath, /*preserveSelected*/ false);

      // Folder selections
      const absSel = resolveSelected(s.rootPath, s.selected); // -> absolute
      if (loadedTree) {
        const reachable = collectFilePaths(loadedTree);
        const actualSel = absSel.filter((p) => reachable.has(p));
        setSelected(new Set(actualSel));

        // Expand ancestors so they’re visible immediately.
        const mustOpen = dirsToExpandForSelected(loadedTree, new Set(actualSel));
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const d of mustOpen) next.add(d);
          next.add(loadedTree.path); // ensure root is open
          return next;
        });
      } else {
        setSelected(new Set(absSel));
      }

      // Unit source & config
      const srcAbs = resolveUnitSource(s.rootPath, s.unitSource);
      setUnitSource(srcAbs ?? "");

      if (s.mode === "excel" && s.unitSource && srcAbs && s.unitConfig?.kind === "excel") {
        const insp = await invoke<ExcelInspector>("inspect_excel", { path: srcAbs });
        setExcelInspect(insp);
        setExcelSheet(s.unitConfig.sheet);
        setExcelIdCol(s.unitConfig.idColumn);
        setExcelDescCols(s.unitConfig.descriptionColumns);
        const u = await invoke<PromptUnit[]>("extract_excel_units", {
          path: srcAbs,
          config: s.unitConfig,
        });
        setUnits(u);
        const idx = Math.max(0, Math.min(u.length - 1, s.cursor?.index ?? 0));
        setUnitIndex(idx);
      } else if (s.mode === "block" && s.unitSource && srcAbs && s.unitConfig) {
        if (s.unitConfig.kind === "regex") {
          setBlockKind("regex");
          setRegexDelimiter(s.unitConfig.delimiter);
          setRegexIdCapture(s.unitConfig.idCapture ?? "");
          setRegexFlags(s.unitConfig.flags ?? "m");
          const u = await invoke<PromptUnit[]>("extract_regex_blocks", {
            path: srcAbs,
            config: s.unitConfig,
          });
          setUnits(u);
          const idx = Math.max(0, Math.min(u.length - 1, s.cursor?.index ?? 0));
          setUnitIndex(idx);
        } else if (s.unitConfig.kind === "html") {
          setBlockKind("html");
          setHtmlItemSel(s.unitConfig.itemSelector);
          setHtmlIdSel(s.unitConfig.idSelector ?? "");
          setHtmlIdAttr(s.unitConfig.idAttr ?? "id");
          setHtmlDescSel(s.unitConfig.descSelector ?? "");
          const u = await invoke<PromptUnit[]>("extract_html_blocks", {
            path: srcAbs,
            config: s.unitConfig,
          });
          setUnits(u);
          const idx = Math.max(0, Math.min(u.length - 1, s.cursor?.index ?? 0));
          setUnitIndex(idx);
        } else if (s.unitConfig.kind === "api") {
          setBlockKind("api");
          const apiCfg = s.unitConfig;
          setApiEndpoint(apiCfg.endpoint ?? "");

          try {
            const table = await invoke<ApiTable>("fetch_api_table", {
              endpoint: apiCfg.endpoint ?? "",
              path: srcAbs,
            });
            setApiColumns(table.columns);
            setApiRows(table.rows);

            if (apiCfg.idColumn) setApiKeyColumn(apiCfg.idColumn);
            if (apiCfg.descriptionColumns) setApiDescColumns(apiCfg.descriptionColumns);

            // Auto-build units if both key & description were previously chosen
            if (apiCfg.idColumn && (apiCfg.descriptionColumns?.length ?? 0) > 0) {
              const built: PromptUnit[] = table.rows
                .map((r, i) => ({
                  id: r[apiCfg.idColumn!] ?? String(i + 1),
                  body: apiCfg.descriptionColumns!
                    .map((c: string) => r[c])
                    .filter(Boolean)
                    .join("\n"),
                }))
                .filter((u) => u.body.length > 0);
              setUnits(built);
              const idx = Math.max(0, Math.min(built.length - 1, s.cursor?.index ?? 0));
              setUnitIndex(idx);
            } else {
              setUnits([]);
              setUnitIndex(0);
            }
          } catch (e: unknown) {
            setError(toErrorMessage(e));
          }
        } else {
          // Defensive: unexpected kind while in "block" mode
          setUnits([]);
          setUnitIndex(0);
        }
      } else {
        // non-unit mode
        setUnits([]);
        setUnitIndex(0);
      }
    } catch (e: unknown) {
      setError(toErrorMessage(e));
    }
  }

  // Expand helpers
  function findAncestorDirsInTree(
    node: Node,
    targetPath: string,
    parents: string[] = []
  ): string[] | null {
    if (node.path === targetPath) return parents;
    if (isDirNode(node)) {
      for (const child of node.children) {
        const res = findAncestorDirsInTree(child, targetPath, [...parents, node.path]);
        if (res) return res;
      }
    }
    return null;
  }

  function dirsToExpandForSelected(root: Node, selectedPaths: ReadonlySet<string>): Set<string> {
    const toExpand = new Set<string>();
    selectedPaths.forEach((p) => {
      const dirs = findAncestorDirsInTree(root, p);
      if (dirs) dirs.forEach((d) => toExpand.add(d));
    });
    return toExpand;
  }

  // --- add near the other helpers inside App() (top-level of the component) ---


  // Split `text` into exactly `parts` chunks by using the first (parts-1)
  // newline separators as hard boundaries. The remainder (with all its newlines)
  // goes into the last chunk. This preserves multi-line content for the last column.
  function splitIntoPartsKeepRemainder(text: string, parts: number): string[] {
    if (parts <= 1) return [text];
    const out: string[] = [];
    let start = 0;
    let splits = 0;
    while (splits < parts - 1) {
      const idx = text.indexOf("\n", start);
      if (idx === -1) break;
      out.push(text.slice(start, idx));
      start = idx + 1;
      splits++;
    }
    out.push(text.slice(start));
    while (out.length < parts) out.push("");
    return out;
  }

  // Render labeled bullets, preserving multi-line values by indenting them
  // under the bullet so Markdown keeps the full block.
  function renderLabeledList(names: string[], values: string[]): string {
    const lines: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const raw = (values[i] ?? "").trim();
      if (!raw) continue;
      if (/\r?\n/.test(raw)) {
        const indented = raw.split(/\r?\n/).map((ln) => `  ${ln}`).join("\n");
        lines.push(`- **${name}:**\n${indented}`);
      } else {
        lines.push(`- **${name}:** ${raw}`);
      }
    }
    return lines.join("\n");
  }

  // ----- Derived view of selected files for the info icon / dialog -----
  const selectedFilesArray = Array.from(selected).sort();
  const selectedFilesForDisplay = rootPath
    ? selectedFilesArray.map((abs) => toRelative(rootPath, abs))
    : selectedFilesArray;

  const selectedCount = selectedFilesForDisplay.length;

  const selectedTooltipTitle =
    selectedCount === 0
      ? "No files selected"
      : selectedCount <= 12
        ? selectedFilesForDisplay.join("\n")
        : `${selectedFilesForDisplay.slice(0, 12).join("\n")}\n… (${selectedCount - 12} more)`;

  /* ---------------- UI ---------------- */

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "1fr",
          sm:
            mode === "folder"
              ? `${folderPanelWidth}px ${FOLDER_PANEL_SPLITTER_WIDTH}px minmax(0, 1fr)`
              : "1fr",
          md:
            mode === "folder"
              ? `${folderPanelWidth}px ${FOLDER_PANEL_SPLITTER_WIDTH}px minmax(0, 1fr)`
              : "1fr",
        },
        //height: "100vh",
        //width: "100vw",
        overflow: "hidden",
      }}
    >
      {/* Left panel: visible only in folder mode */}
      <Box
        sx={{
          borderRight: 1,
          borderColor: "divider",
          display: mode === "folder" ? "flex" : "none",
          flexDirection: "column",
          minWidth: FOLDER_PANEL_MIN_WIDTH,
          maxWidth: FOLDER_PANEL_MAX_WIDTH,
          width: "100%",
          overflow: "hidden",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<FolderOpenIcon />}
            onClick={() => void chooseFolder()}
            disabled={busy}
          >
            Choose folder
          </Button>
          <Button
            size="small"
            variant="text"
            startIcon={<RefreshIcon />}
            onClick={() => void loadTree(rootPath, true)}
            disabled={busy || !rootPath}
          >
            Refresh
          </Button>
          {rootPath && (
            <Typography
              variant="caption"
              noWrap
              title={rootPath}
              sx={{ color: "text.secondary", flex: 1 }}
            >
              {rootPath}
            </Typography>
          )}
        </Stack>
        <FolderPathSelector
          open={folderPathSelectorOpen}
          value={folderPathInput}
          disabled={busy || !rootPath || !tree}
          statusText={folderPathSelectionStatus}
          onOpenChange={setFolderPathSelectorOpen}
          onValueChange={updateFolderPathInput}
          onApply={applyFolderPathSelection}
        />
        {busy && !tree && <LinearBusy />}
        <Box sx={{ flex: 1, overflow: "auto", p: 1 }}>
          {busy && !tree && (
            <Typography variant="body2" color="text.secondary">
              Loading
            </Typography>
          )}
          {!tree && !busy && (
            <Typography variant="body2" color="text.secondary">
              Pick a folder to build the tree.
            </Typography>
          )}
          {tree && (
            <TreeView
              node={tree}
              expanded={expanded}
              selected={selected}
              onToggleDir={toggleDir}
              onToggleFile={toggleFile}
            />
          )}
        </Box>
      </Box>

      <ResizableSplitter
        visible={mode === "folder"}
        width={folderPanelWidth}
        minWidth={FOLDER_PANEL_MIN_WIDTH}
        maxWidth={FOLDER_PANEL_MAX_WIDTH}
        splitterWidth={FOLDER_PANEL_SPLITTER_WIDTH}
        onWidthChange={setFolderPanelWidth}
        label="Resize folder tree panel"
        tooltip="Drag to resize folder tree"
      />
      {/* Right panel */}
      <Box
        sx={{
          p: 2,
          display: "grid",
          // folder actions + system prompt + header row + main textarea + mode panel + footer
          gridTemplateRows:
            mode === "folder"
              ? "auto auto auto minmax(0,1fr) auto auto"
              : "auto auto minmax(0,1fr) auto auto",
          gap: 1.25,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >

        {mode === "folder" && (
          <Box
            sx={{
              mb: 0.5,
              p: 1,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              bgcolor: "background.paper",
            }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ flexWrap: "wrap", rowGap: 1 }}
            >
              <Tooltip title={busy ? "Preparing prompt" : "Copy prompt"} arrow>
                <span>
                  <IconButton
                    size="small"
                    aria-label="Copy prompt"
                    disabled={busy}
                    onClick={() => void copyPrompt()}
                    color="primary"
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Chip label={`Tokens: ${tokenCount}`} size="small" />

              <Tooltip
                title={
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      whiteSpace: "pre-wrap",
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                      fontSize: 11,
                    }}
                  >
                    {selectedTooltipTitle}
                  </Box>
                }
                placement="bottom"
                arrow
              >
                <IconButton
                  size="small"
                  aria-label="Show selected files"
                  onClick={() => setSelectedDialogOpen(true)}
                >
                  <InfoOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Checkbox
                  size="small"
                  checked={includeTree}
                  onChange={(e) => setIncludeTree(e.currentTarget.checked)}
                />
                <Typography variant="body2">Include folder tree</Typography>
              </Stack>
            </Stack>
          </Box>
        )}

        {/* System Prompt (global across sessions) */}
        <Box
          sx={{
            mb: 0.5,
            p: 1.25,
            borderRadius: 1,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            System Prompt
          </Typography>
          <TextField
            placeholder="Optional system instructions applied before every run"
            multiline
            minRows={3}
            maxRows={6}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.currentTarget.value)}
            fullWidth
            InputProps={{
              sx: {
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                fontSize: 13,
              },
            }}
          />
        </Box>

        {/* Header row */}
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h5" sx={{ flex: 1 }}>
            Rapid Prompt - Workbench
          </Typography>
          <Button
            size="small"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => void loadSession()}
          >
            Load
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<SaveAltIcon />}
            onClick={() => void saveSession()}
            disabled={!rootPath}
          >
            Save
          </Button>
          <Box sx={{ ml: 1, display: { xs: "none", sm: "inline-flex" }, alignItems: "center" }}>
            <img src={brandSvg} alt="Brand" height={36} style={{ opacity: 0.9 }} />
          </Box>
        </Stack>

        {/* User prompt textarea */}
        <Box sx={{ minHeight: 0, overflow: "auto" }}>
          <TextField
            placeholder="Type your prompt here"
            multiline
            minRows={8}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            fullWidth
            InputProps={{
              sx: {
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                fontSize: 13,
              },
            }}
          />
        </Box>

        {/* Mode panels */}
        {mode === "excel" && (
          <>
            {/* Excel: pick file + sheet + columns */}
            <Box sx={{ mb: 1 }}>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 1.5, columnGap: 1.5 }}>
                <Button size="small" variant="outlined" onClick={() => void chooseExcel()}>
                  Choose Excel
                </Button>
                <Typography variant="body2" color="text.secondary">
                  {unitSource || "No file"}
                </Typography>

                {excelInspect && (
                  <FormControl size="small" sx={{ minWidth: 220 }}>
                    <InputLabel>Sheet</InputLabel>
                    <Select
                      label="Sheet"
                      value={excelSheet}
                      onChange={(e) => {
                        const next = e.target.value;
                        setExcelSheet(next);
                        const info = excelInspect.sheets.find((s) => s.name === next);
                        if (info) {
                          const idCol = info.columns[0] ?? "";
                          setExcelIdCol(idCol);
                          setExcelDescCols(info.columns.filter((c: string) => c !== idCol).slice(0, 1));
                        }
                      }}
                    >
                      {excelInspect.sheets.map((s) => (
                        <MenuItem key={s.name} value={s.name}>{s.name}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => void buildExcelUnits()}
                  disabled={!excelInspect}
                >
                  Extract
                </Button>
              </Stack>

              {excelInspect && (
                <Stack direction="row" spacing={1.5} sx={{ mt: 1, flexWrap: "wrap", rowGap: 1.5, columnGap: 1.5 }}>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>ID column</InputLabel>
                    <Select
                      label="ID column"
                      value={excelIdCol}
                      onChange={(e) => setExcelIdCol(e.target.value)}
                    >
                      {(excelInspect.sheets.find((s) => s.name === excelSheet)?.columns ?? []).map((c: string) => (
                        <MenuItem key={c} value={c}>{c}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" sx={{ minWidth: 260 }}>
                    <InputLabel>Description columns</InputLabel>
                    <Select
                      label="Description columns"
                      multiple
                      value={excelDescCols}
                      onChange={(e) =>
                        setExcelDescCols(
                          typeof e.target.value === "string"
                            ? e.target.value.split(",")
                            : (e.target.value)
                        )
                      }
                    >
                      {(excelInspect.sheets.find((s) => s.name === excelSheet)?.columns ?? []).map((c: string) => (
                        <MenuItem key={c} value={c}>{c}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => void buildExcelUnits()}
                    disabled={!excelSheet || !excelIdCol || excelDescCols.length === 0}
                  >
                    Build
                  </Button>
                </Stack>
              )}
            </Box>

            {/* Sticky bottom bar (Prev/Copy/Next) — keep as‑is */}
            <Box
              sx={{
                position: "sticky",
                bottom: 0,
                bgcolor: "background.paper",
                borderTop: 1,
                borderColor: "divider",
                py: 1,
                zIndex: 1,
              }}
            >
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                alignItems={{ xs: "stretch", sm: "center" }}
              >
                <Button size="small" variant="outlined" startIcon={<ArrowBackIcon />} disabled={unitIndex <= 0 || units.length === 0}
                  onClick={() => setUnitIndex((i) => Math.max(0, i - 1))}>
                  Prev
                </Button>
                <Button variant="contained" startIcon={<ContentCopyIcon />} disabled={busy || units.length === 0}
                  onClick={() => void copyPrompt()}>
                  {busy ? "Working" : "Copy prompt"}
                </Button>
                <Button size="small" variant="outlined" endIcon={<ArrowForwardIcon />} disabled={unitIndex >= units.length - 1 || units.length === 0}
                  onClick={() => setUnitIndex((i) => Math.min(units.length - 1, i + 1))}>
                  Next
                </Button>

                <Chip label={`Tokens: ${tokenCount}`} sx={{ ml: { sm: 1 } }} />

                <TextField
                  size="small"
                  label="Jump to ID"
                  sx={{ ml: { sm: 2 }, width: 220 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = (e.target as HTMLInputElement).value.trim();
                      const idx = units.findIndex((u) => u.id === v);
                      if (idx >= 0) setUnitIndex(idx);
                    }
                  }}
                />
                <Typography variant="body2" sx={{ ml: { sm: 1 } }} color="text.secondary">
                  {units.length > 0 ? `Row ${unitIndex + 1}/${units.length}  ID: ${units[unitIndex]?.id}` : "No units"}
                </Typography>
              </Stack>
            </Box>
          </>
        )}

        {mode === "block" && (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Button size="small" variant="outlined" onClick={() => void chooseBlockFile()}>
                Choose file
              </Button>
              <Typography variant="body2" color="text.secondary">
                {unitSource || "No file"}
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={blockKind}
                onChange={(_, v) => {
                  if (v) setBlockKind(v);
                }}
              >
                <ToggleButton value="regex">Regex</ToggleButton>
                <ToggleButton value="html">HTML</ToggleButton>
                <ToggleButton value="api">API</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            {blockKind === "regex" && (
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ mb: 1, flexWrap: "wrap", rowGap: 1.5, columnGap: 1.5 }}
              >
                <TextField
                  size="small"
                  label="Delimiter regex"
                  value={regexDelimiter}
                  onChange={(e) => setRegexDelimiter(e.target.value)}
                  sx={{ minWidth: 240 }}
                />
                <TextField
                  size="small"
                  label="ID capture regex (group 1)"
                  value={regexIdCapture}
                  onChange={(e) => setRegexIdCapture(e.target.value)}
                  sx={{ minWidth: 260 }}
                />
                <TextField
                  size="small"
                  label="Flags (e.g., m,i)"
                  value={regexFlags}
                  onChange={(e) => setRegexFlags(e.target.value)}
                  sx={{ width: 120 }}
                />
                <Button size="small" variant="outlined" onClick={() => void buildRegexUnits()}>
                  Extract
                </Button>
              </Stack>
            )}

            {blockKind === "html" && (
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ mb: 1, flexWrap: "wrap", rowGap: 1.5, columnGap: 1.5 }}
              >
                <TextField
                  size="small"
                  label="Item CSS selector"
                  value={htmlItemSel}
                  onChange={(e) => setHtmlItemSel(e.target.value)}
                  sx={{ minWidth: 240 }}
                />
                <TextField
                  size="small"
                  label="ID selector (optional)"
                  value={htmlIdSel}
                  onChange={(e) => setHtmlIdSel(e.target.value)}
                  sx={{ minWidth: 240 }}
                />
                <TextField
                  size="small"
                  label="ID attribute"
                  value={htmlIdAttr}
                  onChange={(e) => setHtmlIdAttr(e.target.value)}
                  sx={{ width: 140 }}
                />
                <TextField
                  size="small"
                  label="Description selector (optional)"
                  value={htmlDescSel}
                  onChange={(e) => setHtmlDescSel(e.target.value)}
                  sx={{ minWidth: 260 }}
                />
                <Button size="small" variant="outlined" onClick={() => void buildHtmlUnits()}>
                  Extract
                </Button>
              </Stack>
            )}

            {/* API add-on panel */}
            {blockKind === "api" && (
              <>
                {/* Row 1: endpoint + extract */}
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ mb: 1, flexWrap: "wrap", rowGap: 1.5, columnGap: 1.5 }}
                >
                  <TextField
                    size="small"
                    label="API endpoint"
                    value={apiEndpoint}
                    onChange={(e) => setApiEndpoint(e.target.value)}
                    sx={{ minWidth: 360 }}
                    placeholder="http://127.0.0.1:8000/extract_items"
                  />
                  <Button size="small" variant="outlined" onClick={() => void extractApi()}>
                    Extract
                  </Button>
                  <Typography variant="body2" color="text.secondary">
                    {apiColumns.length
                      ? `${apiRows.length} rows • ${apiColumns.length} columns`
                      : "No data yet"}
                  </Typography>
                </Stack>

                {/* Row 2: choose columns like Excel */}
                {apiColumns.length > 0 && (
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ mb: 1, flexWrap: "wrap", rowGap: 1.5, columnGap: 1.5 }}
                  >
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                      <InputLabel>ID column</InputLabel>
                      <Select
                        label="ID column"
                        value={apiKeyColumn}
                        onChange={(e) => setApiKeyColumn(e.target.value)}
                      >
                        {apiColumns.map((c: string) => (
                          <MenuItem key={c} value={c}>
                            {c}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 260 }}>
                      <InputLabel>Description columns</InputLabel>
                      <Select
                        label="Description columns"
                        multiple
                        value={apiDescColumns}
                        onChange={(e) =>
                          setApiDescColumns(
                            typeof e.target.value === "string"
                              ? e.target.value.split(",")
                              : (e.target.value)
                          )
                        }
                      >
                        {apiColumns.map((c: string) => (
                          <MenuItem key={c} value={c}>
                            {c}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button size="small" variant="outlined" onClick={() => buildApiUnits()}>
                      Build
                    </Button>
                  </Stack>
                )}
              </>
            )}

            {/* Common actions for Block modes */}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                disabled={unitIndex <= 0 || units.length === 0}
                onClick={() => setUnitIndex((i) => Math.max(0, i - 1))}
              >
                Prev
              </Button>
              <Button
                variant="contained"
                startIcon={<ContentCopyIcon />}
                disabled={busy || units.length === 0}
                onClick={() => void copyPrompt()}
              >
                {busy ? "Working" : "Copy prompt"}
              </Button>
              <Button
                size="small"
                variant="outlined"
                endIcon={<ArrowForwardIcon />}
                disabled={unitIndex >= units.length - 1 || units.length === 0}
                onClick={() => setUnitIndex((i) => Math.min(units.length - 1, i + 1))}
              >
                Next
              </Button>

              <Chip label={`Tokens: ${tokenCount}`} sx={{ ml: 1 }} />

              <TextField
                size="small"
                label="Jump to ID"
                sx={{ ml: 2, width: 220 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = (e.target as HTMLInputElement).value.trim();
                    const idx = units.findIndex((u) => u.id === v);
                    if (idx >= 0) setUnitIndex(idx);
                  }
                }}
              />
              <Typography variant="body2" sx={{ ml: 1 }} color="text.secondary">
                {units.length > 0
                  ? `Block ${unitIndex + 1}/${units.length} · ID: ${units[unitIndex]?.id}`
                  : "No units"}
              </Typography>
            </Stack>
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        {/* Selected files dialog (folder mode helper) */}
        <Dialog
          open={selectedDialogOpen}
          onClose={() => setSelectedDialogOpen(false)}
          fullWidth
          maxWidth="sm"
        >
          <DialogTitle>Selected files</DialogTitle>
          <DialogContent dividers>
            {selectedCount === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No files selected.
              </Typography>
            ) : (
              <Box
                component="pre"
                sx={{
                  m: 0,
                  maxHeight: 360,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                  fontSize: 12,
                }}
              >
                {selectedFilesForDisplay.join("\n")}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSelectedDialogOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        <Divider />
        <Typography variant="body2" color="text.secondary">
          {mode === "folder" ? (
            <>
              Copied text is <strong>Markdown</strong>: prompt + selected files (and optional
              folder tree).
            </>
          ) : (
            <>
              Copied text is <strong>Markdown</strong>: prompt + the current unit body.
            </>
          )}
        </Typography>
      </Box>
    </Box>
  );
}

function LinearBusy() {
  return (
    <Box sx={{ px: 1, pt: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <CircularProgress size={16} />
        <Typography variant="caption" color="text.secondary">
          Preparing
        </Typography>
      </Stack>
    </Box>
  );
}