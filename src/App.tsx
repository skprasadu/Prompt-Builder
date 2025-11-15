// src/App.tsx
import { JSX, SyntheticEvent, useState } from "react";
import { TabContext, TabList, TabPanel } from '@mui/lab';
import PromptBuilder from "./components/PromptBuilder";
import { Box, Tab } from "@mui/material";

export default function App(): JSX.Element {
  const [value, setValue] = useState('1');

  const handleChange = (_event: SyntheticEvent, newValue: string) => {
    setValue(newValue);
  };

  return (
    <>
      <TabContext value={value}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <TabList onChange={handleChange} aria-label="lab API tabs example">
            <Tab label="Rapid Prompt" value="1" />
          </TabList>
        </Box>
        <TabPanel value="1">
          <PromptBuilder />
        </TabPanel>
      </TabContext>
    </>
  );
}

