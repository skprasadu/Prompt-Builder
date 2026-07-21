
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PreviewOutlinedIcon from "@mui/icons-material/PreviewOutlined";
import TerminalOutlinedIcon from "@mui/icons-material/TerminalOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type JSX,
} from "react";

import type {
  AttachmentPreview,
  RequirementCloseoutDraft,
  RequirementDetail,
  RequirementPromptCompilation,
  RequirementSummary,
  PythonPatchAttachment,
} from "@rapid-prompt/prompt-builder-contracts";

import {
  getDesktopWindow,
  getDroppedFilePaths,
  invoke,
  writeClipboardText,
} from "../lib/desktop";
import { toErrorMessage } from "../lib/errors";
import { formatOutput } from "../lib/formatters";
import { resolveTreeSelectionFromPathInput } from "../lib/pathSelection";
import { toAbsolute, toRelative } from "../lib/session";
import { countTokens } from "../lib/tokenize";
import { collectFilePaths } from "../lib/tree";
import type {
  ImageAttachment,
  LocalProjectState,
  PdfAttachment,
} from "../types/capture";
import type { FileValue, Node } from "../types/fs";
import { isDirNode } from "../types/fs";
import type { LocalProject } from "../types/project";
import { FolderPathSelector } from "./FolderPathSelector";
import { ResizableSplitter } from "./ResizableSplitter";
import { TreeView } from "./TreeView";

const FOLDER_PANEL_DEFAULT_WIDTH = 420;
const FOLDER_PANEL_MIN_WIDTH = 320;
const FOLDER_PANEL_MAX_WIDTH = 720;
const FOLDER_PANEL_SPLITTER_WIDTH = 8;

const MemoTreeView = memo(
  TreeView,
  (previous, next) =>
    previous.node === next.node &&
    previous.expanded === next.expanded &&
    previous.selected === next.selected,
);

interface PromptBuilderProps {
  project: LocalProject;
}

type DialogMode =
  | "create-requirement"
  | "close-iteration"
  | "close-requirement"
  | null;

type IterationSaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

interface AttachmentPreviewState {
  title: string;
  preview: AttachmentPreview;
}

const ITERATION_AUTOSAVE_DELAY_MS = 1000;

