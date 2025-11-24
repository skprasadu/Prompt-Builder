// src/components/TreeView.tsx
import { memo } from "react";
import type { Node } from "../types/fs";
import { isDirNode } from "../types/fs";
import {
  Box,
  Checkbox,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import DescriptionIcon from "@mui/icons-material/Description";

export interface TreeViewProps {
  node: Node;
  expanded: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggleDir: (path: string) => void;
  onToggleFile: (path: string, checked: boolean) => void;
}

function getDirSelectionState(
  node: Node,
  selected: ReadonlySet<string>
): { checked: boolean; indeterminate: boolean } {
  if (!isDirNode(node) || node.children.length === 0) {
    return { checked: false, indeterminate: false };
  }

  let totalFiles = 0;
  let selectedFiles = 0;

  const stack: Node[] = [...node.children];

  while (stack.length > 0) {
    const current = stack.pop() as Node;
    if (isDirNode(current)) {
      stack.push(...current.children);
    } else {
      totalFiles += 1;
      if (selected.has(current.path)) {
        selectedFiles += 1;
      }
    }
  }

  if (totalFiles === 0) {
    return { checked: false, indeterminate: false };
  }

  if (selectedFiles === 0) {
    return { checked: false, indeterminate: false };
  }

  if (selectedFiles === totalFiles) {
    return { checked: true, indeterminate: false };
  }

  // Some but not all files selected
  return { checked: false, indeterminate: true };
}

export const TreeView = memo(function TreeView(props: TreeViewProps) {
  return (
    <Box>
      <TreeNode {...props} node={props.node} depth={0} />
    </Box>
  );
});

interface TreeNodeProps extends TreeViewProps {
  node: Node;
  depth: number;
}

function TreeNode(props: TreeNodeProps) {
  const { node, depth, expanded, onToggleDir, onToggleFile, selected } = props;
  const pad = depth * 1.25; // indentation in theme spacing units

  if (isDirNode(node)) {
    const isOpen = expanded.has(node.path);
    const { checked, indeterminate } = getDirSelectionState(node, selected);

    return (
      <Box sx={{ pl: pad }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 0.25 }}>
          <IconButton
            size="small"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={() => onToggleDir(node.path)}
          >
            {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>

          <Checkbox
            size="small"
            checked={checked}
            indeterminate={indeterminate}
            onChange={(e) => onToggleFile(node.path, e.currentTarget.checked)}
            inputProps={{ "aria-label": `Select folder ${node.name}` }}
          />

          <FolderIcon fontSize="small" color="action" />
          <Typography
            variant="body2"
            fontWeight={600}
            onClick={() => onToggleDir(node.path)}
            title={node.path}
            sx={{ cursor: "pointer" }}
          >
            {node.name}
          </Typography>
        </Stack>

        {isOpen &&
          node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggleDir={onToggleDir}
              onToggleFile={onToggleFile}
            />
          ))}
      </Box>
    );
  }

  // File leaf
  return (
    <Box sx={{ pl: pad }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 0.25 }}>
        <Box sx={{ width: 40 /* space for the expand icon area */ }} />
        <Checkbox
          size="small"
          checked={selected.has(node.path)}
          onChange={(e) => onToggleFile(node.path, e.currentTarget.checked)}
          inputProps={{ "aria-label": `Select ${node.name}` }}
        />
        <DescriptionIcon fontSize="small" color="disabled" />
        <Typography variant="body2" title={node.path}>
          {node.name}
        </Typography>
      </Stack>
    </Box>
  );
}