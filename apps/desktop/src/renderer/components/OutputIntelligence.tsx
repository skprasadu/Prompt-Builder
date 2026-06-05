import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState, type JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { invoke, writeClipboardText } from "../lib/desktop";
import type {
  CreateEntryInput,
  EntryDetail,
  EntryPurpose,
  EntrySearchResult,
  EntrySummary,
  PromptWorkflowState,
  RagAnswer,
} from "../types/capture";
import type { LocalProject } from "../types/project";

export interface OutputIntelligenceProps {
  project: LocalProject;
  promptState: PromptWorkflowState | null;
}

type OutputIntelligencePanel = "insights" | "entries";
type InsightIntentId =
  | "daily_engineering_logs"
  | "research_notes"
  | "linkedin_posts"
  | "technical_blog_drafts"
  | "architecture_explainers"
  | "implementation_summaries"
  | "lessons_learned";
type MemoryItem = EntrySummary | EntrySearchResult;

const INSIGHT_CHIPS: {
  id: InsightIntentId;
  label: string;
}[] = [
  { id: "daily_engineering_logs", label: "daily engineering logs" },
  { id: "research_notes", label: "research notes" },
  { id: "linkedin_posts", label: "LinkedIn posts" },
  { id: "technical_blog_drafts", label: "technical blog drafts" },
  { id: "architecture_explainers", label: "architecture explainers" },
  { id: "implementation_summaries", label: "implementation summaries" },
  { id: "lessons_learned", label: "lessons learned" },
];

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error === null || error === undefined) return "Unknown error";

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function defaultEntryName(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `Entry ${stamp}`;
}

function isSearchResult(item: MemoryItem): item is EntrySearchResult {
  return "entryId" in item;
}

function entryIdFor(item: MemoryItem): string {
  return isSearchResult(item) ? item.entryId : item.id;
}

function itemName(item: MemoryItem): string {
  return isSearchResult(item) ? item.entryName : item.name;
}

function itemDescription(item: MemoryItem): string {
  return isSearchResult(item) ? item.entryDescription : item.description;
}

function changedFilesFor(item: MemoryItem): string[] {
  return item.changedFiles ?? [];
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath;
}

