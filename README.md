# I Weather PDF

A lightweight, private PDF workspace designed to run entirely in the browser and deploy as a static GitHub Pages site.

## Goal

One workspace instead of separate "merge", "split", and "organize" pages:

- Drop in one PDF and see its pages.
- Drop in more PDFs and append their pages to the same workspace.
- Drag pages into any order.
- Delete, duplicate, rotate, split, and combine pages.
- Edit/annotate pages without uploading documents to a server.
- Export the workspace back to a PDF.

## Architecture

The project intentionally starts with **no framework and no build step**.

```
index.html
styles.css
app.js
favicon.svg
.github/workflows/pages.yml
```

Current shell behavior:

- Responsive desktop/mobile workspace.
- Drag-and-drop PDF intake anywhere in the window.
- Multi-file picker, including adding the same PDF more than once as separate workspace copies.
- Files remain in browser memory only.
- Imported-document strip with remove and drag reorder.
- Tool-mode shell for Split, Combine, Reorder, and Edit.
- Page canvas, sidebar, inspector, status bar, empty/loading states.
- Keyboard shortcut: `Ctrl/Cmd + O` opens the PDF picker.
- No third-party runtime dependencies yet.

## Planned PDF engine

Keep responsibilities separated:

1. **PDF.js** — render PDF pages/thumbnails and read document metadata.
2. **pdf-lib** — copy/reorder/delete/rotate pages, merge documents, add annotations/content, and export.
3. **Native browser APIs** — drag/drop, File/Blob/Object URLs, downloads, pointer input.
4. **IndexedDB only if needed later** — optional crash/session recovery; not required for the core editor.

Large PDFs should be handled lazily: keep source files as `File`/ArrayBuffer references, render thumbnails on demand, and avoid holding full-resolution canvases for every page.

## Privacy

The intended editor is client-only. PDF contents should not leave the device unless a future feature explicitly requires network access and clearly says so.

## GitHub Pages

A Pages deployment workflow is included. It deploys the repository root whenever `main` is updated.

If GitHub Pages has not previously been enabled for the repository, open:

**Repository → Settings → Pages → Source → GitHub Actions**

After that, pushes to `main` deploy automatically.

## Current implementation

The workspace now supports:

- Lazy PDF.js page rendering.
- Multiple PDFs in one shared page workspace.
- Page selection, deletion, duplication, rotation, and reorder.
- Undo/redo for page structure and saved free-edit overlays.
- Split/extract by exporting selected pages.
- Combined export with pdf-lib.
- Free edit mode with text, pen, highlight, rectangle, whiteout, and image overlays.
- Annotation-aware export: edits are flattened onto the exported PDF while the original PDF page remains vector content.
- Off-screen thumbnail eviction so scrolling through large files does not retain hundreds of rendered canvases.
- Edge auto-scroll while dragging pages through long documents.
- Lazy loading of both the PDF engines and the free editor.

### Stress audit

A synthetic browser stress harness exercised a 500-page workspace assembled from two PDFs, repeated duplicate/delete/undo/redo/rotate/reorder operations, free-edit creation, coordinate transforms at 0°/90°/180°/270°, and a 120-page export assembly.

The key memory issue found during that audit was that rendered thumbnails stayed allocated after scrolling away. The workspace now evicts off-screen canvases and recreates them only when they approach the viewport.

The synthetic harness validates workspace/state behavior and rendering lifecycle. It does not claim compatibility with every unusual or malformed PDF in the wild; encrypted, damaged, or highly specialized PDFs still depend on PDF.js/pdf-lib support.

## Next implementation milestone

Improve direct editing ergonomics: richer text controls, resize handles for placed images/shapes, and optional persistence/recovery without adding a backend.


## Performance notes

The viewer keeps runtime work deliberately small: PDF.js is loaded only after a PDF is opened, the free editor is loaded only when the page workspace needs it, and pdf-lib is loaded only when an export is requested. Sidebar thumbnails are lazy-rendered and off-screen canvases are released. Large inserted images are resized before being stored in edit history.

A zero-dependency audit runs before every GitHub Pages deployment via `node tests/audit.mjs`.


## Existing-text editing

The page editor can inspect selectable PDF text only when **Edit text** is activated. Existing lines can be replaced or deleted in place. On export, the app attempts to remove the original PDF string token from the page content stream and writes the replacement as vector PDF text. If the source PDF uses an encoding that cannot be safely rewritten, that individual edit falls back to a visual background repair rather than risking document corruption.

The content-stream string scanning/rewrite approach is adapted from **PDF Studio** by kuldeepcodes (MIT License, Copyright © 2026 kuldeepcodes). See `THIRD_PARTY_NOTICES.md`.
