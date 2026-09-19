(function () {
  "use strict";

  var active = null;
  var imageCache = new Map();
  var objectClipboard = [];

  function host() {
    if (!window.iWeatherPDFEditorHost) throw new Error("Editor host is unavailable");
    return window.iWeatherPDFEditorHost;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function copy(value) {
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === "object") {
      var result = {};
      Object.keys(value).forEach(function (key) {
        result[key] = copy(value[key]);
      });
      return result;
    }
    return value;
  }

  function normRotation(value) {
    return ((value % 360) + 360) % 360;
  }

  function canonicalToDisplay(point, rotation) {
    var r = normRotation(rotation);
    if (r === 90) return { x: 1 - point.y, y: point.x };
    if (r === 180) return { x: 1 - point.x, y: 1 - point.y };
    if (r === 270) return { x: point.y, y: 1 - point.x };
    return { x: point.x, y: point.y };
  }

  function displayToCanonical(point, rotation) {
    var r = normRotation(rotation);
    if (r === 90) return { x: point.y, y: 1 - point.x };
    if (r === 180) return { x: 1 - point.x, y: 1 - point.y };
    if (r === 270) return { x: 1 - point.y, y: point.x };
    return { x: point.x, y: point.y };
  }

  function rectToDisplay(annotation, rotation) {
    var x = annotation.x;
    var y = annotation.y;
    var w = annotation.w;
    var h = annotation.h;
    var r = normRotation(rotation);
    if (r === 90) return { x: 1 - y - h, y: x, w: h, h: w };
    if (r === 180) return { x: 1 - x - w, y: 1 - y - h, w: w, h: h };
    if (r === 270) return { x: y, y: 1 - x - w, w: h, h: w };
    return { x: x, y: y, w: w, h: h };
  }

  function rgba(hex, alpha) {
    var raw = (hex || "#111111").replace("#", "");
    if (raw.length === 3) raw = raw.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(raw, 16);
    if (!Number.isFinite(n)) return "rgba(17,17,17," + alpha + ")";
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + alpha + ")";
  }

  function getImage(src) {
    if (!src) return Promise.resolve(null);
    if (imageCache.has(src)) return imageCache.get(src);
    var promise = new Promise(function (resolve) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { resolve(null); };
      image.src = src;
    });
    imageCache.set(src, promise);
    if (imageCache.size > 24) {
      var oldest = imageCache.keys().next().value;
      if (oldest && oldest !== src) imageCache.delete(oldest);
    }
    return promise;
  }

  function pushLocalHistory() {
    if (!active) return;
    active.dirty = true;
    active.undo.push(copy(active.annotations));
    if (active.undo.length > 30) active.undo.shift();
    active.redo = [];
    updateUndoRedo();
  }

  function localUndo() {
    if (!active || !active.undo.length) return;
    active.dirty = true;
    active.redo.push(copy(active.annotations));
    active.annotations = active.undo.pop();
    active.selectedId = null;
    draw();
    updateUndoRedo();
  }

  function localRedo() {
    if (!active || !active.redo.length) return;
    active.dirty = true;
    active.undo.push(copy(active.annotations));
    active.annotations = active.redo.pop();
    active.selectedId = null;
    draw();
    updateUndoRedo();
  }

  function updateUndoRedo() {
    if (!active) return;
    active.undoButton.disabled = !active.undo.length;
    active.redoButton.disabled = !active.redo.length;
  }

  function actionIcon(label) {
    var icons = {
      "Undo": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8 4.5 12 9 16"/><path d="M5 12h8.5a5.5 5.5 0 0 1 0 11"/></svg>',
      "Redo": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 8 4.5 4-4.5 4"/><path d="M19 12h-8.5a5.5 5.5 0 0 0 0 11"/></svg>',
      "Save": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V4M8 20v-6h8v6"/></svg>',
      "Done": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>',
      "Close": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      "Delete edit": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m8 10 .5 8h7l.5-8"/></svg>',
      "Zoom out": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.5 15.5 20 20"/></svg>',
      "Zoom in": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M10.5 7.5v6M15.5 15.5 20 20"/></svg>'
    };
    return icons[label] || "";
  }

  function toolIcon(tool) {
    var icons = {
      select: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 6.5 15 2.1-6.2 6.4-2.2z"/></svg>',
      edittext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v12M8 18h8"/><path d="m16.5 13.5 3-3 1.5 1.5-3 3z"/></svg>',
      editimage: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="13" height="11" rx="2"/><circle cx="8" cy="9" r="1.2"/><path d="m6 14 3-3 2.5 2 2-2 1.5 1.5"/><path d="M15 18h5M18 15l3 3-3 3"/></svg>',
      text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M12 6v12M8 18h8"/></svg>',
      pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"/><path d="m13.8 7.2 3 3"/></svg>',
      highlight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 8-8 4 4-8 8H6z"/><path d="M4 20h16"/></svg>',
      rect: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1"/></svg>',
      whiteout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 16 8-8 4 4-8 8H6z"/><path d="M14 8l4-4 2 2-4 4"/></svg>',
      image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m6 17 4-4 3 3 2-2 3 3"/></svg>'
    };
    return icons[tool] || "";
  }

  function makeButton(label, className, onClick, title) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className || "pdf-editor-btn";
    var icon = actionIcon(label);
    if (icon) button.insertAdjacentHTML("beforeend", icon);
    var text = document.createElement("span");
    text.className = "pdf-editor-button-label";
    text.textContent = label;
    button.append(text);
    button.title = title || label;
    button.setAttribute("aria-label", title || label);
    button.addEventListener("click", onClick);
    return button;
  }

  function setTool(tool) {
    if (!active) return;
    if (
      active.directTextEditor &&
      active.directTextEditor.isConnected &&
      active.tool !== tool
    ) {
      active.directTextEditor.blur();
    }
    active.tool = tool;
    active.selectedId = null;
    active.toolButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.tool === tool);
    });
    active.overlay.classList.toggle("select", tool === "select");
    active.overlay.classList.toggle("edit-existing-text", tool === "edittext");
    active.overlay.classList.toggle("edit-existing-image", tool === "editimage");
    active.status.textContent =
      tool === "select" ? "Tap an edit to select and drag it" :
      tool === "edittext" ? "Loading editable text…" :
      tool === "editimage" ? "Finding images…" :
      tool === "text" ? "Tap anywhere to add text" :
      tool === "pen" ? "Draw directly on the page" :
      tool === "highlight" ? "Drag across an area to highlight" :
      tool === "rect" ? "Drag to draw a rectangle" :
      tool === "whiteout" ? "Drag to cover an area" :
      tool === "image" ? "Choose an image, then place it" : "Edit";

    if (tool === "edittext") {
      loadTextRuns().then(function () {
        if (!active || active.tool !== "edittext") return;
        active.status.textContent = active.textRuns.length
          ? "Tap highlighted existing text to replace or delete it"
          : "No editable text detected on this page";
        draw();
      });
    }

    if (tool === "editimage") {
      loadImageRuns().then(function () {
        if (!active || active.tool !== "editimage") return;
        active.status.textContent = active.imageRuns.length
          ? "Tap an existing image, then drag it"
          : "No movable images detected on this page";
        draw();
      });
    }

    draw();
  }

  function createToolButton(label, tool) {
    var button = makeButton(label, "pdf-editor-tool", function () {
      if (tool === "image") {
        active.imageInput.click();
        return;
      }
      setTool(tool);
    }, label);
    button.dataset.tool = tool;
    var icon = toolIcon(tool);
    if (icon) button.insertAdjacentHTML("afterbegin", icon);
    active.toolButtons.push(button);
    return button;
  }


  function selectedAnnotation() {
    if (!active || !active.selectedId) return null;
    return active.annotations.find(function (item) { return item.id === active.selectedId; }) || null;
  }

  function textFontCss(item) {
    var family = String((item && (item.fontFamily || item.font)) || "Arial").replace(/["';]/g, "").trim();
    if (!family) family = "Arial";
    return '"' + family + '",Arial,Helvetica,sans-serif';
  }

  function syncInlineTextFormatting() {
    if (!active || !active.directTextEditor || !active.directTextEditor.isConnected) return;
    var editor = active.directTextEditor;
    if (!editor.classList.contains("is-new")) return;
    var px = Number(active.size.value) || 24;
    editor.style.color = active.color.value;
    editor.style.fontFamily = textFontCss({ fontFamily: active.textFont.value });
    editor.style.fontSize = px + "px";
    editor.style.fontWeight = active.textStyle.bold ? "700" : "400";
    editor.style.fontStyle = active.textStyle.italic ? "italic" : "normal";
    editor.style.textDecorationLine = active.textStyle.underline ? "underline" : "none";
    editor.style.minHeight = Math.max(16, px * 1.1) + "px";
  }

  function updateFormatButtonState() {
    if (!active) return;
    active.boldButton.classList.toggle("is-active", !!active.textStyle.bold);
    active.italicButton.classList.toggle("is-active", !!active.textStyle.italic);
    active.underlineButton.classList.toggle("is-active", !!active.textStyle.underline);
  }

  function applyTextFormatChange(property, value) {
    if (!active) return;
    var item = selectedAnnotation();
    var selectedText = active.tool === "select" && item && item.type === "text";

    if (property === "bold" || property === "italic" || property === "underline") {
      active.textStyle[property] = !!value;
    }

    if (selectedText) {
      pushLocalHistory();
      if (property === "fontFamily") item.fontFamily = value;
      else if (property === "sizePx") item.size = Number(value) / Math.max(1, Math.min(active.overlay.clientWidth, active.overlay.clientHeight));
      else if (property === "color") item.color = value;
      else item[property] = !!value;
      active.status.textContent = "Text formatting updated";
    }

    updateFormatButtonState();
    syncInlineTextFormatting();
    draw();
  }

  function updateToolControls() {
    if (!active || !active.props) return;
    var tool = active.tool;
    var selected = selectedAnnotation();
    var selectedText = tool === "select" && selected && selected.type === "text";
    var textVisible = tool === "text" || selectedText;
    var colorVisible = textVisible || tool === "pen" || tool === "rect";
    var strokeVisible = tool === "pen" || tool === "rect";
    var deleteVisible = tool === "select" && !!active.selectedId;

    if (selectedText) {
      active.textFont.value = selected.fontFamily || "Arial";
      active.size.value = String(Math.max(8, Math.round((selected.size || 0.04) * Math.max(1, Math.min(active.overlay.clientWidth, active.overlay.clientHeight)))));
      active.color.value = selected.color || "#111111";
      active.textStyle.bold = !!selected.bold;
      active.textStyle.italic = !!selected.italic;
      active.textStyle.underline = !!selected.underline;
    }

    active.color.hidden = !colorVisible;
    active.stroke.hidden = !strokeVisible;
    active.size.hidden = !textVisible;
    active.textFont.hidden = !textVisible;
    active.textFormatGroup.hidden = !textVisible;
    active.removeButton.hidden = !deleteVisible;
    active.props.hidden = !(colorVisible || strokeVisible || textVisible || deleteVisible);
    updateFormatButtonState();
  }

  function updateZoomLabel() {
    if (!active || !active.zoomValueButton) return;
    var label = active.zoomValueButton.querySelector(".pdf-editor-button-label");
    if (label) label.textContent = Math.abs(active.zoom - 1) < 0.01 ? "Fit" : Math.round(active.zoom * 100) + "%";
    active.zoomValueButton.title = Math.abs(active.zoom - 1) < 0.01 ? "Page fitted to view" : "Fit page";
    active.zoomValueButton.setAttribute("aria-label", active.zoomValueButton.title);
  }

  function setStageCssSize(width, height) {
    if (!active) return;
    active.stage.style.width = width + "px";
    active.stage.style.height = height + "px";
    active.pageCanvas.style.width = width + "px";
    active.pageCanvas.style.height = height + "px";
    active.overlay.style.width = width + "px";
    active.overlay.style.height = height + "px";
  }

  function swapRenderedPage(canvas, dims) {
    if (!active) return;
    canvas.className = "pdf-editor-page";
    active.pageCanvas.replaceWith(canvas);
    active.pageCanvas = canvas;
    setStageCssSize(dims.width, dims.height);
    resizeOverlay(dims.width, dims.height);
    active.rotation = dims.rotation;
    draw();
  }

  async function renderZoomQuality(expectedZoom) {
    if (!active || !active.fitWidth || !active.fitHeight) return;
    var current = active;
    var generation = ++current.zoomRenderGeneration;
    var targetWidth = Math.max(120, Math.round(current.fitWidth * expectedZoom));
    var targetHeight = Math.max(120, Math.round(current.fitHeight * expectedZoom));
    var temp = document.createElement("canvas");

    try {
      var dims = await host().renderPage(current.pageId, temp, targetWidth, targetHeight);
      if (!active || active !== current || generation !== current.zoomRenderGeneration) return;
      if (Math.abs(current.zoom - expectedZoom) > 0.01) return;
      swapRenderedPage(temp, dims);
    } catch (error) {
      console.error(error);
    }
  }

  function scheduleZoomRender() {
    if (!active) return;
    clearTimeout(active.zoomRenderTimer);
    var expectedZoom = active.zoom;
    active.zoomRenderTimer = setTimeout(function () {
      renderZoomQuality(expectedZoom);
    }, 140);
  }

  function setZoom(nextZoom, clientX, clientY) {
    if (!active || !active.fitWidth || !active.fitHeight) return;
    if (active.directTextEditor && active.directTextEditor.isConnected) active.directTextEditor.blur();

    var next = clamp(nextZoom, 0.5, 4);
    if (Math.abs(next - active.zoom) < 0.005) return;

    var wrapRect = active.stageWrap.getBoundingClientRect();
    var before = active.stage.getBoundingClientRect();
    var anchorX = Number.isFinite(clientX) ? clientX : wrapRect.left + wrapRect.width / 2;
    var anchorY = Number.isFinite(clientY) ? clientY : wrapRect.top + wrapRect.height / 2;
    var relX = before.width ? clamp((anchorX - before.left) / before.width, 0, 1) : 0.5;
    var relY = before.height ? clamp((anchorY - before.top) / before.height, 0, 1) : 0.5;

    active.zoom = next;
    var width = Math.round(active.fitWidth * next);
    var height = Math.round(active.fitHeight * next);
    setStageCssSize(width, height);
    active.stageWrap.classList.toggle("is-zoomed", next > 1.01);
    updateZoomLabel();

    requestAnimationFrame(function () {
      if (!active) return;
      var after = active.stage.getBoundingClientRect();
      active.stageWrap.scrollLeft += after.left + relX * after.width - anchorX;
      active.stageWrap.scrollTop += after.top + relY * after.height - anchorY;
    });

    scheduleZoomRender();
  }

  async function fitPage() {
    if (!active) return;
    var current = active;
    clearTimeout(current.zoomRenderTimer);
    var generation = ++current.zoomRenderGeneration;
    var horizontalPadding = current.embedded ? 28 : 48;
    var verticalPadding = current.embedded ? 24 : 48;
    var maxWidth = Math.max(260, current.stageWrap.clientWidth - horizontalPadding);
    var maxHeight = Math.max(320, current.stageWrap.clientHeight - verticalPadding);
    var temp = document.createElement("canvas");

    try {
      var dims = await host().renderPage(current.pageId, temp, maxWidth, maxHeight);
      if (!active || active !== current || generation !== current.zoomRenderGeneration) return;
      current.fitWidth = dims.width;
      current.fitHeight = dims.height;
      current.zoom = 1;
      current.stageWrap.classList.remove("is-zoomed");
      swapRenderedPage(temp, dims);
      updateZoomLabel();
    } catch (error) {
      console.error(error);
      host().showToast("Could not fit this page.");
    }
  }

  function wheelZoom(event) {
    if (!active || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    var factor = Math.exp(-event.deltaY * 0.003);
    setZoom(active.zoom * factor, event.clientX, event.clientY);
  }

  function beginPan(event) {
    if (!active) return;
    event.preventDefault();
    try { active.overlay.setPointerCapture(event.pointerId); } catch (_) {}
    active.pointer = {
      id: event.pointerId,
      mode: "pan",
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: active.stageWrap.scrollLeft,
      scrollTop: active.stageWrap.scrollTop
    };
    active.overlay.classList.add("panning");
  }

  function keyup(event) {
    if (!active || event.code !== "Space") return;
    active.spacePan = false;
    active.stageWrap.classList.remove("is-pan-ready");
  }

  function clearPanKey() {
    if (!active) return;
    active.spacePan = false;
    active.stageWrap.classList.remove("is-pan-ready");
  }

  function loadTextRuns() {
    if (!active) return Promise.resolve([]);
    if (Array.isArray(active.textRuns)) return Promise.resolve(active.textRuns);
    if (active.textRunsPromise) return active.textRunsPromise;

    active.textRunsPromise = Promise.resolve(host().getPageTextRuns(active.pageId))
      .then(function (runs) {
        if (!active) return [];
        active.textRuns = Array.isArray(runs) ? runs : [];
        active.textRunsPromise = null;
        return active.textRuns;
      })
      .catch(function (error) {
        console.error(error);
        if (active) {
          active.textRuns = [];
          active.textRunsPromise = null;
          active.status.textContent = "Could not inspect existing text";
        }
        return [];
      });

    return active.textRunsPromise;
  }

  function loadImageRuns() {
    if (!active) return Promise.resolve([]);
    if (Array.isArray(active.imageRuns)) return Promise.resolve(active.imageRuns);
    if (active.imageRunsPromise) return active.imageRunsPromise;

    active.imageRunsPromise = Promise.resolve(host().getPageImageRuns(active.pageId))
      .then(function (runs) {
        if (!active) return [];
        active.imageRuns = Array.isArray(runs) ? runs : [];
        active.imageRunsPromise = null;
        return active.imageRuns;
      })
      .catch(function (error) {
        console.error(error);
        if (active) {
          active.imageRuns = [];
          active.imageRunsPromise = null;
          active.status.textContent = "Could not inspect existing images";
        }
        return [];
      });

    return active.imageRunsPromise;
  }

  function movedImageKeys() {
    var keys = new Set();
    if (!active) return keys;
    active.annotations.forEach(function (item) {
      if (item.type === "imagemove" && item.sourceKey) keys.add(item.sourceKey);
    });
    return keys;
  }

  function hitExistingImage(displayPoint) {
    if (!active || !Array.isArray(active.imageRuns)) return null;
    var moved = movedImageKeys();

    for (var i = active.imageRuns.length - 1; i >= 0; i--) {
      var run = active.imageRuns[i];
      if (moved.has(run.key)) continue;
      var rect = rectToDisplay(run, active.rotation);
      if (
        displayPoint.x >= rect.x - 0.006 &&
        displayPoint.x <= rect.x + rect.w + 0.006 &&
        displayPoint.y >= rect.y - 0.006 &&
        displayPoint.y <= rect.y + rect.h + 0.006
      ) return run;
    }
    return null;
  }

  function sampleRectBackground(run) {
    if (!active) return "#ffffff";
    var rect = rectToDisplay(run, active.rotation);
    var canvas = active.pageCanvas;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var x = Math.max(0, Math.floor(rect.x * canvas.width));
    var y = Math.max(0, Math.floor(rect.y * canvas.height));
    var w = Math.max(1, Math.floor(rect.w * canvas.width));
    var h = Math.max(1, Math.floor(rect.h * canvas.height));
    var pad = Math.max(2, Math.round(Math.min(w, h) * 0.05));
    var bx = Math.max(0, x - pad);
    var by = Math.max(0, y - pad);
    var bw = Math.min(canvas.width - bx, w + pad * 2);
    var bh = Math.min(canvas.height - by, h + pad * 2);
    if (bw <= 0 || bh <= 0) return "#ffffff";

    try {
      var data = ctx.getImageData(bx, by, bw, bh).data;
      var counts = new Map();
      for (var py = 0; py < bh; py += 2) {
        for (var px = 0; px < bw; px += 2) {
          var inside = px >= x - bx && px < x - bx + w && py >= y - by && py < y - by + h;
          if (inside) continue;
          var idx = (py * bw + px) * 4;
          var r = data[idx], g = data[idx + 1], b = data[idx + 2];
          var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
      var best = null, count = -1;
      counts.forEach(function (value, key) {
        if (value > count) { count = value; best = key; }
      });
      if (best === null) return "#ffffff";
      return canvasHex(((best >> 8) & 15) * 17, ((best >> 4) & 15) * 17, (best & 15) * 17);
    } catch (_) {
      return "#ffffff";
    }
  }

  function captureImageRun(run) {
    if (!active) return null;
    var rect = rectToDisplay(run, active.rotation);
    var source = active.pageCanvas;
    var sx = Math.max(0, Math.floor(rect.x * source.width));
    var sy = Math.max(0, Math.floor(rect.y * source.height));
    var sw = Math.max(1, Math.min(source.width - sx, Math.ceil(rect.w * source.width)));
    var sh = Math.max(1, Math.min(source.height - sy, Math.ceil(rect.h * source.height)));
    if (sw <= 1 || sh <= 1) return null;

    var canvas = document.createElement("canvas");
    var scale = Math.min(1, 1800 / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    var ctx = canvas.getContext("2d");
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }

  function makeExistingImageMovable(run) {
    if (!active || !run) return;
    var src = captureImageRun(run);
    if (!src) {
      active.status.textContent = "Could not capture this image";
      return;
    }

    pushLocalHistory();
    var item = {
      id: host().uid("edit"),
      type: "imagemove",
      sourceKey: run.key,
      src: src,
      x: run.x,
      y: run.y,
      w: run.w,
      h: run.h,
      originalX: run.x,
      originalY: run.y,
      originalW: run.w,
      originalH: run.h,
      bg: sampleRectBackground(run)
    };
    active.annotations.push(item);
    setTool("select");
    active.selectedId = item.id;
    active.status.textContent = "Image selected · drag to move";
    draw();
  }

  function drawExistingImageHotspots(ctx, width, height) {
    if (!active || active.tool !== "editimage" || !Array.isArray(active.imageRuns)) return;
    var moved = movedImageKeys();
    ctx.save();
    ctx.strokeStyle = "rgba(183,139,0,.82)";
    ctx.fillStyle = "rgba(244,196,48,.08)";
    ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
    ctx.setLineDash([5, 4]);
    active.imageRuns.forEach(function (run) {
      if (moved.has(run.key)) return;
      var rect = rectToDisplay(run, active.rotation);
      ctx.fillRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
      ctx.strokeRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
    });
    ctx.restore();
  }

  function fontFamilyCss(item) {
    var fallback =
      item.family === "serif" ? "Times New Roman,Times,serif" :
      item.family === "mono" ? "Consolas,Courier New,monospace" :
      "Helvetica,Arial,sans-serif";
    var exact = String(item.fontFamily || "").replace(/["';]/g, "").trim();
    if (exact && !/^(serif|sans-serif|monospace)$/i.test(exact)) {
      return '"' + exact + '",' + fallback;
    }
    return fallback;
  }

  function canvasHex(r, g, b) {
    return "#" + [r, g, b].map(function (value) {
      return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
    }).join("");
  }

  function sampleExistingTextColors(run) {
    if (!active) return { color: "#111111", bg: "#ffffff" };

    var rect = rectToDisplay(run, active.rotation);
    var canvas = active.pageCanvas;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var x = Math.max(0, Math.floor(rect.x * canvas.width));
    var y = Math.max(0, Math.floor(rect.y * canvas.height));
    var w = Math.max(1, Math.floor(rect.w * canvas.width));
    var h = Math.max(1, Math.floor(rect.h * canvas.height));
    var pad = Math.max(2, Math.round(h * 0.32));
    var bx = Math.max(0, x - pad);
    var by = Math.max(0, y - pad);
    var bw = Math.min(canvas.width - bx, w + pad * 2);
    var bh = Math.min(canvas.height - by, h + pad * 2);

    if (bw <= 0 || bh <= 0) return { color: "#111111", bg: "#ffffff" };

    try {
      var pixels = ctx.getImageData(bx, by, bw, bh).data;
      var darkest = null;
      var darkestLum = Infinity;
      var counts = new Map();

      for (var py = 0; py < bh; py++) {
        for (var px = 0; px < bw; px++) {
          var index = (py * bw + px) * 4;
          var r = pixels[index];
          var g = pixels[index + 1];
          var b = pixels[index + 2];
          var lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          var inside =
            px >= x - bx &&
            px < x - bx + w &&
            py >= y - by &&
            py < y - by + h;

          if (inside) {
            if (lum < darkestLum) {
              darkestLum = lum;
              darkest = [r, g, b];
            }
          } else {
            var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        }
      }

      var bestKey = null;
      var bestCount = -1;
      counts.forEach(function (count, key) {
        if (count > bestCount) {
          bestCount = count;
          bestKey = key;
        }
      });

      var bg = "#ffffff";
      if (bestKey !== null) {
        bg = canvasHex(
          ((bestKey >> 8) & 15) * 17,
          ((bestKey >> 4) & 15) * 17,
          (bestKey & 15) * 17
        );
      }

      return {
        color: darkest ? canvasHex(darkest[0], darkest[1], darkest[2]) : "#111111",
        bg: bg
      };
    } catch (_) {
      return { color: "#111111", bg: "#ffffff" };
    }
  }

  function editedTextKeys() {
    var keys = new Set();
    if (!active) return keys;
    active.annotations.forEach(function (item) {
      if (item.type === "textedit" && item.lineKey) keys.add(item.lineKey);
    });
    return keys;
  }

  function hitExistingText(displayPoint) {
    if (!active || !Array.isArray(active.textRuns)) return null;
    var edited = editedTextKeys();

    for (var i = active.textRuns.length - 1; i >= 0; i--) {
      var run = active.textRuns[i];
      if (edited.has(run.key)) continue;
      var rect = rectToDisplay(run, active.rotation);
      if (
        displayPoint.x >= rect.x - 0.004 &&
        displayPoint.x <= rect.x + rect.w + 0.004 &&
        displayPoint.y >= rect.y - 0.004 &&
        displayPoint.y <= rect.y + rect.h + 0.004
      ) {
        return run;
      }
    }

    return null;
  }

  function commitTextReplacement(run, existing, value) {
    if (!active) return false;
    var before = existing ? existing.text : run.text;
    var next = String(value == null ? "" : value);
    if (next === before) return false;

    pushLocalHistory();

    if (existing) {
      existing.text = next.slice(0, 4000);
      active.selectedId = existing.id;
    } else {
      var sampled = sampleExistingTextColors(run);
      var edit = {
        id: host().uid("textedit"),
        type: "textedit",
        lineKey: run.key,
        original: run.text,
        text: next.slice(0, 4000),
        x: run.x,
        y: run.y,
        w: run.w,
        h: run.h,
        baseline: run.baseline,
        size: run.size,
        family: run.family,
        fontFamily: run.fontFamily || "",
        fontName: run.fontName || "",
        bold: !!run.bold,
        italic: !!run.italic,
        color: sampled.color,
        bg: sampled.bg,
        uniqueOriginal: !!run.uniqueOriginal
      };
      active.annotations.push(edit);
      active.selectedId = edit.id;
    }

    active.status.textContent = next
      ? "Existing text changed"
      : "Existing text marked for deletion";
    draw();
    return true;
  }

  function beginInlineTextEdit(run, existing) {
    if (!active || !active.textHitLayer) return;

    var source = existing || run;
    var rect = rectToDisplay(source, active.rotation);
    var colors = existing
      ? { color: existing.color || "#111111", bg: existing.bg || "#ffffff" }
      : sampleExistingTextColors(run);

    var editor = document.createElement("span");
    editor.className = "pdf-editor-direct-text";
    editor.contentEditable = "true";
    editor.spellcheck = false;
    editor.textContent = existing ? existing.text : run.text;
    editor.style.left = (rect.x * 100) + "%";
    editor.style.top = (rect.y * 100) + "%";
    editor.style.minWidth = Math.max(8, rect.w * active.stage.clientWidth) + "px";
    editor.style.maxWidth = Math.max(
      24,
      (1 - rect.x) * active.stage.clientWidth
    ) + "px";
    editor.style.minHeight = Math.max(14, rect.h * active.stage.clientHeight) + "px";
    editor.style.color = colors.color;
    editor.style.background = colors.bg;

    var canonicalHeight = active.rotation % 180
      ? active.stage.clientWidth
      : active.stage.clientHeight;
    var fontPx = Math.max(8, (source.size || 0.02) * canonicalHeight);
    editor.style.font =
      (source.italic ? "italic " : "") +
      (source.bold ? "700 " : "400 ") +
      fontPx +
      "px " +
      fontFamilyCss(source);
    editor.style.lineHeight = "1.06";

    active.textHitLayer.appendChild(editor);
    active.directTextEditor = editor;

    requestAnimationFrame(function () {
      if (!editor.isConnected) return;
      editor.focus({ preventScroll: true });

      var selection = window.getSelection();
      if (!selection) return;
      var range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    });

    var closed = false;
    function finish(commit) {
      if (closed) return;
      closed = true;
      var value = (editor.textContent || "").replace(/\r?\n/g, " ");
      editor.remove();
      if (active && active.directTextEditor === editor) {
        active.directTextEditor = null;
      }
      if (commit) commitTextReplacement(run, existing, value);
      else renderTextHitLayer();
    }

    editor.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
    editor.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    editor.addEventListener("paste", function (event) {
      event.preventDefault();
      var text = (event.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, text.replace(/\r?\n/g, " "));
    });
    editor.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    editor.addEventListener("blur", function () {
      finish(true);
    });
  }

  function beginInlineNewText(displayPoint, canonical, minDim) {
    if (!active || !active.textHitLayer) return;

    if (active.directTextEditor && active.directTextEditor.isConnected) {
      active.directTextEditor.blur();
    }

    var editor = document.createElement("span");
    editor.className = "pdf-editor-direct-text is-new";
    editor.contentEditable = "true";
    editor.spellcheck = false;
    editor.setAttribute("role", "textbox");
    editor.setAttribute("aria-label", "New PDF text");
    editor.dataset.placeholder = "Type text";
    editor.style.left = (displayPoint.x * 100) + "%";
    editor.style.top = (displayPoint.y * 100) + "%";
    editor.style.minWidth = "24px";
    editor.style.maxWidth = Math.max(
      40,
      (1 - displayPoint.x) * active.stage.clientWidth
    ) + "px";
    editor.style.minHeight = Math.max(16, Number(active.size.value) * 1.1) + "px";
    editor.style.color = active.color.value;
    editor.style.background = "transparent";
    editor.style.lineHeight = "1.15";
    editor.style.fontFamily = textFontCss({ fontFamily: active.textFont.value });
    editor.style.fontSize = Number(active.size.value) + "px";
    editor.style.fontWeight = active.textStyle.bold ? "700" : "400";
    editor.style.fontStyle = active.textStyle.italic ? "italic" : "normal";
    editor.style.textDecorationLine = active.textStyle.underline ? "underline" : "none";

    active.textHitLayer.appendChild(editor);
    active.directTextEditor = editor;
    active.status.textContent = "Type directly on the page · Enter to place · Esc to cancel";

    requestAnimationFrame(function () {
      if (!editor.isConnected) return;
      editor.focus({ preventScroll: true });
    });

    var closed = false;
    function finish(commit) {
      if (closed) return;
      closed = true;
      var value = (editor.textContent || "").replace(/\u00a0/g, " ").replace(/\r?\n/g, " ").trim();
      editor.remove();
      if (active && active.directTextEditor === editor) {
        active.directTextEditor = null;
      }

      if (commit && value && active) {
        pushLocalHistory();
        var item = {
          id: host().uid("edit"),
          type: "text",
          x: canonical.x,
          y: canonical.y,
          text: value.slice(0, 2000),
          color: active.color.value,
          size: Number(active.size.value) / Math.max(1, minDim),
          fontFamily: active.textFont.value,
          bold: !!active.textStyle.bold,
          italic: !!active.textStyle.italic,
          underline: !!active.textStyle.underline,
          angle: normRotation(-active.rotation)
        };
        active.annotations.push(item);
        active.selectedId = item.id;
        active.status.textContent = "Text added";
        draw();
      } else if (active) {
        active.status.textContent = commit ? "Type something to add text" : "Text cancelled";
        renderTextHitLayer();
      }
    }

    editor.addEventListener("pointerdown", function (event) {
      event.stopPropagation();
    });
    editor.addEventListener("click", function (event) {
      event.stopPropagation();
    });
    editor.addEventListener("paste", function (event) {
      event.preventDefault();
      var text = (event.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, text.replace(/\r?\n/g, " "));
    });
    editor.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    editor.addEventListener("blur", function () {
      finish(true);
    });
  }

  function drawExistingTextHotspots(ctx, width, height) {
    if (!active || active.tool !== "edittext" || !Array.isArray(active.textRuns)) return;
    var edited = editedTextKeys();

    ctx.save();
    ctx.lineWidth = Math.max(1, window.devicePixelRatio || 1);
    ctx.setLineDash([4, 3]);

    active.textRuns.forEach(function (run) {
      if (edited.has(run.key)) return;
      var rect = rectToDisplay(run, active.rotation);
      ctx.fillStyle = "rgba(47,126,230,.07)";
      ctx.strokeStyle = "rgba(47,126,230,.58)";
      ctx.fillRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
      ctx.strokeRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
    });

    ctx.restore();
  }

  function renderTextHitLayer() {
    if (!active || !active.textHitLayer) return;
    if (active.directTextEditor && active.directTextEditor.isConnected) return;
    active.textHitLayer.replaceChildren();
    active.textHitLayer.classList.toggle("is-active", active.tool === "edittext");

    if (active.tool !== "edittext" || !Array.isArray(active.textRuns)) return;
    var edited = editedTextKeys();

    active.textRuns.forEach(function (run) {
      if (edited.has(run.key)) return;
      var rect = rectToDisplay(run, active.rotation);
      var hit = document.createElement("button");
      hit.type = "button";
      hit.className = "pdf-editor-text-hit";
      hit.style.left = (rect.x * 100) + "%";
      hit.style.top = (rect.y * 100) + "%";
      hit.style.width = (rect.w * 100) + "%";
      hit.style.height = (rect.h * 100) + "%";
      hit.title = run.text;
      hit.setAttribute("aria-label", "Edit text: " + run.text.slice(0, 120));
      hit.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      hit.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        beginInlineTextEdit(run, null);
      });
      active.textHitLayer.appendChild(hit);
    });

    active.annotations.forEach(function (item) {
      if (item.type !== "textedit") return;
      var rect = rectToDisplay(item, active.rotation);
      var hit = document.createElement("button");
      hit.type = "button";
      hit.className = "pdf-editor-text-hit is-edited";
      hit.style.left = (rect.x * 100) + "%";
      hit.style.top = (rect.y * 100) + "%";
      hit.style.width = (rect.w * 100) + "%";
      hit.style.height = (rect.h * 100) + "%";
      hit.title = item.text || "Deleted text";
      hit.setAttribute("aria-label", "Edit replacement text");
      hit.addEventListener("pointerdown", function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      hit.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        beginInlineTextEdit(null, item);
      });
      active.textHitLayer.appendChild(hit);
    });
  }

  function fitExistingTextPx(ctx, text, maxWidth, baseSize, item) {
    var floor = Math.max(5, baseSize * 0.6);
    var size = Math.max(floor, baseSize);

    while (size > floor) {
      ctx.font =
        (item.italic ? "italic " : "") +
        (item.bold ? "700 " : "400 ") +
        size +
        "px " +
        fontFamilyCss(item);
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= Math.max(0.2, size * 0.04);
    }

    return Math.max(floor, size);
  }

  function drawTextEditPreview(ctx, item, width, height, rotation, skipBackground) {
    var canonicalWidth = rotation % 180 ? height : width;
    var canonicalHeight = rotation % 180 ? width : height;
    var rect = rectToDisplay(item, rotation);

    if (!skipBackground) {
      ctx.fillStyle = item.bg || "#ffffff";
      ctx.fillRect(rect.x * width, rect.y * height, rect.w * width, rect.h * height);
    }

    if (!String(item.text || "").length) return;

    var baseSize = Math.max(6, (item.size || 0.02) * canonicalHeight);
    var maxWidth = Math.max(1, (item.w || 0.1) * canonicalWidth);
    var fontSize = fitExistingTextPx(ctx, item.text, maxWidth, baseSize, item);
    var baseline = canonicalToDisplay(
      { x: item.x, y: item.baseline },
      rotation
    );

    ctx.save();
    ctx.translate(baseline.x * width, baseline.y * height);
    ctx.rotate(normRotation(rotation) * Math.PI / 180);
    ctx.fillStyle = item.color || "#111111";
    ctx.font =
      (item.italic ? "italic " : "") +
      (item.bold ? "700 " : "400 ") +
      fontSize +
      "px " +
      fontFamilyCss(item);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(item.text, 0, 0);
    ctx.restore();
  }


  async function open(pageId, options) {
    options = options || {};
    if (active) close(!!active.embedded);

    var h = host();
    var page = h.getPage(pageId);
    if (!page) return;

    var embedded = !!(options.embedded && options.mount);
    var backdrop = document.createElement("div");
    backdrop.className = embedded ? "pdf-editor-embed" : "pdf-editor-backdrop";

    var shell = document.createElement("div");
    shell.className = "pdf-editor-shell";

    var topbar = document.createElement("div");
    topbar.className = "pdf-editor-topbar";

    var left = document.createElement("div");
    left.className = "pdf-editor-top-left";
    var closeButton = makeButton("Close", "pdf-editor-btn", function () { close(false); }, "Discard changes");

    var title = document.createElement("div");
    title.className = "pdf-editor-title";
    var titleStrong = document.createElement("strong");
    titleStrong.textContent = h.getDocumentName(page.docId) || "PDF";
    var titleMeta = document.createElement("span");
    titleMeta.textContent = "Page " + (h.getPageIndex(pageId) + 1) + " · Free edit";
    title.append(titleStrong, titleMeta);
    if (!embedded) left.append(closeButton, title);
    else left.append(title);

    var right = document.createElement("div");
    right.className = "pdf-editor-top-right";
    var undoButton = makeButton("Undo", "pdf-editor-btn", localUndo);
    var redoButton = makeButton("Redo", "pdf-editor-btn", localRedo);
    var doneButton = makeButton(embedded ? "Save" : "Done", "pdf-editor-btn primary", function () {
      if (embedded) saveCurrent();
      else close(true);
    });
    right.append(undoButton, redoButton, doneButton);
    topbar.append(left, right);

    var tools = document.createElement("div");
    tools.className = "pdf-editor-tools";
    var toolList = document.createElement("div");
    toolList.className = "pdf-editor-tool-list";
    var props = document.createElement("div");
    props.className = "pdf-editor-props";

    var zoomGroup = document.createElement("div");
    zoomGroup.className = "pdf-editor-zoom";
    var zoomOutButton = makeButton("Zoom out", "pdf-editor-btn pdf-editor-icon-only", function () {
      if (active) setZoom(active.zoom / 1.2);
    }, "Zoom out");
    zoomOutButton.dataset.zoomAction = "out";
    var zoomValueButton = makeButton("Fit", "pdf-editor-btn pdf-editor-zoom-value", fitPage, "Fit page");
    zoomValueButton.dataset.zoomAction = "fit";
    var zoomInButton = makeButton("Zoom in", "pdf-editor-btn pdf-editor-icon-only", function () {
      if (active) setZoom(active.zoom * 1.2);
    }, "Zoom in");
    zoomInButton.dataset.zoomAction = "in";
    zoomGroup.append(zoomOutButton, zoomValueButton, zoomInButton);

    var stageWrap = document.createElement("div");
    stageWrap.className = "pdf-editor-stage-wrap";
    var stage = document.createElement("div");
    stage.className = "pdf-editor-stage";
    var pageCanvas = document.createElement("canvas");
    pageCanvas.className = "pdf-editor-page";
    var overlay = document.createElement("canvas");
    overlay.className = "pdf-editor-overlay";
    var textHitLayer = document.createElement("div");
    textHitLayer.className = "pdf-editor-text-hit-layer";
    var status = document.createElement("div");
    status.className = "pdf-editor-status";
    stage.append(pageCanvas, overlay, textHitLayer, status);
    stageWrap.append(stage);

    var color = document.createElement("input");
    color.type = "color";
    color.className = "pdf-editor-color";
    color.value = "#e74a3b";
    color.title = "Color";

    var stroke = document.createElement("input");
    stroke.type = "range";
    stroke.className = "pdf-editor-range";
    stroke.min = "1";
    stroke.max = "18";
    stroke.step = "1";
    stroke.value = "4";
    stroke.title = "Stroke width";

    var size = document.createElement("select");
    size.className = "pdf-editor-btn";
    size.title = "Text size";
    [14,18,24,32,44,60].forEach(function (value) {
      var option = document.createElement("option");
      option.value = String(value);
      option.textContent = value + "px";
      if (value === 24) option.selected = true;
      size.append(option);
    });

    var textFont = document.createElement("select");
    textFont.className = "pdf-editor-btn pdf-editor-font-select";
    textFont.title = "Font";
    [
      ["Arial", "Arial"],
      ["Helvetica", "Helvetica"],
      ["Times New Roman", "Times New Roman"],
      ["Georgia", "Georgia"],
      ["Verdana", "Verdana"],
      ["Courier New", "Courier New"]
    ].forEach(function (entry) {
      var option = document.createElement("option");
      option.value = entry[0];
      option.textContent = entry[1];
      textFont.append(option);
    });

    var textFormatGroup = document.createElement("div");
    textFormatGroup.className = "pdf-editor-text-format";
    var boldButton = makeButton("B", "pdf-editor-btn pdf-editor-format-button", function () {
      applyTextFormatChange("bold", !active.textStyle.bold);
    }, "Bold");
    var italicButton = makeButton("I", "pdf-editor-btn pdf-editor-format-button is-italic", function () {
      applyTextFormatChange("italic", !active.textStyle.italic);
    }, "Italic");
    var underlineButton = makeButton("U", "pdf-editor-btn pdf-editor-format-button is-underline", function () {
      applyTextFormatChange("underline", !active.textStyle.underline);
    }, "Underline");
    textFormatGroup.append(boldButton, italicButton, underlineButton);

    textFont.addEventListener("change", function () {
      applyTextFormatChange("fontFamily", textFont.value);
      syncInlineTextFormatting();
    });
    size.addEventListener("change", function () {
      applyTextFormatChange("sizePx", Number(size.value));
      syncInlineTextFormatting();
    });
    color.addEventListener("change", function () {
      applyTextFormatChange("color", color.value);
      syncInlineTextFormatting();
    });

    var remove = makeButton("Delete edit", "pdf-editor-btn", function () {
      if (!active || !active.selectedId) return;
      pushLocalHistory();
      active.annotations = active.annotations.filter(function (item) { return item.id !== active.selectedId; });
      active.selectedId = null;
      draw();
    });
    remove.title = "Delete selected edit";

    var imageInput = document.createElement("input");
    imageInput.type = "file";
    imageInput.accept = "image/png,image/jpeg,image/webp";
    imageInput.className = "pdf-editor-hidden-input";

    active = {
      pageId: pageId,
      page: page,
      backdrop: backdrop,
      stage: stage,
      stageWrap: stageWrap,
      pageCanvas: pageCanvas,
      overlay: overlay,
      textHitLayer: textHitLayer,
      status: status,
      annotations: h.getAnnotations(pageId),
      undo: [],
      redo: [],
      selectedId: null,
      tool: "select",
      color: color,
      stroke: stroke,
      size: size,
      textFont: textFont,
      textFormatGroup: textFormatGroup,
      boldButton: boldButton,
      italicButton: italicButton,
      underlineButton: underlineButton,
      textStyle: { bold: false, italic: false, underline: false },
      props: props,
      removeButton: remove,
      undoButton: undoButton,
      redoButton: redoButton,
      zoomValueButton: zoomValueButton,
      toolButtons: [],
      imageInput: imageInput,
      textRuns: null,
      textRunsPromise: null,
      imageRuns: null,
      imageRunsPromise: null,
      directTextEditor: null,
      rotation: normRotation(page.rotation || 0),
      pointer: null,
      dirty: false,
      zoom: 1,
      fitWidth: 0,
      fitHeight: 0,
      zoomRenderTimer: null,
      zoomRenderGeneration: 0,
      resizeTimer: null,
      resizeObserver: null,
      spacePan: false,
      embedded: embedded,
      mount: options.mount || null
    };

    toolList.append(
      createToolButton("Select", "select"),
      createToolButton("Edit text", "edittext"),
      createToolButton("Move image", "editimage"),
      createToolButton("Text", "text"),
      createToolButton("Pen", "pen"),
      createToolButton("Highlight", "highlight"),
      createToolButton("Rectangle", "rect"),
      createToolButton("Whiteout", "whiteout"),
      createToolButton("Image", "image")
    );
    props.append(textFont, size, textFormatGroup, color, stroke, remove);
    tools.append(toolList, zoomGroup, props, imageInput);

    if (embedded) {
      right.classList.add("pdf-editor-inline-actions");
      tools.append(right);
      shell.append(tools, stageWrap);
    } else {
      shell.append(topbar, tools, stageWrap);
    }
    backdrop.append(shell);
    if (embedded) {
      options.mount.replaceChildren(backdrop);
    } else {
      document.body.append(backdrop);
    }
    document.body.classList.add("pdf-editor-open");

    overlay.addEventListener("pointerdown", pointerDown);
    overlay.addEventListener("pointermove", pointerMove);
    overlay.addEventListener("pointerup", pointerUp);
    overlay.addEventListener("pointercancel", pointerUp);
    stageWrap.addEventListener("wheel", wheelZoom, { passive: false });

    imageInput.addEventListener("change", async function () {
      var file = imageInput.files && imageInput.files[0];
      imageInput.value = "";
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 12 * 1024 * 1024) {
        h.showToast("Use a PNG, JPEG, or WebP image under 12 MB.");
        return;
      }
      var src = await prepareImageData(file);
      if (!src) return;
      var image = await getImage(src);
      if (!image) return;
      pushLocalHistory();
      var aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
      var w = 0.28;
      var hh = clamp(w / aspect, 0.08, 0.45);
      var center = displayToCanonical({ x: 0.5, y: 0.5 }, active.rotation);
      active.annotations.push({
        id: h.uid("edit"),
        type: "image",
        cx: center.x,
        cy: center.y,
        widthN: w,
        heightN: hh,
        angle: normRotation(-active.rotation),
        src: src
      });
      active.selectedId = active.annotations[active.annotations.length - 1].id;
      setTool("select");
      draw();
    });

    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", clearPanKey);
    setTool("select");

    active.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(function () {
      if (!active || active.zoom !== 1) return;
      clearTimeout(active.resizeTimer);
      active.resizeTimer = setTimeout(function () {
        if (active && active.zoom === 1) fitPage();
      }, 180);
    }) : null;
    if (active.resizeObserver) active.resizeObserver.observe(stageWrap);

    try {
      await fitPage();
      if (!active || active.pageId !== pageId) return;
      updateUndoRedo();
      draw();
    } catch (error) {
      console.error(error);
      h.showToast("Could not open the page editor.");
      close(false);
    }
  }

  function hasChanges(current) {
    return !!(current && current.dirty);
  }

  function saveCurrent() {
    if (!active) return false;
    if (!hasChanges(active)) {
      active.status.textContent = "Saved";
      return false;
    }
    host().commitAnnotations(active.pageId, active.annotations, true, !!active.embedded);
    active.dirty = false;
    active.undo = [];
    active.redo = [];
    updateUndoRedo();
    active.status.textContent = "Saved";
    return true;
  }

  function close(save) {
    if (!active) return;
    var current = active;
    window.removeEventListener("keydown", keydown);
    window.removeEventListener("keyup", keyup);
    window.removeEventListener("blur", clearPanKey);
    clearTimeout(current.zoomRenderTimer);
    clearTimeout(current.resizeTimer);
    if (current.resizeObserver) current.resizeObserver.disconnect();
    if (save && hasChanges(current)) {
      host().commitAnnotations(current.pageId, current.annotations, true, !!current.embedded);
    }
    current.backdrop.remove();
    document.body.classList.remove("pdf-editor-open");
    active = null;
  }

  function resizeOverlay(cssWidth, cssHeight) {
    if (!active) return;
    var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1.6), 2.25);
    active.overlay.width = Math.max(1, Math.round(cssWidth * dpr));
    active.overlay.height = Math.max(1, Math.round(cssHeight * dpr));
    active.overlay.style.width = cssWidth + "px";
    active.overlay.style.height = cssHeight + "px";
  }

  function readDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function prepareImageData(file) {
    var original = await readDataUrl(file);
    var image = await getImage(original);
    if (!image) return null;

    var maxSide = 1600;
    var sourceWidth = image.naturalWidth || image.width || 1;
    var sourceHeight = image.naturalHeight || image.height || 1;
    var scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));

    if (scale >= 1 && file.size <= 2.5 * 1024 * 1024) return original;

    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    var ctx = canvas.getContext("2d", { alpha: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    var mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    return canvas.toDataURL(mime, mime === "image/png" ? undefined : 0.88);
  }

  function pointFromEvent(event) {
    var rect = active.overlay.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function pointerDown(event) {
    if (!active) return;
    if (event.button === 1 || active.spacePan) {
      beginPan(event);
      return;
    }
    if (event.button > 0) return;
    event.preventDefault();
    try { active.overlay.setPointerCapture(event.pointerId); } catch (_) {}

    var displayPoint = pointFromEvent(event);
    var canonical = displayToCanonical(displayPoint, active.rotation);
    var minDim = Math.min(active.overlay.clientWidth, active.overlay.clientHeight);
    var widthN = Number(active.stroke.value) / Math.max(1, minDim);

    if (active.tool === "select") {
      var hit = hitTest(displayPoint);
      active.selectedId = hit ? hit.id : null;
      if (!hit && active.zoom > 1.01) {
        beginPan(event);
        draw();
        return;
      }
      if (hit && hit.type !== "textedit") {
        active.pointer = {
          id: event.pointerId,
          mode: "move",
          start: canonical,
          original: copy(hit)
        };
        pushLocalHistory();
      }
      draw();
      return;
    }

    if (active.tool === "edittext") {
      var existingEdit = hitTest(displayPoint);
      if (existingEdit && existingEdit.type === "textedit") {
        beginInlineTextEdit(null, existingEdit);
        return;
      }

      var run = hitExistingText(displayPoint);
      if (run) {
        beginInlineTextEdit(run, null);
      } else {
        active.status.textContent = "Tap one of the highlighted text lines";
      }
      return;
    }

    if (active.tool === "editimage") {
      var imageRun = hitExistingImage(displayPoint);
      if (imageRun) makeExistingImageMovable(imageRun);
      else active.status.textContent = "Tap one of the highlighted images";
      return;
    }

    if (active.tool === "text") {
      beginInlineNewText(displayPoint, canonical, minDim);
      return;
    }

    if (active.tool === "pen") {
      pushLocalHistory();
      var pen = {
        id: host().uid("edit"),
        type: "pen",
        color: active.color.value,
        width: widthN,
        points: [canonical]
      };
      active.annotations.push(pen);
      active.pointer = { id: event.pointerId, mode: "pen", annotationId: pen.id };
      draw();
      return;
    }

    if (active.tool === "highlight" || active.tool === "rect" || active.tool === "whiteout") {
      pushLocalHistory();
      var shape = {
        id: host().uid("edit"),
        type: active.tool,
        x: canonical.x,
        y: canonical.y,
        w: 0,
        h: 0,
        color: active.tool === "highlight" ? "#fff16b" : active.tool === "whiteout" ? "#ffffff" : active.color.value,
        width: widthN
      };
      active.annotations.push(shape);
      active.pointer = {
        id: event.pointerId,
        mode: "shape",
        annotationId: shape.id,
        start: canonical
      };
      draw();
    }
  }

  function pointerMove(event) {
    if (!active || !active.pointer || event.pointerId !== active.pointer.id) return;
    event.preventDefault();
    var pointer = active.pointer;
    if (pointer.mode === "pan") {
      active.stageWrap.scrollLeft = pointer.scrollLeft - (event.clientX - pointer.startX);
      active.stageWrap.scrollTop = pointer.scrollTop - (event.clientY - pointer.startY);
      return;
    }

    var displayPoint = pointFromEvent(event);
    var canonical = displayToCanonical(displayPoint, active.rotation);
    var item = active.annotations.find(function (annotation) {
      return annotation.id === (pointer.annotationId || active.selectedId);
    });
    if (!item) return;

    if (pointer.mode === "pen") {
      var last = item.points[item.points.length - 1];
      if (
        (!last || Math.abs(last.x - canonical.x) + Math.abs(last.y - canonical.y) > 0.0015) &&
        item.points.length < 8000
      ) {
        item.points.push(canonical);
      }
    } else if (pointer.mode === "shape") {
      var x1 = pointer.start.x;
      var y1 = pointer.start.y;
      item.x = Math.min(x1, canonical.x);
      item.y = Math.min(y1, canonical.y);
      item.w = Math.abs(canonical.x - x1);
      item.h = Math.abs(canonical.y - y1);
    } else if (pointer.mode === "move") {
      var dx = canonical.x - pointer.start.x;
      var dy = canonical.y - pointer.start.y;
      moveAnnotation(item, pointer.original, dx, dy);
    }
    draw();
  }

  function pointerUp(event) {
    if (!active || !active.pointer || event.pointerId !== active.pointer.id) return;
    event.preventDefault();
    var pointer = active.pointer;
    active.pointer = null;
    active.overlay.classList.remove("panning");
    if (pointer.mode === "pan") return;
    if (pointer.mode === "shape") {
      var item = active.annotations.find(function (annotation) { return annotation.id === pointer.annotationId; });
      if (item && (item.w < 0.003 || item.h < 0.003)) {
        active.annotations = active.annotations.filter(function (annotation) { return annotation.id !== pointer.annotationId; });
      }
    }
    draw();
  }

  function moveAnnotation(target, original, dx, dy) {
    if (target.type === "pen") {
      target.points = original.points.map(function (point) {
        return { x: clamp(point.x + dx, 0, 1), y: clamp(point.y + dy, 0, 1) };
      });
      return;
    }
    if (target.type === "image") {
      target.cx = clamp(original.cx + dx, 0, 1);
      target.cy = clamp(original.cy + dy, 0, 1);
      return;
    }
    target.x = clamp(original.x + dx, 0, Math.max(0, 1 - (original.w || 0)));
    target.y = clamp(original.y + dy, 0, Math.max(0, 1 - (original.h || 0)));
  }

  function hitTest(displayPoint) {
    if (!active) return null;
    var annotations = active.annotations.slice().reverse();

    for (var i = 0; i < annotations.length; i++) {
      var item = annotations[i];

      if (item.type === "pen") {
        var near = item.points && item.points.some(function (point) {
          var p = canonicalToDisplay(point, active.rotation);
          return Math.hypot(p.x - displayPoint.x, p.y - displayPoint.y) < 0.025;
        });
        if (near) return item;
        continue;
      }

      if (item.type === "text") {
        var anchor = canonicalToDisplay({ x: item.x, y: item.y }, active.rotation);
        if (Math.abs(anchor.x - displayPoint.x) < 0.12 && Math.abs(anchor.y - displayPoint.y) < 0.05) return item;
        continue;
      }

      if (item.type === "image") {
        var center = canonicalToDisplay({ x: item.cx, y: item.cy }, active.rotation);
        var minPixels = Math.min(active.overlay.clientWidth, active.overlay.clientHeight);
        var hitW = (item.widthN || 0.25) * minPixels / Math.max(1, active.overlay.clientWidth);
        var hitH = (item.heightN || 0.2) * minPixels / Math.max(1, active.overlay.clientHeight);
        if (
          Math.abs(center.x - displayPoint.x) <= hitW / 2 + 0.015 &&
          Math.abs(center.y - displayPoint.y) <= hitH / 2 + 0.015
        ) return item;
        continue;
      }

      var rect = rectToDisplay(item, active.rotation);
      if (
        displayPoint.x >= rect.x - 0.01 &&
        displayPoint.x <= rect.x + rect.w + 0.01 &&
        displayPoint.y >= rect.y - 0.01 &&
        displayPoint.y <= rect.y + rect.h + 0.01
      ) return item;
    }

    return null;
  }

  function draw() {
    if (!active) return;
    updateToolControls();
    var canvas = active.overlay;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAnnotations(ctx, active.annotations, canvas.width, canvas.height, active.rotation, active.selectedId, true);
    drawExistingTextHotspots(ctx, canvas.width, canvas.height);
    drawExistingImageHotspots(ctx, canvas.width, canvas.height);
    renderTextHitLayer();
  }

  function drawAnnotations(ctx, annotations, width, height, rotation, selectedId, allowAsyncImages) {
    var minDim = Math.min(width, height);

    annotations.forEach(function (item) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (item.type === "pen") {
        if (!item.points || item.points.length < 1) {
          ctx.restore();
          return;
        }
        ctx.strokeStyle = item.color || "#e74a3b";
        ctx.lineWidth = Math.max(1, (item.width || 0.004) * minDim);
        ctx.beginPath();
        item.points.forEach(function (point, index) {
          var p = canonicalToDisplay(point, rotation);
          var x = p.x * width;
          var y = p.y * height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      } else if (item.type === "text") {
        var anchor = canonicalToDisplay({ x: item.x, y: item.y }, rotation);
        var fontPx = Math.max(8, (item.size || 0.04) * minDim);
        ctx.translate(anchor.x * width, anchor.y * height);
        ctx.rotate(normRotation((item.angle || 0) + rotation) * Math.PI / 180);
        ctx.fillStyle = item.color || "#111111";
        ctx.font =
          (item.italic ? "italic " : "") +
          (item.bold ? "700 " : "400 ") +
          fontPx + "px " + textFontCss(item);
        ctx.textBaseline = "top";
        var lines = String(item.text || "").split(/\r?\n/);
        lines.forEach(function (line, index) {
          var lineY = index * fontPx * 1.2;
          ctx.fillText(line, 0, lineY);
          if (item.underline && line) {
            var lineWidth = ctx.measureText(line).width;
            ctx.save();
            ctx.strokeStyle = item.color || "#111111";
            ctx.lineWidth = Math.max(1, fontPx * 0.055);
            ctx.beginPath();
            ctx.moveTo(0, lineY + fontPx * 1.03);
            ctx.lineTo(lineWidth, lineY + fontPx * 1.03);
            ctx.stroke();
            ctx.restore();
          }
        });
      } else if (item.type === "textedit") {
        drawTextEditPreview(ctx, item, width, height, rotation, false);
      } else if (item.type === "imagemove") {
        var originalRect = rectToDisplay({
          x: item.originalX, y: item.originalY, w: item.originalW, h: item.originalH
        }, rotation);
        ctx.fillStyle = item.bg || "#ffffff";
        ctx.fillRect(
          originalRect.x * width,
          originalRect.y * height,
          originalRect.w * width,
          originalRect.h * height
        );
        var movedRect = rectToDisplay(item, rotation);
        var movedPromise = getImage(item.src);
        var movedCached = imageCache.get(item.src);
        Promise.resolve(movedCached || movedPromise).then(function (image) {
          if (!image || !active || !allowAsyncImages) return;
          var c = active.overlay.getContext("2d");
          c.save();
          c.drawImage(
            image,
            movedRect.x * width,
            movedRect.y * height,
            movedRect.w * width,
            movedRect.h * height
          );
          c.restore();
          if (selectedId === item.id) drawSelection(c, movedRect, width, height);
        });
      } else if (item.type === "image") {
        var imageCenter = canonicalToDisplay({ x: item.cx, y: item.cy }, rotation);
        var imageMin = Math.min(width, height);
        var imageW = (item.widthN || 0.25) * imageMin;
        var imageH = (item.heightN || 0.2) * imageMin;
        var imageAngle = normRotation((item.angle || 0) + rotation);
        var promise = getImage(item.src);
        var cached = imageCache.get(item.src);
        Promise.resolve(cached || promise).then(function (image) {
          if (!image) return;
          if (active && allowAsyncImages) {
            var c = active.overlay.getContext("2d");
            c.save();
            c.translate(imageCenter.x * width, imageCenter.y * height);
            c.rotate(imageAngle * Math.PI / 180);
            c.drawImage(image, -imageW / 2, -imageH / 2, imageW, imageH);
            c.restore();
            if (selectedId === item.id) {
              drawSelection(c, {
                x: imageCenter.x - imageW / width / 2,
                y: imageCenter.y - imageH / height / 2,
                w: imageW / width,
                h: imageH / height
              }, width, height);
            }
          }
        });
      } else {
        var rect = rectToDisplay(item, rotation);
        var x = rect.x * width;
        var y = rect.y * height;
        var w = rect.w * width;
        var h = rect.h * height;

        if (item.type === "highlight") {
          ctx.fillStyle = rgba(item.color || "#fff16b", 0.38);
          ctx.fillRect(x, y, w, h);
        } else if (item.type === "whiteout") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = "rgba(120,120,112,.32)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, w, h);
        } else if (item.type === "rect") {
          ctx.strokeStyle = item.color || "#e74a3b";
          ctx.lineWidth = Math.max(1, (item.width || 0.004) * minDim);
          ctx.strokeRect(x, y, w, h);
        }
      }

      ctx.restore();

      if (selectedId === item.id && item.type !== "image") {
        var box;
        if (item.type === "text") {
          var p = canonicalToDisplay({ x: item.x, y: item.y }, rotation);
          box = { x: p.x - 0.01, y: p.y - 0.01, w: 0.18, h: 0.07 };
        } else if (item.type === "pen") {
          var xs = [], ys = [];
          (item.points || []).forEach(function (point) {
            var q = canonicalToDisplay(point, rotation);
            xs.push(q.x); ys.push(q.y);
          });
          if (xs.length) {
            var minX = Math.min.apply(Math, xs);
            var maxX = Math.max.apply(Math, xs);
            var minY = Math.min.apply(Math, ys);
            var maxY = Math.max.apply(Math, ys);
            box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
          }
        } else if (item.type === "image") {
          var cpt = canonicalToDisplay({ x: item.cx, y: item.cy }, rotation);
          var md = Math.min(width, height);
          var iw = (item.widthN || 0.25) * md / width;
          var ih = (item.heightN || 0.2) * md / height;
          box = { x: cpt.x - iw / 2, y: cpt.y - ih / 2, w: iw, h: ih };
        } else {
          box = rectToDisplay(item, rotation);
        }
        if (box) drawSelection(ctx, box, width, height);
      }
    });
  }

  function drawSelection(ctx, rect, width, height) {
    ctx.save();
    ctx.strokeStyle = "#2f7ee6";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(rect.x * width - 3, rect.y * height - 3, rect.w * width + 6, rect.h * height + 6);
    ctx.restore();
  }

  async function drawAnnotationsAsync(ctx, annotations, width, height, options) {
    var minDim = Math.min(width, height);
    options = options || {};
    var strippedOriginals = new Set(options.strippedOriginals || []);
    var textEditIds = new Set(options.textEditIds || []);

    for (var i = 0; i < annotations.length; i++) {
      var item = annotations[i];
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (item.type === "pen") {
        if (item.points && item.points.length) {
          ctx.strokeStyle = item.color || "#e74a3b";
          ctx.lineWidth = Math.max(1, (item.width || 0.004) * minDim);
          ctx.beginPath();
          item.points.forEach(function (point, index) {
            var x = point.x * width;
            var y = point.y * height;
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
      } else if (item.type === "text") {
        var fontPx = Math.max(8, (item.size || 0.04) * minDim);
        ctx.translate(item.x * width, item.y * height);
        ctx.rotate(normRotation(item.angle || 0) * Math.PI / 180);
        ctx.fillStyle = item.color || "#111111";
        ctx.font =
          (item.italic ? "italic " : "") +
          (item.bold ? "700 " : "400 ") +
          fontPx + "px " + textFontCss(item);
        ctx.textBaseline = "top";
        String(item.text || "").split(/\r?\n/).forEach(function (line, index) {
          var lineY = index * fontPx * 1.2;
          ctx.fillText(line, 0, lineY);
          if (item.underline && line) {
            var lineWidth = ctx.measureText(line).width;
            ctx.save();
            ctx.strokeStyle = item.color || "#111111";
            ctx.lineWidth = Math.max(1, fontPx * 0.055);
            ctx.beginPath();
            ctx.moveTo(0, lineY + fontPx * 1.03);
            ctx.lineTo(lineWidth, lineY + fontPx * 1.03);
            ctx.stroke();
            ctx.restore();
          }
        });
      } else if (item.type === "textedit") {
        if (!textEditIds.has(item.id)) {
          ctx.restore();
          continue;
        }
        drawTextEditPreview(
          ctx,
          item,
          width,
          height,
          0,
          strippedOriginals.has(item.original)
        );
      } else if (item.type === "imagemove") {
        ctx.fillStyle = item.bg || "#ffffff";
        ctx.fillRect(
          item.originalX * width,
          item.originalY * height,
          item.originalW * width,
          item.originalH * height
        );
        var movedImage = await getImage(item.src);
        if (movedImage) {
          ctx.drawImage(
            movedImage,
            item.x * width,
            item.y * height,
            item.w * width,
            item.h * height
          );
        }
      } else if (item.type === "image") {
        var image = await getImage(item.src);
        if (image) {
          var imageMin = Math.min(width, height);
          var imageW = (item.widthN || 0.25) * imageMin;
          var imageH = (item.heightN || 0.2) * imageMin;
          ctx.translate(item.cx * width, item.cy * height);
          ctx.rotate(normRotation(item.angle || 0) * Math.PI / 180);
          ctx.drawImage(image, -imageW / 2, -imageH / 2, imageW, imageH);
        }
      } else {
        var x = item.x * width;
        var y = item.y * height;
        var w = item.w * width;
        var h = item.h * height;
        if (item.type === "highlight") {
          ctx.fillStyle = rgba(item.color || "#fff16b", 0.38);
          ctx.fillRect(x, y, w, h);
        } else if (item.type === "whiteout") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(x, y, w, h);
        } else if (item.type === "rect") {
          ctx.strokeStyle = item.color || "#e74a3b";
          ctx.lineWidth = Math.max(1, (item.width || 0.004) * minDim);
          ctx.strokeRect(x, y, w, h);
        }
      }
      ctx.restore();
    }
  }

  async function exportOverlay(pageId, pageWidth, pageHeight, options) {
    options = options || {};
    var annotations = host().getAnnotations(pageId);
    var textEditIds = new Set(options.textEditIds || []);
    annotations = annotations.filter(function (item) {
      return item.type !== "textedit" || textEditIds.has(item.id);
    });
    if (!annotations.length) return null;

    var maxDim = Math.max(pageWidth, pageHeight);
    var scale = Math.min(2, 3000 / Math.max(1, maxDim));
    scale = Math.max(0.75, scale);

    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(pageWidth * scale));
    canvas.height = Math.max(1, Math.round(pageHeight * scale));

    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await drawAnnotationsAsync(ctx, annotations, canvas.width, canvas.height, options);

    var blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }

  function copySelectedObject() {
    if (!active || !active.selectedId) return false;
    var item = active.annotations.find(function (annotation) {
      return annotation.id === active.selectedId;
    });
    if (!item) return false;

    var copied = copy(item);
    delete copied.id;

    if (copied.type === "textedit") {
      copied = {
        type: "text",
        x: copied.x,
        y: copied.y,
        text: copied.text || "",
        color: copied.color || "#111111",
        size: copied.size || 0.03,
        fontFamily: copied.fontFamily || (copied.family === "serif" ? "Times New Roman" : copied.family === "mono" ? "Courier New" : "Helvetica"),
        bold: !!copied.bold,
        italic: !!copied.italic,
        underline: !!copied.underline,
        angle: normRotation(-active.rotation)
      };
    }

    if (copied.type === "imagemove") {
      copied.sourceKey = "";
      copied.originalX = copied.x;
      copied.originalY = copied.y;
      copied.originalW = 0;
      copied.originalH = 0;
    }

    objectClipboard = [copied];
    host().showToast("Object copied");
    return true;
  }

  function offsetPastedObject(item, amount) {
    var delta = amount || 0.025;
    if (item.type === "pen") {
      item.points = (item.points || []).map(function (point) {
        return {
          x: clamp(point.x + delta, 0, 1),
          y: clamp(point.y + delta, 0, 1)
        };
      });
      return;
    }
    if (item.type === "image") {
      item.cx = clamp((item.cx || 0.5) + delta, 0, 1);
      item.cy = clamp((item.cy || 0.5) + delta, 0, 1);
      return;
    }
    if (typeof item.x === "number") item.x = clamp(item.x + delta, 0, 1);
    if (typeof item.y === "number") item.y = clamp(item.y + delta, 0, 1);
  }

  function pasteObject() {
    if (!active || !objectClipboard.length) return false;
    pushLocalHistory();

    var last = null;
    objectClipboard.forEach(function (source, index) {
      var item = copy(source);
      item.id = host().uid("edit");
      offsetPastedObject(item, 0.025 + index * 0.012);
      active.annotations.push(item);
      last = item;
    });

    active.selectedId = last ? last.id : null;
    active.status.textContent = objectClipboard.length === 1 ? "Object pasted" : "Objects pasted";
    draw();
    return true;
  }

  function cutSelectedObject() {
    if (!copySelectedObject() || !active) return false;
    pushLocalHistory();
    active.annotations = active.annotations.filter(function (item) {
      return item.id !== active.selectedId;
    });
    active.selectedId = null;
    active.status.textContent = "Object cut";
    draw();
    return true;
  }

  function duplicateSelectedObject() {
    if (!copySelectedObject()) return false;
    return pasteObject();
  }

  function keydown(event) {
    if (!active) return;

    var directTextTarget =
      event.target &&
      event.target.closest &&
      event.target.closest(".pdf-editor-direct-text");
    if (directTextTarget) return;

    var modifier = event.metaKey || event.ctrlKey;
    var key = event.key.toLowerCase();

    if (event.key === "Insert") {
      event.preventDefault();
      if (host().addBlankPage) host().addBlankPage();
      return;
    }

    if (modifier && key === "c") {
      event.preventDefault();
      if (!copySelectedObject()) {
        objectClipboard = [];
        if (host().copySelectedPages) host().copySelectedPages();
      }
      return;
    }

    if (modifier && key === "x") {
      event.preventDefault();
      if (!cutSelectedObject()) {
        objectClipboard = [];
        if (host().cutSelectedPages) host().cutSelectedPages();
      }
      return;
    }

    if (modifier && key === "v") {
      event.preventDefault();
      if (!pasteObject() && host().pastePages) host().pastePages();
      return;
    }

    if (modifier && key === "d") {
      event.preventDefault();
      if (!duplicateSelectedObject() && host().duplicateSelected) host().duplicateSelected();
      return;
    }

    if (event.code === "Space" && !modifier) {
      active.spacePan = true;
      active.stageWrap.classList.add("is-pan-ready");
      event.preventDefault();
      return;
    }
    if (modifier && (key === "+" || key === "=")) {
      event.preventDefault();
      setZoom(active.zoom * 1.2);
      return;
    }
    if (modifier && key === "-") {
      event.preventDefault();
      setZoom(active.zoom / 1.2);
      return;
    }
    if (modifier && key === "0") {
      event.preventDefault();
      fitPage();
      return;
    }

    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) localRedo();
      else localUndo();
      return;
    }
    if (modifier && key === "y") {
      event.preventDefault();
      localRedo();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && active.selectedId) {
      event.preventDefault();
      pushLocalHistory();
      active.annotations = active.annotations.filter(function (item) { return item.id !== active.selectedId; });
      active.selectedId = null;
      draw();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();

      if (active.selectedId) {
        active.selectedId = null;
        draw();
        return;
      }

      if (active.tool !== "select") {
        setTool("select");
        active.status.textContent = "Selection mode";
        return;
      }

      if (!active.embedded) {
        close(false);
      }
    }
  }

  window.iWeatherPDFEditor = {
    open: open,
    close: close,
    save: saveCurrent,
    exportOverlay: exportOverlay
  };
})();
