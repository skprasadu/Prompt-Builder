import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
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
import { useEffect, useState, type JSX } from "react";

import { invoke, openDialog } from "../lib/desktop";
import type { LocalProject } from "../types/project";

export interface ProjectLandingProps {
  initialMode?: "open" | "create";
  onEnter: (project: LocalProject) => void;
}

interface DeleteLocalProjectResult {
  projectId: string;
  deleted: boolean;
  deletedPath: string;
  rootPath: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }

  if (error === null || error === undefined) {
    return "Unknown error";
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function defaultProjectName(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  return `Project ${stamp}`;
}

export default function ProjectLanding({
  initialMode = "open",
  onEnter,
}: ProjectLandingProps): JSX.Element {
  const [mode, setMode] = useState<"open" | "create">(initialMode);
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>(() => defaultProjectName());
  const [rootPath, setRootPath] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    void refreshProjects();
  }, []);

  async function refreshProjects(): Promise<void> {
    setError(null);

    try {
      const rows = await invoke<LocalProject[]>("project:list", {});
      const nextProjects = Array.isArray(rows) ? rows : [];
      setProjects(nextProjects);

      setSelectedProjectId((current) => {
        if (current && nextProjects.some((project) => project.id === current)) {
          return current;
        }

        return nextProjects[0]?.id ?? "";
      });
    } catch (err: unknown) {
      setProjects([]);
      setSelectedProjectId("");
      setError(`Failed to list projects: ${toErrorMessage(err)}`);
    }
  }

  async function chooseRootFolder(): Promise<void> {
    setError(null);

    const picked = await openDialog({
      directory: true,
      multiple: false,
    });

    if (typeof picked === "string" && picked.length > 0) {
      setRootPath(picked);
    }
  }

  async function createProject(): Promise<void> {
    const name = projectName.trim();
    const folder = rootPath.trim();

    if (!name) {
      setError("Project name is required.");
      return;
    }

    if (!folder) {
      setError("Choose a project folder.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const project = await invoke<LocalProject>("project:create", {
        name,
        rootPath: folder,
      });

      onEnter(project);
    } catch (err: unknown) {
      setError(`Failed to create project: ${toErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function openSelectedProject(): Promise<void> {
    if (!selectedProject) {
      setError("Select a project.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const project = await invoke<LocalProject>("project:get", {
        projectId: selectedProject.id,
      });

      onEnter(project);
    } catch (err: unknown) {
      setError(`Failed to open project: ${toErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelectedProject(): Promise<void> {
    if (!selectedProject) {
      setError("Select a project.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await invoke<DeleteLocalProjectResult>("project:delete", {
        projectId: selectedProject.id,
      });

      setDeleteConfirmOpen(false);
      await refreshProjects();
    } catch (err: unknown) {
      setError(`Failed to delete project: ${toErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Paper
        elevation={2}
        sx={{
          width: "min(920px, 100%)",
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ p: 3, borderRight: { md: 1 }, borderColor: "divider" }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <Typography variant="h5" sx={{ flex: 1, fontWeight: 700 }}>
              Rapid Prompt
            </Typography>

            <Tooltip title="Refresh projects" arrow>
              <span>
                <IconButton
                  aria-label="Refresh projects"
                  disabled={busy}
                  onClick={() => void refreshProjects()}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Tooltip title="Open project" arrow>
              <IconButton
                color={mode === "open" ? "primary" : "default"}
                aria-label="Open project"
                onClick={() => setMode("open")}
              >
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title="Create project" arrow>
              <IconButton
                color={mode === "create" ? "primary" : "default"}
                aria-label="Create project"
                onClick={() => setMode("create")}
              >
                <AddCircleOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {mode === "open" && (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ maxHeight: 320, overflow: "auto" }}>
                {projects.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                    No projects yet.
                  </Typography>
                ) : (
                  <List disablePadding>
                    {projects.map((project) => (
                      <ListItemButton
                        key={project.id}
                        selected={project.id === selectedProjectId}
                        onClick={() => setSelectedProjectId(project.id)}
                      >
                        <ListItemText
                          primary={project.name}
                          secondary={project.rootPath}
                          primaryTypographyProps={{ noWrap: true }}
                          secondaryTypographyProps={{ noWrap: true }}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </Paper>

              <Stack direction="row" alignItems="center" spacing={1}>
                <Tooltip title="Open selected project" arrow>
                  <span>
                    <IconButton
                      color="primary"
                      aria-label="Open selected project"
                      disabled={busy || !selectedProject}
                      onClick={() => void openSelectedProject()}
                    >
                      {busy ? <CircularProgress size={18} /> : <FolderOpenIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>

                <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
                  {selectedProject?.name ?? "Select a project"}
                </Typography>

                <Tooltip title="Delete selected project" arrow>
                  <span>
                    <IconButton
                      color="error"
                      aria-label="Delete selected project"
                      disabled={busy || !selectedProject}
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          )}

          {mode === "create" && (
            <Stack spacing={2}>
              <TextField
                label="Project name"
                size="small"
                value={projectName}
                onChange={(event) => setProjectName(event.currentTarget.value)}
                fullWidth
              />

              <TextField
                label="Folder"
                size="small"
                value={rootPath}
                fullWidth
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <Tooltip title="Choose folder" arrow>
                      <IconButton
                        aria-label="Choose folder"
                        edge="end"
                        onClick={() => void chooseRootFolder()}
                      >
                        <CreateNewFolderIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ),
                }}
              />

              <Stack direction="row" alignItems="center" spacing={1}>
                <Tooltip title="Create project" arrow>
                  <span>
                    <IconButton
                      color="primary"
                      aria-label="Create project"
                      disabled={busy || !projectName.trim() || !rootPath.trim()}
                      onClick={() => void createProject()}
                    >
                      {busy ? <CircularProgress size={18} /> : <AddCircleOutlineIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>

                <Typography variant="body2" color="text.secondary" noWrap>
                  {projectName.trim() || "New project"}
                </Typography>
              </Stack>
            </Stack>
          )}

          <Dialog
            open={deleteConfirmOpen}
            onClose={() => setDeleteConfirmOpen(false)}
            fullWidth
            maxWidth="xs"
          >
            <DialogTitle>Delete project?</DialogTitle>
            <DialogContent dividers>
              <Typography variant="body2">
                {selectedProject
                  ? `Delete "${selectedProject.name}" from local Rapid Prompt storage?`
                  : "Delete this project from local Rapid Prompt storage?"}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                The original project folder will not be deleted.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setDeleteConfirmOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                color="error"
                variant="contained"
                disabled={busy || !selectedProject}
                onClick={() => void deleteSelectedProject()}
              >
                Delete
              </Button>
            </DialogActions>
          </Dialog>
        </Box>

        <Box sx={{ p: 3, bgcolor: "background.paper" }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: "text.secondary" }}>
            Local storage
          </Typography>

          <Typography variant="body2" sx={{ mb: 2 }}>
            Project metadata is stored locally under your Rapid Prompt home folder.
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" sx={{ mb: 1, color: "text.secondary" }}>
            Workspace
          </Typography>

          <Typography variant="body2">
            Open or create a project to enter the workbench.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
