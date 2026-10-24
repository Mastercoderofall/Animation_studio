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
  const frames = [{ image: null, history: [], historyIndex: -1 }];
  let activeFrame = 0;
  let tool = "pencil";
  let brushSize = Number(brushSizeInput.value);
  let brushColor = brushColorInput.value;
  let onionSkin = true;
  let drawing = false;
  let lastPoint = null;
  let playing = false;
  let playbackTimer = null;
  let toastTimer = null;
  let dragIndex = null;

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
    const previous = onionSkin && frames.length > 1
      ? frames[(activeFrame - 1 + frames.length) % frames.length].image
      : null;
    onionContext.clearRect(0, 0, WIDTH, HEIGHT);
    if (previous) {
      const image = await loadImage(previous);
      onionContext.globalAlpha = 0.2;
      onionContext.drawImage(image, 0, 0, WIDTH, HEIGHT);
      onionContext.globalAlpha = 1;
    }
    hint.classList.toggle("hidden", Boolean(frame.image));
    document.querySelector("#canvas-frame-label").textContent = `FRAME ${String(activeFrame + 1).padStart(2, "0")}`;
    document.querySelector("#undo-button").disabled = frame.historyIndex <= 0;
    document.querySelector("#redo-button").disabled = frame.historyIndex >= frame.history.length - 1;
    renderTimeline();
  }

  function renderTimeline() {
    track.replaceChildren();
    frames.forEach((frame, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `frame-card${index === activeFrame ? " selected" : ""}`;
      card.setAttribute("aria-label", `Frame ${index + 1}${index === activeFrame ? ", selected" : ""}`);
      card.setAttribute("aria-pressed", String(index === activeFrame));
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
      meta.innerHTML = `<span>Frame ${String(index + 1).padStart(2, "0")}</span><span class="frame-duration">${1000 / Number(fpsInput.value || 12)} ms</span>`;
      card.append(thumbnail, meta);
      card.addEventListener("click", () => selectFrame(index));
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
        activeFrame = index;
        renderActiveFrame();
      });
      track.append(card);
    });
    document.querySelector("#frame-count").textContent = `${frames.length} ${frames.length === 1 ? "frame" : "frames"}`;
  }

  function selectFrame(index) {
    if (playing || index === activeFrame) return;
    activeFrame = index;
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
    drawing = true;
    drawingCanvas.setPointerCapture(event.pointerId);
    lastPoint = getCanvasPoint(event);
    drawingContext.beginPath();
    drawingContext.moveTo(lastPoint.x, lastPoint.y);
    drawingContext.lineTo(lastPoint.x, lastPoint.y);
    drawingContext.lineWidth = brushSize;
    drawingContext.strokeStyle = brushColor;
    drawingContext.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    drawingContext.stroke();
  });

  drawingCanvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const point = getCanvasPoint(event);
    drawingContext.beginPath();
    drawingContext.moveTo(lastPoint.x, lastPoint.y);
    drawingContext.lineTo(point.x, point.y);
    drawingContext.lineWidth = brushSize;
    drawingContext.strokeStyle = brushColor;
    drawingContext.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    drawingContext.stroke();
    lastPoint = point;
  });

  function finishStroke() {
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

  function updateOnion() {
    onionContext.clearRect(0, 0, WIDTH, HEIGHT);
    if (!onionSkin || frames.length < 2) return;
    const previous = frames[(activeFrame - 1 + frames.length) % frames.length].image;
    if (previous) {
      loadImage(previous).then((image) => {
        onionContext.globalAlpha = 0.2;
        onionContext.drawImage(image, 0, 0, WIDTH, HEIGHT);
        onionContext.globalAlpha = 1;
      }).catch(showError);
    }
  }

  function setTool(nextTool) {
    tool = nextTool;
    document.querySelectorAll(".tool-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.tool === tool);
    });
    drawingCanvas.style.cursor = tool === "eraser" ? "cell" : "crosshair";
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
    document.querySelector("#color-value").textContent = brushColor.toUpperCase();
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

  document.querySelector("#add-frame").addEventListener("click", () => {
    frames.splice(activeFrame + 1, 0, { image: null, history: [], historyIndex: -1 });
    activeFrame += 1;
    saveHistory(frames[activeFrame]);
    renderActiveFrame();
  });
  document.querySelector("#duplicate-frame").addEventListener("click", () => {
    const source = frames[activeFrame];
    frames.splice(activeFrame + 1, 0, { image: source.image, history: [source.image], historyIndex: 0 });
    activeFrame += 1;
    renderActiveFrame();
    showToast("Frame duplicated");
  });
  document.querySelector("#delete-frame").addEventListener("click", () => {
    if (frames.length === 1) {
      frames[0] = { image: null, history: [], historyIndex: -1 };
      saveHistory(frames[0]);
      activeFrame = 0;
    } else {
      frames.splice(activeFrame, 1);
      activeFrame = Math.min(activeFrame, frames.length - 1);
    }
    renderActiveFrame();
  });
  document.querySelector("#clear-frame").addEventListener("click", () => {
    drawingContext.clearRect(0, 0, WIDTH, HEIGHT);
    frames[activeFrame].image = null;
    saveHistory(frames[activeFrame]);
    hint.classList.remove("hidden");
    renderTimeline();
    updateHistoryButtons();
  });

  function setPlaybackState(isPlaying) {
    playing = isPlaying;
    document.querySelector("#play-button").disabled = playing;
    document.querySelector("#pause-button").disabled = !playing;
    drawingCanvas.style.cursor = playing ? "default" : (tool === "eraser" ? "cell" : "crosshair");
  }
  function play() {
    if (playing || frames.length < 2) return;
    setPlaybackState(true);
    let index = activeFrame;
    playbackTimer = window.setInterval(() => {
      index = (index + 1) % frames.length;
      activeFrame = index;
      renderActiveFrame();
    }, 1000 / Number(fpsInput.value));
  }
  function pause() {
    if (!playing) return;
    window.clearInterval(playbackTimer);
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
      frames: frames.map((frame) => frame.image)
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
      frames.splice(0, frames.length, ...project.frames.map((image) => {
        const frame = { image, history: [], historyIndex: -1 };
        frame.history.push(image);
        frame.historyIndex = 0;
        return frame;
      }));
      activeFrame = 0;
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
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (playing) pause();
      else play();
    } else if (event.key.toLowerCase() === "p") setTool("pencil");
    else if (event.key.toLowerCase() === "e") setTool("eraser");
  });
})();
