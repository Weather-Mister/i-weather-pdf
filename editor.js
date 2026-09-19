(function () {
  "use strict";

  var active = null;
  var imageCache = new Map();

  function host() {
    if (!window.iWeatherPDFEditorHost) throw new Error("Editor host is unavailable");
    return window.iWeatherPDFEditorHost;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
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
    return promise;
  }

  function pushLocalHistory() {
    if (!active) return;
    active.undo.push(copy(active.annotations));
    if (active.undo.length > 50) active.undo.shift();
    active.redo = [];
    updateUndoRedo();
  }

  function localUndo() {
    if (!active || !active.undo.length) return;
    active.redo.push(copy(active.annotations));
    active.annotations = active.undo.pop();
    active.selectedId = null;
    draw();
    updateUndoRedo();
  }

  function localRedo() {
    if (!active || !active.redo.length) return;
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

  function makeButton(label, className, onClick, title) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className || "pdf-editor-btn";
    button.textContent = label;
    button.title = title || label;
    button.addEventListener("click", onClick);
    return button;
  }

  function setTool(tool) {
    if (!active) return;
    active.tool = tool;
    active.selectedId = null;
    active.toolButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.tool === tool);
    });
    active.overlay.classList.toggle("select", tool === "select");
    active.status.textContent =
      tool === "select" ? "Tap an edit to select and drag it" :
      tool === "text" ? "Tap anywhere to add text" :
      tool === "pen" ? "Draw directly on the page" :
      tool === "highlight" ? "Drag across an area to highlight" :
      tool === "rect" ? "Drag to draw a rectangle" :
      tool === "whiteout" ? "Drag to cover an area" :
      tool === "image" ? "Choose an image, then place it" : "Edit";
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
    active.toolButtons.push(button);
    return button;
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

    var stageWrap = document.createElement("div");
    stageWrap.className = "pdf-editor-stage-wrap";
    var stage = document.createElement("div");
    stage.className = "pdf-editor-stage";
    var pageCanvas = document.createElement("canvas");
    pageCanvas.className = "pdf-editor-page";
    var overlay = document.createElement("canvas");
    overlay.className = "pdf-editor-overlay";
    var status = document.createElement("div");
    status.className = "pdf-editor-status";
    stage.append(pageCanvas, overlay, status);
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
      status: status,
      annotations: h.getAnnotations(pageId),
      original: h.getAnnotations(pageId),
      undo: [],
      redo: [],
      selectedId: null,
      tool: "select",
      color: color,
      stroke: stroke,
      size: size,
      undoButton: undoButton,
      redoButton: redoButton,
      toolButtons: [],
      imageInput: imageInput,
      rotation: normRotation(page.rotation || 0),
      pointer: null,
      embedded: embedded,
      mount: options.mount || null
    };

    toolList.append(
      createToolButton("Select", "select"),
      createToolButton("Text", "text"),
      createToolButton("Pen", "pen"),
      createToolButton("Highlight", "highlight"),
      createToolButton("Rectangle", "rect"),
      createToolButton("Whiteout", "whiteout"),
      createToolButton("Image", "image")
    );
    props.append(color, stroke, size, remove);
    tools.append(toolList, props, imageInput);

    shell.append(topbar, tools, stageWrap);
    backdrop.append(shell);
    if (embedded) {
      options.mount.replaceChildren(backdrop);
    } else {
      document.body.append(backdrop);
      document.body.classList.add("pdf-editor-open");
    }

    overlay.addEventListener("pointerdown", pointerDown);
    overlay.addEventListener("pointermove", pointerMove);
    overlay.addEventListener("pointerup", pointerUp);
    overlay.addEventListener("pointercancel", pointerUp);

    imageInput.addEventListener("change", async function () {
      var file = imageInput.files && imageInput.files[0];
      imageInput.value = "";
      if (!file) return;
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 12 * 1024 * 1024) {
        h.showToast("Use a PNG, JPEG, or WebP image under 12 MB.");
        return;
      }
      var src = await readDataUrl(file);
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

    window.addEventListener("keydown", keydown, true);

    try {
      var mountWidth = embedded ? Math.max(260, options.mount.clientWidth - 36) : window.innerWidth - 70;
      var mountHeight = embedded ? Math.max(320, options.mount.clientHeight - 118) : window.innerHeight - 150;
      var maxWidth = Math.min(1200, Math.max(260, mountWidth));
      var maxHeight = Math.max(320, mountHeight);
      var dims = await h.renderPage(pageId, pageCanvas, maxWidth, maxHeight);
      if (!active || active.pageId !== pageId) return;
      stage.style.width = dims.width + "px";
      stage.style.height = dims.height + "px";
      pageCanvas.style.width = dims.width + "px";
      pageCanvas.style.height = dims.height + "px";
      resizeOverlay(dims.width, dims.height);
      active.rotation = dims.rotation;
      setTool("select");
      updateUndoRedo();
      draw();
    } catch (error) {
      console.error(error);
      h.showToast("Could not open the page editor.");
      close(false);
    }
  }

  function hasChanges(current) {
    if (!current) return false;
    try {
      return JSON.stringify(current.annotations || []) !== JSON.stringify(current.original || []);
    } catch (_) {
      return true;
    }
  }

  function saveCurrent() {
    if (!active) return false;
    if (!hasChanges(active)) {
      active.status.textContent = "Saved";
      return false;
    }
    host().commitAnnotations(active.pageId, active.annotations, true, !!active.embedded);
    active.original = copy(active.annotations);
    active.undo = [];
    active.redo = [];
    updateUndoRedo();
    active.status.textContent = "Saved";
    return true;
  }

  function close(save) {
    if (!active) return;
    var current = active;
    window.removeEventListener("keydown", keydown, true);
    if (save && hasChanges(current)) {
      host().commitAnnotations(current.pageId, current.annotations, true, !!current.embedded);
    }
    current.backdrop.remove();
    if (!current.embedded) document.body.classList.remove("pdf-editor-open");
    active = null;
  }

  function resizeOverlay(cssWidth, cssHeight) {
    if (!active) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
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

  function pointFromEvent(event) {
    var rect = active.overlay.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function pointerDown(event) {
    if (!active || event.button > 0) return;
    event.preventDefault();
    try { active.overlay.setPointerCapture(event.pointerId); } catch (_) {}

    var displayPoint = pointFromEvent(event);
    var canonical = displayToCanonical(displayPoint, active.rotation);
    var minDim = Math.min(active.overlay.clientWidth, active.overlay.clientHeight);
    var widthN = Number(active.stroke.value) / Math.max(1, minDim);

    if (active.tool === "select") {
      var hit = hitTest(displayPoint);
      active.selectedId = hit ? hit.id : null;
      if (hit) {
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

    if (active.tool === "text") {
      var text = window.prompt("Text to add:");
      if (!text) return;
      pushLocalHistory();
      active.annotations.push({
        id: host().uid("edit"),
        type: "text",
        x: canonical.x,
        y: canonical.y,
        text: text.slice(0, 2000),
        color: active.color.value,
        size: Number(active.size.value) / Math.max(1, minDim),
        angle: normRotation(-active.rotation)
      });
      active.selectedId = active.annotations[active.annotations.length - 1].id;
      draw();
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
    var displayPoint = pointFromEvent(event);
    var canonical = displayToCanonical(displayPoint, active.rotation);
    var pointer = active.pointer;
    var item = active.annotations.find(function (annotation) {
      return annotation.id === (pointer.annotationId || active.selectedId);
    });
    if (!item) return;

    if (pointer.mode === "pen") {
      var last = item.points[item.points.length - 1];
      if (!last || Math.abs(last.x - canonical.x) + Math.abs(last.y - canonical.y) > 0.0015) {
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
    var canvas = active.overlay;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawAnnotations(ctx, active.annotations, canvas.width, canvas.height, active.rotation, active.selectedId, true);
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
        ctx.font = "600 " + fontPx + "px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";
        ctx.textBaseline = "top";
        var lines = String(item.text || "").split(/\r?\n/);
        lines.forEach(function (line, index) {
          ctx.fillText(line, 0, index * fontPx * 1.2);
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

  async function drawAnnotationsAsync(ctx, annotations, width, height) {
    var minDim = Math.min(width, height);

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
        ctx.font = "600 " + fontPx + "px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif";
        ctx.textBaseline = "top";
        String(item.text || "").split(/\r?\n/).forEach(function (line, index) {
          ctx.fillText(line, 0, index * fontPx * 1.2);
        });
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

  async function exportOverlay(pageId, pageWidth, pageHeight) {
    var annotations = host().getAnnotations(pageId);
    if (!annotations.length) return null;

    var maxDim = Math.max(pageWidth, pageHeight);
    var scale = Math.min(2, 3000 / Math.max(1, maxDim));
    scale = Math.max(0.75, scale);

    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(pageWidth * scale));
    canvas.height = Math.max(1, Math.round(pageHeight * scale));

    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    await drawAnnotationsAsync(ctx, annotations, canvas.width, canvas.height);

    var blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  }

  function keydown(event) {
    if (!active) return;
    var modifier = event.metaKey || event.ctrlKey;
    var key = event.key.toLowerCase();

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
      } else {
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
