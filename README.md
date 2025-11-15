# Rapid Prompts - Workbench

## Design Goals:

  1. It has to be simple to use for domain users to create, save and import prompts
  2. Ability to point to local file system and include files and extract content from the files and rapidly create prompt and use them in GPT 5/ GPT 5 Pro/ advanced models, the objective is not to use API and complicate for domain users
  3. More advanced design goal, attaching external rules to extract blocks of data and iterate their the block and add those block to the prompt and create prompts.

## Capabilities:

1. Ability to point to a folder in the file system and build a tree of all the files within that folder and create a prompt action and embed ascii content from selected files and build prompts and test them. This is already implemented.
2. Ability to extract rows in excel identifying which column is ID and which column is description, and instead of just having "Copy prompt", we have "<", "Copy Prompt", ">" and where we can scroll and extract description and copy the prompt action + description and run the prompt in GPT. Also ability to show the current Id, which is editable and user can type a different id and the tool can jump to that id and extract description for that prompt
3. Ability to support extensions like Pdf, docx, pptx, xlsx and for starter this need to support PDF and later extend to other extension in pluggable way, to extract ascii and embed in prompt
4. Ability to extract blocks of text based with id on rules and pass these block to the prompt action and run prompt, again it is similar to excel extract, other extension
