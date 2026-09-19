(() => {
  const PDFJS_VERSION = "3.11.174";
  const PDFLIB_VERSION = "1.17.1";
  const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/build/pdf.min.js";
  const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@" + PDFJS_VERSION + "/build/pdf.worker.min.js";
  const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@" + PDFLIB_VERSION + "/dist/pdf-lib.min.js";
  const MAX_IMAGE_PAGES = 300;

  let active = null;
  let pdfJsPromise = null;
  let pdfLibPromise = null;

  const MODES = {
    "images-pdf": {
      title: "Images → PDF",
      subtitle: "Combine JPG, PNG, or WebP images into one PDF.",
      accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
      action: "Create PDF"
    },
    "pdf-png": {
      title: "PDF → PNG",
      subtitle: "Render every PDF page as a PNG image.",
      accept: "application/pdf,.pdf",
      action: "Convert to PNG"
    },
    "pdf-jpg": {
      title: "PDF → JPG",
      subtitle: "Render every PDF page as a high-quality JPG image.",
      accept: "application/pdf,.pdf",
      action: "Convert to JPG"
    },
    "pdf-text": {
      title: "PDF → Text",
      subtitle: "Extract selectable PDF text into plain .txt files.",
      accept: "application/pdf,.pdf",
      action: "Extract Text"
    }
  };

  function loadScript(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-converter-src="' + src + '"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window[globalName]), { once: true });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.converterSrc = src;
      script.onload = () => resolve(window[globalName]);
      script.onerror = () => reject(new Error("Could not load converter dependency."));
      document.head.appendChild(script);
    });
  }

  function ensurePdfJs() {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return Promise.resolve(window.pdfjsLib);
    }
    if (!pdfJsPromise) {
      pdfJsPromise = loadScript(PDFJS_URL, "pdfjsLib")
        .then((lib) => {
          lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
          return lib;
        })
        .catch((error) => {
          pdfJsPromise = null;
          throw error;
        });
    }
    return pdfJsPromise;
  }

  function ensurePdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!pdfLibPromise) {
      pdfLibPromise = loadScript(PDFLIB_URL, "PDFLib")
        .catch((error) => {
          pdfLibPromise = null;
          throw error;
        });
    }
    return pdfLibPromise;
  }

  function safeBase(name) {
    return (name || "file")
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .trim() || "file";
  }

  function formatBytes(bytes) {
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
    return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  }

  function isImage(file) {
    return file && (
      /^image\/(jpeg|png|webp)$/i.test(file.type) ||
      /\.(jpe?g|png|webp)$/i.test(file.name)
    );
  }

  function acceptedFiles(files) {
    if (!active) return [];
    return [...files].filter(active.mode === "images-pdf" ? isImage : isPdf);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 12000);
  }

  function setStatus(message, progress) {
    if (!active) return;
    active.status.textContent = message;
    if (typeof progress === "number") {
      active.progress.hidden = false;
      active.progressBar.style.width = Math.max(0, Math.min(100, progress)) + "%";
    } else {
      active.progress.hidden = true;
      active.progressBar.style.width = "0%";
    }
  }

  function renderFiles() {
    if (!active) return;
    active.fileList.replaceChildren();

    if (!active.files.length) {
      const empty = document.createElement("div");
      empty.className = "converter-files-empty";
      empty.textContent = "No files selected";
      active.fileList.append(empty);
    } else {
      active.files.forEach((file, index) => {
        const row = document.createElement("div");
        row.className = "converter-file-row";

        const icon = document.createElement("span");
        icon.className = "converter-file-icon";
        icon.innerHTML = active.mode === "images-pdf"
          ? '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m7 16 4-4 3 3 2-2 3 3"/><circle cx="9" cy="9" r="1"/></svg>'
          : '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/></svg>';

        const info = document.createElement("span");
        info.className = "converter-file-info";
        const name = document.createElement("strong");
        name.textContent = file.name;
        const meta = document.createElement("span");
        meta.textContent = formatBytes(file.size);
        info.append(name, meta);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "converter-file-remove";
        remove.setAttribute("aria-label", "Remove " + file.name);
        remove.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
        remove.addEventListener("click", () => {
          if (active.busy) return;
          active.files.splice(index, 1);
          renderFiles();
        });

        row.append(icon, info, remove);
        active.fileList.append(row);
      });
    }

    active.convertButton.disabled = active.busy || !active.files.length;
    active.pickButton.disabled = active.busy;
  }

  function addFiles(files) {
    if (!active || active.busy) return;
    const accepted = acceptedFiles(files);
    if (!accepted.length) {
      setStatus(active.mode === "images-pdf" ? "Choose JPG, PNG, or WebP images." : "Choose PDF files.");
      return;
    }

    active.files.push(...accepted);
    setStatus(accepted.length + " file" + (accepted.length === 1 ? "" : "s") + " added");
    renderFiles();
  }

  function switchMode(mode) {
    if (!active || active.busy || !MODES[mode]) return;
    active.mode = mode;
    active.files = [];

    active.modeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === mode);
    });

    const config = MODES[mode];
    active.title.textContent = config.title;
    active.subtitle.textContent = config.subtitle;
    active.input.accept = config.accept;
    active.input.multiple = true;
    active.convertButton.textContent = config.action;
    active.dropText.textContent = mode === "images-pdf" ? "Drop images here" : "Drop PDFs here";
    active.dropHint.textContent = mode === "images-pdf" ? "JPG, PNG and WebP" : "One or more PDF files";
    active.input.value = "";
    setStatus("Ready");
    renderFiles();
  }

  function bytesToBlob(bytes, type) {
    return new Blob([bytes], { type });
  }

  async function imageToPngBytes(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not decode " + file.name));
        img.src = url;
      });

      const maxSide = 6000;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d", { alpha: true });
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Image conversion failed.")), "image/png");
      });
      canvas.width = 1;
      canvas.height = 1;
      return new Uint8Array(await blob.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function convertImagesToPdf() {
    const PDFLib = await ensurePdfLib();
    const output = await PDFLib.PDFDocument.create();

    for (let i = 0; i < active.files.length; i++) {
      const file = active.files[i];
      setStatus("Adding image " + (i + 1) + " / " + active.files.length, (i / active.files.length) * 90);

      let image;
      if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) {
        image = await output.embedJpg(new Uint8Array(await file.arrayBuffer()));
      } else if (file.type === "image/png" || /\.png$/i.test(file.name)) {
        image = await output.embedPng(new Uint8Array(await file.arrayBuffer()));
      } else {
        image = await output.embedPng(await imageToPngBytes(file));
      }

      const maxPdfSide = 14400;
      const scale = Math.min(1, maxPdfSide / image.width, maxPdfSide / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const page = output.addPage([width, height]);
      page.drawImage(image, { x: 0, y: 0, width, height });

      if (i % 4 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    setStatus("Saving PDF…", 94);
    const bytes = await output.save({ useObjectStreams: true });
    downloadBlob(bytesToBlob(bytes, "application/pdf"), "converted-images.pdf");
    setStatus("PDF created", 100);
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Could not encode page image.")),
        type,
        quality
      );
    });
  }

  async function renderPdfPage(page, format) {
    const base = page.getViewport({ scale: 1 });
    const pixelScale = Math.min(2, Math.sqrt(6000000 / Math.max(1, base.width * base.height)));
    const viewport = page.getViewport({ scale: Math.max(0.35, pixelScale) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d", { alpha: format === "png" });
    if (format === "jpg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvasBlob(canvas, format === "png" ? "image/png" : "image/jpeg", format === "png" ? undefined : 0.9);
    canvas.width = 1;
    canvas.height = 1;
    return new Uint8Array(await blob.arrayBuffer());
  }

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(value) {
    const out = new Uint8Array(2);
    new DataView(out.buffer).setUint16(0, value, true);
    return out;
  }

  function u32(value) {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value >>> 0, true);
    return out;
  }

  function concat(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function makeZip(entries) {
    const encoder = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = entry.data;
      const crc = crc32(data);
      const flags = 0x0800;
      const local = concat([
        u32(0x04034b50), u16(20), u16(flags), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        name, data
      ]);
      locals.push(local);
      const central = concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        u16(0), u16(0), u16(0), u32(0), u32(offset), name
      ]);
      centrals.push(central);
      offset += local.length;
    }

    const centralBytes = concat(centrals);
    const end = concat([
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(centralBytes.length), u32(offset), u16(0)
    ]);
    return new Blob([...locals, centralBytes, end], { type: "application/zip" });
  }

  async function convertPdfImages(format) {
    const pdfjs = await ensurePdfJs();
    const docs = [];
    let totalPages = 0;

    for (const file of active.files) {
      setStatus("Reading " + file.name + "…");
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      docs.push({ file, pdf });
      totalPages += pdf.numPages;
    }

    if (totalPages > MAX_IMAGE_PAGES) {
      docs.forEach(({ pdf }) => pdf.destroy && pdf.destroy());
      throw new Error("This conversion has " + totalPages + " pages. PDF-to-image conversion is limited to " + MAX_IMAGE_PAGES + " pages at once for memory safety.");
    }

    const entries = [];
    let done = 0;
    try {
      for (const { file, pdf } of docs) {
        const base = safeBase(file.name);
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          done++;
          setStatus("Rendering page " + done + " / " + totalPages, (done / totalPages) * 94);
          const page = await pdf.getPage(pageNumber);
          const data = await renderPdfPage(page, format);
          const digits = Math.max(3, String(pdf.numPages).length);
          const fileName =
            (active.files.length > 1 ? base + "/" : "") +
            base + "-page-" + String(pageNumber).padStart(digits, "0") +
            "." + (format === "jpg" ? "jpg" : "png");
          entries.push({ name: fileName, data });
          if (done % 2 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      }
    } finally {
      docs.forEach(({ pdf }) => pdf.destroy && pdf.destroy());
    }

    if (entries.length === 1) {
      downloadBlob(bytesToBlob(entries[0].data, format === "jpg" ? "image/jpeg" : "image/png"), entries[0].name.split("/").pop());
    } else {
      setStatus("Building ZIP…", 97);
      downloadBlob(makeZip(entries), "converted-" + (format === "jpg" ? "jpg" : "png") + ".zip");
    }
    setStatus("Conversion complete", 100);
  }

  function textFromContent(content) {
    let text = "";
    for (const item of content.items || []) {
      if (!item || typeof item.str !== "string") continue;
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
    return text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  }

  async function convertPdfText() {
    const pdfjs = await ensurePdfJs();
    const encoder = new TextEncoder();
    const entries = [];
    let fileIndex = 0;

    for (const file of active.files) {
      fileIndex++;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      let text = "";
      try {
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          text += (pageNumber > 1 ? "\n\n" : "") + "----- Page " + pageNumber + " -----\n" + textFromContent(content);
          const completed = ((fileIndex - 1) + pageNumber / pdf.numPages) / active.files.length;
          setStatus("Extracting text…", completed * 94);
          if (pageNumber % 8 === 0) await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      } finally {
        if (pdf.destroy) pdf.destroy();
      }
      entries.push({ name: safeBase(file.name) + ".txt", data: encoder.encode(text + "\n") });
    }

    if (entries.length === 1) {
      downloadBlob(bytesToBlob(entries[0].data, "text/plain;charset=utf-8"), entries[0].name);
    } else {
      setStatus("Building ZIP…", 97);
      downloadBlob(makeZip(entries), "converted-text.zip");
    }
    setStatus("Text extracted", 100);
  }

  async function runConversion() {
    if (!active || active.busy || !active.files.length) return;
    active.busy = true;
    renderFiles();
    active.convertButton.textContent = "Working…";

    try {
      if (active.mode === "images-pdf") await convertImagesToPdf();
      else if (active.mode === "pdf-png") await convertPdfImages("png");
      else if (active.mode === "pdf-jpg") await convertPdfImages("jpg");
      else if (active.mode === "pdf-text") await convertPdfText();
    } catch (error) {
      console.error(error);
      setStatus(error && error.message ? error.message : "Conversion failed.");
    } finally {
      if (active) {
        active.busy = false;
        active.convertButton.textContent = MODES[active.mode].action;
        renderFiles();
      }
    }
  }

  function close() {
    if (!active || active.busy) return;
    window.removeEventListener("keydown", onKeyDown, true);
    active.root.remove();
    active = null;
    document.body.classList.remove("converter-open");
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function open() {
    if (active) return;

    const root = document.createElement("div");
    root.className = "converter-backdrop";
    root.innerHTML = [
      '<section class="converter-shell" role="dialog" aria-modal="true" aria-label="File converter">',
      '<header class="converter-header"><div><strong>File Converter</strong><span>Private, local conversion</span></div>',
      '<button type="button" class="converter-close" aria-label="Close converter"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>',
      '<div class="converter-modes" role="tablist" aria-label="Conversion type">',
      '<button type="button" data-mode="images-pdf">Images <span>→ PDF</span></button>',
      '<button type="button" data-mode="pdf-png">PDF <span>→ PNG</span></button>',
      '<button type="button" data-mode="pdf-jpg">PDF <span>→ JPG</span></button>',
      '<button type="button" data-mode="pdf-text">PDF <span>→ Text</span></button>',
      '</div><div class="converter-content"><div class="converter-copy"><h2 class="converter-title"></h2><p class="converter-subtitle"></p></div>',
      '<div class="converter-drop"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8.5 3.5h9l6 6v19h-15z"/><path d="M17.5 3.5v6h6"/><path d="M11 20h10M16 15v10"/></svg>',
      '<strong class="converter-drop-text"></strong><span class="converter-drop-hint"></span>',
      '<button type="button" class="converter-pick">Choose files</button><input class="converter-input" type="file" hidden></div>',
      '<div class="converter-file-list"></div><div class="converter-progress" hidden><span></span></div>',
      '<div class="converter-footer"><span class="converter-status">Ready</span><button type="button" class="converter-run" disabled>Convert</button></div>',
      '<p class="converter-privacy">Files are processed in your browser and are not uploaded.</p></div></section>'
    ].join("");

    document.body.append(root);
    document.body.classList.add("converter-open");

    const input = root.querySelector(".converter-input");
    const pickButton = root.querySelector(".converter-pick");
    const convertButton = root.querySelector(".converter-run");
    const drop = root.querySelector(".converter-drop");

    active = {
      root,
      input,
      pickButton,
      convertButton,
      drop,
      mode: "images-pdf",
      files: [],
      busy: false,
      title: root.querySelector(".converter-title"),
      subtitle: root.querySelector(".converter-subtitle"),
      dropText: root.querySelector(".converter-drop-text"),
      dropHint: root.querySelector(".converter-drop-hint"),
      fileList: root.querySelector(".converter-file-list"),
      status: root.querySelector(".converter-status"),
      progress: root.querySelector(".converter-progress"),
      progressBar: root.querySelector(".converter-progress span"),
      modeButtons: [...root.querySelectorAll(".converter-modes button")]
    };

    root.querySelector(".converter-close").addEventListener("click", close);
    root.addEventListener("click", (event) => {
      if (event.target === root) close();
    });
    active.modeButtons.forEach((button) => button.addEventListener("click", () => switchMode(button.dataset.mode)));
    pickButton.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      addFiles(input.files);
      input.value = "";
    });
    convertButton.addEventListener("click", runConversion);

    ["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
      drop.addEventListener(name, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    drop.addEventListener("dragenter", () => drop.classList.add("is-dragging"));
    drop.addEventListener("dragover", () => drop.classList.add("is-dragging"));
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragging"));
    drop.addEventListener("drop", (event) => {
      drop.classList.remove("is-dragging");
      addFiles(event.dataTransfer.files);
    });

    window.addEventListener("keydown", onKeyDown, true);
    switchMode("images-pdf");
    requestAnimationFrame(() => pickButton.focus());
  }

  window.iWeatherPDFConverter = { open, close };
})();