# Output Intelligence UX

Output Intelligence has two inner panels:

- Chat with Data
- Manage Entries

## Chat with Data

This is the default user experience.

The user can ask a natural question, click a suggested question chip, and inspect which project entries were used as context.

Suggested questions include:

- Summarize this project
- What changed recently?
- What did this entry implement?
- Which files changed?
- What decisions did we make?
- What should I test?
- What is incomplete?
- Write team update
- Draft PR description
- List follow-up tasks
- Explain selected entry
- Find related entries
- Show risks

## Manage Entries

This is for browsing and inspecting saved entries.

The entry detail panel shows:

- description
- changed files
- notes
- searchable chunks
- capture folder actions

## Retrieval behavior

When an entry is selected, `rag:ask` receives `selectedEntryId`. The backend includes that entry in the RAG context even if FTS search is weak or returns zero matches.
