# Output Intelligence RAG

Output Intelligence has two jobs:

1. Capture useful AI output as project entries.
2. Ask questions over saved project memory.

## Local retrieval

The app searches the local SQLite/FTS5 catalog first.

RAG flow:

```txt
question
  -> SQLite FTS search
  -> retrieved entries/chunks
  -> compact context pack
  -> OpenAI Responses API
  -> answer + retrieved entry citations
```

## Environment

Create `.env.local` at the repository root:

```bash
cp .env.local.example .env.local
```

Set:

```txt
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

The key is read by the Electron backend only. The renderer does not receive the key.
