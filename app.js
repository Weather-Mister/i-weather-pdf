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
    activePageId: null,
    dragCounter: 0,
    loadingFiles: false,
    exporting: false,
    viewerPromise: null,
    exportPromise: null,
    editorPromise: null,
    pptxViewerPromise: null,
    sidebarObserver: null,
    history: { undo: [], redo: [] },
    pageClipboard: [],
    ignoreClick: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const els = {
    fileInput: $("#fileInput"),
    chooseButton: $("#chooseButton"),
    addButton: $("#addButton"),
    pptxViewerButton: $("#pptxViewerButton"),
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
    rotateLeftButton: $("#rotateLeftButton"),
    rotateRightButton: $("#rotateRightButton"),
    newPageButton: $("#newPageButton"),
    duplicateButton: $("#duplicateButton"),
    selectAllButton: $("#selectAllButton"),
    deletePageButton: $("#deletePageButton"),
    extractButton: $("#extractButton"),
    exportButton: $("#exportButton"),
    undoButton: $("#undoButton"),
    redoButton: $("#redoButton"),
    toast: $("#toast")
  };

  if (els.sidebarPages) els.sidebarPages.className = "sidebar-pages";

  let toastTimer;
  let pointerDrag = null;
  const textRunCache = new Map();
  const imageRunCache = new Map();

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeRotation(value) {
    return ((value % 360) + 360) % 360;
  }

  function deepClone(value) {
    if (Array.isArray(value)) return value.map(deepClone);
    if (value && typeof value === "object") {
      const result = {};
      for (const key of Object.keys(value)) result[key] = deepClone(value[key]);
      return result;
    }
    return value;
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

  function ensureViewerEngine() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return Promise.resolve(true);
    }
    if (state.viewerPromise) return state.viewerPromise;

    setStatus("Loading PDF viewer…");
    state.viewerPromise = loadScript(PDFJS_URL, "pdfjsLib")
      .then(() => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        return true;
      })
      .catch((error) => {
        state.viewerPromise = null;
        throw error;
      });
    return state.viewerPromise;
  }

  function ensureExportEngine() {
    if (window.PDFLib) return Promise.resolve(true);
    if (state.exportPromise) return state.exportPromise;

    state.exportPromise = ensureViewerEngine()
      .then(() => loadScript(PDFLIB_URL, "PDFLib"))
      .then(() => true)
      .catch((error) => {
        state.exportPromise = null;
        throw error;
      });
    return state.exportPromise;
  }

  function ensureEditor() {
    if (window.iWeatherPDFEditor) return Promise.resolve(window.iWeatherPDFEditor);
    if (state.editorPromise) return state.editorPromise;

    if (!document.querySelector('link[data-pdf-editor-css]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./editor.css?v=16";
      link.dataset.pdfEditorCss = "true";
      document.head.appendChild(link);
    }

    state.editorPromise = loadScript("./editor.js?v=15", "iWeatherPDFEditor")
      .then(() => window.iWeatherPDFEditor)
      .catch((error) => {
        state.editorPromise = null;
        throw error;
      });

    return state.editorPromise;
  }


  function ensurePptxViewer() {
    if (window.iWeatherPPTXViewer) return Promise.resolve(window.iWeatherPPTXViewer);
    if (state.pptxViewerPromise) return state.pptxViewerPromise;

    if (!document.querySelector('link[data-pptx-viewer-css]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./pptx-viewer.css?v=1";
      link.dataset.pptxViewerCss = "true";
      document.head.appendChild(link);
    }

    state.pptxViewerPromise = loadScript("./pptx-viewer.js?v=1", "iWeatherPPTXViewer")
      .then(() => window.iWeatherPPTXViewer)
      .catch((error) => {
        state.pptxViewerPromise = null;
        throw error;
      });

    return state.pptxViewerPromise;
  }

  function getDocumentById(id) {
    return state.documents.find((doc) => doc.id === id);
  }

  function getPageById(id) {
    return state.pages.find((page) => page.id === id);
  }

  function clonePages() {
    return state.pages.map((page) => ({ ...page }));
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
    if (state.history.undo.length > 30) state.history.undo.shift();
    state.history.redo = [];
    updateHistoryButtons();
  }

  function clearHistory() {
    state.history.undo = [];
    state.history.redo = [];
    updateHistoryButtons();
  }

  function undo() {
    saveCurrentEditor();
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
    saveCurrentEditor();
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
    const selectedCount = state.selected.size;
    const hasSelection = selectedCount > 0;
    const allSelected = hasPages && selectedCount === state.pages.length;

    if (els.newPageButton) els.newPageButton.disabled = state.exporting;
    if (els.rotateLeftButton) els.rotateLeftButton.disabled = !hasSelection;
    if (els.rotateRightButton) els.rotateRightButton.disabled = !hasSelection;
    if (els.duplicateButton) els.duplicateButton.disabled = !hasSelection;

    els.selectAllButton.disabled = !hasPages;
    els.selectAllButton.classList.toggle("is-active", allSelected);
    els.selectAllButton.title = allSelected ? "Clear selection" : "Select all pages";
    els.selectAllButton.setAttribute("aria-label", allSelected ? "Clear selection" : "Select all pages");

    els.deletePageButton.disabled = !hasSelection;
    if (els.extractButton) els.extractButton.disabled = !hasSelection || state.exporting;

    setExportLabel("Export");
    els.exportButton.disabled = !hasPages || state.exporting;

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
      name.textContent = doc.label || doc.name;

      const meta = document.createElement("span");
      meta.className = "document-size";
      meta.textContent = doc.pageCount + "p · " + formatBytes(doc.size);

      const remove = document.createElement("button");
      remove.className = "document-remove";
      remove.type = "button";
      remove.setAttribute("aria-label", "Remove " + (doc.label || doc.name));
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

  function makeDocumentLabel(name) {
    const used = new Set(
      state.documents
        .filter((doc) => doc.name === name)
        .map((doc) => doc.label || doc.name)
    );
    if (!used.has(name)) return name;

    let copyNumber = 2;
    let label = name + " · copy " + copyNumber;
    while (used.has(label)) {
      copyNumber++;
      label = name + " · copy " + copyNumber;
    }
    return label;
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
      label: makeDocumentLabel(file.name),
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
      els.fileInput.value = "";
      return;
    }

    state.loadingFiles = true;
    clearHistory();
    setStatus("Preparing " + pdfs.length + " PDF" + (pdfs.length === 1 ? "" : "s") + "…");

    try {
      await ensureViewerEngine();
      let added = 0;

      for (const file of pdfs) {
        setStatus("Reading " + file.name + "…");
        try {
          await loadOnePdf(file);
          added++;
        } catch (error) {
          console.error(error);
          showToast("Could not open " + file.name, 2600);
        }
      }

      if (added) {
        if (!state.activePageId && state.pages.length) state.activePageId = state.pages[0].id;
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
      setStatus("PDF viewer failed to load");
      showToast("Could not load the PDF viewer. Check your connection.", 3200);
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

    if (removedPageIds.includes(state.activePageId)) {
      if (window.iWeatherPDFEditor && typeof window.iWeatherPDFEditor.close === "function") {
        window.iWeatherPDFEditor.close(false);
      }
      state.activePageId = null;
    } else {
      saveCurrentEditor();
    }

    state.documents = state.documents.filter((item) => item.id !== id);
    state.pages = state.pages.filter((page) => page.docId !== id);
    removedPageIds.forEach((pageId) => {
      delete state.annotations[pageId];
      textRunCache.delete(pageId);
      imageRunCache.delete(pageId);
    });

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
    showToast((doc.label || doc.name) + " removed");
  }

  function render() {
    const hasDocs = state.documents.length > 0 || state.pages.length > 0;
    els.documentStrip.hidden = !hasDocs;
    els.emptyState.hidden = hasDocs;
    els.loadedState.hidden = !hasDocs;

    if (!hasDocs) {
      if (state.sidebarObserver) {
        state.sidebarObserver.disconnect();
        state.sidebarObserver = null;
      }
      if (window.iWeatherPDFEditor && typeof window.iWeatherPDFEditor.close === "function") {
        window.iWeatherPDFEditor.close(false);
      }
      state.selected.clear();
      state.activeTool = null;
      state.activePageId = null;
      els.documentList.replaceChildren();
      if (els.sidebarPages) els.sidebarPages.replaceChildren();
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

    const activeIndex = state.activePageId
      ? state.pages.findIndex((page) => page.id === state.activePageId)
      : -1;
    els.workspaceTitle.textContent =
      activeIndex >= 0
        ? "Page " + (activeIndex + 1) + " of " + state.pages.length
        : state.pages.length + " pages";
    els.workspaceMeta.textContent =
      count === 1
        ? (state.documents[0].label || state.documents[0].name)
        : count + " PDFs · " + formatBytes(state.documents.reduce((sum, doc) => sum + doc.size, 0));
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

  async function renderPageCanvas(canvas) {
    const model = getPageById(canvas.dataset.pageId);
    if (!model || !canvas.isConnected) return;
    if (canvas.dataset.rendered === "true" || canvas.dataset.rendering === "true") return;

    if (model.blank) {
      canvas.dataset.rendering = "true";
      const parentWidth = Math.max(56, Math.min(canvas.parentElement.clientWidth || 110, 160));
      const baseW = Math.max(1, model.width || 612);
      const baseH = Math.max(1, model.height || 792);
      const rotated = normalizeRotation(model.rotation || 0) % 180;
      const displayW = rotated ? baseH : baseW;
      const displayH = rotated ? baseW : baseH;
      const cssW = parentWidth;
      const cssH = Math.max(1, Math.round(parentWidth * displayH / displayW));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.rendering = "false";
      canvas.dataset.rendered = "true";
      if (canvas.parentElement) canvas.parentElement.classList.add("is-rendered");
      return;
    }

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
    }
  }

  function syncSelectionUI() {
    $$(".sidebar-page-row").forEach((row) => {
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
      thumb.addEventListener("pointerdown", (event) => {
        startPointerReorder(event, page.id, thumb, true);
      });
      thumb.addEventListener("click", (event) => event.stopPropagation());

      const info = document.createElement("span");
      info.className = "sidebar-page-info";

      const title = document.createElement("strong");
      title.textContent = "Page " + (index + 1);

      const source = document.createElement("span");
      source.textContent = page.blank
        ? "Blank page" + (editCount(page.id) ? " · " + editCount(page.id) + " edits" : "")
        : (doc ? (doc.label || doc.name) : "PDF") +
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

  function updateSidebarEditMeta(pageId) {
    const row = els.sidebarPages && els.sidebarPages.querySelector(
      '.sidebar-page-row[data-page-id="' + pageId + '"]'
    );
    const page = getPageById(pageId);
    if (!row || !page) return;

    const doc = getDocumentById(page.docId);
    const source = row.querySelector(".sidebar-page-info span");
    if (!source) return;

    source.textContent =
      (doc ? (doc.label || doc.name) : "PDF") +
      " · p" +
      (page.sourceIndex + 1) +
      (editCount(page.id) ? " · " + editCount(page.id) + " edits" : "");
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
    if (!els.inspector || els.inspector.hidden) return;
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
        text.textContent = "Drag page thumbnails in the left sidebar into the order you want.";
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
        (doc ? (doc.label || doc.name) : "PDF") + " · original page " + (selected[0].sourceIndex + 1);
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
      makeInspectorButton("Extract PDF", () => exportPages(selectedPages(), "i-weather-pdf-extract.pdf"))
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

  async function inferNewPageSize() {
    const current = getPageById(state.activePageId);
    if (current) {
      if (current.blank) {
        return {
          width: Math.max(1, current.width || 612),
          height: Math.max(1, current.height || 792)
        };
      }
      const doc = getDocumentById(current.docId);
      if (doc) {
        try {
          const pdfPage = await doc.pdfJs.getPage(current.sourceIndex + 1);
          const viewport = pdfPage.getViewport({ scale: 1, rotation: 0 });
          return { width: viewport.width, height: viewport.height };
        } catch (_) {}
      }
    }
    return { width: 612, height: 792 };
  }

  async function addBlankPage() {
    saveCurrentEditor();
    const size = await inferNewPageSize();
    pushHistory();
    const page = {
      id: uid("page"),
      docId: null,
      sourceIndex: -1,
      rotation: 0,
      blank: true,
      width: size.width,
      height: size.height
    };
    const activeIndex = state.pages.findIndex((item) => item.id === state.activePageId);
    const insertAt = activeIndex >= 0 ? activeIndex + 1 : state.pages.length;
    state.pages.splice(insertAt, 0, page);
    state.activePageId = page.id;
    state.selected.clear();
    state.selected.add(page.id);
    state.lastSelectedId = page.id;
    renderWorkspace();
    showToast("Blank page added");
  }

  function copySelectedPages() {
    saveCurrentEditor();
    const pages = selectedPages();
    if (!pages.length) return false;
    state.pageClipboard = pages.map((page) => ({
      page: deepClone(page),
      annotations: deepClone(state.annotations[page.id] || [])
    }));
    showToast(pages.length + " page" + (pages.length === 1 ? "" : "s") + " copied");
    return true;
  }

  function cutSelectedPages() {
    if (!copySelectedPages()) return false;
    deleteSelected();
    showToast("Page" + (state.pageClipboard.length === 1 ? "" : "s") + " cut");
    return true;
  }

  function pastePages() {
    if (!state.pageClipboard.length) return false;
    saveCurrentEditor();
    pushHistory();

    const activeIndex = state.pages.findIndex((page) => page.id === state.activePageId);
    let insertAt = activeIndex >= 0 ? activeIndex + 1 : state.pages.length;
    const pastedIds = [];

    state.pageClipboard.forEach((entry) => {
      const copy = { ...deepClone(entry.page), id: uid("page") };
      state.pages.splice(insertAt++, 0, copy);
      if (entry.annotations && entry.annotations.length) {
        state.annotations[copy.id] = deepClone(entry.annotations);
      }
      pastedIds.push(copy.id);
    });

    state.selected = new Set(pastedIds);
    state.activePageId = pastedIds[0] || state.activePageId;
    state.lastSelectedId = pastedIds[0] || null;
    renderWorkspace();
    showToast(pastedIds.length + " page" + (pastedIds.length === 1 ? "" : "s") + " pasted");
    return true;
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
          ...page,
          id: uid("page")
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

  function deleteCurrentPage() {
    const pageId = state.activePageId;
    const index = state.pages.findIndex((page) => page.id === pageId);
    if (!pageId || index < 0) return;

    saveCurrentEditor();
    pushHistory();

    state.pages.splice(index, 1);
    delete state.annotations[pageId];
    textRunCache.delete(pageId);
    state.selected.delete(pageId);
    if (state.lastSelectedId === pageId) state.lastSelectedId = null;

    if (state.pages.length) {
      const nextIndex = Math.min(index, state.pages.length - 1);
      state.activePageId = state.pages[nextIndex].id;
      state.selected.clear();
      state.selected.add(state.activePageId);
      state.lastSelectedId = state.activePageId;
    } else {
      state.activePageId = null;
      state.selected.clear();
      state.lastSelectedId = null;
    }

    renderWorkspace();
    setStatus(state.pages.length + " pages ready");
    showToast("Page deleted · Undo available");
  }

  function deleteSelected() {
    if (!state.selected.size) return;
    saveCurrentEditor();

    const count = state.selected.size;
    const removedIds = new Set(state.selected);
    const activeIndex = Math.max(0, state.pages.findIndex((page) => page.id === state.activePageId));

    pushHistory();
    state.pages = state.pages.filter((page) => !removedIds.has(page.id));
    removedIds.forEach((pageId) => {
      delete state.annotations[pageId];
      textRunCache.delete(pageId);
      imageRunCache.delete(pageId);
    });

    state.selected.clear();
    state.lastSelectedId = null;

    if (state.pages.length) {
      const next = state.pages[Math.min(activeIndex, state.pages.length - 1)];
      state.activePageId = next.id;
      state.selected.add(next.id);
      state.lastSelectedId = next.id;
    } else {
      state.activePageId = null;
    }

    renderWorkspace();
    setStatus(state.pages.length + " pages ready");
    showToast(count + " page" + (count === 1 ? "" : "s") + " deleted · Undo available");
  }

  function moveSelected(delta) {
    if (state.selected.size !== 1) return;
    saveCurrentEditor();
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
      const row = els.sidebarPages.querySelector('[data-page-id="' + id + '"]');
      if (row) row.scrollIntoView({ block: "nearest" });
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

  function startPointerReorder(event, pageId, handle, selectOnTap = false) {
    if (pointerDrag) return;
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
      handle,
      selectOnTap
    };

    try {
      handle.setPointerCapture(event.pointerId);
    } catch (_) {}

    const sourceRow = els.sidebarPages.querySelector(
      '.sidebar-page-row[data-page-id="' + pageId + '"]'
    );
    if (sourceRow) sourceRow.classList.add("is-dragging");

    window.addEventListener("pointermove", onPointerReorderMove, { passive: false });
    window.addEventListener("pointerup", onPointerReorderEnd);
    window.addEventListener("pointercancel", onPointerReorderEnd);
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
    event.preventDefault();

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
    window.removeEventListener("pointermove", onPointerReorderMove);
    window.removeEventListener("pointerup", onPointerReorderEnd);
    window.removeEventListener("pointercancel", onPointerReorderEnd);

    if (data.moved && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      const target = element && element.closest ? element.closest(".sidebar-page-row") : null;
      const targetId = target ? target.dataset.pageId : null;
      if (targetId && targetId !== data.pageId) data.targetId = targetId;
    }

    document.querySelectorAll(".sidebar-page-row.is-dragging, .sidebar-page-row.drop-target").forEach((row) => {
      row.classList.remove("is-dragging", "drop-target");
    });

    pointerDrag = null;

    if (data.moved) {
      state.ignoreClick = true;
      setTimeout(() => {
        state.ignoreClick = false;
      }, 0);
    }

    if (!data.moved && data.selectOnTap) {
      selectPage(data.pageId, event);
      return;
    }

    if (data.moved && data.targetId) {
      reorderPage(data.pageId, data.targetId);
    }
  }

  function classifyTextFont(fontName, fontFamily) {
    const rawFamily = String(fontFamily || "").trim();
    const rawName = String(fontName || "").trim();
    const source = (rawName + " " + rawFamily).toLowerCase();
    let family = "sans";
    if (/times|serif|georgia|garamond|cambria/.test(source)) family = "serif";
    else if (/courier|mono|consol|menlo/.test(source)) family = "mono";
    return {
      family,
      fontFamily: rawFamily,
      fontName: rawName,
      bold: /bold|black|heavy|semib|demi/.test(source),
      italic: /italic|oblique/.test(source)
    };
  }

  async function getPageTextRuns(pageId) {
    if (textRunCache.has(pageId)) return deepClone(textRunCache.get(pageId));

    const model = getPageById(pageId);
    if (!model) return [];
    const doc = getDocumentById(model.docId);
    if (!doc) return [];

    const page = await doc.pdfJs.getPage(model.sourceIndex + 1);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    const fragments = [];

    for (const item of content.items || []) {
      if (!item || typeof item.str !== "string" || !item.str.trim()) continue;
      const tx = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
      const size = Math.hypot(tx[2], tx[3]);
      if (!Number.isFinite(size) || size <= 0) continue;

      const style = content.styles && content.styles[item.fontName];
      const x = tx[4];
      const baseline = tx[5];
      const width = Math.abs(item.width) || size * item.str.length * 0.5;

      fragments.push({
        text: item.str,
        x,
        baseline,
        width,
        size,
        font: classifyTextFont(item.fontName, style && style.fontFamily)
      });
    }

    fragments.sort((a, b) => (a.baseline - b.baseline) || (a.x - b.x));
    const lines = [];

    for (const fragment of fragments) {
      const last = lines[lines.length - 1];
      const sameLine =
        last &&
        Math.abs(last.baseline - fragment.baseline) <= Math.max(1.5, fragment.size * 0.25) &&
        fragment.x >= last.x - 1 &&
        fragment.x - (last.x + last.width) < fragment.size * 2.2;

      if (sameLine) {
        const gap = fragment.x - (last.x + last.width);
        if (
          gap > fragment.size * 0.22 &&
          !/\s$/.test(last.text) &&
          !/^\s/.test(fragment.text)
        ) {
          last.text += " ";
        }
        last.text += fragment.text;
        last.width = fragment.x + fragment.width - last.x;
        last.size = Math.max(last.size, fragment.size);
      } else {
        lines.push({
          text: fragment.text,
          x: fragment.x,
          baseline: fragment.baseline,
          width: fragment.width,
          size: fragment.size,
          font: fragment.font
        });
      }
    }

    const counts = new Map();
    for (const line of lines) {
      const key = line.text.trim();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }

    const result = lines
      .filter((line) => line.text.trim() && line.width > 1)
      .map((line, lineIndex) => {
        const y = line.baseline - line.size * 0.82;
        const height = line.size * 1.06;
        const original = line.text;
        return {
          key:
            lineIndex +
            ":" +
            original +
            ":" +
            line.x.toFixed(2) +
            ":" +
            line.baseline.toFixed(2),
          text: original,
          x: line.x / viewport.width,
          y: y / viewport.height,
          w: line.width / viewport.width,
          h: height / viewport.height,
          baseline: line.baseline / viewport.height,
          size: line.size / viewport.height,
          family: line.font.family,
          fontFamily: line.font.fontFamily,
          fontName: line.font.fontName,
          bold: line.font.bold,
          italic: line.font.italic,
          uniqueOriginal: (counts.get(original.trim()) || 0) === 1
        };
      });

    textRunCache.set(pageId, deepClone(result));
    if (textRunCache.size > 80) {
      const oldest = textRunCache.keys().next().value;
      if (oldest) textRunCache.delete(oldest);
    }
    return deepClone(result);
  }

  async function getPageImageRuns(pageId) {
    if (imageRunCache.has(pageId)) return deepClone(imageRunCache.get(pageId));

    const model = getPageById(pageId);
    if (!model) return [];
    const doc = getDocumentById(model.docId);
    if (!doc) return [];

    const page = await doc.pdfJs.getPage(model.sourceIndex + 1);
    if (!page || typeof page.getOperatorList !== "function") return [];

    const opList = await page.getOperatorList();
    const viewport = page.getViewport({ scale: 1, rotation: 0 });
    const OPS = window.pdfjsLib.OPS || {};
    const Util = window.pdfjsLib.Util;
    if (!Util || typeof Util.transform !== "function") return [];

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const result = [];

    function point(matrix, x, y) {
      return {
        x: matrix[0] * x + matrix[2] * y + matrix[4],
        y: matrix[1] * x + matrix[3] * y + matrix[5]
      };
    }

    const imageOps = new Set([
      OPS.paintImageXObject,
      OPS.paintJpegXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject
    ].filter((value) => Number.isFinite(value)));

    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i] || [];

      if (fn === OPS.save) {
        stack.push(ctm.slice());
        continue;
      }
      if (fn === OPS.restore) {
        ctm = stack.length ? stack.pop() : [1, 0, 0, 1, 0, 0];
        continue;
      }
      if (fn === OPS.transform && args.length >= 6) {
        ctm = Util.transform(ctm, args.slice(0, 6));
        continue;
      }
      if (!imageOps.has(fn)) continue;

      const matrix = Util.transform(viewport.transform, ctm);
      const corners = [
        point(matrix, 0, 0),
        point(matrix, 1, 0),
        point(matrix, 0, 1),
        point(matrix, 1, 1)
      ];
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);

      const x = Math.max(0, left / viewport.width);
      const y = Math.max(0, top / viewport.height);
      const w = Math.min(1 - x, Math.abs(right - left) / viewport.width);
      const h = Math.min(1 - y, Math.abs(bottom - top) / viewport.height);

      if (
        !Number.isFinite(x + y + w + h) ||
        w < 0.01 ||
        h < 0.01 ||
        w * h < 0.0003
      ) continue;

      result.push({
        key: "img:" + i,
        x,
        y,
        w,
        h
      });

      if (result.length >= 120) break;
    }

    imageRunCache.set(pageId, deepClone(result));
    if (imageRunCache.size > 80) {
      const oldest = imageRunCache.keys().next().value;
      if (oldest) imageRunCache.delete(oldest);
    }
    return deepClone(result);
  }

  function decodePdfLiteralString(body) {
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const char = body[i];
      if (char !== "\\") {
        out += char;
        continue;
      }

      const next = body[++i];
      if (next === undefined) break;
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === "b") out += "\b";
      else if (next === "f") out += "\f";
      else if (next >= "0" && next <= "7") {
        let octal = next;
        while (
          octal.length < 3 &&
          body[i + 1] >= "0" &&
          body[i + 1] <= "7"
        ) {
          octal += body[++i];
        }
        out += String.fromCharCode(parseInt(octal, 8));
      } else if (next === "\n") {
        // PDF line continuation.
      } else {
        out += next;
      }
    }
    return out;
  }

  function decodePdfHexString(body) {
    const hex = body.replace(/[^0-9a-fA-F]/g, "");
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    if (hex.length % 2) {
      out += String.fromCharCode(parseInt(hex[hex.length - 1] + "0", 16));
    }
    return out;
  }

  function scanPdfStringTokens(source) {
    const tokens = [];

    for (let i = 0; i < source.length; i++) {
      const char = source[i];

      if (char === "%") {
        while (i < source.length && source[i] !== "\n") i++;
        continue;
      }

      if (char === "(") {
        let depth = 1;
        let j = i + 1;
        while (j < source.length && depth > 0) {
          if (source[j] === "\\") {
            j += 2;
            continue;
          }
          if (source[j] === "(") depth++;
          else if (source[j] === ")") depth--;
          j++;
        }
        const body = source.slice(i + 1, j - 1);
        tokens.push({
          start: i,
          end: j,
          kind: "literal",
          text: decodePdfLiteralString(body)
        });
        i = j - 1;
        continue;
      }

      if (char === "<" && source[i + 1] !== "<") {
        const j = source.indexOf(">", i + 1);
        if (j === -1) continue;
        tokens.push({
          start: i,
          end: j + 1,
          kind: "hex",
          text: decodePdfHexString(source.slice(i + 1, j))
        });
        i = j;
        continue;
      }

      if (char === "<" && source[i + 1] === "<") i++;
    }

    return tokens;
  }

  function blankPdfTextInStream(source, target) {
    const wanted = String(target || "").replace(/\s+/g, "");
    if (!wanted) return null;

    const tokens = scanPdfStringTokens(source);
    if (!tokens.length) return null;

    const chars = [];
    tokens.forEach((token, tokenIndex) => {
      for (const char of token.text) {
        if (!/\s/.test(char)) chars.push({ char, tokenIndex });
      }
    });

    const flattened = chars.map((item) => item.char).join("");
    const start = flattened.indexOf(wanted);
    if (start === -1) return null;

    const involved = new Set();
    for (let i = start; i < start + wanted.length; i++) {
      involved.add(chars[i].tokenIndex);
    }

    for (const tokenIndex of involved) {
      const ownedIndexes = [];
      for (let i = 0; i < chars.length; i++) {
        if (chars[i].tokenIndex === tokenIndex) ownedIndexes.push(i);
      }
      if (
        !ownedIndexes.every(
          (charIndex) => charIndex >= start && charIndex < start + wanted.length
        )
      ) {
        return null;
      }
    }

    let rewritten = source;
    [...involved]
      .sort((a, b) => b - a)
      .forEach((tokenIndex) => {
        const token = tokens[tokenIndex];
        rewritten =
          rewritten.slice(0, token.start) +
          (token.kind === "hex" ? "<>" : "()") +
          rewritten.slice(token.end);
      });

    return rewritten;
  }

  function bytesToLatin1(bytes) {
    let result = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      result += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return result;
  }

  function latin1ToBytes(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
    return bytes;
  }

  function stripOriginalText(outputDocument, page, targets) {
    const removed = new Set();
    if (!targets.length) return removed;

    const {
      PDFName,
      PDFArray,
      PDFRawStream,
      decodePDFRawStream
    } = window.PDFLib;

    if (!PDFName || !PDFArray || !PDFRawStream || !decodePDFRawStream) {
      return removed;
    }

    const context = outputDocument.context;
    let contents;

    try {
      contents = page.node.get(PDFName.of("Contents"));
    } catch {
      return removed;
    }

    if (!contents) return removed;
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];

    for (const ref of refs) {
      let stream;
      try {
        stream = context.lookup(ref);
      } catch {
        continue;
      }
      if (!(stream instanceof PDFRawStream)) continue;

      let source;
      try {
        source = bytesToLatin1(decodePDFRawStream(stream).decode());
      } catch {
        continue;
      }

      let changed = false;
      for (const target of targets) {
        if (removed.has(target)) continue;
        const next = blankPdfTextInStream(source, target);
        if (next !== null) {
          source = next;
          changed = true;
          removed.add(target);
        }
      }

      if (!changed) continue;
      const fresh = context.stream(latin1ToBytes(source));
      const freshRef = context.register(fresh);

      if (contents instanceof PDFArray) {
        const refIndex = contents.asArray().indexOf(ref);
        if (refIndex >= 0) contents.set(refIndex, freshRef);
      } else {
        page.node.set(PDFName.of("Contents"), freshRef);
      }
    }

    return removed;
  }

  function pdfRgb(hex) {
    const raw = String(hex || "#111111").replace("#", "");
    const value = parseInt(raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw, 16);
    const safe = Number.isFinite(value) ? value : 0x111111;
    return window.PDFLib.rgb(
      ((safe >> 16) & 255) / 255,
      ((safe >> 8) & 255) / 255,
      (safe & 255) / 255
    );
  }

  function textEditFontName(edit) {
    const requested = String(edit.fontFamily || "").toLowerCase();
    const family =
      /times|georgia|garamond|serif/.test(requested) || edit.family === "serif"
        ? "TimesRoman"
        : /courier|mono/.test(requested) || edit.family === "mono"
          ? "Courier"
          : "Helvetica";

    if (family === "TimesRoman") {
      if (edit.bold && edit.italic) return "TimesRomanBoldItalic";
      if (edit.bold) return "TimesRomanBold";
      if (edit.italic) return "TimesRomanItalic";
      return "TimesRoman";
    }

    if (family === "Courier") {
      if (edit.bold && edit.italic) return "CourierBoldOblique";
      if (edit.bold) return "CourierBold";
      if (edit.italic) return "CourierOblique";
      return "Courier";
    }

    if (edit.bold && edit.italic) return "HelveticaBoldOblique";
    if (edit.bold) return "HelveticaBold";
    if (edit.italic) return "HelveticaOblique";
    return "Helvetica";
  }

  async function applyExistingTextEdits(output, page, crop, edits, stripped) {
    const fallbackIds = new Set();
    const fontCache = new Map();

    async function getFont(edit) {
      const name = textEditFontName(edit);
      if (!fontCache.has(name)) {
        fontCache.set(
          name,
          await output.embedFont(window.PDFLib.StandardFonts[name])
        );
      }
      return fontCache.get(name);
    }

    for (const edit of edits) {
      if (!stripped.has(edit.original)) {
        page.drawRectangle({
          x: crop.x + edit.x * crop.width,
          y: crop.y + crop.height - (edit.y + edit.h) * crop.height,
          width: edit.w * crop.width,
          height: edit.h * crop.height,
          color: pdfRgb(edit.bg || "#ffffff")
        });
      }

      if (!String(edit.text || "").length) continue;

      try {
        const font = await getFont(edit);
        const maxWidth = Math.max(1, edit.w * crop.width);
        const baseSize = Math.max(4, edit.size * crop.height);
        const minSize = Math.max(4, baseSize * 0.6);
        let size = baseSize;

        while (
          !edit.manualSize &&
          size > minSize &&
          font.widthOfTextAtSize(edit.text, size) > maxWidth
        ) {
          size -= Math.max(0.2, size * 0.04);
        }

        page.drawText(edit.text, {
          x: crop.x + edit.x * crop.width,
          y: crop.y + crop.height - edit.baseline * crop.height,
          size: Math.max(minSize, size),
          font,
          color: pdfRgb(edit.color || "#111111")
        });
      } catch (error) {
        console.warn("Vector text replacement fell back to canvas:", error);
        fallbackIds.add(edit.id);
      }
    }

    return fallbackIds;
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
      await ensureExportEngine();
      const sourceDocs = new Map();

      for (const model of pages) {
        if (model.blank) continue;
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
        let copied;

        if (model.blank) {
          copied = output.addPage([
            Math.max(1, model.width || 612),
            Math.max(1, model.height || 792)
          ]);
          copied.setRotation(window.PDFLib.degrees(normalizeRotation(model.rotation || 0)));
        } else {
          const source = sourceDocs.get(model.docId);
          const copiedPages = await output.copyPages(source, [model.sourceIndex]);
          copied = copiedPages[0];

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
        }

        if (editCount(model.id)) {
          const editor = await ensureEditor();
          const crop =
            typeof copied.getCropBox === "function"
              ? copied.getCropBox()
              : { x: 0, y: 0, width: copied.getWidth(), height: copied.getHeight() };
          const pageEdits = state.annotations[model.id] || [];
          const textEdits = pageEdits.filter((edit) => edit.type === "textedit");
          const stripTargets = textEdits
            .filter((edit) => edit.uniqueOriginal)
            .map((edit) => edit.original);
          const stripped = stripOriginalText(output, copied, stripTargets);
          const rasterTextEditIds = await applyExistingTextEdits(
            output,
            copied,
            crop,
            textEdits,
            stripped
          );

          const overlayBytes = await editor.exportOverlay(
            model.id,
            crop.width,
            crop.height,
            {
              strippedOriginals: [...stripped],
              textEditIds: [...rasterTextEditIds]
            }
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
            : "i-weather-pdf-combined.pdf";
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
    if (model.blank) {
      const rotation = normalizeRotation(model.rotation || 0);
      const baseWidth = Math.max(1, model.width || 612);
      const baseHeight = Math.max(1, model.height || 792);
      const rotated = rotation % 180;
      const displayWidth = rotated ? baseHeight : baseWidth;
      const displayHeight = rotated ? baseWidth : baseHeight;
      const cssScale = Math.max(0.12, Math.min(maxWidth / displayWidth, maxHeight / displayHeight, 6));
      const cssWidth = Math.max(1, Math.floor(displayWidth * cssScale));
      const cssHeight = Math.max(1, Math.floor(displayHeight * cssScale));
      const pixelBudgetDpr = Math.sqrt(12000000 / Math.max(1, cssWidth * cssHeight));
      const requestedDpr = Math.max(window.devicePixelRatio || 1, 1.8);
      const dpr = Math.max(0.65, Math.min(requestedDpr, 2.5, pixelBudgetDpr));
      canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
      canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
      canvas.style.width = cssWidth + "px";
      canvas.style.height = cssHeight + "px";
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return { width: cssWidth, height: cssHeight, rotation };
    }

    const doc = getDocumentById(model.docId);
    if (!doc) throw new Error("Document not found");

    const pdfPage = await doc.pdfJs.getPage(model.sourceIndex + 1);
    const rotation = normalizeRotation((pdfPage.rotate || 0) + (model.rotation || 0));
    const base = pdfPage.getViewport({ scale: 1, rotation });
    const cssScale = Math.max(
      0.12,
      Math.min(maxWidth / base.width, maxHeight / base.height, 6)
    );
    const cssViewport = pdfPage.getViewport({ scale: cssScale, rotation });
    const cssWidth = Math.max(1, Math.floor(cssViewport.width));
    const cssHeight = Math.max(1, Math.floor(cssViewport.height));
    const pixelBudgetDpr = Math.sqrt(12000000 / Math.max(1, cssWidth * cssHeight));
    const requestedDpr = Math.max(window.devicePixelRatio || 1, 1.8);
    const dpr = Math.max(0.65, Math.min(requestedDpr, 2.5, pixelBudgetDpr));
    const viewport = pdfPage.getViewport({ scale: cssScale * dpr, rotation });

    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
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

    if (!quiet) {
      renderPages();
      renderSidebar();
    } else {
      updateSidebarEditMeta(pageId);
    }
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
      return doc ? (doc.label || doc.name) : "Blank page";
    },
    getAnnotations,
    getPageTextRuns,
    getPageImageRuns,
    copySelectedPages,
    cutSelectedPages,
    pastePages,
    duplicateSelected,
    addBlankPage,
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

  els.pptxViewerButton.addEventListener("click", async () => {
    els.pptxViewerButton.disabled = true;
    try {
      const viewer = await ensurePptxViewer();
      viewer.open();
    } catch (error) {
      console.error(error);
      showToast("Could not open the PPTX viewer.", 2600);
    } finally {
      els.pptxViewerButton.disabled = false;
    }
  });

  els.fileInput.addEventListener("change", () => addFiles(els.fileInput.files));

  if (els.rotateLeftButton) els.rotateLeftButton.addEventListener("click", () => rotateSelected(-90));
  if (els.rotateRightButton) els.rotateRightButton.addEventListener("click", () => rotateSelected(90));
  if (els.newPageButton) els.newPageButton.addEventListener("click", addBlankPage);
  if (els.duplicateButton) els.duplicateButton.addEventListener("click", duplicateSelected);
  els.selectAllButton.addEventListener("click", selectAll);
  els.deletePageButton.addEventListener("click", deleteSelected);
  if (els.extractButton) {
    els.extractButton.addEventListener("click", () => {
      saveCurrentEditor();
      if (!state.selected.size) return;
      exportPages(selectedPages(), state.selected.size === 1 ? "i-weather-pdf-page.pdf" : "i-weather-pdf-extract.pdf");
    });
  }
  els.exportButton.addEventListener("click", () => {
    saveCurrentEditor();
    exportPages(state.pages, null);
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

  window.addEventListener("dragenter", (event) => {
    if (
      document.body.classList.contains("pptx-viewer-open")
    ) return;
    if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    state.dragCounter++;
    els.dropOverlay.classList.add("is-visible");
    els.dropOverlay.setAttribute("aria-hidden", "false");
  });

  window.addEventListener("dragover", (event) => {
    if (
      document.body.classList.contains("pptx-viewer-open")
    ) return;
    if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (
      document.body.classList.contains("pptx-viewer-open")
    ) return;
    if (!event.dataTransfer || !event.dataTransfer.types.includes("Files")) return;
    state.dragCounter = Math.max(0, state.dragCounter - 1);
    if (!state.dragCounter) {
      els.dropOverlay.classList.remove("is-visible");
      els.dropOverlay.setAttribute("aria-hidden", "true");
    }
  });

  window.addEventListener("drop", (event) => {
    if (
      document.body.classList.contains("pptx-viewer-open")
    ) return;
    if (!event.dataTransfer || !event.dataTransfer.files.length) return;
    event.preventDefault();
    state.dragCounter = 0;
    els.dropOverlay.classList.remove("is-visible");
    els.dropOverlay.setAttribute("aria-hidden", "true");
    addFiles(event.dataTransfer.files);
  });

  window.addEventListener("keydown", (event) => {
    if (
      document.body.classList.contains("pdf-editor-open") ||
      document.body.classList.contains("pptx-viewer-open")
    ) return;
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

    if (event.key === "Insert") {
      event.preventDefault();
      addBlankPage();
      return;
    }

    if (modifier && key === "c" && state.selected.size) {
      event.preventDefault();
      copySelectedPages();
      return;
    }

    if (modifier && key === "x" && state.selected.size) {
      event.preventDefault();
      cutSelectedPages();
      return;
    }

    if (modifier && key === "v" && state.pageClipboard.length) {
      event.preventDefault();
      pastePages();
      return;
    }

    if (modifier && key === "d" && state.selected.size) {
      event.preventDefault();
      duplicateSelected();
      return;
    }

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