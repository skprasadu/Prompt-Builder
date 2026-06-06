# Image Attachments in Prompt Workflow

Prompt Workflow supports image-only attachments as the first attachment type.

## Flow

- Drag images into Prompt Workflow.
- Images are hashed with SHA-256.
- The project stores one copy under `.rapid_prompt/projects/<project>/attachments/images/...`.
- Duplicate images reuse the same hash-backed stored file.
- Copy prompt text and image attachments are separate actions.
- Image attachments can be pasted into ChatGPT Desktop after copying them from the app.

## Clipboard behavior

- One image uses Electron `nativeImage` and the normal image clipboard.
- Multiple images use a macOS pasteboard helper that writes multiple image pasteboard items.
- Multiple-image copy is currently macOS-only.

## Entry capture

Captured entries include `image-attachments.json` and an indexed `image_attachments` chunk containing file names, hashes, and stored paths.

This creates the seam for later VLM enrichment.
## Project isolation

Prompt image attachments are project-scoped.

When the active project changes, Prompt Workflow clears image attachments, selected files, expanded tree state, and prompt text before loading the next project's `local-state.json`.

The backend also filters saved image attachments by `projectId` while reading project state. This prevents stale image baskets from another project from appearing in the active project.
## Archive and prompt basket

Prompt Workflow now separates image archive from prompt basket.

- Image archive: every image added to the project, deduped by SHA-256.
- Prompt basket: the images selected for the current ChatGPT run.
- Drag/drop adds images to both archive and basket.
- Removing a chip removes it only from the prompt basket.
- Opening the archive lets the user reselect earlier images without finding them on disk again.
- Copy image attachments copies the current prompt basket only.

Entry capture stores the prompt basket in `image-attachments.json`, and Manage Entries shows the images used for the selected entry.

## Archive deletion

Image archive cleanup is project-scoped.

- Delete image removes one image from the project archive and from the current prompt basket.
- Clear image archive removes all archived images for the current project and clears the current prompt basket.
- Entry records may still contain historical `image-attachments.json` references if they were captured before archive deletion.

## VLM image insight capture

When an entry is created with images in the prompt basket, the backend analyzes each image with the configured LLM vision model.

The entry capture writes:

- `image-insights.json`
- `image-insights.md`

The SQLite index receives an `image_insights` chunk so image summaries, visible text, tags, UI elements, implementation hints, and research concepts become searchable later.

If image analysis fails, entry capture still succeeds and records a failed image insight with the exact error message.

## Prompt basket image selection

Images in the prompt workflow can stay in the project image list while being selected or unselected for clipboard copy.

- Selected chips are copied to ChatGPT Desktop.
- Unselected chips remain visible and are not copied.
- Removing a chip removes it from the current prompt image list.
- Captured entries receive only the currently selected prompt images.

## PDF attachments

Prompt Workflow supports PDFs beside images.

- Drag/drop PDFs into Prompt Workflow.
- PDFs are archived per project under `.rapid_prompt/projects/<project>/attachments/pdfs/...`.
- PDFs are deduped by SHA-256.
- PDF chips can be selected or unselected for clipboard copy.
- Copy PDF attachments writes PDF file references to the macOS clipboard for pasting into ChatGPT Desktop.
- Entry capture writes `pdf-attachments.json`, `pdf-text.json`, and `pdf-text.md`.
- The SQLite index receives `pdf_attachments` and `pdf_text` chunks so PDF filenames and extracted text are searchable.

PDF text extraction is local and best-effort. It extracts literal and Flate-compressed PDF text streams without adding a new dependency. Scanned PDFs may require a later OCR/VLM pass.
