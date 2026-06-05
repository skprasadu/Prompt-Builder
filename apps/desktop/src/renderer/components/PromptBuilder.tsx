// src/App.tsx
import { memo, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type JSX } from "react";
import {
  getDesktopWindow as getCurrentWindow,
  getDroppedFilePaths,
  invoke,
  openDialog as open,
  writeClipboardText as writeText,
} from "../lib/desktop";

import type { Node, FileValue } from "../types/fs";
import type { LocalProject } from "../types/project";
import type { ImageAttachment, LocalProjectState, PromptWorkflowState } from "../types/capture";
import { isDirNode } from "../types/fs";
import { formatOutput, type OutputOptions } from "../lib/formatters";
import { countTokens } from "../lib/tokenize";
import { toErrorMessage } from "../lib/errors";
import { TreeView } from "../components/TreeView";
import { ResizableSplitter } from "../components/ResizableSplitter";
import { FolderPathSelector } from "../components/FolderPathSelector";
import { collectFilePaths } from "../lib/tree";
import { resolveTreeSelectionFromPathInput } from "../lib/pathSelection";

import { toAbsolute, toRelative } from "../lib/session";

import type {
  PromptUnit,
  ExcelInspector,
  ExcelConfig,
  RegexConfig,
  HtmlConfig,
  Mode,
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

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

function normalizeRootFromRust(raw: Node): Node {
  if (isDirNode(raw)) return { ...raw, children: raw.children ?? [] };
  return raw;
}

const FOLDER_PANEL_DEFAULT_WIDTH = 360;
const FOLDER_PANEL_MIN_WIDTH = 280;
const FOLDER_PANEL_MAX_WIDTH = 640;
const FOLDER_PANEL_SPLITTER_WIDTH = 8;

const MemoTreeView = memo(
  TreeView,
  (previous, next) =>
    previous.node === next.node &&
    previous.expanded === next.expanded &&
    previous.selected === next.selected,
);

export interface PromptBuilderProps {
  project?: LocalProject | null;
  onWorkspaceStateChange?: (state: PromptWorkflowState) => void;
}

export default function PromptBuilder({
  project = null,
  onWorkspaceStateChange,
}: PromptBuilderProps): JSX.Element {
  const [mode] = useState<Mode>("folder");

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
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [imageArchive, setImageArchive] = useState<ImageAttachment[]>([]);
  const [imageArchiveOpen, setImageArchiveOpen] = useState<boolean>(false);
  const [archiveDeleteTarget, setArchiveDeleteTarget] = useState<ImageAttachment | null>(null);
  const [archiveClearConfirmOpen, setArchiveClearConfirmOpen] = useState<boolean>(false);

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
  const [folderPathSelectionError, setFolderPathSelectionError] = useState<string>("");

  const debounceRef = useRef<number | null>(null);
  const systemPromptSaveRef = useRef<number | null>(null); // NEW
  const projectStateSaveRef = useRef<number | null>(null);
  const workspaceStateEmitRef = useRef<number | null>(null);
  const projectTreeLoadRef = useRef<number>(0);
  const projectStateLoadedRef = useRef<boolean>(false);
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
    if (!project?.id || !project.rootPath) {
      projectTreeLoadRef.current += 1;
      projectStateLoadedRef.current = false;
      setRootPath("");
      setTree(null);
      setExpanded(new Set());
      setSelected(new Set());
      setImageAttachments([]);
      setImageArchive([]);
      setImageArchiveOpen(false);
      setArchiveDeleteTarget(null);
      setArchiveClearConfirmOpen(false);
      return;
    }

    const projectId = project.id;
    const projectRootPath = project.rootPath;
    const loadId = projectTreeLoadRef.current + 1;
    projectTreeLoadRef.current = loadId;
    projectStateLoadedRef.current = false;

    // Clear project-scoped renderer state before async project state/tree loading.
    // This prevents previous project images/files from flashing or leaking into the next project.
    setError(null);
    setRootPath(projectRootPath);
    setTree(null);
    setExpanded(new Set());
    setSelected(new Set());
    setImageAttachments([]);
    setImageArchive([]);
    setImageArchiveOpen(false);
    setArchiveDeleteTarget(null);
    setArchiveClearConfirmOpen(false);
    setText("");
    setIncludeTree(false);

    void (async () => {
      try {
        const savedState = await invoke<LocalProjectState>("project:get_state", {
          projectId,
        });

        if (projectTreeLoadRef.current !== loadId) {
          return;
        }

        const archive = await invoke<ImageAttachment[]>("attachments:list_images", {
          projectId,
        });

        if (projectTreeLoadRef.current !== loadId) {
          return;
        }

        setImageArchive(archive);

        setText(savedState.promptText ?? "");
        setIncludeTree(savedState.includeTree ?? false);
        setFolderPanelWidth(
          Math.min(
            FOLDER_PANEL_MAX_WIDTH,
            Math.max(FOLDER_PANEL_MIN_WIDTH, savedState.folderPanelWidth ?? FOLDER_PANEL_DEFAULT_WIDTH),
          ),
        );
        setImageAttachments(() => {
          const archiveHashes = new Set(archive.map((attachment) => attachment.sha256));

          return (savedState.imageAttachments ?? []).filter(
            (attachment) => attachment.projectId === projectId && archiveHashes.has(attachment.sha256),
          );
        });

        const loadedTree = await loadTree(projectRootPath, false, loadId);

        if (projectTreeLoadRef.current !== loadId) {
          return;
        }

        if (loadedTree) {
          const reachable = collectFilePaths(loadedTree);
          const restoredSelected = (savedState.selectedPaths ?? [])
            .map((relativePath) => toAbsolute(projectRootPath, relativePath))
            .filter((absolutePath) => reachable.has(absolutePath));

          setSelected(new Set(restoredSelected));

          setExpanded(() => {
            const next = new Set<string>();
            next.add(loadedTree.path);
            (savedState.expandedPaths ?? [])
              .map((relativePath) => toAbsolute(projectRootPath, relativePath))
              .forEach((absolutePath) => next.add(absolutePath));
            return next;
          });
        }
      } catch (err: unknown) {
        if (projectTreeLoadRef.current !== loadId) {
          return;
        }

        console.warn("project:get_state failed:", err);
        setRootPath(projectRootPath);
        void loadTree(projectRootPath, false, loadId);
      } finally {
        if (projectTreeLoadRef.current === loadId) {
          projectStateLoadedRef.current = true;
        }
      }
    })();
  }, [project?.id, project?.rootPath]);

  useEffect(() => {
    if (!project?.id || !projectStateLoadedRef.current || !rootPath) {
      return;
    }

    if (projectStateSaveRef.current) {
      window.clearTimeout(projectStateSaveRef.current);
    }

    projectStateSaveRef.current = window.setTimeout(() => {
      void invoke("project:save_state", {
        projectId: project.id,
        state: {
          promptText: text,
          includeTree,
          selectedPaths: Array.from(selected).map((absolutePath) => toRelative(rootPath, absolutePath)),
          expandedPaths: Array.from(expanded).map((absolutePath) => toRelative(rootPath, absolutePath)),
          imageAttachments,
          folderPanelWidth,
        },
      }).catch((err: unknown) => {
        console.warn("project:save_state failed:", err);
      });
    }, 500);

    return () => {
      if (projectStateSaveRef.current) {
        window.clearTimeout(projectStateSaveRef.current);
      }
    };
  }, [expanded, folderPanelWidth, imageAttachments, includeTree, project?.id, rootPath, selected, text]);

  useEffect(() => {
    if (!project?.id) {
      return;
    }

    if (workspaceStateEmitRef.current) {
      window.clearTimeout(workspaceStateEmitRef.current);
    }

    workspaceStateEmitRef.current = window.setTimeout(() => {
      onWorkspaceStateChange?.({
        projectId: project.id,
        rootPath,
        systemPrompt,
        promptText: text,
        selectedPaths: Array.from(selected).map((absolutePath) => toRelative(rootPath, absolutePath)),
        imageAttachments,
        includeTree,
        tokenCount,
        folderPanelWidth,
        updatedAt: new Date().toISOString(),
      });
    }, 250);

    return () => {
      if (workspaceStateEmitRef.current) {
        window.clearTimeout(workspaceStateEmitRef.current);
      }
    };
  }, [
    folderPanelWidth,
    imageAttachments,
    includeTree,
    onWorkspaceStateChange,
    project?.id,
    rootPath,
    selected,
    systemPrompt,
    text,
    tokenCount,
  ]);

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

  async function loadTree(
    path: string,
    preserveSelected: boolean,
    loadId = projectTreeLoadRef.current,
  ): Promise<Node | null> {
    setError(null);
    setBusy(true);
    try {
      const prevSelected = new Set(selected);
      const raw = await invoke<Node>("scan_dir", { path });

      if (loadId !== projectTreeLoadRef.current) {
        return null;
      }

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
      if (loadId === projectTreeLoadRef.current) {
        setError(toErrorMessage(e));
      }
      return null;
    } finally {
      if (loadId === projectTreeLoadRef.current) {
        setBusy(false);
      }
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
    if (folderPathSelectionError) {
      setFolderPathSelectionError("");
    }
  }

  /* ---------------- Excel mode ---------------- */

  function applyFolderPathSelection(): void {
    setFolderPathSelectionError("");

    if (!rootPath) {
      setFolderPathSelectionStatus("");
      setFolderPathSelectionError("Project folder is not available.");
      setError(null);
      return;
    }

    if (!tree) {
      setFolderPathSelectionStatus("");
      setFolderPathSelectionError("The folder tree is not loaded. Refresh the project tree before applying path selections.");
      setError(null);
      return;
    }

    const result = resolveTreeSelectionFromPathInput({
      rootPath,
      tree,
      input: folderPathInput,
    });

    if (result.inputCount === 0) {
      setFolderPathSelectionStatus("");
      setFolderPathSelectionError("Paste at least one file or folder path before applying.");
      setError(null);
      return;
    }

    if (result.matchedInputs.length === 0) {
      setFolderPathSelectionStatus("No matching paths found.");
      setFolderPathSelectionError(formatUnmatchedPathMessage(result.unmatchedInputs));
      setError(null);
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
      setFolderPathSelectionError(formatUnmatchedPathMessage(result.unmatchedInputs));
    } else {
      setFolderPathSelectionError("");
    }

    setError(null);
  }

  function formatUnmatchedPathMessage(paths: string[]): string {
    const shown = paths.slice(0, 5).join("; ");
    const suffix = paths.length > 5 ? `; +${paths.length - 5} more` : "";
    return `Paths not found in the loaded folder tree: ${shown}${suffix}. Add the missing file/folder under the project folder or correct the path.`;
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

  async function addDroppedImageFiles(files: File[]): Promise<void> {
    if (!project?.id) {
      setError("Project is required before adding image attachments.");
      return;
    }

    const paths = getDroppedFilePaths(files);

    if (paths.length === 0) {
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const added = await invoke<ImageAttachment[]>("attachments:add_images", {
        projectId: project.id,
        paths,
      });

      setImageArchive((current) => mergeImageAttachments(current, added));
      setImageAttachments((current) => mergeImageAttachments(current, added));
    } catch (err: unknown) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyImageAttachments(): Promise<void> {
    const paths = imageAttachments.map((attachment) => attachment.storedPath);

    if (paths.length === 0) {
      return;
    }

    setError(null);
    setBusy(true);

    try {
      await invoke<{ copied: number }>("attachments:copy_images_to_clipboard", {
        paths,
      });
    } catch (err: unknown) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function removeImageAttachment(sha256: string): void {
    setImageAttachments((current) =>
      current.filter((attachment) => attachment.sha256 !== sha256),
    );
  }

  function toggleImageAttachmentInBasket(attachment: ImageAttachment): void {
    setImageAttachments((current) => {
      if (current.some((item) => item.sha256 === attachment.sha256)) {
        return current.filter((item) => item.sha256 !== attachment.sha256);
      }

      return mergeImageAttachments(current, [attachment]);
    });
  }

  async function deleteImageFromArchive(attachment: ImageAttachment): Promise<void> {
    if (!project?.id) {
      setError("Project is required before deleting an image.");
      return;
    }

    setError(null);
    setBusy(true);

    try {
      await invoke("attachments:delete_image", {
        projectId: project.id,
        sha256: attachment.sha256,
      });

      setImageArchive((current) =>
        current.filter((item) => item.sha256 !== attachment.sha256),
      );
      setImageAttachments((current) =>
        current.filter((item) => item.sha256 !== attachment.sha256),
      );
      setArchiveDeleteTarget(null);
    } catch (err: unknown) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearImageArchive(): Promise<void> {
    if (!project?.id) {
      setError("Project is required before clearing the image archive.");
      return;
    }

    setError(null);
    setBusy(true);

    try {
      await invoke("attachments:clear_images", {
        projectId: project.id,
      });

      setImageArchive([]);
      setImageAttachments([]);
      setArchiveClearConfirmOpen(false);
      setImageArchiveOpen(false);
    } catch (err: unknown) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function mergeImageAttachments(
    current: ImageAttachment[],
    added: ImageAttachment[],
  ): ImageAttachment[] {
    const byHash = new Map<string, ImageAttachment>();

    for (const attachment of current) {
      byHash.set(attachment.sha256, attachment);
    }

    for (const attachment of added) {
      byHash.set(attachment.sha256, attachment);
    }

    return Array.from(byHash.values()).sort((left, right) =>
      left.fileName.localeCompare(right.fileName),
    );
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
        height: "100%",
        minHeight: 0,
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
          <Typography
            variant="caption"
            noWrap
            title={rootPath}
            sx={{ color: "text.secondary", flex: 1 }}
          >
            {rootPath || "Project folder"}
          </Typography>

          <Tooltip title="Refresh project tree" arrow>
            <span>
              <IconButton
                size="small"
                aria-label="Refresh project tree"
                onClick={() => void loadTree(rootPath, true)}
                disabled={busy || !rootPath}
              >
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
        <FolderPathSelector
          open={folderPathSelectorOpen}
          value={folderPathInput}
          disabled={busy || !rootPath || !tree}
          statusText={folderPathSelectionStatus}
          errorText={folderPathSelectionError}
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
            <MemoTreeView
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
          // folder actions + system prompt + main textarea + mode panel + footer
          gridTemplateRows:
            mode === "folder"
              ? "auto auto minmax(0,1fr) auto auto auto"
              : "auto minmax(0,1fr) auto auto auto",
          gap: 1.25,
          minWidth: 0,
          minHeight: 0,
          overflowX: "hidden",
          overflowY: "auto",
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

              <Tooltip title="Copy image attachments" arrow>
                <span>
                  <IconButton
                    size="small"
                    aria-label="Copy image attachments"
                    disabled={busy || imageAttachments.length === 0}
                    onClick={() => void copyImageAttachments()}
                  >
                    <ImageOutlinedIcon fontSize="small" />
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

        <ImageAttachmentPanel
          basket={imageAttachments}
          archiveCount={imageArchive.length}
          disabled={busy}
          onClearArchive={() => setArchiveClearConfirmOpen(true)}
          onDropFiles={addDroppedImageFiles}
          onOpenArchive={() => setImageArchiveOpen(true)}
          onRemove={removeImageAttachment}
        />

        <ImageArchiveDialog
          open={imageArchiveOpen}
          archive={imageArchive}
          basket={imageAttachments}
          onClose={() => setImageArchiveOpen(false)}
          onRequestDelete={setArchiveDeleteTarget}
          onToggle={toggleImageAttachmentInBasket}
        />

        <Dialog
          open={archiveDeleteTarget !== null}
          onClose={() => setArchiveDeleteTarget(null)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Delete image?</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2">
              {archiveDeleteTarget
                ? `Delete "${archiveDeleteTarget.fileName}" from the project image archive?`
                : "Delete this image from the project image archive?"}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setArchiveDeleteTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={busy || !archiveDeleteTarget}
              onClick={() => {
                if (archiveDeleteTarget) {
                  void deleteImageFromArchive(archiveDeleteTarget);
                }
              }}
            >
              Delete
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={archiveClearConfirmOpen}
          onClose={() => setArchiveClearConfirmOpen(false)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>Clear image archive?</DialogTitle>
          <DialogContent dividers>
            <Typography variant="body2">
              Delete all images from this project's image archive and clear the prompt basket?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setArchiveClearConfirmOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              color="error"
              variant="contained"
              disabled={busy || imageArchive.length === 0}
              onClick={() => void clearImageArchive()}
            >
              Clear
            </Button>
          </DialogActions>
        </Dialog>

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

interface ImageAttachmentPanelProps {
  basket: ImageAttachment[];
  archiveCount: number;
  disabled: boolean;
  onClearArchive: () => void;
  onDropFiles: (files: File[]) => Promise<void>;
  onOpenArchive: () => void;
  onRemove: (sha256: string) => void;
}

function ImageAttachmentPanel({
  basket,
  archiveCount,
  disabled,
  onClearArchive,
  onDropFiles,
  onOpenArchive,
  onRemove,
}: ImageAttachmentPanelProps): JSX.Element {
  function handleDragOver(event: ReactDragEvent<HTMLDivElement>): void {
    event.preventDefault();
  }

  function handleDrop(event: ReactDragEvent<HTMLDivElement>): void {
    event.preventDefault();

    if (disabled) {
      return;
    }

    void onDropFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <Box
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      sx={{
        p: 1,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Images
          </Typography>

          <Tooltip title="Open image archive" arrow>
            <IconButton
              size="small"
              aria-label="Open image archive"
              disabled={disabled || archiveCount === 0}
              onClick={onOpenArchive}
            >
              <ImageOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Clear image archive" arrow>
            <IconButton
              size="small"
              aria-label="Clear image archive"
              disabled={disabled || archiveCount === 0}
              onClick={onClearArchive}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Chip size="small" label={`Archive: ${archiveCount}`} />
        </Stack>

        {basket.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Drop images here.
          </Typography>
        ) : (
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
            {basket.map((attachment) => (
              <Chip
                key={attachment.sha256}
                size="small"
                label={`${attachment.fileName}  ${formatBytes(attachment.sizeBytes)}`}
                onDelete={() => onRemove(attachment.sha256)}
                deleteIcon={<DeleteOutlineIcon />}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

interface ImageArchiveDialogProps {
  open: boolean;
  archive: ImageAttachment[];
  basket: ImageAttachment[];
  onClose: () => void;
  onRequestDelete: (attachment: ImageAttachment) => void;
  onToggle: (attachment: ImageAttachment) => void;
}

function ImageArchiveDialog({
  open,
  archive,
  basket,
  onClose,
  onRequestDelete,
  onToggle,
}: ImageArchiveDialogProps): JSX.Element {
  const basketHashes = new Set(basket.map((attachment) => attachment.sha256));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Image archive</DialogTitle>
      <DialogContent dividers>
        {archive.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No images.
          </Typography>
        ) : (
          <Stack spacing={0.75} sx={{ maxHeight: 420, overflow: "auto" }}>
            {archive.map((attachment) => {
              const inBasket = basketHashes.has(attachment.sha256);

              return (
                <Chip
                  key={attachment.sha256}
                  label={`${attachment.fileName}  ${formatBytes(attachment.sizeBytes)}`}
                  variant={inBasket ? "filled" : "outlined"}
                  color={inBasket ? "primary" : "default"}
                  onClick={() => onToggle(attachment)}
                  onDelete={() => onRequestDelete(attachment)}
                  deleteIcon={<DeleteOutlineIcon />}
                  title={attachment.storedPath}
                />
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kib = sizeBytes / 1024;

  if (kib < 1024) {
    return `${kib.toFixed(1)} KB`;
  }

  return `${(kib / 1024).toFixed(1)} MB`;
}

