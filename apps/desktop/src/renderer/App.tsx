import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { AppBar, Box, IconButton, Tab, Tabs, Toolbar, Tooltip, Typography } from "@mui/material";
import { useCallback, useState, type JSX } from "react";

import brandSvg from "./assets/brand.svg";
import OutputIntelligence from "./components/OutputIntelligence";
import ProjectLanding from "./components/ProjectLanding";
import PromptBuilder from "./components/PromptBuilder";
import type { PromptWorkflowState } from "./types/capture";
import type { LocalProject } from "./types/project";

type WorkbenchTab = "prompt-workflow" | "output-intelligence";

export default function App(): JSX.Element {
  const [project, setProject] = useState<LocalProject | null>(null);
  const [landingMode, setLandingMode] = useState<"open" | "create">("open");
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("prompt-workflow");
  const [promptState, setPromptState] = useState<PromptWorkflowState | null>(null);

  const handlePromptStateChange = useCallback((nextState: PromptWorkflowState): void => {
    setPromptState(nextState);
  }, []);

  if (!project) {
    return (
      <ProjectLanding
        initialMode={landingMode}
        onEnter={(nextProject) => {
          setProject(nextProject);
          setActiveTab("prompt-workflow");
          setPromptState(null);
        }}
      />
    );
  }

  return (
    <Box
      sx={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <AppBar position="static" color="default" elevation={1}>
        <Toolbar sx={{ gap: 1 }}>
          <Box
            component="img"
            src={brandSvg}
            alt="Rapid Prompt"
            sx={{ width: 32, height: 32 }}
          />

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
              Rapid Prompt - Workbench
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {project.name}
            </Typography>
          </Box>

          <Tooltip title="Open project" arrow>
            <IconButton
              aria-label="Open project"
              onClick={() => {
                setLandingMode("open");
                setProject(null);
              }}
            >
              <FolderOpenIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="Create project" arrow>
            <IconButton
              aria-label="Create project"
              onClick={() => {
                setLandingMode("create");
                setProject(null);
              }}
            >
              <AddCircleOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>

        <Tabs
          value={activeTab}
          onChange={(_event, value) => setActiveTab(value as WorkbenchTab)}
          sx={{
            px: 2,
            minHeight: 40,
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          <Tab
            label="Prompt Workflow"
            value="prompt-workflow"
            sx={{ minHeight: 40 }}
          />
          <Tab
            label="Output Intelligence"
            value="output-intelligence"
            sx={{ minHeight: 40 }}
          />
        </Tabs>
      </AppBar>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {activeTab === "prompt-workflow" ? (
          <PromptBuilder
            project={project}
            onWorkspaceStateChange={handlePromptStateChange}
          />
        ) : (
          <OutputIntelligence
            project={project}
            promptState={promptState}
          />
        )}
      </Box>
    </Box>
  );
}
