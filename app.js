(() => {
  const state = {
    documents: [],
    activeTool: null,
    dragCounter: 0
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
    toast: $("#toast")
  };

  let toastTimer;

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 1800);
  }

  function isPdf(file) {
    return file && (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
  }

  function makeId() {
    return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addFiles(fileList) {
    const incoming = [...fileList];
    const pdfs = incoming.filter(isPdf);
    const rejected = incoming.length - pdfs.length;

    if (!pdfs.length) {
      if (rejected) showToast("Only PDF files can be added.");
      return;
    }

    const existingKeys = new Set(state.documents.map(d => `${d.name}:${d.size}:${d.lastModified}`));
    let added = 0;

    for (const file of pdfs) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (existingKeys.has(key)) continue;
      state.documents.push({
        id: makeId(),
        file,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified
      });
      existingKeys.add(key);
      added++;
    }

    render();
    els.fileInput.value = "";

    if (added) {
      els.statusText.textContent = `${added} PDF${added === 1 ? "" : "s"} added`;
      showToast(`${added} PDF${added === 1 ? "" : "s"} added locally`);
    } else {
      showToast("Those PDFs are already in the workspace.");
    }

    if (rejected) {
      setTimeout(() => showToast(`${rejected} non-PDF file${rejected === 1 ? "" : "s"} skipped`), 350);
    }
  }

  function removeDocument(id) {
    const doc = state.documents.find(d => d.id === id);
    state.documents = state.documents.filter(d => d.id !== id);
    render();
    els.statusText.textContent = state.documents.length ? "Workspace updated" : "Ready";
    if (doc) showToast(`${doc.name} removed`);
  }

  function reorderDocument(sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = state.documents.findIndex(d => d.id === sourceId);
    const targetIndex = state.documents.findIndex(d => d.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = state.documents.splice(sourceIndex, 1);
    state.documents.splice(targetIndex, 0, moved);
    renderDocuments();
    els.statusText.textContent = "Document order changed";
  }

  function renderDocuments() {
    els.documentList.replaceChildren();

    state.documents.forEach((doc, index) => {
      const chip = document.createElement("div");
      chip.className = "document-chip";
      chip.draggable = true;
      chip.dataset.id = doc.id;
      chip.title = "Drag to reorder imported documents";

      const dot = document.createElement("span");
      dot.className = "document-dot";
      dot.style.opacity = String(Math.max(.55, 1 - index * .08));

      const info = document.createElement("div");
      info.className = "document-info";

      const name = document.createElement("span");
      name.className = "document-name";
      name.textContent = doc.name;

      const size = document.createElement("span");
      size.className = "document-size";
      size.textContent = formatBytes(doc.size);

      const remove = document.createElement("button");
      remove.className = "document-remove";
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${doc.name}`);
      remove.title = "Remove";
      remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        removeDocument(doc.id);
      });

      info.append(name, size);
      chip.append(dot, info, remove);

      chip.addEventListener("dragstart", (event) => {
        chip.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", doc.id);
      });
      chip.addEventListener("dragend", () => chip.classList.remove("is-dragging"));
      chip.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      });
      chip.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        reorderDocument(event.dataTransfer.getData("text/plain"), doc.id);
      });

      els.documentList.append(chip);
    });
  }

  function render() {
    const hasDocs = state.documents.length > 0;
    els.documentStrip.hidden = !hasDocs;
    els.emptyState.hidden = hasDocs;
    els.loadedState.hidden = !hasDocs;

    $$(".tool-button").forEach(button => {
      button.disabled = !hasDocs;
      if (!hasDocs) button.classList.remove("is-active");
    });

    $("#selectAllButton").disabled = true;
    $("#exportButton").disabled = true;

    if (hasDocs) {
      renderDocuments();
      const count = state.documents.length;
      els.workspaceTitle.textContent = count === 1 ? state.documents[0].name : `${count} PDFs in workspace`;
      els.workspaceMeta.textContent = `${state.documents.map(d => formatBytes(d.size)).join(" + ")} · local only`;
      els.pageCount.textContent = "—";
    } else {
      state.activeTool = null;
      els.documentList.replaceChildren();
      els.workspaceTitle.textContent = "Workspace";
      els.workspaceMeta.textContent = "PDFs loaded locally";
      els.pageCount.textContent = "0";
    }
  }

  function openPicker() {
    els.fileInput.click();
  }

  [els.chooseButton, els.addButton, els.stripAddButton, els.addMoreButton]
    .filter(Boolean)
    .forEach(button => button.addEventListener("click", openPicker));

  els.fileInput.addEventListener("change", () => addFiles(els.fileInput.files));

  $$(".tool-button").forEach(button => {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      state.activeTool = state.activeTool === tool ? null : tool;
      $$(".tool-button").forEach(b => b.classList.toggle("is-active", b.dataset.tool === state.activeTool));
      const labels = {
        split: "Split mode is ready for the page engine.",
        combine: "Add multiple PDFs and their pages will share one workspace.",
        reorder: "Page drag-and-drop will live directly in the canvas.",
        edit: "Free editing controls will open in the inspector."
      };
      showToast(labels[tool]);
    });
  });

  $$(".view-button").forEach(button => {
    button.addEventListener("click", () => {
      $$(".view-button").forEach(b => b.classList.toggle("is-active", b === button));
      showToast(`${button.dataset.view === "grid" ? "Grid" : "List"} page view selected`);
    });
  });

  window.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    state.dragCounter++;
    els.dropOverlay.classList.add("is-visible");
    els.dropOverlay.setAttribute("aria-hidden", "false");
  });

  window.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  window.addEventListener("dragleave", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    state.dragCounter = Math.max(0, state.dragCounter - 1);
    if (!state.dragCounter) {
      els.dropOverlay.classList.remove("is-visible");
      els.dropOverlay.setAttribute("aria-hidden", "true");
    }
  });

  window.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    state.dragCounter = 0;
    els.dropOverlay.classList.remove("is-visible");
    els.dropOverlay.setAttribute("aria-hidden", "true");
    addFiles(event.dataTransfer.files);
  });

  window.addEventListener("keydown", (event) => {
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "o") {
      event.preventDefault();
      openPicker();
    }
    if (event.key === "Escape" && state.activeTool) {
      state.activeTool = null;
      $$(".tool-button").forEach(b => b.classList.remove("is-active"));
      showToast("Tool closed");
    }
  });

  render();
})();
