# Local Entry Capture and SQLite Catalog

This phase adds a local project state file, manual entry capture, and a local SQLite catalog.

## Project state

Each project has:

```txt
~/.rapid_prompt/projects/<project-id>/local-state.json
```

It stores prompt text, selected paths, expanded paths, include-tree state, and folder panel width.

## Entry capture

Entries are written under:

```txt
~/.rapid_prompt/projects/<project-id>/captures/YYYY/MM/DD/<entry-id>/
```

Each entry contains:

```txt
entry.json
system-prompt.md
prompt.md
output.md
notes.md
selected-files.json
chunks.jsonl
```

## SQLite catalog

The local catalog lives at:

```txt
~/.rapid_prompt/projects/<project-id>/index/rapid-prompt.sqlite
```

The catalog stores entry metadata, artifacts, chunks, and an FTS5 search table.

The bucket/cloud archive comes later. SQLite is currently the local searchable catalog.
