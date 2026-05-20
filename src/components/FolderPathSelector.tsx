
import {
  Box,
  Collapse,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import PlaylistAddCheckIcon from "@mui/icons-material/PlaylistAddCheck";

export interface FolderPathSelectorProps {
  open: boolean;
  value: string;
  disabled: boolean;
  statusText: string;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onApply: () => void;
}

export function FolderPathSelector({
  open,
  value,
  disabled,
  statusText,
  onOpenChange,
  onValueChange,
  onApply,
}: FolderPathSelectorProps) {
  const applyDisabled = disabled || value.trim().length === 0;

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ px: 1, py: 0.5 }}
      >
        <Tooltip title={open ? "Hide path selector" : "Show path selector"} arrow>
          <IconButton
            size="small"
            aria-label={open ? "Hide path selector" : "Show path selector"}
            onClick={() => onOpenChange(!open)}
          >
            {open ? (
              <KeyboardArrowDownIcon fontSize="small" />
            ) : (
              <KeyboardArrowRightIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        <Typography
          variant="caption"
          noWrap
          sx={{ color: "text.secondary", flex: 1 }}
        >
          Select by path
        </Typography>

        <Tooltip title="Apply paths to folder tree" arrow>
          <span>
            <IconButton
              size="small"
              aria-label="Apply paths to folder tree"
              disabled={applyDisabled}
              onClick={onApply}
            >
              <PlaylistAddCheckIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Collapse in={open}>
        <Box sx={{ px: 1, pb: 1 }}>
          <TextField
            placeholder="Paste relative or absolute file/folder paths, one per line"
            multiline
            minRows={4}
            maxRows={8}
            value={value}
            onChange={(event) => onValueChange(event.currentTarget.value)}
            fullWidth
            size="small"
          />

          {statusText && (
            <Typography
              variant="caption"
              sx={{ display: "block", mt: 0.75, color: "text.secondary" }}
            >
              {statusText}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
