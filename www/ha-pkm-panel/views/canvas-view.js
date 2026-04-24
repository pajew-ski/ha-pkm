import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export class PkmCanvasView extends LitElement {
  static properties = {
    hass: { type: Object },
    path: { type: String },
    _canvas: { state: true },
    _viewport: { state: true },
    _selected: { state: true },
    _dragging: { state: true },
    _loading: { state: true },
    _dirty: { state: true },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; }

    .canvas-toolbar {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      background: var(--pkm-surface);
      border-bottom: 1px solid var(--pkm-border);
      gap: 6px;
      flex-shrink: 0;
      font-size: 13px;
    }
    .canvas-toolbar .path { flex: 1; color: var(--pkm-text-muted); font-size: 12px; }

    .canvas-area {
      flex: 1;
      overflow: hidden;
      position: relative;
      background: var(--pkm-bg);
      background-image: radial-gradient(circle, var(--pkm-border) 1px, transparent 1px);
      background-size: 24px 24px;
      cursor: default;
    }

    .canvas-layer {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
    }

    .canvas-node {
      position: absolute;
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 6px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      cursor: move;
      user-select: none;
      min-width: 120px;
      min-height: 60px;
      display: flex;
      flex-direction: column;
    }
    .canvas-node.selected {
      border-color: var(--pkm-accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--pkm-accent) 40%, transparent);
    }
    .canvas-node-header {
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
      color: var(--pkm-text-muted);
      border-bottom: 1px solid var(--pkm-border);
      cursor: move;
    }
    .canvas-node-body {
      padding: 8px 10px;
      flex: 1;
      font-size: 13px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .canvas-node-resize {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 14px;
      height: 14px;
      cursor: se-resize;
      opacity: 0.4;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--pkm-text-muted);
    }
    .canvas-node-resize:hover { opacity: 1; }

    .canvas-edges {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: visible;
    }

    edge-path {
      fill: none;
      stroke: var(--pkm-accent);
      stroke-width: 2;
      opacity: 0.7;
    }

    .empty-canvas {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 12px;
      color: var(--pkm-text-muted);
      pointer-events: none;
    }
    .empty-canvas .hint { font-size: 13px; }

    .zoom-controls {
      position: absolute;
      bottom: 16px;
      right: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
  `;

  constructor() {
    super();
    this._canvas = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    this._viewport = { x: 0, y: 0, zoom: 1 };
    this._selected = new Set();
    this._dragging = null;
    this._loading = false;
    this._dirty = false;
    this._panning = false;
    this._panStart = null;
    this._autosaveTimer = null;
  }

  updated(changed) {
    if ((changed.has("path") || changed.has("hass")) && this.path && this.hass) {
      this._loadCanvas();
    }
  }

  async _loadCanvas() {
    this._loading = true;
    try {
      const res = await this.hass.callWS({ type: "ha_pkm/read_canvas", path: this.path });
      const data = res.canvas || { nodes: [], edges: [] };
      if (data.viewport) this._viewport = data.viewport;
      this._canvas = data;
    } catch (e) {
      if (e.code === "file_not_found") {
        this._canvas = { nodes: [], edges: [] };
      } else {
        console.error("Canvas load error:", e);
      }
    } finally {
      this._loading = false;
    }
  }

  async _saveCanvas() {
    if (!this.hass || !this.path) return;
    clearTimeout(this._autosaveTimer);
    try {
      const data = { ...this._canvas, viewport: this._viewport };
      await this.hass.callWS({ type: "ha_pkm/write_canvas", path: this.path, canvas: data });
      this._dirty = false;
    } catch (e) {
      console.error("Canvas save error:", e);
    }
  }

  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => this._saveCanvas(), 1500);
    this._dirty = true;
  }

  _toCanvas(clientX, clientY) {
    const rect = this.shadowRoot.querySelector(".canvas-area").getBoundingClientRect();
    return {
      x: (clientX - rect.left - this._viewport.x) / this._viewport.zoom,
      y: (clientY - rect.top  - this._viewport.y) / this._viewport.zoom,
    };
  }

  _onCanvasDblClick(e) {
    if (e.target !== e.currentTarget && !e.target.classList.contains("canvas-area")) return;
    const pos = this._toCanvas(e.clientX, e.clientY);
    const node = {
      id: uuid(),
      type: "text",
      x: pos.x - 100,
      y: pos.y - 40,
      width: 240,
      height: 120,
      content: "New note",
      color: null,
    };
    this._canvas = { ...this._canvas, nodes: [...this._canvas.nodes, node] };
    this._selected = new Set([node.id]);
    this._scheduleAutosave();
  }

  _onNodeMouseDown(e, nodeId) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = this._canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this._dragging = { nodeId, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
    this._selected = new Set([nodeId]);

    const onMove = (e2) => {
      if (!this._dragging) return;
      const dx = (e2.clientX - this._dragging.startX) / this._viewport.zoom;
      const dy = (e2.clientY - this._dragging.startY) / this._viewport.zoom;
      this._canvas = {
        ...this._canvas,
        nodes: this._canvas.nodes.map((n) =>
          n.id === nodeId ? { ...n, x: this._dragging.origX + dx, y: this._dragging.origY + dy } : n
        ),
      };
    };
    const onUp = () => {
      this._dragging = null;
      this._scheduleAutosave();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  _onCanvasWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect = this.shadowRoot.querySelector(".canvas-area").getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const newZoom = Math.min(4, Math.max(0.2, this._viewport.zoom * factor));
    this._viewport = {
      x: cx - (cx - this._viewport.x) * (newZoom / this._viewport.zoom),
      y: cy - (cy - this._viewport.y) * (newZoom / this._viewport.zoom),
      zoom: newZoom,
    };
  }

  _onCanvasMouseDown(e) {
    if (e.button !== 1 || (!e.metaKey && !e.altKey && e.button !== 1)) return;
    e.preventDefault();
    this._panning = true;
    this._panStart = { x: e.clientX - this._viewport.x, y: e.clientY - this._viewport.y };
    const onMove = (e2) => {
      if (!this._panning) return;
      this._viewport = { ...this._viewport, x: e2.clientX - this._panStart.x, y: e2.clientY - this._panStart.y };
    };
    const onUp = () => {
      this._panning = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  _deleteSelected() {
    if (this._selected.size === 0) return;
    this._canvas = {
      ...this._canvas,
      nodes: this._canvas.nodes.filter((n) => !this._selected.has(n.id)),
      edges: this._canvas.edges.filter((e) => !this._selected.has(e.fromNode) && !this._selected.has(e.toNode)),
    };
    this._selected = new Set();
    this._scheduleAutosave();
  }

  _renderEdges() {
    const nodes = Object.fromEntries(this._canvas.nodes.map((n) => [n.id, n]));
    return this._canvas.edges.map((edge) => {
      const from = nodes[edge.fromNode];
      const to = nodes[edge.toNode];
      if (!from || !to) return "";
      const x1 = from.x + from.width / 2;
      const y1 = from.y + from.height / 2;
      const x2 = to.x + to.width / 2;
      const y2 = to.y + to.height / 2;
      const cx = (x1 + x2) / 2;
      return html`<path d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}" stroke="var(--pkm-accent)" fill="none" stroke-width="2" opacity="0.7" />`;
    });
  }

  render() {
    const vp = this._viewport;
    const transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;

    return html`
      <div class="canvas-toolbar">
        <button class="pkm-icon-btn" title="Save" @click=${() => this._saveCanvas()}>💾</button>
        <span class="path">${this.path || "Untitled Canvas"}</span>
        ${this._dirty ? html`<span style="color:var(--pkm-accent);font-size:18px">●</span>` : ""}
        <button class="pkm-icon-btn" title="Delete selected" @click=${() => this._deleteSelected()}>🗑️</button>
        <span style="font-size:11px;color:var(--pkm-text-muted)">Dblclick: new node · Wheel: zoom · Mid-drag: pan</span>
      </div>

      <div
        class="canvas-area"
        @dblclick=${this._onCanvasDblClick}
        @wheel=${this._onCanvasWheel}
        @mousedown=${this._onCanvasMouseDown}
        @click=${() => { this._selected = new Set(); }}
      >
        <svg class="canvas-edges" style="transform:${transform};transform-origin:0 0;position:absolute;inset:0;width:100%;height:100%;">
          ${this._renderEdges()}
        </svg>

        <div class="canvas-layer" style="transform:${transform}">
          ${this._canvas.nodes.map((node) => html`
            <div
              class="canvas-node ${this._selected.has(node.id) ? "selected" : ""}"
              style="
                left:${node.x}px; top:${node.y}px;
                width:${node.width}px; height:${node.height}px;
                ${node.color ? `border-color:${node.color};` : ""}
              "
              @mousedown=${(e) => this._onNodeMouseDown(e, node.id)}
              @click=${(e) => { e.stopPropagation(); this._selected = new Set([node.id]); }}
            >
              <div class="canvas-node-header">📄 ${node.type}</div>
              <div class="canvas-node-body" contenteditable="true"
                @input=${(e) => {
                  node.content = e.target.innerText;
                  this._scheduleAutosave();
                }}
              >${node.content}</div>
              <div class="canvas-node-resize">⌟</div>
            </div>
          `)}
        </div>

        ${this._canvas.nodes.length === 0 ? html`
          <div class="empty-canvas">
            <span style="font-size:48px">🔲</span>
            <span class="hint">Double-click to create a node</span>
          </div>
        ` : ""}

        <div class="zoom-controls">
          <button class="pkm-icon-btn" @click=${() => { this._viewport = { ...this._viewport, zoom: Math.min(4, this._viewport.zoom * 1.2) }; }}>+</button>
          <button class="pkm-icon-btn" @click=${() => { this._viewport = { x: 0, y: 0, zoom: 1 }; }}>⌂</button>
          <button class="pkm-icon-btn" @click=${() => { this._viewport = { ...this._viewport, zoom: Math.max(0.2, this._viewport.zoom / 1.2) }; }}>−</button>
        </div>
      </div>
    `;
  }
}

customElements.define("pkm-canvas-view", PkmCanvasView);
