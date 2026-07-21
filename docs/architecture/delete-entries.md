# Delete Entries

Output Intelligence supports deleting a saved entry from local project memory.

The delete action removes:

- SQLite catalog rows for the entry
- artifact rows
- chunk rows
- changed file rows
- tag/sync rows for that entry
- the local capture folder under `~/.rapid_prompt/projects/<project-id>/captures/...`

The FTS5 table is contentless, so stale FTS rows are hidden by deleting `chunk_index_map` rows. They are no longer returned because search joins through the map and entries tables.

Cloud delete is not implemented yet. When cloud sync lands, delete should become a soft-delete/tombstone flow instead of immediate remote deletion.
