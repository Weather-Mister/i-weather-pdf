(() => {
  const ENGINE_URL = "https://cdn.jsdelivr.net/npm/omni-doc-viewer@0.1.3/+esm";
  let enginePromise = null;
  let active = null;

  function ensureEngine() {
    if (!enginePromise) {
      enginePromise = import(ENGINE_URL).catch((error) => {
        enginePromise = null;
        throw error;
      });
    }
    return enginePromise;
  }

  function isPptx(file) {
    return !!file && (
      file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      /\.pptx$/i.test(file.name)
    );
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

  function updateControls(state) {
    if (!active || !state) return;
    active.pageInput.value = String(state.page || 1);
    active.pageInput.max = String(state.pageCount || 1);
    active.pageTotal.textContent = "/ " + (state.pageCount || 1);
    active.prev.disabled = state.status !== "loaded" || state.page <= 1;
    active.next.disabled = state.status !== "loaded" || state.page >= state.pageCount;
    active.zoomOut.disabled = state.status !== "loaded";
    active.zoomIn.disabled = state.status !== "loaded";
    active.fit.disabled = state.status !== "loaded";
    active.viewMode.disabled = state.status !== "loaded";
    active.download.disabled = state.status !== "loaded";
    active.zoomLabel.textContent = Math.round((state.zoom || 1) * 100) + "%";
    active.viewMode.classList.toggle("is-active", state.viewMode === "continuous");
    active.viewMode.title = state.viewMode === "continuous" ? "Switch to single-slide view" : "Switch to continuous view";

    if (state.status === "loading") {
      active.status.textContent = "Loading presentation…";
      active.shell.classList.add("is-loading");
    } else if (state.status === "loaded") {
      active.shell.classList.remove("is-loading");
      active.status.textContent = (state.pageCount || 1) + " slide" + ((state.pageCount || 1) === 1 ? "" : "s");
    } else if (state.status === "error") {
      active.shell.classList.remove("is-loading");
      active.status.textContent = state.error?.message || "Could not open presentation.";
    }
  }

  function showEmpty() {
    if (!active) return;
    active.stage.classList.add("is-empty");
    active.drop.hidden = false;
    active.viewerHost.replaceChildren();
    active.toolbar.hidden = true;
    active.filename.textContent = "PPTX Viewer";
    active.filemeta.textContent = "Open a PowerPoint file from this device";
    active.status.textContent = "Ready";
  }

  async function loadFile(file) {
    if (!active || active.busy) return;
    if (!isPptx(file)) {
      active.status.textContent = "Choose a .pptx PowerPoint file.";
      return;
    }

    active.busy = true;
    active.shell.classList.add("is-loading");
    active.drop.hidden = true;
    active.stage.classList.remove("is-empty");
    active.toolbar.hidden = false;
    active.filename.textContent = file.name;
    active.filemeta.textContent = formatBytes(file.size) + " · local only";
    active.status.textContent = "Loading viewer…";

    try {
      const mod = await ensureEngine();
      if (!active) return;

      if (active.unsubscribe) active.unsubscribe();
      if (active.controller) active.controller.destroy();
      active.viewerHost.replaceChildren();

      const controller = mod.createViewer({
        host: active.viewerHost,
        scrollElement: active.stage,
        type: "pptx",
        pagination: true,
        initialViewMode: "paged",
        initialZoom: "auto",
        gestures: true,
        minZoom: 0.35,
        maxZoom: 3,
        zoomStep: 0.15,
        theme: "light",
        onWarning: (warning) => {
          console.warn("PPTX viewer warning:", warning);
        },
        onError: (error) => {
          console.error(error);
          if (active) active.status.textContent = error.message || "Could not open presentation.";
        }
      });

      active.controller = controller;
      active.unsubscribe = controller.subscribe(updateControls);
      active.file = file;
      updateControls(controller.getState());

      await controller.load(file, { type: "pptx" });
      if (!active || active.controller !== controller) {
        controller.destroy();
        return;
      }

      controller.fitPage();
      updateControls(controller.getState());
      active.status.textContent = controller.getPageCount() + " slide" + (controller.getPageCount() === 1 ? "" : "s");
    } catch (error) {
      console.error(error);
      if (active) {
        active.status.textContent = error?.message || "Could not open this PPTX.";
        active.drop.hidden = false;
        active.stage.classList.add("is-empty");
        active.toolbar.hidden = true;
      }
    } finally {
      if (active) {
        active.busy = false;
        active.shell.classList.remove("is-loading");
        active.input.value = "";
      }
    }
  }

  function openPicker() {
    if (active && !active.busy) active.input.click();
  }

  function close() {
    if (!active || active.busy) return;
    if (active.unsubscribe) active.unsubscribe();
    if (active.controller) active.controller.destroy();
    window.removeEventListener("keydown", onKeyDown, true);
    active.root.remove();
    active = null;
    document.body.classList.remove("pptx-viewer-open");
  }

  function onKeyDown(event) {
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;

    if ((event.ctrlKey || event.metaKey) && event.key === "o") {
      event.preventDefault();
      event.stopPropagation();
      openPicker();
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      active.controller?.zoomIn();
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      active.controller?.zoomOut();
      return;
    }

    if (active.controller && active.controller.handleKeyDown(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function open() {
    if (active) return;

    const root = document.createElement("div");
    root.className = "pptx-viewer-backdrop";
    root.innerHTML = [
      '<section class="pptx-viewer-shell" role="dialog" aria-modal="true" aria-label="PowerPoint viewer">',
      '<header class="pptx-viewer-header">',
      '<div class="pptx-viewer-file"><strong class="pptx-viewer-filename">PPTX Viewer</strong><span class="pptx-viewer-filemeta">Open a PowerPoint file from this device</span></div>',
      '<div class="pptx-viewer-header-actions">',
      '<button type="button" class="pptx-viewer-open-file"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z"/><path d="M12 13v4M10 15h4"/></svg><span>Open PPTX</span></button>',
      '<button type="button" class="pptx-viewer-close" aria-label="Close viewer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>',
      '</div></header>',
      '<div class="pptx-viewer-toolbar" hidden>',
      '<div class="pptx-viewer-nav">',
      '<button type="button" class="pptx-prev" aria-label="Previous slide"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>',
      '<input class="pptx-page-input" type="number" min="1" value="1" inputmode="numeric" aria-label="Slide number">',
      '<span class="pptx-page-total">/ 1</span>',
      '<button type="button" class="pptx-next" aria-label="Next slide"><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>',
      '</div>',
      '<div class="pptx-viewer-zoom">',
      '<button type="button" class="pptx-zoom-out" aria-label="Zoom out"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>',
      '<span class="pptx-zoom-label">100%</span>',
      '<button type="button" class="pptx-zoom-in" aria-label="Zoom in"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button>',
      '<button type="button" class="pptx-fit" title="Fit slide"><svg viewBox="0 0 24 24"><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"/></svg><span>Fit</span></button>',
      '<button type="button" class="pptx-view-mode" title="Continuous view"><svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="7" rx="1"/><rect x="5" y="14" width="14" height="7" rx="1"/></svg><span>Scroll</span></button>',
      '<button type="button" class="pptx-download" title="Download original"><svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 20h14"/></svg><span>Download</span></button>',
      '</div></div>',
      '<main class="pptx-viewer-stage is-empty">',
      '<div class="pptx-viewer-drop">',
      '<div class="pptx-viewer-drop-icon"><svg viewBox="0 0 32 32"><path d="M7 4h12l6 6v18H7z"/><path d="M19 4v7h6"/><path d="M11 16h10M11 21h7"/></svg></div>',
      '<h2>Open a PowerPoint</h2><p>View PPTX files directly in your browser. Your presentation stays on this device.</p>',
      '<button type="button" class="pptx-viewer-choose">Choose PPTX</button><span>or drag a .pptx file here</span>',
      '</div>',
      '<div class="pptx-viewer-host"></div>',
      '</main>',
      '<footer class="pptx-viewer-statusbar"><span><i></i>Local-only viewer</span><span class="pptx-viewer-status">Ready</span></footer>',
      '<input class="pptx-viewer-input" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden>',
      '</section>'
    ].join("");

    document.body.append(root);
    document.body.classList.add("pptx-viewer-open");

    const shell = root.querySelector(".pptx-viewer-shell");
    const stage = root.querySelector(".pptx-viewer-stage");
    const input = root.querySelector(".pptx-viewer-input");
    const drop = root.querySelector(".pptx-viewer-drop");
    const toolbar = root.querySelector(".pptx-viewer-toolbar");

    active = {
      root,
      shell,
      stage,
      input,
      drop,
      toolbar,
      viewerHost: root.querySelector(".pptx-viewer-host"),
      filename: root.querySelector(".pptx-viewer-filename"),
      filemeta: root.querySelector(".pptx-viewer-filemeta"),
      status: root.querySelector(".pptx-viewer-status"),
      prev: root.querySelector(".pptx-prev"),
      next: root.querySelector(".pptx-next"),
      pageInput: root.querySelector(".pptx-page-input"),
      pageTotal: root.querySelector(".pptx-page-total"),
      zoomOut: root.querySelector(".pptx-zoom-out"),
      zoomIn: root.querySelector(".pptx-zoom-in"),
      zoomLabel: root.querySelector(".pptx-zoom-label"),
      fit: root.querySelector(".pptx-fit"),
      viewMode: root.querySelector(".pptx-view-mode"),
      download: root.querySelector(".pptx-download"),
      controller: null,
      unsubscribe: null,
      file: null,
      busy: false
    };

    root.querySelector(".pptx-viewer-close").addEventListener("click", close);
    root.querySelector(".pptx-viewer-open-file").addEventListener("click", openPicker);
    root.querySelector(".pptx-viewer-choose").addEventListener("click", openPicker);
    input.addEventListener("change", () => {
      if (input.files && input.files[0]) loadFile(input.files[0]);
    });

    active.prev.addEventListener("click", () => active.controller?.prevPage());
    active.next.addEventListener("click", () => active.controller?.nextPage());
    active.pageInput.addEventListener("change", () => {
      const page = Number(active.pageInput.value);
      if (Number.isFinite(page)) active.controller?.goToPage(page);
    });
    active.zoomOut.addEventListener("click", () => active.controller?.zoomOut());
    active.zoomIn.addEventListener("click", () => active.controller?.zoomIn());
    active.fit.addEventListener("click", () => active.controller?.fitPage());
    active.viewMode.addEventListener("click", () => active.controller?.toggleViewMode());
    active.download.addEventListener("click", () => {
      if (active.controller && active.file) active.controller.download(active.file.name);
    });

    ["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
      stage.addEventListener(name, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    stage.addEventListener("dragenter", () => stage.classList.add("is-dragging"));
    stage.addEventListener("dragover", () => stage.classList.add("is-dragging"));
    stage.addEventListener("dragleave", (event) => {
      if (!stage.contains(event.relatedTarget)) stage.classList.remove("is-dragging");
    });
    stage.addEventListener("drop", (event) => {
      stage.classList.remove("is-dragging");
      const file = [...event.dataTransfer.files].find(isPptx);
      if (file) loadFile(file);
      else active.status.textContent = "Drop a .pptx PowerPoint file.";
    });

    window.addEventListener("keydown", onKeyDown, true);
    showEmpty();
    requestAnimationFrame(() => root.querySelector(".pptx-viewer-choose").focus());
  }

  window.iWeatherPPTXViewer = { open, close };
})();