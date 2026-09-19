(() => {
  const PDFJS_VERSION = "3.11.174";
  const PDFLIB_VERSION = "1.17.1";
  const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/build/pdf.min.js";
  const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/build/pdf.worker.min.js";
  const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@" + PDFLIB_VERSION + "/dist/pdf-lib.min.js";

  const state = {
    documents: [],
    pages: [],
    annotations: {},
    selected: new Set(),
    lastSelectedId: null,
    activeTool: null,
    view: "viewer",
    activePageId: null,
    dragCounter: 0,
    loadingFiles: false,
    exporting: false,
    enginesPromise: null,
    editorPromise: null,
    observer: null,
    sidebarObserver: null,
    history: { undo: [], redo: [] },
    ignoreClick: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const els = {
    fileInput: $("#fileInput"),
    chooseButton: $("#chooseButton"),
    addButton: $("#addButton"),
    stripAddButton: $("#stripAddButton"),
    addMoreButton: $("#addMoreButton"),
    documentStrip: $("#documentStrip"),
    documentList: $("#documentList"),
    emptyState: $("#emptyState"),
    loadedState: $("#loadedState"),
    dropOverlay: $("#dropOverlay"),
    statusText: $("#statusText"),
    workspaceTitle: $("#workspaceTitle"),
    workspaceMeta: $("#workspaceMeta"),
    pageCount: $("#pageCount"),
    pageGrid: $("#pageGrid"),
    sidebarPages: $(".sidebar-note"),
    inspector: $("#inspector"),
    selectAllButton: $("#selectAllButton"),
    exportButton: $("#exportButton"),
    undoButton: $("#undoButton"),
    redoButton: $("#redoButton"),
    toast: $("#toast")
  };

  if (els.sidebarPages) els.sidebarPages.className = "sidebar-pages";

  let toastTimer;
  let pointerDrag = null;

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeRotation(value) {
    return ((value % 360) + 360) % 360;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getAnnotations(pageId) {
    return deepClone(state.annotations[pageId] || []);
  }

  function editCount(pageId) {
    return (state.annotations[pageId] || []).length;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return bytes + " B";
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + " " + units[i];
  }

  function isPdf(file) {
    return file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  }

  function showToast(message, duration) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), duration || 1900);
  }

  function setStatus(message) {
    els.statusText.textContent = message;
  }

  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-src="' + src + '"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window[globalName]), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.src = src;
      script.onload = () => resolve(window[globalName]);
      script.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(script);
    });
  }

  function ensureEngines() {
    if (state.enginesPromise) return state.enginesPromise;
    setStatus("Loading PDF engine…");
    state.enginesPromise = Promise.all([
      loadScript(PDFJS_URL, "pdfjsLib"),
      loadScript(PDFLIB_URL, "PDFLib")
    ]).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return true;
    }).catch((error) => {
      state.enginesPromise = null;
      throw error;
    });
    return state.enginesPromise;
  }

  function ensureEditor() {
    if (window.iWeatherPDFEditor) return Promise.resolve(window.iWeatherPDFEditor);
    if (state.editorPromise) return state.editorPromise;

    if (!document.querySelector('link[data-pdf-editor-css]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./editor.css?v=4";
      link.dataset.pdfEditorCss = "true";
      document.head.appendChild(link);
    }

    state.editorPromise = loadScript("./editor.js?v=4", "iWeatherPDFEditor")
      .then(() => window.iWeatherPDFEditor)
      .catch((error) => {
        state.editorPromise = null;
        throw error;
      });

    return state.editorPromise;
  }

  function getDocumentById(id) {
    return state.documents.find((doc) => doc.id === id);
  }

  function getPageById(id) {
    return state.pages.find((page) => page.id === id);
  }

  function clonePages() {
    return state.pages.map((page) => ({
      id: page.id,
      docId: page.docId,
      sourceIndex: page.sourceIndex,
      rotation: page.rotation || 0
    }));
  }

  function snapshotWorkspace() {
    return {
      pages: clonePages(),
      annotations: deepClone(state.annotations)
    };
  }

  function restoreWorkspace(snapshot) {
    state.pages = snapshot.pages || [];
    state.annotations = snapshot.annotations || {};
  }

  function pushHistory() {
    state.history.undo.push(snapshotWorkspace());
    if (state.history.undo.length > 35) state.history.undo.shift();
    state.history.redo = [];
    updateHistoryButtons();
  }

  function clearHistory() {
    state.history.undo = [];
    state.history.redo = [];
    updateHistoryButtons();
  }

  function undo() {
    if (!state.history.undo.length) return false;
    state.history.redo.push(snapshotWorkspace());
    restoreWorkspace(state.history.undo.pop());
    state.selected.clear();
    state.lastSelectedId = null;
    renderWorkspace();
    updateHistoryButtons();
    showToast("Undone");
    return true;
  }

  function redo() {
    if (!state.history.redo.length) return false;
    state.history.undo.push(snapshotWorkspace());
    restoreWorkspace(state.history.redo.pop());
    state.selected.clear();
    state.lastSelectedId = null;
    renderWorkspace();
    updateHistoryButtons();
    showToast("Redone");
    return true;
  }

  function updateHistoryButtons() {
    els.undoButton.disabled = !state.history.undo.length;
    els.redoButton.disabled = !state.history.redo.length;
  }

  function setExportLabel(label) {
    els.exportButton.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 20h14"/></svg><span>' +
      label +
      "</span>";
  }

  function selectedPages() {
    return state.pages.filter((page) => state.selected.has(page.id));
  }

  function updateToolbarState() {
    const hasPages = state.pages.length > 0;
    $$(".tool-button").forEach((button) => {
      button.disabled = !hasPages;
      button.classList.toggle("is-active", button.dataset.tool === state.activeTool);
    });

    const selectedCount = state.selected.size;
    els.selectAllButton.disabled = !hasPages;
    els.selectAllButton.textContent = selectedCount === state.pages.length && hasPages ? "Clear" : "Select all";

    const splitExport = state.activeTool === "split" && selectedCount > 0;
    setExportLabel(splitExport ? "Export selected" : "Export PDF");
    els.exportButton.disabled = !hasPages || state.exporting || (state.activeTool === "split" && selectedCount === 0);

    updateHistoryButtons();
  }

  function renderDocuments() {
    els.documentList.replaceChildren();

    state.documents.forEach((doc, index) => {
      const chip = document.createElement("div");
      chip.className = "document-chip";
      chip.dataset.id = doc.id;

      const dot = document.createElement("span");
      dot.className = "document-dot";
      dot.style.opacity = String(Math.max(0.52, 1 - index * 0.07));

      const info = document.createElement("div");
      info.className = "document-info";

      const name = document.createElement("span");
      name.className = "document-name";
      name.textContent = doc.name;

      const meta = document.createElement("span");
      meta.className = "document-size";
      meta.textContent = doc.pageCount + "p · " + formatBytes(doc.size);

      const remove = document.createElement("button");
      remove.className = "document-remove";
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove " + doc.name);
      remove.title = "Remove PDF";
      remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeDocument(doc.id);
      });

      info.append(name, meta);
      chip.append(dot, info, remove);
      els.documentList.append(chip);
    });
  }

  async function loadOnePdf(file) {
    const id = uid("doc");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const task = window.pdfjsLib.getDocument({ data: bytes });

    task.onPassword = (updatePassword) => {
      const password = window.prompt("This PDF is password protected. Enter its password:");
      if (password === null) {
        task.destroy();
        return;
      }
      updatePassword(password);
    };

    const pdfJs = await task.promise;
    const doc = {
      id,
      file,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      pageCount: pdfJs.numPages,
      pdfJs
    };

    const pages = [];
    for (let index = 0; index < pdfJs.numPages; index++) {
      pages.push({
        id: uid("page"),
        docId: id,
        sourceIndex: index,
        rotation: 0
      });
    }

    state.documents.push(doc);
    state.pages.push(...pages);
    return doc;
  }

  async function addFiles(fileList) {
    if (state.loadingFiles) return;

    const incoming = [...fileList];
    const pdfs = incoming.filter(isPdf);
    const rejected = incoming.length - pdfs.length;
    if (!pdfs.length) {
      if (rejected) showToast("Only PDF files can be added.");
      return;
    }

    const existingKeys = new Set(
      state.documents.map((doc) => doc.name + ":" + doc.size + ":" + doc.lastModified)
    );
    const unique = pdfs.filter((file) => {
      const key = file.name + ":" + file.size + ":" + file.lastModified;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (!unique.length) {
      showToast("Those PDFs are already in the workspace.");
      els.fileInput.value = "";
      return;
    }

    state.loadingFiles = true;
    clearHistory();
    setStatus("Preparing " + unique.length + " PDF" + (unique.length === 1 ? "" : "s") + "…");

    try {
      await ensureEngines();
      let added = 0;

      for (const file of unique) {
        setStatus("Reading " + file.name + "…");
        try {
          await loadOnePdf(file);
          added++;
          render();
        } catch (error) {
          console.error(error);
          showToast("Could not open " + file.name, 2600);
        }
      }

      if (added) {
        setStatus(state.pages.length + " pages ready");
        showToast(
          added +
            " PDF" +
            (added === 1 ? "" : "s") +
            " added · " +
            state.pages.length +
            " page" +
            (state.pages.length === 1 ? "" : "s")
        );
      }

      if (rejected) {
        setTimeout(() => {
          showToast(rejected + " non-PDF file" + (rejected === 1 ? "" : "s") + " skipped");
        }, 450);
      }
    } catch (error) {
      console.error(error);
      setStatus("PDF engine failed to load");
      showToast("Could not load the PDF engine. Check your connection.", 3200);
    } finally {
      state.loadingFiles = false;
      els.fileInput.value = "";
      render();
    }
  }

  function removeDocument(id) {
    const doc = getDocumentById(id);
    if (!doc) return;

    const removedPageIds = state.pages
      .filter((page) => page.docId === id)
      .map((page) => page.id);

    state.documents = state.documents.filter((item) => item.id !== id);
    state.pages = state.pages.filter((page) => page.docId !== id);
    removedPageIds.forEach((pageId) => delete state.annotations[pageId]);

    for (const selectedId of [...state.selected]) {
      const page = getPageById(selectedId);
      if (!page) state.selected.delete(selectedId);
    }

    if (doc.pdfJs && typeof doc.pdfJs.destroy === "function") {
      Promise.resolve(doc.pdfJs.destroy()).catch(() => {});
    }

    clearHistory();
    state.lastSelectedId = null;
    if (!state.pages.length) state.activeTool = null;
    render();
    setStatus(state.pages.length ? state.pages.length + " pages ready" : "Ready");
    showToast(doc.name + " removed");
  }

  function render() {
    const hasDocs = state.documents.length > 0;
    els.documentStrip.hidden = !hasDocs;
    els.emptyState.hidden = hasDocs;
    els.loadedState.hidden = !hasDocs;

    if (!hasDocs) {
      state.selected.clear();
      state.activeTool = null;
      els.documentList.replaceChildren();
      els.pageGrid.replaceChildren();
      els.workspaceTitle.textContent = "Workspace";
      els.workspaceMeta.textContent = "PDFs loaded locally";
      els.pageCount.textContent = "0";
      updateToolbarState();
      renderInspector();
      return;
    }

    renderDocuments();
    renderWorkspace();
  }

  function renderWorkspace() {
    const count = state.documents.length;
    if (state.pages.length && !getPageById(state.activePageId)) {
      state.activePageId = state.pages[0].id;
    }
    if (!state.pages.length) state.activePageId = null;

    els.workspaceTitle.textContent =
      count === 1 ? state.documents[0].name : count + " PDFs in workspace";
    els.workspaceMeta.textContent =
      state.pages.length +
      " page" +
      (state.pages.length === 1 ? "" : "s") +
      " · " +
      formatBytes(state.documents.reduce((sum, doc) => sum + doc.size, 0)) +
      " · local only";
    els.pageCount.textContent = String(state.pages.length);

    renderSidebar();
    renderPages();
    renderInspector();
    updateToolbarState();
  }

  function unloadPageCanvas(canvas) {
    if (!canvas) return;
    if (canvas._renderTask) {
      try { canvas._renderTask.cancel(); } catch (_) {}
      canvas._renderTask = null;
    }
    canvas._renderGeneration = (canvas._renderGeneration || 0) + 1;
    canvas.dataset.rendered = "false";
    canvas.dataset.rendering = "false";
    if (canvas.width > 1 || canvas.height > 1) {
      canvas.width = 1;
      canvas.height = 1;
    }
    if (canvas.parentElement) canvas.parentElement.classList.remove("is-rendered");
  }

  function saveCurrentEditor() {
    if (window.iWeatherPDFEditor && typeof window.iWeatherPDFEditor.save === "function") {
      window.iWeatherPDFEditor.save();
    }
  }

  function renderPages() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    els.pageGrid.classList.remove("is-list");
    els.pageGrid.classList.add("is-viewer");

    if (!state.pages.length || !state.activePageId) {
      if (window.iWeatherPDFEditor && typeof window.iWeatherPDFEditor.close === "function") {
        window.iWeatherPDFEditor.close(false);
      }
      els.pageGrid.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "workspace-empty";
      empty.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>' +
        "<strong>No pages left</strong><span>Add another PDF to continue.</span>";
      els.pageGrid.append(empty);
      return;
    }

    const pageId = state.activePageId;
    els.pageGrid.replaceChildren();
    const loading = document.createElement("div");
    loading.className = "viewer-loading";
    loading.innerHTML =
      '<span class="viewer-spinner"></span><strong>Loading page…</strong><span>Preparing the full-page editor</span>';
    els.pageGrid.append(loading);

    ensureEditor()
      .then((editorApi) => {
        if (state.activePageId !== pageId || !getPageById(pageId)) return;
        return editorApi.open(pageId, {
          mount: els.pageGrid,
          embedded: true
        });
      })
      .then(() => {
        if (state.activePageId === pageId) setStatus("Page editor ready");
      })
      .catch((error) => {
        console.error(error);
        if (state.activePageId !== pageId) return;
        els.pageGrid.replaceChildren();
        const failed = document.createElement("div");
        failed.className = "workspace-empty";
        failed.innerHTML =
          '<strong>Could not open this page</strong><span>Try selecting it again.</span>';
        els.pageGrid.append(failed);
        setStatus("Page editor failed");
      });
  }

  function createPageCard(page, index) {
    const doc = getDocumentById(page.docId);
    const card = document.createElement("article");
    card.className = "page-card";
    card.dataset.pageId = page.id;
    card.classList.toggle("is-selected", state.selected.has(page.id));

    const top = document.createElement("div");
    top.className = "page-card-top";

    const number = document.createElement("span");
    number.className = "workspace-page-number";
    number.textContent = String(index + 1);

    const actions = document.createElement("div");
    actions.className = "page-quick-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.title = "Free edit";
    edit.setAttribute("aria-label", "Free edit page");
    edit.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m14 6 3 3"/></svg>';
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      openPageEditor(page.id);
    });

    const rotate = document.createElement("button");
    rotate.type = "button";
    rotate.title = "Rotate right";
    rotate.setAttribute("aria-label", "Rotate page right");
    rotate.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5.3"/></svg>';
    rotate.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.selected.has(page.id)) {
        state.selected.clear();
        state.selected.add(page.id);
      }
      rotateSelected(90);
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "Delete page";
    remove.setAttribute("aria-label", "Delete page");
    remove.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14"/></svg>';
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.selected.has(page.id)) {
        state.selected.clear();
        state.selected.add(page.id);
      }
      deleteSelected();
    });

    actions.append(edit, rotate, remove);
    if (editCount(page.id)) {
      const badge = document.createElement("span");
      badge.className = "page-edit-badge";
      badge.textContent = editCount(page.id) + " edit" + (editCount(page.id) === 1 ? "" : "s");
      top.append(number, badge, actions);
    } else {
      top.append(number, actions);
    }

    const preview = document.createElement("div");
    preview.className = "page-preview";

    const canvas = document.createElement("canvas");
    canvas.dataset.pageId = page.id;
    canvas.dataset.rendered = "false";
    canvas.dataset.rendering = "false";
    canvas.setAttribute("aria-label", "Page " + (index + 1) + " preview");

    const sheen = document.createElement("div");
    sheen.className = "page-skeleton";
    preview.append(canvas, sheen);

    const footer = document.createElement("div");
    footer.className = "page-card-footer";

    const source = document.createElement("div");
    source.className = "page-source";
    const title = document.createElement("strong");
    title.textContent = "Page " + (index + 1);
    const subtitle = document.createElement("span");
    subtitle.textContent = (doc ? doc.name : "PDF") + " · p" + (page.sourceIndex + 1);
    source.append(title, subtitle);

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "page-drag-handle";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-label", "Drag page " + (index + 1) + " to reorder");
    handle.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
    handle.addEventListener("pointerdown", (event) => startPointerReorder(event, page.id, handle));

    footer.append(source, handle);
    card.append(top, preview, footer);

    card.addEventListener("click", (event) => {
      if (state.ignoreClick || event.target.closest("button")) return;
      selectPage(page.id, event);
      if (
        state.activeTool === "edit" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey
      ) {
        openPageEditor(page.id);
      }
    });

    card.addEventListener("dblclick", () => {
      openPageEditor(page.id);
    });

    return card;
  }

  async function renderPageCanvas(canvas) {
    const model = getPageById(canvas.dataset.pageId);
    if (!model || !canvas.isConnected) return;
    if (canvas.dataset.rendered === "true" || canvas.dataset.rendering === "true") return;

    const doc = getDocumentById(model.docId);
    if (!doc) return;

    canvas.dataset.rendering = "true";
    const generation = (canvas._renderGeneration || 0) + 1;
    canvas._renderGeneration = generation;

    try {
      const pdfPage = await doc.pdfJs.getPage(model.sourceIndex + 1);
      if (
        !canvas.isConnected ||
        !getPageById(model.id) ||
        canvas._renderGeneration !== generation
      ) return;

      const maxWidth = 160;
      const parentWidth = Math.max(
        56,
        Math.min(canvas.parentElement.clientWidth || 110, maxWidth)
      );
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const rotation = normalizeRotation((pdfPage.rotate || 0) + (model.rotation || 0));
      const base = pdfPage.getViewport({ scale: 1, rotation });
      const cssScale = parentWidth / base.width;
      const viewport = pdfPage.getViewport({ scale: cssScale * dpr, rotation });

      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = Math.floor(viewport.width / dpr) + "px";
      canvas.style.height = Math.floor(viewport.height / dpr) + "px";

      const context = canvas.getContext("2d", { alpha: false });
      context.save();
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.restore();

      const task = pdfPage.render({ canvasContext: context, viewport });
      canvas._renderTask = task;
      await task.promise;

      if (
        canvas.isConnected &&
        canvas._renderGeneration === generation
      ) {
        canvas.dataset.rendered = "true";
        if (canvas.parentElement) canvas.parentElement.classList.add("is-rendered");
      }
    } catch (error) {
      if (!error || error.name !== "RenderingCancelledException") throw error;
    } finally {
      if (canvas._renderGeneration === generation) {
        canvas.dataset.rendering = "false";
        canvas._renderTask = null;
      }
    }
  }

  function selectPage(id, event = {}) {
    const pageIndex = state.pages.findIndex((page) => page.id === id);
    if (pageIndex < 0) return;

    const previousActive = state.activePageId;
    if (previousActive && previousActive !== id) saveCurrentEditor();
    state.activePageId = id;

    const additive = !!(event.metaKey || event.ctrlKey);
    const range = !!(event.shiftKey && state.lastSelectedId);

    if (range) {
      const anchorIndex = state.pages.findIndex((page) => page.id === state.lastSelectedId);
      if (!additive) state.selected.clear();
      if (anchorIndex >= 0) {
        const start = Math.min(anchorIndex, pageIndex);
        const end = Math.max(anchorIndex, pageIndex);
        for (let i = start; i <= end; i++) state.selected.add(state.pages[i].id);
      } else {
        state.selected.add(id);
      }
    } else if (additive) {
      if (state.selected.has(id)) state.selected.delete(id);
      else state.selected.add(id);
      state.lastSelectedId = id;
    } else {
      state.selected.clear();
      state.selected.add(id);
      state.lastSelectedId = id;
    }

    syncSelectionUI();
    renderInspector();
    updateToolbarState();

    if (previousActive !== id) {
      renderPages();
      renderSidebar();
    }
  }

  function syncSelectionUI() {
    $$(".page-card").forEach((card) => {
      card.classList.toggle("is-selected", state.selected.has(card.dataset.pageId));
    });
    $(".sidebar-page-row").forEach((row) => {
      row.classList.toggle("is-selected", state.selected.has(row.dataset.pageId));
      row.classList.toggle("is-active", state.activePageId === row.dataset.pageId);
    });
    updateToolbarState();
  }

  function selectAll() {
    if (state.selected.size === state.pages.length) {
      state.selected.clear();
      state.lastSelectedId = null;
    } else {
      state.pages.forEach((page) => state.selected.add(page.id));
      state.lastSelectedId = state.pages.length ? state.pages[0].id : null;
    }
    syncSelectionUI();
    renderInspector();
  }

  function renderSidebar() {
    if (!els.sidebarPages) return;
    if (state.sidebarObserver) state.sidebarObserver.disconnect();
    els.sidebarPages.replaceChildren();

    state.pages.forEach((page, index) => {
      const doc = getDocumentById(page.docId);
      const row = document.createElement("div");
      row.className = "sidebar-page-row";
      row.dataset.pageId = page.id;
      row.classList.toggle("is-selected", state.selected.has(page.id));
      row.classList.toggle("is-active", state.activePageId === page.id);
      row.setAttribute("role", "button");
      row.tabIndex = 0;

      const thumb = document.createElement("div");
      thumb.className = "sidebar-thumb-wrap";

      const canvas = document.createElement("canvas");
      canvas.dataset.pageId = page.id;
      canvas.dataset.rendered = "false";
      canvas.dataset.rendering = "false";
      canvas.setAttribute("aria-label", "Page " + (index + 1) + " thumbnail");

      const number = document.createElement("span");
      number.className = "sidebar-thumb-number";
      number.textContent = String(index + 1);

      const skeleton = document.createElement("span");
      skeleton.className = "sidebar-thumb-skeleton";
      thumb.append(canvas, skeleton, number);

      const info = document.createElement("span");
      info.className = "sidebar-page-info";

      const title = document.createElement("strong");
      title.textContent = "Page " + (index + 1);

      const source = document.createElement("span");
      source.textContent =
        (doc ? doc.name : "PDF") +
        " · p" +
        (page.sourceIndex + 1) +
        (editCount(page.id) ? " · " + editCount(page.id) + " edits" : "");

      info.append(title, source);

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "sidebar-drag-handle";
      handle.title = "Drag to reorder";
      handle.setAttribute("aria-label", "Drag page " + (index + 1) + " to reorder");
      handle.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
      handle.addEventListener("pointerdown", (event) => startPointerReorder(event, page.id, handle));
      handle.addEventListener("click", (event) => event.stopPropagation());

      row.append(thumb, info, handle);

      row.addEventListener("click", (event) => {
        if (state.ignoreClick || event.target.closest(".sidebar-drag-handle")) return;
        selectPage(page.id, event);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectPage(page.id, event);
        }
      });

      els.sidebarPages.append(row);
    });

    state.sidebarObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const canvas = entry.target;
          if (entry.isIntersecting) {
            renderPageCanvas(canvas).catch((error) => console.error(error));
          } else {
            unloadPageCanvas(canvas);
          }
        });
      },
      { root: els.sidebarPages, rootMargin: "260px 0px", threshold: 0.01 }
    );

    els.sidebarPages.querySelectorAll("canvas[data-page-id]").forEach((canvas) => {
      state.sidebarObserver.observe(canvas);
    });

    requestAnimationFrame(() => {
      const activeRow = els.sidebarPages.querySelector(
        '.sidebar-page-row[data-page-id="' + state.activePageId + '"]'
      );
      if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
    });
  }

  function makeInspectorButton(label, action, options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "inspector-action" + (options && options.danger ? " is-danger" : "");
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function renderInspector() {
    if (!els.inspector) return;
    els.inspector.replaceChildren();

    const heading = document.createElement("div");
    heading.className = "inspector-heading";
    heading.textContent = "Inspector";
    els.inspector.append(heading);

    const selected = selectedPages();

    if (!selected.length) {
      const empty = document.createElement("div");
      empty.className = "inspector-empty";

      const icon = document.createElement("div");
      icon.className = "inspector-mode-icon";
      icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';

      const title = document.createElement("strong");
      const text = document.createElement("span");

      if (state.activeTool === "split") {
        title.textContent = "Select pages to extract";
        text.textContent = "Tap the pages you want, then use Export selected.";
      } else if (state.activeTool === "combine") {
        title.textContent = "Combine is live";
        text.textContent = "All pages in this workspace export as one PDF. Add more PDFs at any time.";
      } else if (state.activeTool === "reorder") {
        title.textContent = "Drag to reorder";
        text.textContent = "Grab the six-dot handle on any page and drop it onto another page.";
      } else if (state.activeTool === "edit") {
        title.textContent = "Select a page to edit";
        text.textContent = "Add text, pen marks, highlights, shapes, whiteout, or images directly on a page.";
      } else {
        title.textContent = "No page selected";
        text.textContent = "Select a page to see page controls.";
      }

      empty.append(icon, title, text);
      els.inspector.append(empty);
      return;
    }

    const panel = document.createElement("div");
    panel.className = "inspector-panel";

    const selection = document.createElement("div");
    selection.className = "selection-summary";

    const title = document.createElement("strong");
    title.textContent =
      selected.length === 1
        ? "Page " + (state.pages.findIndex((page) => page.id === selected[0].id) + 1)
        : selected.length + " pages selected";

    const subtitle = document.createElement("span");
    if (selected.length === 1) {
      const doc = getDocumentById(selected[0].docId);
      subtitle.textContent =
        (doc ? doc.name : "PDF") + " · original page " + (selected[0].sourceIndex + 1);
    } else {
      subtitle.textContent = "Bulk actions apply to every selected page.";
    }

    selection.append(title, subtitle);

    const actionGrid = document.createElement("div");
    actionGrid.className = "inspector-action-grid";

    if (selected.length === 1) {
      const freeEdit = makeInspectorButton("Free edit", () => openPageEditor(selected[0].id));
      freeEdit.classList.add("primary");
      actionGrid.append(freeEdit);
    }

    actionGrid.append(
      makeInspectorButton("Rotate left", () => rotateSelected(-90)),
      makeInspectorButton("Rotate right", () => rotateSelected(90)),
      makeInspectorButton("Duplicate", duplicateSelected),
      makeInspectorButton("Extract PDF", () => exportPages(selectedPages(), "iweather-extract.pdf"))
    );

    const moveGrid = document.createElement("div");
    moveGrid.className = "inspector-action-grid compact";
    if (selected.length === 1) {
      moveGrid.append(
        makeInspectorButton("Move earlier", () => moveSelected(-1)),
        makeInspectorButton("Move later", () => moveSelected(1))
      );
    }

    const deleteButton = makeInspectorButton(
      "Delete selected",
      deleteSelected,
      { danger: true }
    );
    deleteButton.classList.add("full");

    panel.append(selection, actionGrid);
    if (selected.length === 1) panel.append(moveGrid);
    panel.append(deleteButton);
    els.inspector.append(panel);
  }

  function rotateSelected(delta) {
    if (!state.selected.size) return;
    saveCurrentEditor();
    pushHistory();
    state.pages.forEach((page) => {
      if (state.selected.has(page.id)) {
        page.rotation = normalizeRotation((page.rotation || 0) + delta);
      }
    });
    renderPages();
    renderSidebar();
    renderInspector();
    updateToolbarState();
    setStatus("Rotation updated");
  }

  function duplicateSelected() {
    if (!state.selected.size) return;
    saveCurrentEditor();
    pushHistory();

    const selected = new Set(state.selected);
    const newSelected = new Set();
    const nextPages = [];

    state.pages.forEach((page) => {
      nextPages.push(page);
      if (selected.has(page.id)) {
        const copy = {
          id: uid("page"),
          docId: page.docId,
          sourceIndex: page.sourceIndex,
          rotation: page.rotation || 0
        };
        nextPages.push(copy);
        if (state.annotations[page.id]) {
          state.annotations[copy.id] = deepClone(state.annotations[page.id]);
        }
        newSelected.add(copy.id);
      }
    });

    state.pages = nextPages;
    state.selected = newSelected;
    state.lastSelectedId = [...newSelected][0] || null;
    renderWorkspace();
    showToast("Page" + (newSelected.size === 1 ? "" : "s") + " duplicated");
  }

  function deleteSelected() {
    if (!state.selected.size) return;
    saveCurrentEditor();
    const count = state.selected.size;
    const removedIds = new Set(state.selected);
    pushHistory();
    state.pages = state.pages.filter((page) => !removedIds.has(page.id));
    removedIds.forEach((pageId) => delete state.annotations[pageId]);
    state.selected.clear();
    state.lastSelectedId = null;
    renderWorkspace();
    setStatus(state.pages.length + " pages ready");
    showToast(count + " page" + (count === 1 ? "" : "s") + " deleted");
  }

  function moveSelected(delta) {
    if (state.selected.size !== 1) return;
    const id = [...state.selected][0];
    const index = state.pages.findIndex((page) => page.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.pages.length) return;

    pushHistory();
    const temp = state.pages[index];
    state.pages[index] = state.pages[target];
    state.pages[target] = temp;
    renderWorkspace();

    requestAnimationFrame(() => {
      const card = els.pageGrid.querySelector('[data-page-id="' + id + '"]');
      if (card) card.scrollIntoView({ block: "nearest" });
    });
  }

  function reorderPage(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    saveCurrentEditor();
    const sourceIndex = state.pages.findIndex((page) => page.id === sourceId);
    let targetIndex = state.pages.findIndex((page) => page.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    pushHistory();
    const moved = state.pages.splice(sourceIndex, 1)[0];
    if (sourceIndex < targetIndex) targetIndex--;
    state.pages.splice(targetIndex, 0, moved);
    renderWorkspace();
    setStatus("Page order updated");
  }

  function startPointerReorder(event, pageId, handle) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    pointerDrag = {
      pageId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      targetId: null,
      moved: false,
      autoScroll: 0,
      raf: null,
      handle
    };

    try {
      handle.setPointerCapture(event.pointerId);
    } catch (_) {}

    const sourceRow = els.sidebarPages.querySelector(
      '.sidebar-page-row[data-page-id="' + pageId + '"]'
    );
    if (sourceRow) sourceRow.classList.add("is-dragging");

    handle.addEventListener("pointermove", onPointerReorderMove);
    handle.addEventListener("pointerup", onPointerReorderEnd, { once: true });
    handle.addEventListener("pointercancel", onPointerReorderEnd, { once: true });
  }

  function runReorderAutoScroll() {
    if (!pointerDrag || !pointerDrag.autoScroll) return;
    els.sidebarPages.scrollTop += pointerDrag.autoScroll;
    pointerDrag.raf = requestAnimationFrame(runReorderAutoScroll);
  }

  function setReorderAutoScroll(speed) {
    if (!pointerDrag) return;
    if (pointerDrag.autoScroll === speed) return;
    pointerDrag.autoScroll = speed;
    if (pointerDrag.raf) {
      cancelAnimationFrame(pointerDrag.raf);
      pointerDrag.raf = null;
    }
    if (speed) pointerDrag.raf = requestAnimationFrame(runReorderAutoScroll);
  }

  function onPointerReorderMove(event) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;

    const distance =
      Math.abs(event.clientX - pointerDrag.startX) +
      Math.abs(event.clientY - pointerDrag.startY);

    if (distance > 6) pointerDrag.moved = true;
    if (!pointerDrag.moved) return;

    const railRect = els.sidebarPages.getBoundingClientRect();
    const edge = Math.min(70, Math.max(36, railRect.height * 0.1));
    if (event.clientY < railRect.top + edge) {
      setReorderAutoScroll(-10);
    } else if (event.clientY > railRect.bottom - edge) {
      setReorderAutoScroll(10);
    } else {
      setReorderAutoScroll(0);
    }

    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element && element.closest ? element.closest(".sidebar-page-row") : null;
    const targetId = target ? target.dataset.pageId : null;

    $$(".sidebar-page-row.drop-target").forEach((row) => row.classList.remove("drop-target"));

    if (targetId && targetId !== pointerDrag.pageId) {
      pointerDrag.targetId = targetId;
      target.classList.add("drop-target");
    } else {
      pointerDrag.targetId = null;
    }
  }

  function onPointerReorderEnd(event) {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;

    const data = pointerDrag;
    if (data.raf) cancelAnimationFrame(data.raf);
    data.handle.removeEventListener("pointermove", onPointerReorderMove);

    $$(".sidebar-page-row.is-dragging, .sidebar-page-row.drop-target").forEach((row) => {
      row.classList.remove("is-dragging", "drop-target");
    });

    pointerDrag = null;

    if (data.moved) {
      state.ignoreClick = true;
      setTimeout(() => {
        state.ignoreClick = false;
      }, 0);
    }

    if (data.moved && data.targetId) {
      reorderPage(data.pageId, data.targetId);
    }
  }

  function sanitizeBaseName(name) {
    const base = (name || "document").replace(/\.pdf$/i, "");
    return base.replace(/[\\/:*?"<>|]+/g, "-").trim() || "document";
  }

  async function exportPages(pages, filename) {
    if (!pages || !pages.length || state.exporting) return;

    state.exporting = true;
    updateToolbarState();
    setStatus("Preparing export…");

    try {
      await ensureEngines();
      const sourceDocs = new Map();

      for (const model of pages) {
        if (sourceDocs.has(model.docId)) continue;
        const doc = getDocumentById(model.docId);
        if (!doc) throw new Error("A source PDF is missing.");
        const bytes = await doc.file.arrayBuffer();
        const loaded = await window.PDFLib.PDFDocument.load(bytes, {
          ignoreEncryption: false,
          updateMetadata: false
        });
        sourceDocs.set(model.docId, loaded);
      }

      const output = await window.PDFLib.PDFDocument.create();

      for (let i = 0; i < pages.length; i++) {
        const model = pages[i];
        const source = sourceDocs.get(model.docId);
        const copiedPages = await output.copyPages(source, [model.sourceIndex]);
        const copied = copiedPages[0];

        const baseRotation =
          copied.getRotation && copied.getRotation().angle
            ? copied.getRotation().angle
            : 0;
        copied.setRotation(
          window.PDFLib.degrees(
            normalizeRotation(baseRotation + (model.rotation || 0))
          )
        );
        output.addPage(copied);

        if (editCount(model.id)) {
          const editor = await ensureEditor();
          const crop =
            typeof copied.getCropBox === "function"
              ? copied.getCropBox()
              : { x: 0, y: 0, width: copied.getWidth(), height: copied.getHeight() };
          const overlayBytes = await editor.exportOverlay(
            model.id,
            crop.width,
            crop.height
          );
          if (overlayBytes) {
            const overlayImage = await output.embedPng(overlayBytes);
            copied.drawImage(overlayImage, {
              x: crop.x,
              y: crop.y,
              width: crop.width,
              height: crop.height
            });
          }
        }

        if (i % 8 === 0) {
          setStatus("Exporting " + (i + 1) + " / " + pages.length + "…");
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }

      const bytes = await output.save({ useObjectStreams: true });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      if (!filename) {
        filename =
          state.documents.length === 1
            ? sanitizeBaseName(state.documents[0].name) + "-edited.pdf"
            : "iweather-combined.pdf";
      }

      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 12000);

      setStatus("Exported " + pages.length + " pages");
      showToast("PDF exported");
    } catch (error) {
      console.error(error);
      setStatus("Export failed");
      showToast("Export failed. This PDF may use unsupported encryption.", 3200);
    } finally {
      state.exporting = false;
      updateToolbarState();
    }
  }

  async function renderEditorPage(pageId, canvas, maxWidth, maxHeight) {
    const model = getPageById(pageId);
    if (!model) throw new Error("Page not found");
    const doc = getDocumentById(model.docId);
    if (!doc) throw new Error("Document not found");

    const pdfPage = await doc.pdfJs.getPage(model.sourceIndex + 1);
    const rotation = normalizeRotation((pdfPage.rotate || 0) + (model.rotation || 0));
    const base = pdfPage.getViewport({ scale: 1, rotation });
    const cssScale = Math.max(
      0.12,
      Math.min(maxWidth / base.width, maxHeight / base.height, 1.8)
    );
    const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
    const viewport = pdfPage.getViewport({ scale: cssScale * dpr, rotation });

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const cssWidth = Math.floor(viewport.width / dpr);
    const cssHeight = Math.floor(viewport.height / dpr);
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";

    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport }).promise;

    return { width: cssWidth, height: cssHeight, rotation };
  }

  function commitAnnotations(pageId, annotations, recordHistory = true, quiet = false) {
    if (!getPageById(pageId)) return;
    if (recordHistory) pushHistory();

    const cleaned = deepClone(annotations || []);
    if (cleaned.length) state.annotations[pageId] = cleaned;
    else delete state.annotations[pageId];

    if (!quiet) renderPages();
    renderSidebar();
    renderInspector();
    updateToolbarState();
    setStatus(cleaned.length ? cleaned.length + " edits saved" : "Edits cleared");
  }

  async function openPageEditor(pageId) {
    const page = getPageById(pageId);
    if (!page) return;

    if (state.activePageId && state.activePageId !== pageId) saveCurrentEditor();
    state.activePageId = pageId;
    state.selected.clear();
    state.selected.add(pageId);
    state.lastSelectedId = pageId;
    state.activeTool = "edit";
    syncSelectionUI();
    renderSidebar();
    renderInspector();
    updateToolbarState();
    renderPages();
  }

  window.iWeatherPDFEditorHost = {
    uid,
    normalizeRotation,
    getPage: (pageId) => {
      const page = getPageById(pageId);
      return page ? deepClone(page) : null;
    },
    getPageIndex: (pageId) => state.pages.findIndex((page) => page.id === pageId),
    getDocumentName: (docId) => {
      const doc = getDocumentById(docId);
      return doc ? doc.name : "";
    },
    getAnnotations,
    commitAnnotations,
    renderPage: renderEditorPage,
    showToast,
    setStatus
  };

  function openPicker() {
    if (!state.loadingFiles) els.fileInput.click();
  }

  [els.chooseButton, els.addButton, els.stripAddButton, els.addMoreButton]
    .filter(Boolean)
    .forEach((button) => button.addEventListener("click", openPicker));

  els.fileInput.addEventListener("change", () => addFiles(els.fileInput.files));

  els.selectAllButton.addEventListener("click", selectAll);
  els.exportButton.addEventListener("click", () => {
    saveCurrentEditor();
    const pages =
      state.activeTool === "split" && state.selected.size
        ? selectedPages()
        : state.pages;
    const filename =
      state.activeTool === "split" && state.selected.size
        ? "iweather-extract.pdf"
        : null;
    exportPages(pages, filename);
  });

  els.undoButton.addEventListener("click", undo);
  els.redoButton.addEventListener("click", redo);

  $$(".tool-button").forEach((button) => {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      state.activeTool = state.activeTool === tool ? null : tool;

      if (state.activeTool === "combine") {
        showToast("All workspace pages already combine on export.");
      } else if (state.activeTool === "reorder") {
        showToast("Drag pages in the left sidebar to reorder them.");
      } else if (state.activeTool === "split") {
        showToast("Select pages in the left sidebar, then Export selected.");
      } else if (state.activeTool === "edit") {
        if (state.activePageId) openPageEditor(state.activePageId);
        showToast("Edit directly on the full page in the center.");
      }

      renderInspector();
      updateToolbarState();
    });
  });

  $$(".view-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      $(".view-button").forEach((item) => item.classList.toggle("is-active", item === button));
      renderPages();
    });
  });

  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    state.dragCounter++;
    els.dropOverlay.classList.add("is-visible");
    els.dropOverlay.setAttribute("aria-hidden", "false");
  });

  window.addEventListener("dragover", (event) => {
    if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
    state.dragCounter = Math.max(0, state.dragCounter - 1);
    if (!state.dragCounter) {
      els.dropOverlay.classList.remove("is-visible");
      els.dropOverlay.setAttribute("aria-hidden", "true");
    }
  });

  window.addEventListener("drop", (event) => {
    if (!event.dataTransfer || !event.dataTransfer.files.length) return;
    event.preventDefault();
    state.dragCounter = 0;
    els.dropOverlay.classList.remove("is-visible");
    els.dropOverlay.setAttribute("aria-hidden", "true");
    addFiles(event.dataTransfer.files);
  });

  window.addEventListener("keydown", (event) => {
    if (document.body.classList.contains("pdf-editor-open")) return;
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const target = event.target;
    const typing =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable);

    if (modifier && key === "o") {
      event.preventDefault();
      openPicker();
      return;
    }

    if (typing) return;

    if (modifier && key === "a" && state.pages.length) {
      event.preventDefault();
      state.pages.forEach((page) => state.selected.add(page.id));
      syncSelectionUI();
      renderInspector();
      return;
    }

    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }

    if (modifier && key === "y") {
      event.preventDefault();
      redo();
      return;
    }

    if ((event.key === "Delete" || event.key === "Backspace") && state.selected.size) {
      event.preventDefault();
      deleteSelected();
      return;
    }

    if (event.key === "Escape") {
      if (state.selected.size) {
        state.selected.clear();
        state.lastSelectedId = null;
        syncSelectionUI();
        renderInspector();
      } else if (state.activeTool) {
        state.activeTool = null;
        renderInspector();
        updateToolbarState();
      }
    }
  });

  render();
})();