export default function PromptBuilder({
  project,
}: PromptBuilderProps): JSX.Element {
  const [rootPath, setRootPath] = useState("");
  const [tree, setTree] = useState<Node | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );

  const [folderPanelWidth, setFolderPanelWidth] = useState(
    FOLDER_PANEL_DEFAULT_WIDTH,
  );
  const [folderPathSelectorOpen, setFolderPathSelectorOpen] = useState(false);
  const [folderPathInput, setFolderPathInput] = useState("");
  const [folderPathStatus, setFolderPathStatus] = useState("");
  const [folderPathError, setFolderPathError] = useState("");

  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [selectedRequirement, setSelectedRequirement] =
    useState<RequirementDetail | null>(null);

  const [requirementTitle, setRequirementTitle] = useState("");
  const [requirementObjective, setRequirementObjective] = useState("");

  const [instruction, setInstruction] = useState("");
  const [aiOutput, setAiOutput] = useState("");
  const [closeoutOutcome, setCloseoutOutcome] = useState("");

  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [includeTree, setIncludeTree] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);

  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [selectedImageHashes, setSelectedImageHashes] = useState<Set<string>>(
    () => new Set(),
  );
  const [pdfAttachments, setPdfAttachments] = useState<PdfAttachment[]>([]);
  const [selectedPdfHashes, setSelectedPdfHashes] = useState<Set<string>>(
    () => new Set(),
  );
  const [patchAttachments, setPatchAttachments] = useState<
    PythonPatchAttachment[]
  >([]);
  const [selectedPatchHashes, setSelectedPatchHashes] = useState<Set<string>>(
    () => new Set(),
  );

  const [selectedFilesDialogOpen, setSelectedFilesDialogOpen] = useState(false);
  const [attachmentPreview, setAttachmentPreview] =
    useState<AttachmentPreviewState | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iterationSaveStatus, setIterationSaveStatus] =
    useState<IterationSaveStatus>("idle");

  const loadGenerationRef = useRef(0);
  const stateLoadedRef = useRef(false);
  const stateSaveRef = useRef<number | null>(null);
  const systemPromptSaveRef = useRef<number | null>(null);
  const tokenRef = useRef<number | null>(null);
  const iterationAutosaveRef = useRef<number | null>(null);
  const iterationSaveGenerationRef = useRef(0);
  const lastSavedIterationSnapshotRef = useRef("");
  const currentIterationSnapshotRef = useRef("");

  const selectedFiles = useMemo(
    () => Array.from(selectedPaths).sort(),
    [selectedPaths],
  );

  const selectedRelativePaths = useMemo(
    () =>
      rootPath
        ? selectedFiles.map((absolutePath) =>
            toRelative(rootPath, absolutePath),
          )
        : selectedFiles,
    [rootPath, selectedFiles],
  );

  const selectedImages = useMemo(
    () =>
      imageAttachments.filter((attachment) =>
        selectedImageHashes.has(attachment.sha256),
      ),
    [imageAttachments, selectedImageHashes],
  );

  const selectedPdfs = useMemo(
    () =>
      pdfAttachments.filter((attachment) =>
        selectedPdfHashes.has(attachment.sha256),
      ),
    [pdfAttachments, selectedPdfHashes],
  );

  const selectedPatches = useMemo(
    () =>
      patchAttachments.filter((attachment) =>
        selectedPatchHashes.has(attachment.sha256),
      ),
    [patchAttachments, selectedPatchHashes],
  );

  const selectedPatchChangedPaths = useMemo(
    () =>
      Array.from(
        new Set(
          selectedPatches.flatMap((attachment) => attachment.changedPaths),
        ),
      ).sort(),
    [selectedPatches],
  );

  const currentIterationSnapshot = useMemo(
    () =>
      serializeIterationDraft({
        instruction,
        aiOutput,
        selectedPaths: selectedRelativePaths,
        imageAttachmentSha256s: Array.from(selectedImageHashes).sort(),
        pdfAttachmentSha256s: Array.from(selectedPdfHashes).sort(),
        patchAttachmentSha256s: Array.from(selectedPatchHashes).sort(),
      }),
    [
      aiOutput,
      instruction,
      selectedImageHashes,
      selectedPdfHashes,
      selectedPatchHashes,
      selectedRelativePaths,
    ],
  );

  useEffect(() => {
    currentIterationSnapshotRef.current = currentIterationSnapshot;
  }, [currentIterationSnapshot]);

  useEffect(() => {
    const requirement = selectedRequirement;

    if (
      !requirement ||
      requirement.activeIteration ||
      requirement.status === "completed" ||
      requirement.status === "abandoned"
    ) {
      return;
    }

    let cancelled = false;

    void invoke<RequirementDetail>(
      "requirement:ensure_active_iteration",
      {
        projectId: project.id,
        requirementId: requirement.id,
      },
    )
      .then((detail) => {
        if (cancelled) {
          return;
        }

        const active = detail.activeIteration;

        if (!active) {
          setIterationSaveStatus("error");
          setError(
            `Requirement ${detail.id} has no active iteration after recovery.`,
          );
          return;
        }

        lastSavedIterationSnapshotRef.current =
          serializeIterationDraft({
            instruction: active.instruction,
            aiOutput: active.aiOutput,
            selectedPaths: active.selectedPaths,
            imageAttachmentSha256s:
              active.imageAttachmentSha256s,
            pdfAttachmentSha256s:
              active.pdfAttachmentSha256s,
            patchAttachmentSha256s:
              active.patchAttachmentSha256s,
          });
        setSelectedRequirement(detail);
        setIterationSaveStatus("dirty");
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setIterationSaveStatus("error");
          setError(
            `Unable to recover an active iteration for requirement ${requirement.id}: ${toErrorMessage(reason)}`,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [project.id, selectedRequirement]);

  useEffect(() => {
    if (iterationAutosaveRef.current !== null) {
      window.clearTimeout(iterationAutosaveRef.current);
      iterationAutosaveRef.current = null;
    }

    const activeIteration = selectedRequirement?.activeIteration;

    if (
      !stateLoadedRef.current ||
      !activeIteration ||
      selectedRequirement?.status === "completed" ||
      selectedRequirement?.status === "abandoned"
    ) {
      return;
    }

    if (
      currentIterationSnapshot ===
      lastSavedIterationSnapshotRef.current
    ) {
      setIterationSaveStatus("saved");
      return;
    }

    setIterationSaveStatus("dirty");
    const saveGeneration =
      iterationSaveGenerationRef.current + 1;
    iterationSaveGenerationRef.current = saveGeneration;

    iterationAutosaveRef.current = window.setTimeout(() => {
      iterationAutosaveRef.current = null;

      void (async () => {
        setIterationSaveStatus("saving");

        try {
          const detail = await invoke<RequirementDetail>(
            "requirement:save_iteration",
            {
              projectId: project.id,
              requirementId: selectedRequirement.id,
              iterationId: activeIteration.id,
              instruction,
              assembledPrompt: "",
              aiOutput,
              selectedPaths: selectedRelativePaths,
              imageAttachmentSha256s: Array.from(
                selectedImageHashes,
              ),
              pdfAttachmentSha256s: Array.from(
                selectedPdfHashes,
              ),
              patchAttachmentSha256s: Array.from(
                selectedPatchHashes,
              ),
              patchChangedPaths: selectedPatchChangedPaths,
            },
          );

          if (
            iterationSaveGenerationRef.current !== saveGeneration
          ) {
            return;
          }

          setSelectedRequirement(detail);
          setError(null);
          lastSavedIterationSnapshotRef.current =
            currentIterationSnapshot;

          setIterationSaveStatus(
            currentIterationSnapshotRef.current ===
              currentIterationSnapshot
              ? "saved"
              : "dirty",
          );
        } catch (reason: unknown) {
          if (
            iterationSaveGenerationRef.current === saveGeneration
          ) {
            setIterationSaveStatus("error");
            setError(
              `Unable to autosave Iteration ${activeIteration.sequence}: ${toErrorMessage(reason)}`,
            );
          }
        }
      })();
    }, ITERATION_AUTOSAVE_DELAY_MS);

    return () => {
      if (iterationAutosaveRef.current !== null) {
        window.clearTimeout(iterationAutosaveRef.current);
        iterationAutosaveRef.current = null;
      }
    };
  }, [
    aiOutput,
    currentIterationSnapshot,
    instruction,
    project.id,
    selectedImageHashes,
    selectedPdfHashes,
    selectedPatchChangedPaths,
    selectedPatchHashes,
    selectedRelativePaths,
    selectedRequirement,
  ]);

  useEffect(() => {
    void getDesktopWindow()
      .setTitle("Rapid Prompt - Workbench")
      .catch((reason: unknown) => {
        console.warn("Unable to set desktop window title:", reason);
      });
  }, []);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    stateLoadedRef.current = false;

    setRootPath(project.rootPath);
    setTree(null);
    setExpanded(new Set());
    setSelectedPaths(new Set());
    setRequirements([]);
    setSelectedRequirement(null);
    setInstruction("");
    setAiOutput("");
    setImageAttachments([]);
    setSelectedImageHashes(new Set());
    setPdfAttachments([]);
    setSelectedPdfHashes(new Set());
    setPatchAttachments([]);
    setSelectedPatchHashes(new Set());
    setIterationSaveStatus("idle");
    lastSavedIterationSnapshotRef.current = "";
    currentIterationSnapshotRef.current = "";
    iterationSaveGenerationRef.current += 1;
    if (iterationAutosaveRef.current !== null) {
      window.clearTimeout(iterationAutosaveRef.current);
      iterationAutosaveRef.current = null;
    }
    setError(null);

    void loadProject(project, generation);
  }, [project.id, project.rootPath]);

  useEffect(() => {
    if (!stateLoadedRef.current || !rootPath) {
      return;
    }

    if (stateSaveRef.current !== null) {
      window.clearTimeout(stateSaveRef.current);
    }

    stateSaveRef.current = window.setTimeout(() => {
      void invoke("project:save_state", {
        projectId: project.id,
        state: {
          promptText: instruction,
          includeTree,
          selectedPaths: selectedRelativePaths,
          expandedPaths: Array.from(expanded).map((absolutePath) =>
            toRelative(rootPath, absolutePath),
          ),
          imageAttachments,
          selectedImageAttachmentSha256s: Array.from(
            selectedImageHashes,
          ).filter((sha256) =>
            imageAttachments.some(
              (attachment) => attachment.sha256 === sha256,
            ),
          ),
          pdfAttachments,
          selectedPdfAttachmentSha256s: Array.from(
            selectedPdfHashes,
          ).filter((sha256) =>
            pdfAttachments.some(
              (attachment) => attachment.sha256 === sha256,
            ),
          ),
          folderPanelWidth,
        },
      }).catch((reason: unknown) => {
        console.warn("Unable to save project state:", reason);
      });
    }, 500);

    return () => {
      if (stateSaveRef.current !== null) {
        window.clearTimeout(stateSaveRef.current);
      }
    };
  }, [
    expanded,
    folderPanelWidth,
    imageAttachments,
    includeTree,
    instruction,
    pdfAttachments,
    project.id,
    rootPath,
    selectedImageHashes,
    selectedPdfHashes,
    selectedRelativePaths,
  ]);

  useEffect(() => {
    if (systemPromptSaveRef.current !== null) {
      window.clearTimeout(systemPromptSaveRef.current);
    }

    systemPromptSaveRef.current = window.setTimeout(() => {
      void invoke("save_system_prompt", {
        projectId: project.id,
        value: systemPrompt,
      }).catch((reason: unknown) => {
        console.warn("Unable to save project system prompt:", reason);
      });
    }, 400);

    return () => {
      if (systemPromptSaveRef.current !== null) {
        window.clearTimeout(systemPromptSaveRef.current);
      }
    };
  }, [project.id, systemPrompt]);

  useEffect(() => {
    if (tokenRef.current !== null) {
      window.clearTimeout(tokenRef.current);
    }

    tokenRef.current = window.setTimeout(() => {
      void recomputeTokenCount();
    }, 250);

    return () => {
      if (tokenRef.current !== null) {
        window.clearTimeout(tokenRef.current);
      }
    };
  }, [
    includeTree,
    instruction,
    selectedPaths,
    systemPrompt,
    tree,
  ]);

  useEffect(() => {
    if (!tree || selectedPaths.size === 0) {
      return;
    }

    const requiredDirectories = directoriesForSelections(tree, selectedPaths);

    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;

      for (const directory of requiredDirectories) {
        if (!next.has(directory)) {
          next.add(directory);
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [selectedPaths, tree]);

  async function loadProject(
    nextProject: LocalProject,
    generation: number,
  ): Promise<void> {
    setBusy(true);

    try {
      const [
        state,
        prompt,
        imageArchive,
        pdfArchive,
        patchArchive,
        requirementRows,
      ] = await Promise.all([
        invoke<LocalProjectState>("project:get_state", {
          projectId: nextProject.id,
        }),
        invoke<string>("load_system_prompt", {
          projectId: nextProject.id,
        }),
        invoke<ImageAttachment[]>("attachments:list_images", {
          projectId: nextProject.id,
        }),
        invoke<PdfAttachment[]>("attachments:list_pdfs", {
          projectId: nextProject.id,
        }),
        invoke<PythonPatchAttachment[]>(
          "attachments:list_python_patches",
          {
            projectId: nextProject.id,
          },
        ),
        invoke<RequirementSummary[]>("requirement:list", {
          projectId: nextProject.id,
        }),
      ]);

      if (loadGenerationRef.current !== generation) {
        return;
      }

      setSystemPrompt(prompt);
      setInstruction(state.promptText);
      setIncludeTree(state.includeTree);
      setFolderPanelWidth(
        clamp(
          state.folderPanelWidth,
          FOLDER_PANEL_MIN_WIDTH,
          FOLDER_PANEL_MAX_WIDTH,
        ),
      );

      const validImages = imageArchive.filter(
        (attachment) => attachment.projectId === nextProject.id,
      );
      const validImageHashes = new Set(
        validImages.map((attachment) => attachment.sha256),
      );

      setImageAttachments(validImages);
      setSelectedImageHashes(
        new Set(
          state.selectedImageAttachmentSha256s.filter((sha256) =>
            validImageHashes.has(sha256),
          ),
        ),
      );

      const validPdfs = pdfArchive.filter(
        (attachment) => attachment.projectId === nextProject.id,
      );
      const validPdfHashes = new Set(
        validPdfs.map((attachment) => attachment.sha256),
      );

      setPdfAttachments(validPdfs);
      setSelectedPdfHashes(
        new Set(
          state.selectedPdfAttachmentSha256s.filter((sha256) =>
            validPdfHashes.has(sha256),
          ),
        ),
      );

      const validPatches = patchArchive.filter(
        (attachment) => attachment.projectId === nextProject.id,
      );
      setPatchAttachments(validPatches);

      setRequirements(requirementRows);

      const loadedTree = await loadTree(
        nextProject.rootPath,
        false,
        generation,
      );

      if (
        loadGenerationRef.current !== generation ||
        loadedTree === null
      ) {
        return;
      }

      const reachableFiles = collectFilePaths(loadedTree);

      setSelectedPaths(
        new Set(
          state.selectedPaths
            .map((relativePath) =>
              toAbsolute(nextProject.rootPath, relativePath),
            )
            .filter((absolutePath) =>
              reachableFiles.has(absolutePath),
            ),
        ),
      );

      setExpanded(() => {
        const next = new Set<string>([loadedTree.path]);

        for (const relativePath of state.expandedPaths) {
          next.add(toAbsolute(nextProject.rootPath, relativePath));
        }

        return next;
      });

      const firstRequirement = requirementRows[0];

      if (firstRequirement) {
        await openRequirement(firstRequirement.id, generation);
      }
    } catch (reason: unknown) {
      if (loadGenerationRef.current === generation) {
        setError(toErrorMessage(reason));
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        stateLoadedRef.current = true;
        setBusy(false);
      }
    }
  }

  async function loadTree(
    path: string,
    preserveSelection: boolean,
    generation = loadGenerationRef.current,
  ): Promise<Node | null> {
    if (!path) {
      return null;
    }

    setBusy(true);

    try {
      const previousSelection = new Set(selectedPaths);
      const raw = await invoke<Node>("scan_dir", { path });

      if (loadGenerationRef.current !== generation) {
        return null;
      }

      const normalized = isDirNode(raw)
        ? { ...raw, children: raw.children ?? [] }
        : raw;

      setTree(normalized);
      setExpanded((current) => new Set(current).add(normalized.path));

      if (preserveSelection) {
        const reachableFiles = collectFilePaths(normalized);

        setSelectedPaths(
          new Set(
            Array.from(previousSelection).filter((selectedPath) =>
              reachableFiles.has(selectedPath),
            ),
          ),
        );
      }

      return normalized;
    } catch (reason: unknown) {
      if (loadGenerationRef.current === generation) {
        setError(toErrorMessage(reason));
      }

      return null;
    } finally {
      if (loadGenerationRef.current === generation) {
        setBusy(false);
      }
    }
  }

  async function refreshRequirements(
    preferredRequirementId?: string,
  ): Promise<void> {
    const rows = await invoke<RequirementSummary[]>("requirement:list", {
      projectId: project.id,
    });

    setRequirements(rows);

    const targetId =
      preferredRequirementId ??
      selectedRequirement?.id ??
      rows[0]?.id;

    if (targetId) {
      await openRequirement(targetId);
    } else {
      setSelectedRequirement(null);
    }
  }

  async function openRequirement(
    requirementId: string,
    generation = loadGenerationRef.current,
  ): Promise<void> {
    try {
      const detail = await invoke<RequirementDetail>("requirement:get", {
        projectId: project.id,
        requirementId,
      });

      if (loadGenerationRef.current !== generation) {
        return;
      }

      iterationSaveGenerationRef.current += 1;
      if (iterationAutosaveRef.current !== null) {
        window.clearTimeout(iterationAutosaveRef.current);
        iterationAutosaveRef.current = null;
      }

      setSelectedRequirement(detail);

      const active = detail.activeIteration;
      const hydratedSnapshot = serializeIterationDraft({
        instruction: active?.instruction ?? "",
        aiOutput: active?.aiOutput ?? "",
        selectedPaths: active?.selectedPaths ?? [],
        imageAttachmentSha256s:
          active?.imageAttachmentSha256s ?? [],
        pdfAttachmentSha256s:
          active?.pdfAttachmentSha256s ?? [],
        patchAttachmentSha256s:
          active?.patchAttachmentSha256s ?? [],
      });
      lastSavedIterationSnapshotRef.current = hydratedSnapshot;
      currentIterationSnapshotRef.current = hydratedSnapshot;
      setIterationSaveStatus(active ? "saved" : "idle");

      setInstruction(active?.instruction ?? "");
      setAiOutput(active?.aiOutput ?? "");
      setSelectedImageHashes(
        new Set(active?.imageAttachmentSha256s ?? []),
      );
      setSelectedPdfHashes(
        new Set(active?.pdfAttachmentSha256s ?? []),
      );
      setSelectedPatchHashes(
        new Set(active?.patchAttachmentSha256s ?? []),
      );

      if (active && rootPath) {
        setSelectedPaths(
          new Set(
            active.selectedPaths.map((relativePath) =>
              toAbsolute(rootPath, relativePath),
            ),
          ),
        );
      } else {
        setSelectedPaths(new Set());
      }

    } catch (reason: unknown) {
      if (loadGenerationRef.current === generation) {
        setError(toErrorMessage(reason));
      }
    }
  }

  async function createRequirement(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const created = await invoke<RequirementDetail>(
        "requirement:create",
        {
          projectId: project.id,
          title: requirementTitle,
          objective: requirementObjective,
        },
      );

      setRequirementTitle("");
      setRequirementObjective("");
      setDialogMode(null);
      setSelectedRequirement(created);

      await refreshRequirements(created.id);
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }


  async function closeIteration(): Promise<void> {
    if (!selectedRequirement) {
      setError("No requirement is selected.");
      return;
    }

    setBusy(true);
    setError(null);
    setIterationSaveStatus("saving");
    iterationSaveGenerationRef.current += 1;

    if (iterationAutosaveRef.current !== null) {
      window.clearTimeout(iterationAutosaveRef.current);
      iterationAutosaveRef.current = null;
    }

    try {
      const requirementWithDraft =
        selectedRequirement.activeIteration
          ? selectedRequirement
          : await invoke<RequirementDetail>(
              "requirement:ensure_active_iteration",
              {
                projectId: project.id,
                requirementId: selectedRequirement.id,
              },
            );
      const activeIteration =
        requirementWithDraft.activeIteration;

      if (!activeIteration) {
        throw new Error(
          `Requirement ${selectedRequirement.id} has no active iteration after recovery.`,
        );
      }

      await invoke<RequirementDetail>(
        "requirement:save_iteration",
        {
          projectId: project.id,
          requirementId: selectedRequirement.id,
          iterationId: activeIteration.id,
          instruction,
          assembledPrompt: "",
          aiOutput,
          selectedPaths: selectedRelativePaths,
          imageAttachmentSha256s: Array.from(selectedImageHashes),
          pdfAttachmentSha256s: Array.from(selectedPdfHashes),
          patchAttachmentSha256s: Array.from(selectedPatchHashes),
          patchChangedPaths: selectedPatchChangedPaths,
        },
      );

      const detail = await invoke<RequirementDetail>(
        "requirement:close_iteration",
        {
          projectId: project.id,
          requirementId: selectedRequirement.id,
          iterationId: activeIteration.id,
          instruction,
          assembledPrompt: "",
          aiOutput,
          selectedPaths: selectedRelativePaths,
          imageAttachmentSha256s: Array.from(selectedImageHashes),
          pdfAttachmentSha256s: Array.from(selectedPdfHashes),
          patchAttachmentSha256s: Array.from(selectedPatchHashes),
          patchChangedPaths: selectedPatchChangedPaths,
        },
      );

      setSelectedRequirement(detail);
      setInstruction("");
      setAiOutput("");
      setSelectedPaths(new Set());
      setSelectedImageHashes(new Set());
      setSelectedPdfHashes(new Set());
      setSelectedPatchHashes(new Set());
      setDialogMode(null);
      setIterationSaveStatus("saved");
      lastSavedIterationSnapshotRef.current = "";
      currentIterationSnapshotRef.current = "";

      await refreshRequirements(detail.id);
    } catch (reason: unknown) {
      setIterationSaveStatus("error");
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function closeRequirement(): Promise<void> {
    if (!selectedRequirement) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const detail = await invoke<RequirementDetail>(
        "requirement:close",
        {
          projectId: project.id,
          requirementId: selectedRequirement.id,
          outcome: closeoutOutcome,
          decisions: [],
          reusablePatterns: [],
          rejectedApproaches: [],
        },
      );

      setSelectedRequirement(detail);
      setCloseoutOutcome("");
      setDialogMode(null);

      await refreshRequirements(detail.id);
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }


  async function prepareCloseRequirement(): Promise<void> {
    if (!selectedRequirement) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const draft = await invoke<RequirementCloseoutDraft>(
        "requirement:prepare_closeout",
        {
          projectId: project.id,
          requirementId: selectedRequirement.id,
        },
      );

      setCloseoutOutcome(draft.summary);
      setDialogMode("close-requirement");
    } catch (reason: unknown) {
      setError(
        `Unable to prepare requirement closeout for ${selectedRequirement.id}: ${toErrorMessage(reason)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function buildPromptPayload(
    compiledSystemPrompt: string,
  ): Promise<string> {
    const files = selectedFiles.length
      ? await invoke<FileValue[]>("read_ascii_files", {
          paths: selectedFiles,
          maxBytes: 512 * 1024,
        })
      : [];

    return formatOutput(instruction, files, {
      systemPrompt: compiledSystemPrompt,
      includeTree,
      treeRoot: includeTree ? tree : null,
    });
  }

  async function recomputeTokenCount(): Promise<void> {
    try {
      const payload = await buildPromptPayload("");
      setTokenCount(countTokens(payload));
    } catch (reason: unknown) {
      const message = toErrorMessage(reason);
      console.warn("Unable to recompute token count:", reason);
      setTokenCount(0);
      setError(`Unable to calculate prompt tokens: ${message}`);
    }
  }

  async function copyPrompt(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      if (!selectedRequirement) {
        throw new Error("No requirement is selected.");
      }

      const compilation =
        await invoke<RequirementPromptCompilation>(
          "requirement:compile_prompt",
          {
            projectId: project.id,
            requirementId: selectedRequirement.id,
            instruction,
            baseSystemPrompt: systemPrompt,
            selectedPaths: selectedRelativePaths,
          },
        );
      const payload = await buildPromptPayload(
        compilation.systemPrompt,
      );

      await writeClipboardText(payload);
      setTokenCount(countTokens(payload));
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function copySelectedImages(): Promise<void> {
    if (selectedImages.length === 0) {
      setError("Select at least one image attachment before copying.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await invoke("attachments:copy_images_to_clipboard", {
        paths: selectedImages.map(
          (attachment) => attachment.storedPath,
        ),
      });
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function previewAttachment(args: {
    kind: "image" | "pdf" | "python";
    sha256: string;
    title: string;
  }): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const command =
        args.kind === "image"
          ? "attachments:preview_image"
          : args.kind === "pdf"
            ? "attachments:preview_pdf"
            : "attachments:preview_python_patch";

      const preview = await invoke<AttachmentPreview>(command, {
        projectId: project.id,
        sha256: args.sha256,
      });

      setAttachmentPreview({
        title: args.title,
        preview,
      });
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function copySelectedPdfs(): Promise<void> {
    if (selectedPdfs.length === 0) {
      setError("Select at least one PDF attachment before copying.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await invoke("attachments:copy_pdfs_to_clipboard", {
        paths: selectedPdfs.map(
          (attachment) => attachment.storedPath,
        ),
      });
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addImages(files: File[]): Promise<void> {
    const paths = getDroppedFilePaths(files);

    if (paths.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const added = await invoke<ImageAttachment[]>(
        "attachments:add_images",
        {
          projectId: project.id,
          paths,
        },
      );

      setImageAttachments((current) =>
        mergeAttachments(current, added),
      );

      setSelectedImageHashes((current) => {
        const next = new Set(current);
        added.forEach((attachment) =>
          next.add(attachment.sha256),
        );
        return next;
      });
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addPythonPatches(files: File[]): Promise<void> {
    const paths = getDroppedFilePaths(files);

    if (paths.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const added = await invoke<PythonPatchAttachment[]>(
        "attachments:add_python_patches",
        {
          projectId: project.id,
          paths,
        },
      );

      setPatchAttachments((current) =>
        mergeAttachments(current, added),
      );
      setSelectedPatchHashes((current) => {
        const next = new Set(current);

        for (const attachment of added) {
          next.add(attachment.sha256);
        }

        return next;
      });
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function addPdfs(files: File[]): Promise<void> {
    const paths = getDroppedFilePaths(files);

    if (paths.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const added = await invoke<PdfAttachment[]>(
        "attachments:add_pdfs",
        {
          projectId: project.id,
          paths,
        },
      );

      setPdfAttachments((current) =>
        mergeAttachments(current, added),
      );

      setSelectedPdfHashes((current) => {
        const next = new Set(current);
        added.forEach((attachment) =>
          next.add(attachment.sha256),
        );
        return next;
      });
    } catch (reason: unknown) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  function toggleDirectory(path: string): void {
    setExpanded((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  }

  function toggleTreeSelection(
    path: string,
    checked: boolean,
  ): void {
    setSelectedPaths((current) => {
      const next = new Set(current);

      if (!tree) {
        toggleSetValue(next, path, checked);
        return next;
      }

      const node = findNode(tree, path);

      if (!node || !isDirNode(node)) {
        toggleSetValue(next, path, checked);
        return next;
      }

      for (const filePath of collectFilePaths(node)) {
        toggleSetValue(next, filePath, checked);
      }

      return next;
    });
  }

  function applyPathSelection(): void {
    setFolderPathError("");
    setFolderPathStatus("");

    if (!tree) {
      setFolderPathError(
        "The project folder tree is not loaded. Refresh the tree before applying paths.",
      );
      return;
    }

    const result = resolveTreeSelectionFromPathInput({
      rootPath,
      tree,
      input: folderPathInput,
    });

    if (result.inputCount === 0) {
      setFolderPathError(
        "Paste at least one file or folder path before applying.",
      );
      return;
    }

    if (result.matchedInputs.length === 0) {
      setFolderPathStatus("No matching paths found.");
      setFolderPathError(
        unmatchedPathMessage(result.unmatchedInputs),
      );
      return;
    }

    setSelectedPaths(new Set(result.selectedFilePaths));

    setExpanded((current) => {
      const next = new Set(current);
      next.add(tree.path);

      for (const directoryPath of result.expandedDirPaths) {
        next.add(directoryPath);
      }

      return next;
    });

    setFolderPathStatus(
      `Selected ${plural(result.selectedFilePaths.length, "file")} from ${plural(result.matchedInputs.length, "path")}.`,
    );

    if (result.unmatchedInputs.length > 0) {
      setFolderPathError(
        unmatchedPathMessage(result.unmatchedInputs),
      );
    }
  }

  const selectedRequirementIsClosed =
    selectedRequirement?.status === "completed" ||
    selectedRequirement?.status === "abandoned";

  return (
    <Box
      sx={{
        display: "grid",
        height: "100%",
        minHeight: 0,
        gridTemplateColumns: {
          xs: "1fr",
          sm: `${folderPanelWidth}px ${FOLDER_PANEL_SPLITTER_WIDTH}px minmax(0, 1fr)`,
        },
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          minWidth: FOLDER_PANEL_MIN_WIDTH,
          maxWidth: FOLDER_PANEL_MAX_WIDTH,
          display: "grid",
          gridTemplateRows: "auto auto minmax(180px, 1fr) auto minmax(160px, 0.65fr)",
          borderRight: 1,
          borderColor: "divider",
          overflow: "hidden",
          bgcolor: "background.paper",
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            px: 1,
            py: 0.75,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            title={rootPath}
            noWrap
            sx={{ flex: 1 }}
          >
            {rootPath}
          </Typography>

          <ActionIcon
            title="Refresh project tree"
            disabled={busy || !rootPath}
            onClick={() => void loadTree(rootPath, true)}
          >
            <RefreshIcon fontSize="small" />
          </ActionIcon>
        </Stack>

        <FolderPathSelector
          open={folderPathSelectorOpen}
          value={folderPathInput}
          disabled={busy || !tree}
          statusText={folderPathStatus}
          errorText={folderPathError}
          onOpenChange={setFolderPathSelectorOpen}
          onValueChange={(value) => {
            setFolderPathInput(value);
            setFolderPathStatus("");
            setFolderPathError("");
          }}
          onApply={applyPathSelection}
        />

        <Box sx={{ minHeight: 0, overflow: "auto", p: 1 }}>
          {!tree && busy && (
            <Stack direction="row" alignItems="center" spacing={1}>
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">
                Loading project tree
              </Typography>
            </Stack>
          )}

          {!tree && !busy && (
            <Typography variant="body2" color="text.secondary">
              Project tree is unavailable.
            </Typography>
          )}

          {tree && (
            <MemoTreeView
              node={tree}
              expanded={expanded}
              selected={selectedPaths}
              onToggleDir={toggleDirectory}
              onToggleFile={toggleTreeSelection}
            />
          )}
        </Box>

        <Stack
          direction="row"
          alignItems="center"
          sx={{
            px: 1,
            py: 0.75,
            borderTop: 1,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Requirements
          </Typography>

          <ActionIcon
            title="Refresh requirements"
            disabled={busy}
            onClick={() => void refreshRequirements()}
          >
            <RefreshIcon fontSize="small" />
          </ActionIcon>

          <ActionIcon
            title="Create requirement"
            color="primary"
            disabled={busy}
            onClick={() => setDialogMode("create-requirement")}
          >
            <AddCircleOutlineIcon fontSize="small" />
          </ActionIcon>
        </Stack>

        <List
          disablePadding
          sx={{ minHeight: 0, overflow: "auto" }}
        >
          {requirements.map((requirement) => (
            <ListItemButton
              key={requirement.id}
              selected={selectedRequirement?.id === requirement.id}
              onClick={() => void openRequirement(requirement.id)}
            >
              <ListItemText
                primary={requirement.title}
                secondary={`${requirement.status} · ${plural(requirement.iterationCount, "iteration")}`}
                primaryTypographyProps={{ noWrap: true }}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </ListItemButton>
          ))}

          {requirements.length === 0 && (
            <Box sx={{ p: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                Create the first requirement.
              </Typography>
            </Box>
          )}
        </List>
      </Box>

      <ResizableSplitter
        visible
        width={folderPanelWidth}
        minWidth={FOLDER_PANEL_MIN_WIDTH}
        maxWidth={FOLDER_PANEL_MAX_WIDTH}
        splitterWidth={FOLDER_PANEL_SPLITTER_WIDTH}
        onWidthChange={setFolderPanelWidth}
        label="Resize project context panel"
        tooltip="Drag to resize project context"
      />

      <Box
        sx={{
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          p: 2,
        }}
      >
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 1.5 }}
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {!selectedRequirement ? (
          <Paper
            variant="outlined"
            sx={{
              minHeight: 240,
              display: "grid",
              placeItems: "center",
              p: 3,
            }}
          >
            <Stack alignItems="center" spacing={1}>
              <Typography variant="h6">
                No requirement selected
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Create a requirement to begin the first iteration.
              </Typography>

              <ActionIcon
                title="Create requirement"
                color="primary"
                onClick={() => setDialogMode("create-requirement")}
              >
                <AddCircleOutlineIcon />
              </ActionIcon>
            </Stack>
          </Paper>
        ) : (
          <Stack spacing={1.5}>
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                "&::before": {
                  display: "none",
                },
                "&:first-of-type": {
                  borderRadius: 1,
                },
                "&:last-of-type": {
                  borderRadius: 1,
                },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="selected-requirement-details"
                id="selected-requirement-summary"
                sx={{
                  minHeight: 52,
                  px: 1.5,
                  "&.Mui-expanded": {
                    minHeight: 52,
                  },
                  "& .MuiAccordionSummary-content": {
                    my: 1,
                    minWidth: 0,
                  },
                  "& .MuiAccordionSummary-content.Mui-expanded": {
                    my: 1,
                  },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    minWidth: 0,
                    width: "100%",
                    pr: 0.5,
                  }}
                >
                  <Typography
                    variant="subtitle1"
                    fontWeight={600}
                    noWrap
                    sx={{ minWidth: 0, flex: 1 }}
                  >
                    {selectedRequirement.title}
                  </Typography>

                  <Chip
                    size="small"
                    label={selectedRequirement.status}
                  />

                  <Box
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => event.stopPropagation()}
                  >
                    <ActionIcon
                      title="Copy requirement history"
                      onClick={() =>
                        void writeClipboardText(
                          renderRequirementHistory(selectedRequirement),
                        )
                      }
                    >
                      <ContentCopyIcon fontSize="small" />
                    </ActionIcon>
                  </Box>

                  <Box
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => event.stopPropagation()}
                  >
                  </Box>

                  <Box
                    onClick={(event) => event.stopPropagation()}
                    onFocus={(event) => event.stopPropagation()}
                  >
                    <ActionIcon
                      title="Close requirement"
                      color="success"
                      disabled={selectedRequirementIsClosed}
                      onClick={() =>
                        void prepareCloseRequirement()
                      }
                    >
                      <CheckCircleOutlineIcon fontSize="small" />
                    </ActionIcon>
                  </Box>
                </Stack>
              </AccordionSummary>

              <AccordionDetails
                id="selected-requirement-details"
                sx={{
                  px: 1.5,
                  pt: 0,
                  pb: 1.5,
                  borderTop: 1,
                  borderColor: "divider",
                }}
              >
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    pt: 1.25,
                    maxHeight: 260,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {selectedRequirement.objective}
                </Typography>
              </AccordionDetails>
            </Accordion>

            <Paper variant="outlined" sx={{ overflow: "hidden" }}>
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                sx={{
                  px: 1.25,
                  py: 0.75,
                  borderBottom: 1,
                  borderColor: "divider",
                  flexWrap: "wrap",
                  rowGap: 0.75,
                }}
              >
                <ActionIcon
                  title="Copy iteration prompt"
                  color="primary"
                  disabled={busy}
                  onClick={() => void copyPrompt()}
                >
                  <ContentCopyIcon fontSize="small" />
                </ActionIcon>

                <ActionIcon
                  title="Copy selected images"
                  disabled={busy || selectedImages.length === 0}
                  onClick={() => void copySelectedImages()}
                >
                  <ImageOutlinedIcon fontSize="small" />
                </ActionIcon>

                <ActionIcon
                  title="Copy selected PDFs"
                  disabled={busy || selectedPdfs.length === 0}
                  onClick={() => void copySelectedPdfs()}
                >
                  <PictureAsPdfOutlinedIcon fontSize="small" />
                </ActionIcon>

                <Chip size="small" label={`Tokens: ${tokenCount}`} />

                <ActionIcon
                  title="Show selected source files"
                  onClick={() => setSelectedFilesDialogOpen(true)}
                >
                  <InfoOutlinedIcon fontSize="small" />
                </ActionIcon>

                <Stack
                  direction="row"
                  spacing={0.5}
                  alignItems="center"
                >
                  <Checkbox
                    size="small"
                    checked={includeTree}
                    onChange={(event) =>
                      setIncludeTree(event.currentTarget.checked)
                    }
                    inputProps={{
                      "aria-label": "Include folder tree",
                    }}
                  />

                  <Typography variant="body2">
                    Include folder tree
                  </Typography>
                </Stack>

                <Box sx={{ flex: 1 }} />

                <ActionIcon
                  title="Project system prompt"
                  onClick={() =>
                    setSystemPromptOpen((current) => !current)
                  }
                >
                  <SettingsOutlinedIcon fontSize="small" />
                </ActionIcon>

                <Chip
                  size="small"
                  label={iterationSaveStatusLabel(
                    iterationSaveStatus,
                  )}
                  color={iterationSaveStatusColor(
                    iterationSaveStatus,
                  )}
                  variant={
                    iterationSaveStatus === "saved"
                      ? "filled"
                      : "outlined"
                  }
                />

                <ActionIcon
                  title="Close iteration and open next"
                  color="success"
                  disabled={
                    busy ||
                    selectedRequirementIsClosed ||
                    !instruction.trim()
                  }
                  onClick={() => setDialogMode("close-iteration")}
                >
                  <DoneAllIcon fontSize="small" />
                </ActionIcon>
              </Stack>

              {systemPromptOpen && (
                <Box
                  sx={{
                    p: 1.25,
                    borderBottom: 1,
                    borderColor: "divider",
                    bgcolor: "background.default",
                  }}
                >
                  <TextField
                    label="Project system prompt"
                    value={systemPrompt}
                    onChange={(event) =>
                      setSystemPrompt(event.currentTarget.value)
                    }
                    multiline
                    minRows={3}
                    maxRows={8}
                    fullWidth
                    size="small"
                    InputProps={{
                      sx: {
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                        fontSize: 13,
                      },
                    }}
                  />
                </Box>
              )}

              <Stack spacing={1.25} sx={{ p: 1.25 }}>
                <TextField
                  label={`Iteration ${selectedRequirement.activeIteration?.sequence ?? selectedRequirement.iterations.length + 1} instruction`}
                  placeholder="Describe the next change, problem, experiment, or refinement"
                  value={instruction}
                  onChange={(event) =>
                    setInstruction(event.currentTarget.value)
                  }
                  multiline
                  minRows={7}
                  maxRows={18}
                  fullWidth
                  disabled={selectedRequirementIsClosed}
                  InputProps={{
                    sx: {
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                      fontSize: 13,
                    },
                  }}
                />

                <AttachmentDropPanel
                  title="Images"
                  emptyText="Drop images here."
                  icon={<ImageOutlinedIcon fontSize="small" />}
                  attachments={imageAttachments}
                  selectedHashes={selectedImageHashes}
                  disabled={busy || selectedRequirementIsClosed}
                  onDropFiles={addImages}
                  onToggle={(sha256) =>
                    setSelectedImageHashes((current) =>
                      toggledSet(current, sha256),
                    )
                  }
                  onPreview={(attachment) =>
                    void previewAttachment({
                      kind: "image",
                      sha256: attachment.sha256,
                      title: attachment.fileName,
                    })
                  }
                  onRemove={(sha256) => {
                    setImageAttachments((current) =>
                      current.filter(
                        (attachment) =>
                          attachment.sha256 !== sha256,
                      ),
                    );
                    setSelectedImageHashes((current) => {
                      const next = new Set(current);
                      next.delete(sha256);
                      return next;
                    });
                  }}
                />

                <AttachmentDropPanel
                  title="PDFs"
                  emptyText="Drop PDFs here."
                  icon={
                    <PictureAsPdfOutlinedIcon fontSize="small" />
                  }
                  attachments={pdfAttachments}
                  selectedHashes={selectedPdfHashes}
                  disabled={busy || selectedRequirementIsClosed}
                  onDropFiles={addPdfs}
                  onToggle={(sha256) =>
                    setSelectedPdfHashes((current) =>
                      toggledSet(current, sha256),
                    )
                  }
                  onPreview={(attachment) =>
                    void previewAttachment({
                      kind: "pdf",
                      sha256: attachment.sha256,
                      title: attachment.fileName,
                    })
                  }
                  onRemove={(sha256) => {
                    setPdfAttachments((current) =>
                      current.filter(
                        (attachment) =>
                          attachment.sha256 !== sha256,
                      ),
                    );
                    setSelectedPdfHashes((current) => {
                      const next = new Set(current);
                      next.delete(sha256);
                      return next;
                    });
                  }}
                />

                <AttachmentDropPanel
                  title="Python patches"
                  emptyText="Drop a Python patch here."
                  icon={<TerminalOutlinedIcon fontSize="small" />}
                  attachments={patchAttachments}
                  selectedHashes={selectedPatchHashes}
                  disabled={busy || selectedRequirementIsClosed}
                  onDropFiles={addPythonPatches}
                  onToggle={(sha256) =>
                    setSelectedPatchHashes((current) =>
                      toggledSet(current, sha256),
                    )
                  }
                  onPreview={(attachment) =>
                    void previewAttachment({
                      kind: "python",
                      sha256: attachment.sha256,
                      title: attachment.fileName,
                    })
                  }
                  onRemove={(sha256) => {
                    setPatchAttachments((current) =>
                      current.filter(
                        (attachment) => attachment.sha256 !== sha256,
                      ),
                    );
                    setSelectedPatchHashes((current) => {
                      const next = new Set(current);
                      next.delete(sha256);
                      return next;
                    });
                  }}
                />

                {selectedPatchChangedPaths.length > 0 && (
                  <ChipList
                    title="Changed files from selected patches"
                    values={selectedPatchChangedPaths}
                  />
                )}

                <TextField
                  label="AI response"
                  placeholder="Paste the AI response or patch result"
                  value={aiOutput}
                  onChange={(event) =>
                    setAiOutput(event.currentTarget.value)
                  }
                  multiline
                  minRows={7}
                  maxRows={20}
                  fullWidth
                  disabled={selectedRequirementIsClosed}
                />

              </Stack>
            </Paper>

            {selectedRequirement.iterations
              .slice()
              .reverse()
              .map((iteration) => (
                <Accordion
                  key={iteration.id}
                  disableGutters
                  defaultExpanded={iteration.sequence === selectedRequirement.iterations.length}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ minWidth: 0, width: "100%" }}
                    >
                      <Typography variant="subtitle2">
                        Iteration {iteration.sequence}
                      </Typography>

                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ flex: 1 }}
                      >
                        {new Date(iteration.createdAt).toLocaleString()}
                      </Typography>

                    </Stack>
                  </AccordionSummary>

                  <AccordionDetails>
                    <Stack spacing={1.25}>
                      {iteration.memory ? (
                        <>
                          <Stack direction="row" spacing={0.75} alignItems="center">
                            <Chip
                              size="small"
                              label={iteration.memory.outcome}
                              color={iterationOutcomeColor(iteration.memory.outcome)}
                            />
                            <Typography variant="caption" color="text.secondary">
                              Updated {new Date(iteration.memory.updatedAt).toLocaleString()}
                            </Typography>
                          </Stack>

                          <ReadOnlyBlock title="Summary" value={iteration.memory.summary} />
                          <ReadOnlyBlock
                            title="Intent"
                            value={iteration.memory.intent}
                            maxHeight={140}
                          />
                          <TextValues title="Decided actions" values={iteration.memory.decidedActions} />
                          <TextValues title="Relevant facts" values={iteration.memory.relevantFacts} />
                          <TextValues title="Unresolved work" values={iteration.memory.unresolvedWork} />
                          <ChipList title="Target files" values={iteration.memory.targetPaths} />
                          <ChipList title="Changed files" values={iteration.memory.changedPaths} />
                        </>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No concise memory has been generated for this iteration.
                        </Typography>
                      )}

                      <Accordion
                        disableGutters
                        elevation={0}
                        sx={{
                          border: 1,
                          borderColor: "divider",
                          "&::before": { display: "none" },
                        }}
                      >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="subtitle2">Raw evidence</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                          <Stack spacing={1.25}>
                            <ReadOnlyBlock title="Instruction" value={iteration.instruction} />
                            {iteration.aiOutput && (
                              <ReadOnlyBlock
                                title="AI response"
                                value={iteration.aiOutput}
                                maxHeight={320}
                              />
                            )}
                            <ChipList title="Selected source files" values={iteration.selectedPaths} />
                            <IterationAttachmentPreviews
                              title="Images"
                              hashes={iteration.imageAttachmentSha256s}
                              attachments={imageAttachments}
                              onPreview={(attachment) =>
                                void previewAttachment({
                                  kind: "image",
                                  sha256: attachment.sha256,
                                  title: attachment.fileName,
                                })
                              }
                            />
                            <IterationAttachmentPreviews
                              title="PDFs"
                              hashes={iteration.pdfAttachmentSha256s}
                              attachments={pdfAttachments}
                              onPreview={(attachment) =>
                                void previewAttachment({
                                  kind: "pdf",
                                  sha256: attachment.sha256,
                                  title: attachment.fileName,
                                })
                              }
                            />
                            <IterationAttachmentPreviews
                              title="Python patches"
                              hashes={iteration.patchAttachmentSha256s}
                              attachments={patchAttachments}
                              onPreview={(attachment) =>
                                void previewAttachment({
                                  kind: "python",
                                  sha256: attachment.sha256,
                                  title: attachment.fileName,
                                })
                              }
                            />
                            <ChipList title="Changed files from patch" values={iteration.patchChangedPaths} />
                          </Stack>
                        </AccordionDetails>
                      </Accordion>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}

            {selectedRequirement.iterations.length === 0 && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="body2" color="text.secondary">
                  This requirement has no saved iterations.
                </Typography>
              </Paper>
            )}

            {selectedRequirement.closeout && (
              <Accordion disableGutters defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2">
                    Requirement closeout
                  </Typography>
                </AccordionSummary>

                <AccordionDetails>
                  <Stack spacing={1.25}>
                    <ReadOnlyBlock
                      title="Outcome"
                      value={selectedRequirement.closeout.outcome}
                    />

                    <TextValues
                      title="Decisions"
                      values={selectedRequirement.closeout.decisions}
                    />

                    <TextValues
                      title="Reusable patterns"
                      values={
                        selectedRequirement.closeout.reusablePatterns
                      }
                    />

                    <TextValues
                      title="Rejected approaches"
                      values={
                        selectedRequirement.closeout.rejectedApproaches
                      }
                    />

                  </Stack>
                </AccordionDetails>
              </Accordion>
            )}
          </Stack>
        )}
      </Box>

      <EditorDialog
        open={dialogMode === "create-requirement"}
        title="Create requirement"
        disabled={
          busy ||
          !requirementTitle.trim() ||
          !requirementObjective.trim()
        }
        actionTitle="Create requirement"
        onClose={() => setDialogMode(null)}
        onAction={() => void createRequirement()}
      >
        <TextField
          label="Title"
          value={requirementTitle}
          onChange={(event) =>
            setRequirementTitle(event.currentTarget.value)
          }
          fullWidth
          autoFocus
        />

        <TextField
          label="Objective"
          value={requirementObjective}
          onChange={(event) =>
            setRequirementObjective(event.currentTarget.value)
          }
          multiline
          minRows={5}
          maxRows={12}
          fullWidth
        />
      </EditorDialog>

      <EditorDialog
        open={dialogMode === "close-iteration"}
        title="Close iteration"
        disabled={busy || !instruction.trim()}
        actionTitle="Close iteration and open next"
        onClose={() => setDialogMode(null)}
        onAction={() => void closeIteration()}
      >
        <Typography variant="body2">
          Close this iteration and open the next one?
        </Typography>
      </EditorDialog>

      <EditorDialog
        open={dialogMode === "close-requirement"}
        title="Close requirement"
        disabled={busy || !closeoutOutcome.trim()}
        actionTitle="Close requirement"
        onClose={() => setDialogMode(null)}
        onAction={() => void closeRequirement()}
      >
        <TextField
          label="Requirement summary"
          value={closeoutOutcome}
          onChange={(event) =>
            setCloseoutOutcome(event.currentTarget.value)
          }
          multiline
          minRows={6}
          maxRows={14}
          fullWidth
          autoFocus
        />
      </EditorDialog>

      <Dialog
        open={attachmentPreview !== null}
        onClose={() => setAttachmentPreview(null)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle>
          {attachmentPreview?.title ?? "Attachment preview"}
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0 }}>
          {attachmentPreview && (
            <AttachmentPreviewContent preview={attachmentPreview.preview} />
          )}
        </DialogContent>

        <DialogActions>
          <ActionIcon
            title="Close attachment preview"
            onClick={() => setAttachmentPreview(null)}
          >
            <CloseIcon fontSize="small" />
          </ActionIcon>
        </DialogActions>
      </Dialog>

      <Dialog
        open={selectedFilesDialogOpen}
        onClose={() => setSelectedFilesDialogOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Selected source files</DialogTitle>

        <DialogContent dividers>
          {selectedRelativePaths.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No files selected.
            </Typography>
          ) : (
            <Box
              component="pre"
              sx={{
                m: 0,
                maxHeight: 420,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                fontSize: 12,
              }}
            >
              {selectedRelativePaths.join("\n")}
            </Box>
          )}
        </DialogContent>

        <DialogActions>
          <ActionIcon
            title="Close selected files"
            onClick={() => setSelectedFilesDialogOpen(false)}
          >
            <CloseIcon fontSize="small" />
          </ActionIcon>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface AttachmentBase {
  sha256: string;
  fileName: string;
  sizeBytes: number;
}

interface AttachmentDropPanelProps<T extends AttachmentBase> {
  title: string;
  emptyText: string;
  icon: JSX.Element;
  attachments: T[];
  selectedHashes: ReadonlySet<string>;
  disabled: boolean;
  onDropFiles: (files: File[]) => Promise<void>;
  onToggle: (sha256: string) => void;
  onPreview: (attachment: T) => void;
  onRemove: (sha256: string) => void;
}

function AttachmentDropPanel<T extends AttachmentBase>({
  title,
  emptyText,
  icon,
  attachments,
  selectedHashes,
  disabled,
  onDropFiles,
  onToggle,
  onPreview,
  onRemove,
}: AttachmentDropPanelProps<T>): JSX.Element {
  function handleDragOver(
    event: ReactDragEvent<HTMLDivElement>,
  ): void {
    event.preventDefault();
  }

  function handleDrop(
    event: ReactDragEvent<HTMLDivElement>,
  ): void {
    event.preventDefault();

    if (!disabled) {
      void onDropFiles(Array.from(event.dataTransfer.files));
    }
  }

  return (
    <Paper
      variant="outlined"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      sx={{ p: 1 }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {icon}

          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {title}
          </Typography>
        </Stack>

        {attachments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {emptyText}
          </Typography>
        ) : (
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ flexWrap: "wrap", rowGap: 0.75 }}
          >
            {attachments.map((attachment) => {
              const isSelected = selectedHashes.has(
                attachment.sha256,
              );

              return (
                <Tooltip
                  key={attachment.sha256}
                  title={
                    isSelected
                      ? "Selected for this iteration"
                      : "Not selected for this iteration"
                  }
                  arrow
                >
                  <Stack direction="row" spacing={0.25} alignItems="center">
                    <Chip
                      size="small"
                      label={`${attachment.fileName} · ${formatBytes(attachment.sizeBytes)}`}
                      color={isSelected ? "primary" : "default"}
                      variant={isSelected ? "filled" : "outlined"}
                      onClick={() =>
                        onToggle(attachment.sha256)
                      }
                      onDelete={() =>
                        onRemove(attachment.sha256)
                      }
                      deleteIcon={<DeleteOutlineIcon />}
                    />
                    <ActionIcon
                      title={`Preview ${attachment.fileName}`}
                      disabled={disabled}
                      onClick={() => onPreview(attachment)}
                    >
                      <PreviewOutlinedIcon fontSize="small" />
                    </ActionIcon>
                  </Stack>
                </Tooltip>
              );
            })}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

interface PreviewAttachmentBase extends AttachmentBase {
  sha256: string;
}

function IterationAttachmentPreviews<T extends PreviewAttachmentBase>({
  title,
  hashes,
  attachments,
  onPreview,
}: {
  title: string;
  hashes: string[];
  attachments: T[];
  onPreview: (attachment: T) => void;
}): JSX.Element | null {
  if (hashes.length === 0) {
    return null;
  }

  const byHash = new Map(
    attachments.map((attachment) => [attachment.sha256, attachment]),
  );

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ flexWrap: "wrap", rowGap: 0.5 }}
      >
        {hashes.map((sha256) => {
          const attachment = byHash.get(sha256);

          return attachment ? (
            <Chip
              key={sha256}
              size="small"
              icon={<PreviewOutlinedIcon />}
              label={attachment.fileName}
              onClick={() => onPreview(attachment)}
            />
          ) : (
            <Chip
              key={sha256}
              size="small"
              label={sha256.slice(0, 16)}
              variant="outlined"
              disabled
            />
          );
        })}
      </Stack>
    </Box>
  );
}

function AttachmentPreviewContent({
  preview,
}: {
  preview: AttachmentPreview;
}): JSX.Element {
  if (preview.kind === "python") {
    return (
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          maxHeight: "75vh",
          overflow: "auto",
          whiteSpace: "pre",
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
          fontSize: 12,
        }}
      >
        {preview.text}
        {preview.truncated ? "\n\n... preview truncated ..." : ""}
      </Box>
    );
  }

  if (preview.kind === "image") {
    return (
      <Box
        component="img"
        src={preview.dataUrl}
        alt={preview.fileName}
        sx={{
          display: "block",
          width: "100%",
          maxHeight: "75vh",
          objectFit: "contain",
          bgcolor: "background.default",
        }}
      />
    );
  }

  return (
    <Box
      component="iframe"
      title={preview.fileName}
      src={preview.dataUrl}
      sx={{
        display: "block",
        width: "100%",
        height: "75vh",
        border: 0,
        bgcolor: "background.default",
      }}
    />
  );
}

interface EditorDialogProps {
  open: boolean;
  title: string;
  disabled: boolean;
  actionTitle: string;
  onClose: () => void;
  onAction: () => void;
  children: JSX.Element | JSX.Element[];
}

function EditorDialog({
  open,
  title,
  disabled,
  actionTitle,
  onClose,
  onAction,
  children,
}: EditorDialogProps): JSX.Element {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
    >
      <DialogTitle>{title}</DialogTitle>

      <DialogContent dividers>
        <Stack spacing={1.25}>{children}</Stack>
      </DialogContent>

      <DialogActions>
        <ActionIcon title="Cancel" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </ActionIcon>

        <ActionIcon
          title={actionTitle}
          color="primary"
          disabled={disabled}
          onClick={onAction}
        >
          <CheckCircleOutlineIcon fontSize="small" />
        </ActionIcon>
      </DialogActions>
    </Dialog>
  );
}

interface ActionIconProps {
  title: string;
  disabled?: boolean;
  color?: "default" | "primary" | "success";
  onClick: () => void;
  children: JSX.Element;
}

function ActionIcon({
  title,
  disabled = false,
  color = "default",
  onClick,
  children,
}: ActionIconProps): JSX.Element {
  return (
    <Tooltip title={title} arrow>
      <span>
        <IconButton
          size="small"
          aria-label={title}
          disabled={disabled}
          color={color}
          onClick={onClick}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function ReadOnlyBlock({
  title,
  value,
  maxHeight = 220,
}: {
  title: string;
  value: string;
  maxHeight?: number;
}): JSX.Element {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>

      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          maxHeight,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.default",
          fontFamily: "inherit",
          fontSize: 13,
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function ChipList({
  title,
  values,
}: {
  title: string;
  values: string[];
}): JSX.Element | null {
  if (values.length === 0) {
    return null;
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ flexWrap: "wrap", rowGap: 0.5 }}
      >
        {values.map((value) => (
          <Chip key={value} size="small" label={value} />
        ))}
      </Stack>
    </Box>
  );
}

function TextValues({
  title,
  values,
}: {
  title: string;
  values: string[];
}): JSX.Element | null {
  if (values.length === 0) {
    return null;
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {title}
      </Typography>

      <Stack spacing={0.25}>
        {values.map((value) => (
          <Typography key={value} variant="body2">
            {value}
          </Typography>
        ))}
      </Stack>
    </Box>
  );
}

function findNode(root: Node, targetPath: string): Node | null {
  if (root.path === targetPath) {
    return root;
  }

  if (!isDirNode(root)) {
    return null;
  }

  for (const child of root.children) {
    const found = findNode(child, targetPath);

    if (found) {
      return found;
    }
  }

  return null;
}

function directoriesForSelections(
  root: Node,
  selectedPaths: ReadonlySet<string>,
): Set<string> {
  const directories = new Set<string>();

  for (const selectedPath of selectedPaths) {
    const ancestors = findAncestors(root, selectedPath);

    if (ancestors) {
      ancestors.forEach((directory) =>
        directories.add(directory),
      );
    }
  }

  return directories;
}

function findAncestors(
  node: Node,
  targetPath: string,
  ancestors: string[] = [],
): string[] | null {
  if (node.path === targetPath) {
    return ancestors;
  }

  if (!isDirNode(node)) {
    return null;
  }

  for (const child of node.children) {
    const found = findAncestors(
      child,
      targetPath,
      [...ancestors, node.path],
    );

    if (found) {
      return found;
    }
  }

  return null;
}

function renderRequirementHistory(
  requirement: RequirementDetail,
): string {
  const output = [
    `# Requirement: ${requirement.title}`,
    "",
    requirement.objective,
    "",
    `Status: ${requirement.status}`,
    "",
  ];

  for (const iteration of requirement.iterations) {
    output.push(
      `## Iteration ${iteration.sequence}`,
      "",
      "### Instruction",
      "",
      iteration.instruction,
      "",
    );

    if (iteration.assembledPrompt) {
      output.push(
        "### Assembled prompt",
        "",
        iteration.assembledPrompt,
        "",
      );
    }

    if (iteration.aiOutput) {
      output.push(
        "### AI response",
        "",
        iteration.aiOutput,
        "",
      );
    }

    appendList(
      output,
      "Selected source files",
      iteration.selectedPaths,
    );
    appendList(
      output,
      "Python patch artifacts",
      iteration.patchAttachmentSha256s,
    );
    appendList(
      output,
      "Changed files from patch",
      iteration.patchChangedPaths,
    );
  }

  if (requirement.closeout) {
    output.push(
      "# Closeout",
      "",
      requirement.closeout.outcome,
      "",
    );

    appendList(output, "Decisions", requirement.closeout.decisions);
    appendList(
      output,
      "Reusable patterns",
      requirement.closeout.reusablePatterns,
    );
    appendList(
      output,
      "Rejected approaches",
      requirement.closeout.rejectedApproaches,
    );
  }

  return `${output.join("\n").trimEnd()}\n`;
}


function appendList(
  output: string[],
  title: string,
  values: string[],
): void {
  if (values.length === 0) {
    return;
  }

  output.push(`### ${title}`, "");

  values.forEach((value) => output.push(`- ${value}`));
  output.push("");
}

interface IterationDraftSnapshotInput {
  instruction: string;
  aiOutput: string;
  selectedPaths: string[];
  imageAttachmentSha256s: string[];
  pdfAttachmentSha256s: string[];
  patchAttachmentSha256s: string[];
}

function serializeIterationDraft(
  input: IterationDraftSnapshotInput,
): string {
  return JSON.stringify({
    instruction: input.instruction,
    aiOutput: input.aiOutput,
    selectedPaths: [...input.selectedPaths].sort(),
    imageAttachmentSha256s: [
      ...input.imageAttachmentSha256s,
    ].sort(),
    pdfAttachmentSha256s: [
      ...input.pdfAttachmentSha256s,
    ].sort(),
    patchAttachmentSha256s: [
      ...input.patchAttachmentSha256s,
    ].sort(),
  });
}

function iterationSaveStatusLabel(
  status: IterationSaveStatus,
): string {
  switch (status) {
    case "dirty":
      return "Unsaved";
    case "saving":
      return "Saving";
    case "saved":
      return "Saved";
    case "error":
      return "Save failed";
    case "idle":
      return "Ready";
  }
}

function iterationSaveStatusColor(
  status: IterationSaveStatus,
): "default" | "success" | "warning" | "error" {
  switch (status) {
    case "dirty":
    case "saving":
      return "warning";
    case "saved":
      return "success";
    case "error":
      return "error";
    case "idle":
      return "default";
  }
}

function iterationOutcomeColor(
  outcome: "completed" | "partial" | "failed" | "unknown",
): "default" | "success" | "warning" | "error" {
  switch (outcome) {
    case "completed":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "error";
    case "unknown":
      return "default";
  }
}

function unmatchedPathMessage(paths: string[]): string {
  const displayed = paths.slice(0, 5).join("; ");
  const remainder =
    paths.length > 5 ? `; +${paths.length - 5} more` : "";

  return `Paths not found in the loaded project tree: ${displayed}${remainder}.`;
}

function mergeAttachments<T extends AttachmentBase>(
  current: T[],
  added: T[],
): T[] {
  const byHash = new Map<string, T>();

  current.forEach((attachment) =>
    byHash.set(attachment.sha256, attachment),
  );
  added.forEach((attachment) =>
    byHash.set(attachment.sha256, attachment),
  );

  return Array.from(byHash.values()).sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  );
}

function toggleSetValue(
  values: Set<string>,
  value: string,
  enabled: boolean,
): void {
  if (enabled) {
    values.add(value);
  } else {
    values.delete(value);
  }
}

function toggledSet(
  current: ReadonlySet<string>,
  value: string,
): Set<string> {
  const next = new Set(current);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}


function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kibibytes = sizeBytes / 1024;

  if (kibibytes < 1024) {
    return `${kibibytes.toFixed(1)} KB`;
  }

  return `${(kibibytes / 1024).toFixed(1)} MB`;
}
