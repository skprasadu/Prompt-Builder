import { Box, Tooltip } from "@mui/material";
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface ResizeDragState {
  startX: number;
  startWidth: number;
}

export interface ResizableSplitterProps {
  visible: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  splitterWidth?: number;
  step?: number;
  label?: string;
  tooltip?: string;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ResizableSplitter({
  visible,
  width,
  minWidth,
  maxWidth,
  onWidthChange,
  splitterWidth = 8,
  step = 24,
  label = "Resize panel",
  tooltip = "Drag to resize",
}: ResizableSplitterProps) {
  const dragRef = useRef<ResizeDragState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopResize = useCallback((): void => {
    dragRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;

    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }, []);

  const handlePointerMove = useCallback(
    (event: globalThis.PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;

      const nextWidth = drag.startWidth + event.clientX - drag.startX;
      onWidthChange(clampNumber(nextWidth, minWidth, maxWidth));
    },
    [maxWidth, minWidth, onWidthChange]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();

      stopResize();

      dragRef.current = {
        startX: event.clientX,
        startWidth: clampNumber(width, minWidth, maxWidth),
      };

      const controller = new AbortController();
      abortRef.current = controller;

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      document.addEventListener("pointermove", handlePointerMove, {
        signal: controller.signal,
      });
      document.addEventListener("pointerup", stopResize, {
        signal: controller.signal,
        once: true,
      });
      document.addEventListener("pointercancel", stopResize, {
        signal: controller.signal,
        once: true,
      });
    },
    [handlePointerMove, maxWidth, minWidth, stopResize, width]
  );

  const setClampedWidth = useCallback(
    (nextWidth: number): void => {
      onWidthChange(clampNumber(nextWidth, minWidth, maxWidth));
    },
    [maxWidth, minWidth, onWidthChange]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setClampedWidth(width - step);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setClampedWidth(width + step);
      }

      if (event.key === "Home") {
        event.preventDefault();
        setClampedWidth(minWidth);
      }

      if (event.key === "End") {
        event.preventDefault();
        setClampedWidth(maxWidth);
      }
    },
    [maxWidth, minWidth, setClampedWidth, step, width]
  );

  useEffect(() => stopResize, [stopResize]);

  return (
    <Tooltip title={tooltip} placement="right" arrow>
      <Box
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={visible ? 0 : -1}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        sx={{
          display: { xs: "none", sm: visible ? "flex" : "none" },
          alignSelf: "stretch",
          alignItems: "stretch",
          justifyContent: "center",
          width: `${splitterWidth}px`,
          minWidth: `${splitterWidth}px`,
          cursor: "col-resize",
          userSelect: "none",
          touchAction: "none",
          bgcolor: "background.paper",
          outline: "none",
          "&:hover .ResizableSplitter-line": {
            bgcolor: "primary.main",
          },
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: "-2px",
          },
          "&:focus-visible .ResizableSplitter-line": {
            bgcolor: "primary.main",
          },
        }}
      >
        <Box
          className="ResizableSplitter-line"
          sx={{
            width: "1px",
            height: "100%",
            bgcolor: "divider",
          }}
        />
      </Box>
    </Tooltip>
  );
}