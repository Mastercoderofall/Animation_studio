(() => {
  "use strict";

  const WIDTH = 960;
  const HEIGHT = 540;
  const MAX_HISTORY = 40;
  const drawingCanvas = document.querySelector("#drawing-canvas");
  const onionCanvas = document.querySelector("#onion-canvas");
  const drawingContext = drawingCanvas.getContext("2d");
  const onionContext = onionCanvas.getContext("2d");
  const track = document.querySelector("#frame-track");
  const hint = document.querySelector("#canvas-hint");
  const brushSizeInput = document.querySelector("#brush-size");
  const brushColorInput = document.querySelector("#brush-color");
  const fpsInput = document.querySelector("#fps-input");
  const frames = [{ image: null, history: [], historyIndex: -1, name: "Frame 01", duration: 1000 / 12, group: "" }];
  let activeFrame = 0;
  let selectedFrames = new Set([0]);
  let contextFrame = 0;
  let tool = "brush";
  let brushSize = Number(brushSizeInput.value);
  let brushColor = brushColorInput.value;
  let brushOpacity = 1;
  let colorOpacity = 1;
  let brushFlow = 1;
  let brushHardness = 0.7;
  let brushSmoothing = 0.2;
  let stabilizer = false;
  let onionSkin = true;
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  let panStart = null;
  let drawing = false;
  let lastPoint = null;
  let strokeStart = null;
  let strokeSnapshot = null;
  let playing = false;
  let playbackTimer = null;
  let toastTimer = null;
  let dragIndex = null;
  const recentColors = [];

  for (const canvas of [drawingCanvas, onionCanvas]) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
  }
  drawingContext.lineCap = "round";
  drawingContext.lineJoin = "round";
  onionContext.lineCap = "round";
  onionContext.lineJoin = "round";
  saveHistory(frames[0]);
  renderTimeline();
  renderActiveFrame();

  function saveHistory(frame) {
    const snapshot = frame.image;
    if (frame.history[frame.historyIndex] === snapshot) return;
    frame.history = frame.history.slice(0, frame.historyIndex + 1);
    frame.history.push(snapshot);
    if (frame.history.length > MAX_HISTORY) frame.history.shift();
    frame.historyIndex = frame.history.length - 1;
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load this frame image."));
      image.src = source;
    });
  }

  async function drawSnapshot(context, snapshot) {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    if (!snapshot) return;
    const image = await loadImage(snapshot);
    context.drawImage(image, 0, 0, WIDTH, HEIGHT);
  }

  async function renderActiveFrame() {
    const frame = frames[activeFrame];
    await drawSnapshot(drawingContext, frame.image);
    await updateOnion();
    hint.classList.toggle("hidden", Boolean(frame.image));
    document.querySelector("#canvas-frame-label").textContent = frame.name.toUpperCase();
    document.querySelector("#undo-button").disabled = frame.historyIndex <= 0;
    document.querySelector("#redo-button").disabled = frame.historyIndex >= frame.history.length - 1;
    renderTimeline();
  }

  function renderTimeline() {
    track.replaceChildren();
    frames.forEach((frame, index) => {
      const card = document.createElement("div");
      card.className = `frame-card${index === activeFrame ? " selected" : ""}${selectedFrames.has(index) ? " multi-selected" : ""}`;
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `${frame.name}${index === activeFrame ? ", selected" : ""}`);
      card.setAttribute("aria-pressed", String(selectedFrames.has(index)));
      card.draggable = true;
      const thumbnail = document.createElement("canvas");
      thumbnail.width = 192;
      thumbnail.height = 108;
      thumbnail.className = "frame-thumbnail";
      if (frame.image) {
        const image = new Image();
        image.onload = () => thumbnail.getContext("2d").drawImage(image, 0, 0, 192, 108);
        image.src = frame.image;
      }
      const meta = document.createElement("span");
      meta.className = "frame-meta";
      const name = document.createElement("span");
      name.className = "frame-name";
      name.textContent = `${String(index + 1).padStart(2, "0")} · ${frame.name}`;
      name.title = frame.group ? `${frame.name} · ${frame.group}` : frame.name;
      const duration = document.createElement("span");
      duration.className = "frame-duration";
      duration.textContent = `${Math.round(frame.duration)} ms`;
      meta.append(name, duration);
      const actions = document.createElement("span");
      actions.className = "frame-card-actions";
      actions.innerHTML = '<button type="button" class="frame-card-action" data-action="duplicate" title="Duplicate frame" aria-label="Duplicate frame">⧉</button><button type="button" class="frame-card-action delete-action" data-action="delete" title="Delete frame" aria-label="Delete frame">×</button>';
      card.append(thumbnail, actions, meta);
      card.addEventListener("click", (event) => {
        if (event.target.closest(".frame-card-action")) return;
        selectFrame(index, event.shiftKey || event.metaKey || event.ctrlKey);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectFrame(index, event.shiftKey); }
      });
      actions.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "duplicate") duplicateFrame(index);
        if (action === "delete") deleteFrame(index);
      });
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        contextFrame = index;
        const menu = document.querySelector("#frame-context-menu");
        menu.hidden = false;
        menu.style.left = `${Math.min(event.clientX, window.innerWidth - 190)}px`;
        menu.style.top = `${Math.min(event.clientY, window.innerHeight - 170)}px`;
      });
      card.addEventListener("dragstart", (event) => {
        dragIndex = index;
        card.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", () => {
        dragIndex = null;
        card.classList.remove("dragging");
        track.querySelectorAll(".drag-over").forEach((item) => item.classList.remove("drag-over"));
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (dragIndex !== null && dragIndex !== index) card.classList.add("drag-over");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drag-over"));
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        if (dragIndex === null || dragIndex === index) return;
        const [moved] = frames.splice(dragIndex, 1);
        frames.splice(index, 0, moved);
        if (activeFrame === dragIndex) activeFrame = index;
        else if (dragIndex < activeFrame && index >= activeFrame) activeFrame -= 1;
        else if (dragIndex > activeFrame && index <= activeFrame) activeFrame += 1;
        selectedFrames = new Set([activeFrame]);
        renderActiveFrame();
      });
      track.append(card);
    });
    document.querySelector("#frame-count").textContent = `${frames.length} ${frames.length === 1 ? "frame" : "frames"}`;
  }

  function selectFrame(index, additive = false) {
    if (playing || index === activeFrame) return;
    if (additive) {
      if (selectedFrames.has(index)) selectedFrames.delete(index);
      else selectedFrames.add(index);
    } else selectedFrames = new Set([index]);
    activeFrame = index;
    renderActiveFrame();
  }

  function makeFrameCopy(source) {
    return { image: source.image, history: [source.image], historyIndex: 0, name: `${source.name} copy`, duration: source.duration, group: source.group || "" };
  }

  function duplicateFrame(index = activeFrame) {
    frames.splice(index + 1, 0, makeFrameCopy(frames[index]));
    activeFrame = index + 1;
    selectedFrames = new Set([activeFrame]);
    renderActiveFrame();
    showToast("Frame duplicated");
  }

  function deleteFrame(index = activeFrame) {
    if (frames.length === 1) {
      frames[0] = { image: null, history: [], historyIndex: -1, name: "Frame 01", duration: 1000 / Number(fpsInput.value || 12), group: "" };
      saveHistory(frames[0]);
      activeFrame = 0;
    } else {
      frames.splice(index, 1);
      activeFrame = Math.min(activeFrame > index ? activeFrame - 1 : activeFrame, frames.length - 1);
    }
    selectedFrames = new Set([activeFrame]);
    renderActiveFrame();
  }

  function getCanvasPoint(event) {
    const rect = drawingCanvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * WIDTH / rect.width,
      y: (event.clientY - rect.top) * HEIGHT / rect.height
    };
  }

  drawingCanvas.addEventListener("pointerdown", (event) => {
    if (playing || event.button !== 0) return;
    if (tool === "hand") {
      panStart = { x: event.clientX - pan.x, y: event.clientY - pan.y };
      drawingCanvas.setPointerCapture(event.pointerId);
      return;
    }
    if (document.querySelector(".layer-row.active .layer-lock.locked")) {
      showToast("Unlock the selected layer before drawing");
      return;
    }
    if (tool === "eyedropper") {
      const point = getCanvasPoint(event);
      const rgba = drawingContext.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
      if (rgba[3]) setColor(`#${[...rgba].slice(0, 3).map((value) => value.toString(16).padStart(2, "0")).join("")}`);
      return;
    }
    if (tool === "fill") {
      floodFill(getCanvasPoint(event));
      return;
    }
    drawing = true;
    drawingCanvas.setPointerCapture(event.pointerId);
    lastPoint = getCanvasPoint(event);
    strokeStart = lastPoint;
    strokeSnapshot = drawingContext.getImageData(0, 0, WIDTH, HEIGHT);
    drawingContext.beginPath();
    drawingContext.moveTo(lastPoint.x, lastPoint.y);
    drawingContext.lineTo(lastPoint.x, lastPoint.y);
    if (!["line", "rectangle", "circle", "triangle"].includes(tool)) paintSegment(lastPoint, lastPoint);
  });

  drawingCanvas.addEventListener("pointermove", (event) => {
    if (panStart) {
      pan = { x: event.clientX - panStart.x, y: event.clientY - panStart.y };
      applyCanvasTransform();
      return;
    }
    if (!drawing) return;
    let point = getCanvasPoint(event);
    if (stabilizer || brushSmoothing > 0) {
      const factor = stabilizer ? Math.max(0.12, 1 - brushSmoothing * 0.8) : 1 - brushSmoothing * 0.45;
      point = { x: lastPoint.x + (point.x - lastPoint.x) * factor, y: lastPoint.y + (point.y - lastPoint.y) * factor };
    }
    if (["line", "rectangle", "circle", "triangle"].includes(tool)) {
      drawShape(point);
      lastPoint = point;
      return;
    }
    paintSegment(lastPoint, point);
    lastPoint = point;
  });

  function paintSegment(from, to) {
    drawingContext.save();
    drawingContext.globalAlpha = brushOpacity * colorOpacity * brushFlow * (tool === "highlighter" ? 0.35 : (tool === "marker" ? 0.72 : 1));
    drawingContext.globalCompositeOperation = tool === "eraser" ? "destination-out" : (tool === "highlighter" ? "multiply" : "source-over");
    drawingContext.lineCap = tool === "pixel" ? "square" : "round";
    drawingContext.lineJoin = "round";
    drawingContext.lineWidth = tool === "calligraphy" ? Math.max(1, brushSize * Math.abs(Math.sin(Math.atan2(to.y - from.y, to.x - from.x)))) : (tool === "marker" ? brushSize * 1.8 : brushSize);
    drawingContext.strokeStyle = brushColor;
    drawingContext.fillStyle = brushColor;
    if (tool === "airbrush") drawingContext.shadowColor = brushColor, drawingContext.shadowBlur = brushSize * (1 - brushHardness) * 2 + 4;
    drawingContext.beginPath();
    drawingContext.moveTo(from.x, from.y);
    drawingContext.lineTo(to.x, to.y);
    drawingContext.stroke();
    drawingContext.restore();
  }

  function drawShape(end) {
    drawingContext.putImageData(strokeSnapshot, 0, 0);
    drawingContext.save();
    drawingContext.globalAlpha = brushOpacity * colorOpacity;
    drawingContext.strokeStyle = brushColor;
    drawingContext.lineWidth = brushSize;
    drawingContext.beginPath();
    if (tool === "line") {
      drawingContext.moveTo(strokeStart.x, strokeStart.y);
      drawingContext.lineTo(end.x, end.y);
    } else if (tool === "rectangle") {
      drawingContext.rect(strokeStart.x, strokeStart.y, end.x - strokeStart.x, end.y - strokeStart.y);
    } else if (tool === "circle") {
      const dx = end.x - strokeStart.x, dy = end.y - strokeStart.y;
      drawingContext.ellipse(strokeStart.x + dx / 2, strokeStart.y + dy / 2, Math.abs(dx / 2), Math.abs(dy / 2), 0, 0, Math.PI * 2);
    } else {
      drawingContext.moveTo(strokeStart.x, end.y);
      drawingContext.lineTo(strokeStart.x + (end.x - strokeStart.x) / 2, strokeStart.y);
      drawingContext.lineTo(end.x, end.y);
      drawingContext.closePath();
    }
    drawingContext.stroke();
    drawingContext.restore();
  }

  function floodFill(point) {
    const x = Math.floor(point.x), y = Math.floor(point.y);
    const image = drawingContext.getImageData(0, 0, WIDTH, HEIGHT);
    const data = image.data;
    const start = (y * WIDTH + x) * 4;
    const target = [...data.slice(start, start + 4)];
    const fill = [parseInt(brushColor.slice(1, 3), 16), parseInt(brushColor.slice(3, 5), 16), parseInt(brushColor.slice(5, 7), 16), Math.round(255 * brushOpacity * colorOpacity)];
    if (target.every((value, index) => value === fill[index])) return;
    const stack = [];
    const pushIfMatch = (px, py) => {
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) return;
      const offset = (py * WIDTH + px) * 4;
      if (data[offset] !== target[0] || data[offset + 1] !== target[1] || data[offset + 2] !== target[2] || data[offset + 3] !== target[3]) return;
      data.set(fill, offset);
      stack.push([px, py]);
    };
    pushIfMatch(x, y);
    while (stack.length) {
      const [px, py] = stack.pop();
      pushIfMatch(px + 1, py);
      pushIfMatch(px - 1, py);
      pushIfMatch(px, py + 1);
      pushIfMatch(px, py - 1);
    }
    drawingContext.putImageData(image, 0, 0);
    frames[activeFrame].image = drawingCanvas.toDataURL("image/png");
    saveHistory(frames[activeFrame]);
    hint.classList.add("hidden");
    renderTimeline();
    updateHistoryButtons();
  }

  function finishStroke() {
    if (panStart) { panStart = null; return; }
    if (!drawing) return;
    drawing = false;
    drawingContext.globalCompositeOperation = "source-over";
    lastPoint = null;
    frames[activeFrame].image = drawingCanvas.toDataURL("image/png");
    saveHistory(frames[activeFrame]);
    hint.classList.add("hidden");
    renderTimeline();
    updateHistoryButtons();
  }
  drawingCanvas.addEventListener("pointerup", finishStroke);
  drawingCanvas.addEventListener("pointercancel", finishStroke);
  drawingCanvas.addEventListener("lostpointercapture", finishStroke);

  function updateHistoryButtons() {
    const frame = frames[activeFrame];
    document.querySelector("#undo-button").disabled = frame.historyIndex <= 0;
    document.querySelector("#redo-button").disabled = frame.historyIndex >= frame.history.length - 1;
  }

  async function travelHistory(direction) {
    const frame = frames[activeFrame];
    const nextIndex = frame.historyIndex + direction;
    if (nextIndex < 0 || nextIndex >= frame.history.length) return;
    frame.historyIndex = nextIndex;
    frame.image = frame.history[nextIndex];
    await drawSnapshot(drawingContext, frame.image);
    hint.classList.toggle("hidden", Boolean(frame.image));
    updateHistoryButtons();
    renderTimeline();
    updateOnion();
  }

  async function updateOnion() {
    onionContext.clearRect(0, 0, WIDTH, HEIGHT);
    if (!onionSkin || frames.length < 2) return;
    const previousCount = Number(document.querySelector("#onion-previous").value);
    const nextCount = Number(document.querySelector("#onion-next").value);
    const alpha = Number(document.querySelector("#onion-opacity").value) / 100;
    const tint = document.querySelector("#onion-tint").value;
    const drawTinted = async (frameIndex, direction, distance) => {
      const source = frames[frameIndex]?.image;
      if (!source) return;
      const image = await loadImage(source);
      const layer = document.createElement("canvas");
      layer.width = WIDTH;
      layer.height = HEIGHT;
      const context = layer.getContext("2d");
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = tint;
      context.fillRect(0, 0, WIDTH, HEIGHT);
      onionContext.globalAlpha = alpha / distance;
      onionContext.drawImage(layer, 0, 0);
      onionContext.globalAlpha = 1;
    };
    try {
      for (let distance = previousCount; distance >= 1; distance -= 1) {
        const index = activeFrame - distance;
        if (index >= 0) await drawTinted(index, -1, distance);
      }
      for (let distance = nextCount; distance >= 1; distance -= 1) {
        const index = activeFrame + distance;
        if (index < frames.length) await drawTinted(index, 1, distance);
      }
    } catch (error) {
      showError(error);
    }
  }

  function setTool(nextTool) {
    tool = nextTool;
    document.querySelectorAll(".tool-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    drawingCanvas.style.cursor = tool === "eraser" ? "cell" : (tool === "hand" ? "grab" : "crosshair");
  }

  document.querySelectorAll(".tool-button").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  brushSizeInput.addEventListener("input", () => {
    brushSize = Number(brushSizeInput.value);
    document.querySelector("#brush-size-value").textContent = `${brushSize} px`;
    const progress = ((brushSize - 1) / 39) * 100;
    brushSizeInput.style.background = `linear-gradient(to right,var(--accent) 0%,var(--accent) ${progress}%,#3b3947 ${progress}%,#3b3947 100%)`;
  });
  brushColorInput.addEventListener("input", () => {
    brushColor = brushColorInput.value;
    syncColorFields();
    if (recentColors[0] !== brushColor) recentColors.unshift(brushColor);
    recentColors.splice(8);
    renderRecentColors();
  });
  document.querySelectorAll(".swatch").forEach((swatch) => swatch.addEventListener("click", () => {
    brushColorInput.value = swatch.dataset.color;
    brushColorInput.dispatchEvent(new Event("input"));
  }));
  document.querySelector("#onion-toggle").addEventListener("click", (event) => {
    onionSkin = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(onionSkin));
    updateOnion();
  });
  document.querySelector("#undo-button").addEventListener("click", () => travelHistory(-1));
  document.querySelector("#redo-button").addEventListener("click", () => travelHistory(1));

  document.querySelector("#clear-frame").addEventListener("click", () => {
    drawingContext.clearRect(0, 0, WIDTH, HEIGHT);
    frames[activeFrame].image = null;
    saveHistory(frames[activeFrame]);
    hint.classList.remove("hidden");
    renderTimeline();
    updateHistoryButtons();
  });

  const settingInputs = [
    ["#brush-opacity", "#brush-opacity-value", (value) => { brushOpacity = value / 100; }],
    ["#brush-flow", "#brush-flow-value", (value) => { brushFlow = value / 100; }],
    ["#brush-hardness", "#brush-hardness-value", (value) => { brushHardness = value / 100; }],
    ["#brush-smoothing", "#brush-smoothing-value", (value) => { brushSmoothing = value / 100; }],
    ["#onion-previous", "#onion-previous-value", updateOnion],
    ["#onion-next", "#onion-next-value", updateOnion],
    ["#onion-opacity", "#onion-opacity-value", updateOnion]
  ];
  settingInputs.forEach(([inputSelector, valueSelector, callback]) => {
    const input = document.querySelector(inputSelector);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      document.querySelector(valueSelector).textContent = `${value}${inputSelector.includes("onion-previous") || inputSelector.includes("onion-next") ? "" : "%"}`;
      callback(value);
    });
  });
  document.querySelector("#brush-stabilizer").addEventListener("change", (event) => { stabilizer = event.target.checked; });
  document.querySelector("#color-opacity").addEventListener("input", (event) => {
    colorOpacity = Number(event.target.value) / 100;
    document.querySelector("#color-opacity-value").textContent = `${event.target.value}%`;
  });
  document.querySelector("#onion-tint").addEventListener("input", updateOnion);
  document.querySelector("#color-r").addEventListener("change", syncRgbColor);
  document.querySelector("#color-g").addEventListener("change", syncRgbColor);
  document.querySelector("#color-b").addEventListener("change", syncRgbColor);
  ["h", "s", "l"].forEach((key) => document.querySelector(`#color-${key}`).addEventListener("change", syncHslColor));
  const presets = {
    Neon: ["#f72585", "#b5179e", "#7209b7", "#4361ee", "#4cc9f0", "#f9c74f"],
    Pastel: ["#ffadad", "#ffd6a5", "#fdffb6", "#caffbf", "#9bf6ff", "#bdb2ff"],
    Anime: ["#ff5c8a", "#ffc857", "#3da5d9", "#72d6c9", "#b388eb", "#f7f7ff"],
    "Pixel Art": ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070"],
    "Dark Mode": ["#0f172a", "#334155", "#64748b", "#94a3b8", "#cbd5e1", "#a78bfa"],
    Nature: ["#264653", "#2a9d8f", "#8ab17d", "#e9c46a", "#f4a261", "#e76f51"],
    Sunset: ["#560bad", "#b5179e", "#f72585", "#ff6b6b", "#fca311", "#ffd166"],
    Cyberpunk: ["#ff00a8", "#00f5d4", "#9b5de5", "#00bbf9", "#fee440", "#f15bb5"],
    Custom: []
  };
  let customPalette = [];
  function renderPalette(colors) {
    const swatches = document.querySelector(".color-swatches");
    swatches.replaceChildren();
    colors.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.className = "swatch";
      swatch.style.setProperty("--swatch", color);
      swatch.dataset.color = color;
      swatch.title = color.toUpperCase();
      swatch.setAttribute("aria-label", `Use ${color}`);
      swatch.addEventListener("click", () => setColor(color));
      swatches.append(swatch);
    });
  }
  document.querySelector("#palette-select").addEventListener("change", (event) => {
    renderPalette(event.target.value === "Custom" ? customPalette : presets[event.target.value]);
  });
  renderPalette(presets.Neon);
  document.querySelector("#palette-save").addEventListener("click", () => {
    if (!customPalette.includes(brushColor)) customPalette.push(brushColor);
    document.querySelector("#palette-select").value = "Custom";
    renderPalette(customPalette);
    showToast("Color saved to custom palette");
  });
  function setColor(color) {
    brushColorInput.value = color;
    brushColorInput.dispatchEvent(new Event("input"));
  }
  document.querySelector("#color-value").addEventListener("change", (event) => {
    const value = event.target.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) setColor(value);
    else event.target.value = brushColor.toUpperCase();
  });
  function renderRecentColors() {
    const container = document.querySelector("#recent-colors");
    container.replaceChildren();
    recentColors.forEach((color) => {
      const swatch = document.createElement("button");
      swatch.className = "swatch";
      swatch.style.setProperty("--swatch", color);
      swatch.title = `Recent ${color}`;
      swatch.setAttribute("aria-label", `Use recent color ${color}`);
      swatch.addEventListener("click", () => setColor(color));
      container.append(swatch);
    });
  }
  function syncColorFields() {
    brushColor = brushColorInput.value;
    document.querySelector("#color-value").value = brushColor.toUpperCase();
    const [r, g, b] = [1, 3, 5].map((offset) => parseInt(brushColor.slice(offset, offset + 2), 16));
    ["r", "g", "b"].forEach((key, index) => { document.querySelector(`#color-${key}`).value = [r, g, b][index]; });
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    const delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r / 255) h = ((g - b) / 255 / delta) % 6;
      else if (max === g / 255) h = (b - r) / 255 / delta + 2;
      else h = (r - g) / 255 / delta + 4;
    }
    h = (h * 60 + 360) % 360;
    const l = (max + min) / 2;
    const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
    document.querySelector("#color-h").value = Math.round(h);
    document.querySelector("#color-s").value = Math.round(s * 100);
    document.querySelector("#color-l").value = Math.round(l * 100);
  }
  function syncRgbColor() {
    const values = ["r", "g", "b"].map((key) => Math.max(0, Math.min(255, Number(document.querySelector(`#color-${key}`).value) || 0)));
    setColor(`#${values.map((value) => value.toString(16).padStart(2, "0")).join("")}`);
  }
  function syncHslColor() {
    const h = (Number(document.querySelector("#color-h").value) || 0) / 360;
    const s = Math.max(0, Math.min(100, Number(document.querySelector("#color-s").value) || 0)) / 100;
    const l = Math.max(0, Math.min(100, Number(document.querySelector("#color-l").value) || 0)) / 100;
    const hue = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const values = s ? [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)] : [l, l, l];
    setColor(`#${values.map((value) => Math.round(value * 255).toString(16).padStart(2, "0")).join("")}`);
  }
  syncColorFields();

  document.querySelector("#frame-context-menu").addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const frame = frames[contextFrame];
    if (!frame || !action) return;
    if (action === "duplicate") duplicateFrame(contextFrame);
    if (action === "copy") { clipboardFrame = makeFrameCopy(frame); showToast("Frame copied"); }
    if (action === "paste" && clipboardFrame) {
      frames.splice(contextFrame + 1, 0, makeFrameCopy(clipboardFrame));
      activeFrame = contextFrame + 1;
      selectedFrames = new Set([activeFrame]);
      renderActiveFrame();
    }
    if (action === "delete") deleteFrame(contextFrame);
    if (action === "rename") {
      const name = window.prompt("Rename frame:", frame.name);
      if (name?.trim()) { frame.name = name.trim(); renderTimeline(); }
    }
    if (action === "duration") {
      const duration = Number(window.prompt("Frame duration in milliseconds:", String(Math.round(frame.duration))));
      if (Number.isFinite(duration) && duration >= 20 && duration <= 10000) {
        frame.duration = duration;
        renderTimeline();
      } else if (duration) showToast("Duration must be between 20 and 10000 ms");
    }
    if (action === "group") {
      const group = window.prompt("Frame group name:", frame.group || "Scene 1");
      if (group?.trim()) {
        const indices = selectedFrames.has(contextFrame) ? selectedFrames : new Set([contextFrame]);
        indices.forEach((index) => { frames[index].group = group.trim(); });
        showToast(`Grouped ${indices.size} frame${indices.size === 1 ? "" : "s"}`);
        renderTimeline();
      }
    }
    document.querySelector("#frame-context-menu").hidden = true;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#frame-context-menu")) document.querySelector("#frame-context-menu").hidden = true;
  });
  document.querySelector("#shortcuts-button").addEventListener("click", () => document.querySelector("#shortcuts-dialog").showModal());
  document.querySelector("#close-shortcuts").addEventListener("click", () => document.querySelector("#shortcuts-dialog").close());
  document.querySelector("#fit-canvas").addEventListener("click", () => {
    zoom = 1; pan = { x: 0, y: 0 }; applyCanvasTransform();
  });
  document.querySelector("#canvas-stage").addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom = Math.max(0.25, Math.min(3, zoom + (event.deltaY < 0 ? 0.1 : -0.1)));
    applyCanvasTransform();
  }, { passive: false });
  function applyCanvasTransform() {
    document.querySelector("#canvas-wrap").style.transform = `translate(${pan.x}px,${pan.y}px) scale(${zoom})`;
    document.querySelector("#zoom-label").textContent = `${Math.round(zoom * 100)}%`;
  }
  drawingCanvas.addEventListener("pointermove", (event) => {
    const cursor = document.querySelector("#brush-cursor");
    const bounds = document.querySelector("#canvas-wrap").getBoundingClientRect();
    cursor.style.display = tool === "hand" || tool === "eyedropper" ? "none" : "block";
    cursor.style.width = `${Math.max(3, brushSize * bounds.width / WIDTH)}px`;
    cursor.style.height = `${Math.max(3, brushSize * bounds.width / WIDTH)}px`;
    cursor.style.left = `${event.clientX - bounds.left}px`;
    cursor.style.top = `${event.clientY - bounds.top}px`;
    cursor.style.borderColor = brushColor;
  });
  drawingCanvas.addEventListener("pointerleave", () => { document.querySelector("#brush-cursor").style.display = "none"; });
  document.querySelector("#add-frame").addEventListener("click", () => {
    frames.splice(activeFrame + 1, 0, { image: null, history: [], historyIndex: -1, name: `Frame ${String(frames.length + 1).padStart(2, "0")}`, duration: 1000 / Number(fpsInput.value || 12), group: "" });
    activeFrame += 1;
    selectedFrames = new Set([activeFrame]);
    saveHistory(frames[activeFrame]);
    renderActiveFrame();
  });

  let clipboardFrame = null;
  document.querySelector("#layer-list").innerHTML = '<div class="layer-row active" data-layer="Sketch"><button class="layer-visibility" title="Toggle layer visibility">◉</button><span>Sketch</span><button class="layer-lock" title="Lock layer">⌑</button></div>';
  document.querySelector("#layer-list").addEventListener("click", (event) => {
    const row = event.target.closest(".layer-row");
    if (row) {
      document.querySelectorAll(".layer-row").forEach((item) => item.classList.toggle("active", item === row));
    }
  });
  document.querySelector("#add-layer").addEventListener("click", () => {
    const count = document.querySelectorAll(".layer-row").length + 1;
    const row = document.createElement("div");
    row.className = "layer-row";
    row.innerHTML = `<button class="layer-visibility" title="Toggle layer visibility">◉</button><span>Layer ${count}</span><button class="layer-lock" title="Lock layer">⌑</button>`;
    document.querySelectorAll(".layer-row").forEach((item) => item.classList.remove("active"));
    row.classList.add("active");
    document.querySelector("#layer-list").append(row);
  });
  document.querySelector("#layer-list").addEventListener("click", (event) => {
    if (event.target.matches(".layer-visibility")) event.target.classList.toggle("muted");
    if (event.target.matches(".layer-lock")) event.target.classList.toggle("locked");
  });
  document.querySelector("#layer-list").addEventListener("dblclick", (event) => {
    const row = event.target.closest(".layer-row");
    const label = row?.querySelector("span");
    if (!label) return;
    const name = window.prompt("Rename layer:", label.textContent);
    if (name?.trim()) label.textContent = name.trim();
  });
  document.querySelector("#delete-layer").addEventListener("click", () => {
    const active = document.querySelector(".layer-row.active");
    if (document.querySelectorAll(".layer-row").length <= 1) return showToast("Keep at least one layer");
    active?.remove();
    document.querySelector(".layer-row")?.classList.add("active");
  });
  document.querySelector("#layer-up").addEventListener("click", () => moveLayer(-1));
  document.querySelector("#layer-down").addEventListener("click", () => moveLayer(1));
  function moveLayer(direction) {
    const active = document.querySelector(".layer-row.active");
    if (!active) return;
    const sibling = direction < 0 ? active.previousElementSibling : active.nextElementSibling;
    if (sibling) direction < 0 ? sibling.before(active) : sibling.after(active);
  }

  function setPlaybackState(isPlaying) {
    playing = isPlaying;
    document.querySelector("#play-button").disabled = playing;
    document.querySelector("#pause-button").disabled = !playing;
    drawingCanvas.style.cursor = playing ? "default" : (tool === "eraser" ? "cell" : (tool === "hand" ? "grab" : "crosshair"));
  }
  function play() {
    if (playing || frames.length < 2) return;
    setPlaybackState(true);
    let index = activeFrame;
    const advance = () => {
      if (!playing) return;
      index = (index + 1) % frames.length;
      activeFrame = index;
      renderActiveFrame();
      playbackTimer = window.setTimeout(advance, frames[index].duration || 1000 / Number(fpsInput.value));
    };
    playbackTimer = window.setTimeout(advance, frames[index].duration || 1000 / Number(fpsInput.value));
  }
  function pause() {
    if (!playing) return;
    window.clearTimeout(playbackTimer);
    playbackTimer = null;
    setPlaybackState(false);
    renderActiveFrame();
  }
  document.querySelector("#play-button").addEventListener("click", play);
  document.querySelector("#pause-button").addEventListener("click", pause);
  fpsInput.addEventListener("change", () => {
    fpsInput.value = String(Math.max(1, Math.min(24, Number(fpsInput.value) || 12)));
    renderTimeline();
    if (playing) {
      pause();
      play();
    }
  });

  document.querySelector("#rename-project").addEventListener("click", () => {
    const name = window.prompt("Name your animation:", document.querySelector("#project-name").textContent);
    if (name && name.trim()) document.querySelector("#project-name").textContent = name.trim();
  });
  document.querySelector("#export-project").addEventListener("click", () => {
    const project = {
      format: "animatix-studio",
      version: 1,
      name: document.querySelector("#project-name").textContent,
      width: WIDTH,
      height: HEIGHT,
      fps: Number(fpsInput.value),
      frames: frames.map((frame) => frame.image),
      frameData: frames.map(({ name, duration, group }) => ({ name, duration, group }))
    };
    const blob = new Blob([JSON.stringify(project)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "") || "animatix-project"}.animatix`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("Project exported");
  });
  document.querySelector("#import-project").addEventListener("click", () => document.querySelector("#project-file").click());
  document.querySelector("#project-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const project = JSON.parse(await file.text());
      if (project.format !== "animatix-studio" || project.version !== 1 || !Array.isArray(project.frames) ||
          !project.frames.length || project.frames.some((frame) => frame !== null && (typeof frame !== "string" || !frame.startsWith("data:image/png;base64,")))) {
        throw new Error("This is not a valid Animatix Studio project.");
      }
      if (project.frames.length > 500) throw new Error("Projects can contain up to 500 frames.");
      pause();
      frames.splice(0, frames.length, ...project.frames.map((image, index) => {
        const metadata = project.frameData?.[index] || {};
        const frame = { image, name: typeof metadata.name === "string" ? metadata.name : `Frame ${String(index + 1).padStart(2, "0")}`, duration: Number(metadata.duration) || 1000 / (Number(project.fps) || 12), group: typeof metadata.group === "string" ? metadata.group : "", history: [], historyIndex: -1 };
        frame.history.push(image);
        frame.historyIndex = 0;
        return frame;
      }));
      activeFrame = 0;
      selectedFrames = new Set([0]);
      document.querySelector("#project-name").textContent = typeof project.name === "string" ? project.name : "Untitled animation";
      fpsInput.value = String(Math.max(1, Math.min(24, Number(project.fps) || 12)));
      await renderActiveFrame();
      showToast("Project opened");
    } catch (error) {
      showError(error);
    } finally {
      event.target.value = "";
    }
  });

  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2200);
  }
  function showError(error) {
    showToast(error instanceof Error ? error.message : "Something went wrong.");
  }

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) travelHistory(1);
      else travelHistory(-1);
      return;
    }
    if (typing || event.altKey) return;
    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateFrame();
      } else if (event.key.toLowerCase() === "c") {
        clipboardFrame = makeFrameCopy(frames[activeFrame]);
        showToast("Frame copied");
      } else if (event.key.toLowerCase() === "v" && clipboardFrame) {
        frames.splice(activeFrame + 1, 0, makeFrameCopy(clipboardFrame));
        activeFrame += 1;
        selectedFrames = new Set([activeFrame]);
        renderActiveFrame();
      }
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (playing) pause();
      else play();
    } else if (event.key.toLowerCase() === "b") setTool("brush");
    else if (event.key.toLowerCase() === "e") setTool("eraser");
    else if (event.key.toLowerCase() === "i") setTool("eyedropper");
    else if (event.key.toLowerCase() === "h") setTool("hand");
    else if (event.key.toLowerCase() === "f") document.querySelector("#add-frame").click();
  });
})();
