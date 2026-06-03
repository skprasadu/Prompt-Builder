import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { AppBar, Box, IconButton, Toolbar, Tooltip, Typography } from "@mui/material";
import { useState, type JSX } from "react";

import brandSvg from "./assets/brand.svg";
import ProjectLanding from "./components/ProjectLanding";
import PromptBuilder from "./components/PromptBuilder";
import type { LocalProject } from "./types/project";

export default function App(): JSX.Element {
  const [project, setProject] = useState<LocalProject | null>(null);
  const [landingMode, setLandingMode] = useState<"open" | "create">("open");

  if (!project) {
    return (
      <ProjectLanding
        initialMode={landingMode}
        onEnter={(nextProject) => setProject(nextProject)}
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
      </AppBar>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <PromptBuilder project={project} />
      </Box>
    </Box>
  );
}
