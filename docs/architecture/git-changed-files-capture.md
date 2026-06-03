# Git Changed Files Capture

The Output Intelligence tab supports an optional "Include Git changed files" checkbox.

This intentionally captures only the changed file list, not the full `git diff`.

## Why

The actual line-level diff is noisy for the local intelligence index and can always be recovered from GitHub or git history. For local search and future RAG, the useful signal is usually:

- which files changed
- which packages/components were involved
- which entry captured those changes

## Artifacts

When enabled, entry capture writes:

```txt
git-changed-files.json
git-changed-files.txt
```

No patch/diff file is written.

## Search

Changed file paths are indexed into SQLite/FTS5 so searches can find entries by file path, package name, component name, or folder name.
