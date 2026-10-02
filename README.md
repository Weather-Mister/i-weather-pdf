# I Weather PDF

A lightweight PDF workspace that runs in your browser. PDFs stay on your device; no account or document upload is required.

## Use it

Open one or more PDFs, or start with a blank page. Add more files whenever you need them, including another copy of a file already open.

- **Pages:** jump to a page by number, use the previous/next buttons, or choose a thumbnail. Drag thumbnails to reorder. Ctrl/Cmd-click adds to the selection; Shift-click selects a range. Rotate, duplicate, delete, extract, or add a blank page from the page toolbar.
- **Editing:** add multiline text, draw, highlight, cover an area, place images, and replace supported existing PDF text. Select an added edit to move it; double-click added text or use the Text tool to edit it. Font, size in PDF points, color, bold, italic, and underline controls appear when relevant. Sizes remain stable across zoom and screen-size changes.
- **History:** the top Undo/Redo buttons and keyboard shortcuts use one history for edits, page changes, and PDF imports/removals. Completed edits are automatically retained in this tab.
- **Export:** use Export PDF or Ctrl/Cmd+S to download the current document. Extract downloads only selected pages. Newly added text is written as real PDF text so it stays selectable/searchable and can be edited again by capable PDF editors; unsupported glyphs fall back to the raster overlay instead of being dropped. Export includes text still being edited and uses a fixed snapshot, so edits made while exporting belong to the next download.

**This is a temporary workspace.** Export to keep your changes before closing the tab. The browser warns when leaving with changes made since the last full export. Extracting selected pages does not mark the entire workspace as exported.

## Keyboard controls

The `?` button opens the shortcut reference.

| Action | Shortcut |
| --- | --- |
| Add PDFs | Ctrl/Cmd+O |
| Export PDF | Ctrl/Cmd+S |
| Undo / Redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z (or Ctrl+Y) |
| Copy / Cut / Paste / Duplicate | Ctrl/Cmd+C / X / V / D |
| Select / Add text / Pen / Highlight / Rectangle | V / T / P / H / R |
| Previous / Next page | Page Up / Page Down |
| Reorder a focused page | Alt+Up / Alt+Down |
| Move a selected edit | Arrow keys; Shift for larger steps |
| Zoom / Fit page | Ctrl/Cmd+Plus / Minus / 0 |
| Pan | Space+drag or middle-button drag |
| Finish added text | Ctrl/Cmd+Enter; Enter adds a new line |
| Edit selected added text | Enter |
| Cancel / Deselect / Return to Select | Escape |

When the page rail has focus, copy/delete shortcuts act on pages. In the editor, they act on the selected edit, with page copy/paste available when no edit is selected. Form fields and text editing retain their native keyboard behavior.

## Architecture and performance

Plain HTML, CSS, and JavaScript; no framework or build step. PDF.js 3.11.174 renders pages and reads content. pdf-lib 1.17.1 assembles exports. Both engines and the editor load on demand. The separate PPTX viewer is also lazy-loaded.

Only the active page renders at full resolution. Sidebar thumbnails load near the viewport and release their canvases when they leave it. Render resolution, pen points, image size, and history depth are bounded. Source PDFs needed by undo or copied pages remain available; unreferenced sources are released.

Third-party engines load from CDNs, so opening PDFs initially requires a connection. There is no offline or session-recovery guarantee.

## PDF editing limitations

Added overlays are flattened on export while the original PDF page stays vector content. Existing-text replacements attempt to remove the original string and add extractable vector text. Unsupported encodings fall back to a visual background repair. Whiteout and these fallback repairs are **not secure redaction**. Scanned documents require OCR elsewhere before their text can be edited. Existing-text replacement operates on detected lines.

Content-stream rewriting is adapted from PDF Studio by kuldeepcodes (MIT). See `THIRD_PARTY_NOTICES.md`.

## Verification and deployment

Run:

```sh
node tests/audit.mjs
node tests/browser-stress.mjs
```

The browser suite requires Chrome/Chromium (`CHROME_BIN` can specify the executable) and a connection for pinned PDF/PPTX engines and a fixture. It covers synthetic large documents, real PDF rendering/export, text editing, history, navigation, keyboard focus, and desktop/mobile interactions. It does not claim support for every malformed, encrypted, or specialized PDF.

GitHub Actions runs both checks on pull requests. Successful changes to `main` deploy to GitHub Pages. Configure the repository's Pages source as **GitHub Actions**.
