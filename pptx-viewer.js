(() => {
  const ENGINE_URL = "https://esm.sh/pptx-preview@1.0.7?bundle&target=es2020";
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

  function downloadOriginal() {
    if (!active?.file) return;
    const url = URL.createObjectURL(active.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = active.file.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 12000);
  }

  async function renderFile(file) {
    if (!active || active.busy) return;
    if (!isPptx(file)) {
      active.status.textContent = "Choose a .pptx PowerPoint file.";
      return;
    }

    active.busy = true;
    active.shell.classList.add("is-loading");
    active.drop.hidden = true;
    active.stage.classList.remove("is-empty");
    active.filename.textContent = file.name;
    active.filemeta.textContent = formatBytes(file.size) + " · local only";
    active.status.textContent = "Loading PowerPoint renderer…";
    active.download.disabled = true;

    try {
      const mod = await ensureEngine();
      if (!active) return;

      const buffer = await file.arrayBuffer();
      if (!active) return;

      active.host.replaceChildren();

      const width = Math.max(
        320,
        Math.min(1280, active.stage.clientWidth - 24 || window.innerWidth - 24)
      );
      const height = Math.max(
        300,
        active.stage.clientHeight - 24 || window.innerHeight - 120
      );

      active.status.textContent = "Rendering presentation…";
      const previewer = mod.init(active.host, { width, height });
      active.previewer = previewer;
      active.file = file;

      await previewer.preview(buffer);
      if (!active || active.previewer !== previewer) return;

      active.status.textContent = "Presentation ready";
      active.download.disabled = false;
    } catch (error) {
      console.error(error);
      if (active) {
        active.status.textContent = error?.message || "Could not open this PPTX.";
        active.host.replaceChildren();
        active.drop.hidden = false;
        active.stage.classList.add("is-empty");
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
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
      event.preventDefault();
      event.stopPropagation();
      openPicker();
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
      '<button type="button" class="pptx-viewer-download" disabled><svg viewBox="0 0 24 24"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 20h14"/></svg><span>Download</span></button>',
      '<button type="button" class="pptx-viewer-open-file"><svg viewBox="0 0 24 24"><path d="M4 7h6l2 2h8v10H4z"/><path d="M12 13v4M10 15h4"/></svg><span>Open PPTX</span></button>',
      '<button type="button" class="pptx-viewer-close" aria-label="Close viewer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>',
      '</div></header>',
      '<main class="pptx-viewer-stage is-empty">',
      '<div class="pptx-viewer-drop">',
      '<div class="pptx-viewer-drop-icon"><svg viewBox="0 0 32 32"><path d="M7 4h12l6 6v18H7z"/><path d="M19 4v7h6"/><path d="M11 16h10M11 21h7"/></svg></div>',
      '<h2>Open a PowerPoint</h2>',
      '<p>View PPTX files directly in your browser. The file stays on this device.</p>',
      '<button type="button" class="pptx-viewer-choose">Choose PPTX</button>',
      '<span>or drag a .pptx file here</span>',
      '</div>',
      '<div class="pptx-viewer-host"></div>',
      '</main>',
      '<footer class="pptx-viewer-statusbar"><span><i></i>Local-only viewer</span><span class="pptx-viewer-status">Ready</span></footer>',
      '<input class="pptx-viewer-input" type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden>',
      '</section>'
    ].join("");

    document.body.append(root);
    document.body.classList.add("pptx-viewer-open");

    const stage = root.querySelector(".pptx-viewer-stage");
    const input = root.querySelector(".pptx-viewer-input");

    active = {
      root,
      shell: root.querySelector(".pptx-viewer-shell"),
      stage,
      input,
      drop: root.querySelector(".pptx-viewer-drop"),
      host: root.querySelector(".pptx-viewer-host"),
      filename: root.querySelector(".pptx-viewer-filename"),
      filemeta: root.querySelector(".pptx-viewer-filemeta"),
      status: root.querySelector(".pptx-viewer-status"),
      download: root.querySelector(".pptx-viewer-download"),
      previewer: null,
      file: null,
      busy: false
    };

    root.querySelector(".pptx-viewer-close").addEventListener("click", close);
    root.querySelector(".pptx-viewer-open-file").addEventListener("click", openPicker);
    root.querySelector(".pptx-viewer-choose").addEventListener("click", openPicker);
    active.download.addEventListener("click", downloadOriginal);

    input.addEventListener("change", () => {
      if (input.files && input.files[0]) renderFile(input.files[0]);
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
      if (file) renderFile(file);
      else active.status.textContent = "Drop a .pptx PowerPoint file.";
    });

    window.addEventListener("keydown", onKeyDown, true);
    requestAnimationFrame(() => root.querySelector(".pptx-viewer-choose").focus());
  }

  window.iWeatherPPTXViewer = { open, close };
})();