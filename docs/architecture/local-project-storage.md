# Local Project Storage

Rapid Prompt desktop stores local-only project metadata under:

```txt
~/.rapid_prompt
```

## Layout

```txt
~/.rapid_prompt/
  system-prompt.md
  projects/
    <project-id>/
      project.json
      system-prompt.md
      prompt-policy.md
      recent-context.json
      local-state.json
      captures/
```

## Project record

```json
{
  "id": "rp_proj_8f3a91b2",
  "name": "Prompt Builder",
  "rootPath": "/Users/example/work/Prompt-Builder",
  "rootPathHash": "sha256:...",
  "cloudProjectId": "proj_123",
  "defaultSystemPromptPath": "system-prompt.md",
  "createdAt": "2026-06-03T00:00:00.000Z",
  "updatedAt": "2026-06-03T00:00:00.000Z"
}
```

## Boundary

This folder is for local metadata and local captures. It is not a secret store and it is not canonical cloud truth.

Secrets should later use macOS Keychain, Electron safe storage, or cloud-side secret storage.
