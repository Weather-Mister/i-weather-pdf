# iWeather PDF

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
- Multi-file picker.
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

## Next implementation milestone

Connect PDF.js and replace the page-engine placeholder with real, lazy-rendered page thumbnails. At that point we can implement page-level drag reorder, selection, deletion, rotation, and export before adding the richer free-edit layer.