export default function OutputIntelligence({
  project,
  promptState,
}: OutputIntelligenceProps): JSX.Element {
  const [panel, setPanel] = useState<OutputIntelligencePanel>("insights");

  const [entryPurpose, setEntryPurpose] = useState<EntryPurpose>("software_implementation");
  const [entryName, setEntryName] = useState<string>(() => defaultEntryName());
  const [description, setDescription] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [aiOutput, setAiOutput] = useState<string>("");
  const [includeGitChangedFiles, setIncludeGitChangedFiles] = useState<boolean>(true);
  const [captureOpen, setCaptureOpen] = useState<boolean>(false);

  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<EntryDetail | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);
  const [contextOpen, setContextOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [results, setResults] = useState<EntrySearchResult[]>([]);
  const [activeIntentId, setActiveIntentId] = useState<InsightIntentId | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const visibleItems = useMemo<MemoryItem[]>(
    () => (results.length > 0 ? results : entries),
    [entries, results],
  );

  useEffect(() => {
    void refreshEntries();
  }, [project.id]);

  async function refreshEntries(): Promise<void> {
    setError(null);

    try {
      const rows = await invoke<EntrySummary[]>("entry:list", {
        projectId: project.id,
      });

      const nextEntries = Array.isArray(rows) ? rows : [];
      setEntries(nextEntries);

      if (!selectedEntry && nextEntries[0]) {
        await openEntry(nextEntries[0].id);
      }
    } catch (err: unknown) {
      setEntries([]);
      setError(`Failed to load entries: ${toErrorMessage(err)}`);
    }
  }

  async function saveEntry(): Promise<void> {
    const name = entryName.trim();

    if (!name) {
      setError("Entry name is required.");
      return;
    }

    if (!aiOutput.trim() && !notes.trim()) {
      setError("Add AI output or notes before saving an entry.");
      return;
    }

    setBusy(true);
    setError(null);

    const input: CreateEntryInput = {
      projectId: project.id,
      purpose: entryPurpose,
      name,
      description: description.trim(),
      notes,
      aiOutput,
      systemPrompt: promptState?.systemPrompt ?? "",
      promptText: promptState?.promptText ?? "",
      selectedPaths: promptState?.selectedPaths ?? [],
      imageAttachments: promptState?.imageAttachments ?? [],
      includeTree: promptState?.includeTree ?? false,
      includeGitChangedFiles,
      tokenCount: promptState?.tokenCount ?? 0,
    };

    try {
      const entryArgs: Record<string, unknown> = { ...input };
      const savedEntry = await invoke<EntrySummary>("entry:create", entryArgs);
      setEntryPurpose("software_implementation");
      setEntryName(defaultEntryName());
      setDescription("");
      setNotes("");
      setAiOutput("");
      setIncludeGitChangedFiles(true);
      setCaptureOpen(false);
      setPanel("entries");
      await refreshEntries();
      await openEntry(savedEntry.id);
    } catch (err: unknown) {
      setError(`Failed to save entry: ${toErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function searchEntries(): Promise<void> {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setResults([]);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const rows = await invoke<EntrySearchResult[]>("entry:search", {
        projectId: project.id,
        query: trimmedQuery,
        limit: 20,
      });

      const nextResults = Array.isArray(rows) ? rows : [];
      setResults(nextResults);

      if (nextResults[0]) {
        await openEntry(nextResults[0].entryId);
      }
    } catch (err: unknown) {
      setResults([]);
      setError(`Search failed: ${toErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function generateInsight(intentId: InsightIntentId): Promise<void> {
    setPanel("insights");
    setActiveIntentId(intentId);
    setBusy(true);
    setError(null);

    try {
      const nextAnswer = await invoke<RagAnswer>("insight:generate", {
        projectId: project.id,
        intentId,
        ...(selectedEntry?.id ? { selectedEntryId: selectedEntry.id } : {}),
      });
      setAnswer(nextAnswer);

      if (nextAnswer.context.entries[0]) {
        await openEntry(nextAnswer.context.entries[0].entryId);
      }
    } catch (err: unknown) {
      setError(`Insight generation failed: ${toErrorMessage(err)}`);
    } finally {
      setBusy(false);
      setActiveIntentId(null);
    }
  }

  async function openEntry(entryId: string): Promise<void> {
    try {
      const detail = await invoke<EntryDetail>("entry:get", {
        projectId: project.id,
        entryId,
      });
      setSelectedEntry(detail);
    } catch (err: unknown) {
      setError(`Failed to open entry: ${toErrorMessage(err)}`);
    }
  }

  async function deleteSelectedEntry(): Promise<void> {
    if (!selectedEntry) return;

    const deletedEntryId = selectedEntry.id;
    setBusy(true);
    setError(null);

    try {
      await invoke("entry:delete", {
        projectId: project.id,
        entryId: deletedEntryId,
      });

      setDeleteConfirmOpen(false);
      setSelectedEntry(null);
      setResults((currentResults) =>
        currentResults.filter((result) => result.entryId !== deletedEntryId),
      );

      const rows = await invoke<EntrySummary[]>("entry:list", {
        projectId: project.id,
      });
      const nextEntries = Array.isArray(rows) ? rows : [];
      setEntries(nextEntries);

      if (nextEntries[0]) {
        await openEntry(nextEntries[0].id);
      }
    } catch (err: unknown) {
      setError(`Failed to delete entry: ${toErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openCaptureFolder(): Promise<void> {
    if (!selectedEntry) return;

    await invoke<string>("shell:open_path", {
      path: selectedEntry.captureDir,
    });
  }

  async function copySelectedEntryContext(): Promise<void> {
    if (!selectedEntry) return;
    await writeClipboardText(renderEntryContext(selectedEntry));
  }

  async function copyChangedFiles(): Promise<void> {
    if (!selectedEntry) return;
    await writeClipboardText(selectedEntry.changedFiles.join("\n"));
  }

  async function copyAnswer(): Promise<void> {
    if (!answer) return;
    await writeClipboardText(answer.answer);
  }

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <Paper
        square
        elevation={0}
        sx={{
          px: 2,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Tabs
            value={panel}
            onChange={(_event, value) => setPanel(value as OutputIntelligencePanel)}
            sx={{ minHeight: 42, flex: 1 }}
          >
            <Tab label="Insights" value="insights" sx={{ minHeight: 42 }} />
            <Tab label="Manage Entries" value="entries" sx={{ minHeight: 42 }} />
          </Tabs>

          <Tooltip title="Capture output" arrow>
            <IconButton
              aria-label="Capture output"
              onClick={() => setCaptureOpen(true)}
            >
              <AddCircleOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Paper>

      {panel === "insights" ? (
        <Box
          sx={{
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr)",
            gap: 1.5,
            p: 2,
            overflow: "hidden",
          }}
        >
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }}>
              {INSIGHT_CHIPS.map((chip) => (
                <Chip
                  key={chip.id}
                  label={chip.label}
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  {...(activeIntentId === chip.id
                    ? { icon: <CircularProgress size={14} /> }
                    : {})}
                  onClick={() => void generateInsight(chip.id)}
                />
              ))}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ minHeight: 0, overflow: "auto", p: 2 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                {error}
              </Alert>
            )}

            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
                Answer
              </Typography>

              <Tooltip title="Context used" arrow>
                <span>
                  <IconButton
                    aria-label="Context used"
                    disabled={!answer}
                    onClick={() => setContextOpen(true)}
                  >
                    <InfoOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title="Copy answer" arrow>
                <span>
                  <IconButton
                    aria-label="Copy answer"
                    disabled={!answer}
                    onClick={() => void copyAnswer()}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>

            {busy && activeIntentId ? (
              <Stack direction="row" alignItems="center" spacing={1}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Generating
                </Typography>
              </Stack>
            ) : answer ? (
              <MarkdownAnswer markdown={answer.answer} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Choose an insight.
              </Typography>
            )}
          </Paper>
        </Box>
      ) : (
        <ManageEntriesPanel
          busy={busy}
          error={error}
          query={query}
          visibleItems={visibleItems}
          selectedEntry={selectedEntry}
          setError={setError}
          setQuery={setQuery}
          searchEntries={searchEntries}
          refreshEntries={refreshEntries}
          openEntry={openEntry}
          copySelectedEntryContext={copySelectedEntryContext}
          copyChangedFiles={copyChangedFiles}
          openCaptureFolder={openCaptureFolder}
          setDeleteConfirmOpen={setDeleteConfirmOpen}
        />
      )}

      <ContextDialog
        open={contextOpen}
        answer={answer}
        onClose={() => setContextOpen(false)}
        onOpenEntry={openEntry}
      />

      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete entry?</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            {selectedEntry ? `Delete "${selectedEntry.name}" from local project memory?` : "Delete this entry?"}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || !selectedEntry}
            onClick={() => void deleteSelectedEntry()}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={captureOpen} onClose={() => setCaptureOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Capture output</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.25} sx={{ pt: 0.5 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Purpose</InputLabel>
              <Select
                label="Purpose"
                value={entryPurpose}
                onChange={(event) => setEntryPurpose(event.target.value)}
              >
                <MenuItem value="software_implementation">Software Implementation</MenuItem>
                <MenuItem value="research">Research</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Entry name"
              size="small"
              value={entryName}
              onChange={(event) => setEntryName(event.currentTarget.value)}
              fullWidth
            />

            <TextField
              label="Description"
              size="small"
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
              fullWidth
            />

            <TextField
              label="Notes"
              size="small"
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
              multiline
              minRows={4}
              fullWidth
            />

            <TextField
              label="AI output"
              size="small"
              value={aiOutput}
              onChange={(event) => setAiOutput(event.currentTarget.value)}
              multiline
              minRows={10}
              fullWidth
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={includeGitChangedFiles}
                  onChange={(event) => setIncludeGitChangedFiles(event.currentTarget.checked)}
                />
              }
              label="Include Git changed files"
            />

            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
              <Chip
                size="small"
                label={`Selected files: ${promptState?.selectedPaths.length ?? 0}`}
              />
              <Chip
                size="small"
                label={`Images: ${promptState?.imageAttachments.length ?? 0}`}
              />
              <Chip
                size="small"
                label={`Tokens: ${promptState?.tokenCount ?? 0}`}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Tooltip title="Save entry" arrow>
            <span>
              <IconButton
                aria-label="Save entry"
                color="primary"
                disabled={busy}
                onClick={() => void saveEntry()}
              >
                <SaveAltIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

interface ManageEntriesPanelProps {
  busy: boolean;
  error: string | null;
  query: string;
  visibleItems: MemoryItem[];
  selectedEntry: EntryDetail | null;
  setError: (value: string | null) => void;
  setQuery: (value: string) => void;
  searchEntries: () => Promise<void>;
  refreshEntries: () => Promise<void>;
  openEntry: (entryId: string) => Promise<void>;
  copySelectedEntryContext: () => Promise<void>;
  copyChangedFiles: () => Promise<void>;
  openCaptureFolder: () => Promise<void>;
  setDeleteConfirmOpen: (open: boolean) => void;
}

function ManageEntriesPanel({
  busy,
  error,
  query,
  visibleItems,
  selectedEntry,
  setError,
  setQuery,
  searchEntries,
  refreshEntries,
  openEntry,
  copySelectedEntryContext,
  copyChangedFiles,
  openCaptureFolder,
  setDeleteConfirmOpen,
}: ManageEntriesPanelProps): JSX.Element {
  return (
    <Box
      sx={{
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(340px, 440px) minmax(0, 1fr)" },
        gap: 1.5,
        p: 2,
        overflow: "hidden",
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          minHeight: 0,
          display: "grid",
          gridTemplateRows: "auto auto minmax(0, 1fr)",
          overflow: "hidden",
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.5 }}>
          <TextField
            label="Search entries"
            size="small"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void searchEntries();
              }
            }}
            fullWidth
          />

          <Tooltip title="Search" arrow>
            <IconButton
              aria-label="Search"
              disabled={busy || !query.trim()}
              onClick={() => void searchEntries()}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Refresh entries" arrow>
            <IconButton
              aria-label="Refresh entries"
              disabled={busy}
              onClick={() => void refreshEntries()}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        <Divider />

        <Box sx={{ minHeight: 0, overflow: "auto" }}>
          <List disablePadding>
            {visibleItems.map((item) => {
              const id = entryIdFor(item);
              const changedFiles = changedFilesFor(item);

              return (
                <ListItemButton
                  key={isSearchResult(item) ? item.chunkId : item.id}
                  selected={selectedEntry?.id === id}
                  alignItems="flex-start"
                  onClick={() => void openEntry(id)}
                >
                  <ListItemText
                    primary={
                      <Stack spacing={0.75}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                          {itemName(item)}
                        </Typography>
                        {changedFiles.length > 0 && (
                          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                            {changedFiles.slice(0, 3).map((filePath) => (
                              <Chip
                                key={filePath}
                                size="small"
                                label={basename(filePath)}
                              />
                            ))}
                            {changedFiles.length > 3 && (
                              <Chip size="small" label={`+${changedFiles.length - 3}`} />
                            )}
                          </Stack>
                        )}
                      </Stack>
                    }
                    secondary={
                      isSearchResult(item)
                        ? `${item.chunkKind}: ${item.chunkText}`
                        : itemDescription(item) || item.createdAt
                    }
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                </ListItemButton>
              );
            })}

            {visibleItems.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                No entries yet.
              </Typography>
            )}
          </List>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ minHeight: 0, overflow: "auto", p: 2 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {selectedEntry ? (
          <EntryDetailPanel
            selectedEntry={selectedEntry}
            onCopyContext={copySelectedEntryContext}
            onCopyChangedFiles={copyChangedFiles}
            onOpenFolder={openCaptureFolder}
            onDeleteEntry={() => setDeleteConfirmOpen(true)}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            Select an entry.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

interface EntryDetailPanelProps {
  selectedEntry: EntryDetail;
  compact?: boolean;
  onCopyContext: () => Promise<void>;
  onCopyChangedFiles: () => Promise<void>;
  onOpenFolder: () => Promise<void>;
  onDeleteEntry: () => void;
}

function EntryDetailPanel({
  selectedEntry,
  compact = false,
  onCopyContext,
  onCopyChangedFiles,
  onOpenFolder,
  onDeleteEntry,
}: EntryDetailPanelProps): JSX.Element {
  return (
    <Stack spacing={compact ? 1.25 : 2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }} noWrap>
          {selectedEntry.name}
        </Typography>

        <Tooltip title="Copy entry context" arrow>
          <IconButton
            aria-label="Copy entry context"
            onClick={() => void onCopyContext()}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Copy changed files" arrow>
          <IconButton
            aria-label="Copy changed files"
            onClick={() => void onCopyChangedFiles()}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Open capture folder" arrow>
          <IconButton
            aria-label="Open capture folder"
            onClick={() => void onOpenFolder()}
          >
            <FolderOpenIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title="Delete entry" arrow>
          <IconButton
            aria-label="Delete entry"
            color="error"
            onClick={onDeleteEntry}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Box>
        <Typography variant="subtitle2">Description</Typography>
        <Typography variant="body2" color="text.secondary">
          {selectedEntry.description || "No description"}
        </Typography>
      </Box>

      <Box>
        <Typography variant="subtitle2">Images used</Typography>
        {selectedEntry.imageAttachments.length > 0 ? (
          <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.75 }}>
            {selectedEntry.imageAttachments.map((attachment) => (
              <Chip
                key={attachment.sha256}
                size="small"
                label={`${attachment.fileName}  ${formatBytes(attachment.sizeBytes)}`}
              />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No images captured.
          </Typography>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle2">Image insights</Typography>
        {selectedEntry.imageInsights.length > 0 ? (
          <Stack spacing={1} sx={{ mt: 0.75 }}>
            {selectedEntry.imageInsights.map((insight) => (
              <Paper key={insight.sha256} variant="outlined" sx={{ p: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {insight.fileName}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {insight.summary}
                </Typography>
                {insight.technicalTags.length > 0 && (
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
                    {insight.technicalTags.slice(0, 10).map((tag) => (
                      <Chip key={tag} size="small" label={tag} />
                    ))}
                  </Stack>
                )}
              </Paper>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No image insights captured.
          </Typography>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle2">Changed files</Typography>
        {selectedEntry.changedFiles.length > 0 ? (
          <Stack spacing={0.5} sx={{ mt: 0.75 }}>
            {selectedEntry.changedFiles.slice(0, compact ? 12 : 80).map((filePath) => (
              <Typography key={filePath} variant="body2" component="code">
                {filePath}
              </Typography>
            ))}
            {compact && selectedEntry.changedFiles.length > 12 && (
              <Typography variant="caption" color="text.secondary">
                +{selectedEntry.changedFiles.length - 12} more
              </Typography>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No changed files captured.
          </Typography>
        )}
      </Box>

      {!compact && (
        <>
          <Box>
            <Typography variant="subtitle2">Notes</Typography>
            <Typography
              component="pre"
              variant="body2"
              sx={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                m: 0,
              }}
            >
              {selectedEntry.userNotes || "No notes"}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2">Searchable chunks</Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              {selectedEntry.chunks.slice(0, 12).map((chunk) => (
                <Paper key={chunk.id} variant="outlined" sx={{ p: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {chunk.kind}
                  </Typography>
                  <Typography
                    component="pre"
                    variant="body2"
                    sx={{
                      whiteSpace: "pre-wrap",
                      fontFamily: "inherit",
                      m: 0,
                    }}
                  >
                    {chunk.text}
                  </Typography>
                </Paper>
              ))}
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}

function ContextDialog({
  open,
  answer,
  onClose,
  onOpenEntry,
}: {
  open: boolean;
  answer: RagAnswer | null;
  onClose: () => void;
  onOpenEntry: (entryId: string) => Promise<void>;
}): JSX.Element {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Context used</DialogTitle>
      <DialogContent dividers>
        {answer?.context.entries.length ? (
          <Stack spacing={1}>
            {answer.context.entries.map((entry) => (
              <Paper
                key={entry.entryId}
                variant="outlined"
                sx={{ p: 1, cursor: "pointer" }}
                onClick={() => void onOpenEntry(entry.entryId)}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {entry.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {entry.description || entry.createdAt}
                </Typography>
                {entry.changedFiles.length > 0 && (
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
                    {entry.changedFiles.slice(0, 4).map((filePath) => (
                      <Chip key={filePath} size="small" label={basename(filePath)} />
                    ))}
                    {entry.changedFiles.length > 4 && (
                      <Chip size="small" label={`+${entry.changedFiles.length - 4}`} />
                    )}
                  </Stack>
                )}
              </Paper>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No context available.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function MarkdownAnswer({ markdown }: { markdown: string }): JSX.Element {
  return (
    <Box
      sx={{
        "& p": { mt: 0, mb: 1 },
        "& ul, & ol": { mt: 0, mb: 1, pl: 3 },
        "& h1, & h2, & h3": { mt: 2, mb: 1 },
        "& code": {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        },
        "& pre": {
          overflow: "auto",
          p: 1,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.default",
        },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </Box>
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

function renderEntryContext(entry: EntryDetail): string {
  const lines = [
    `# Entry: ${entry.name}`,
    "",
    `Purpose: ${entry.purpose}`,
    `Description: ${entry.description}`,
    `Created: ${entry.createdAt}`,
    "",
    "## Images",
    ...(entry.imageAttachments.length > 0
      ? entry.imageAttachments.map(
          (attachment) =>
            `- ${attachment.fileName} (${attachment.sha256}) ${attachment.storedPath}`,
        )
      : ["No images captured."]),
    "",
    "## Image insights",
    ...(entry.imageInsights.length > 0
      ? entry.imageInsights.flatMap((insight) => [
          `### ${insight.fileName}`,
          insight.summary,
          insight.technicalTags.length > 0
            ? `Tags: ${insight.technicalTags.join(", ")}`
            : "Tags: none",
          "",
        ])
      : ["No image insights captured."]),
    "",
    "## Changed files",
    ...(entry.changedFiles.length > 0 ? entry.changedFiles.map((filePath) => `- ${filePath}`) : ["No changed files captured."]),
    "",
    "## Notes",
    entry.userNotes || "No notes.",
    "",
    "## Chunks",
    ...entry.chunks.slice(0, 20).flatMap((chunk) => [
      `### ${chunk.kind}`,
      chunk.text,
      "",
    ]),
  ];

  return lines.join("\n");
}
