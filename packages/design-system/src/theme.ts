import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  shape: {
    borderRadius: 8,
  },
  typography: {
    fontFamily: [
      "Inter",
      "Roboto",
      "Helvetica",
      "Arial",
      "sans-serif"
    ].join(","),
  },
  components: {
    MuiTooltip: {
      defaultProps: {
        arrow: true,
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: "small",
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined",
      },
    },
  },
});
