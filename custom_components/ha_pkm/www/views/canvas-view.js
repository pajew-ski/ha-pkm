/**
 * canvas-view.js – Phase 7
 *
 * New features:
 * - Connection points (4 sides) appear on node hover; drag from point → create edge
 * - Working corner-resize via drag handle
 * - Right-click context menu: Edit label, Delete, Open as Note, Duplicate
 * - Middle-mouse / Space+drag for panning
 * - Label display above node header
 * - Group node type (translucent background, larger)
 * - Pending edge preview line during drag
 */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";
import { icon } from "../icons.js";

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b, i) => (i === 6 ? (b & 0x0f) | 0x40 : i === 8 ? (b & 0x3f) | 0x80 : b)
          .toString(16).padStart(2, "0")).join("")
        .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
}

const SIDES = ["top", "right", "bottom", "left"];

function sidePos(node, side) {
  const cx = node.x + node.width  / 2;
  const cy = node.y + node.height / 2;
  return {
    top:    { x: cx,            y: node.y },
    right:  { x: node.x + node.width, y: cy },
    bottom: { x: cx,            y: node.y + node.height },
    left:   { x: node.x,        y: cy },
  }[side];
}

function bezierPath(x1, y1, side1, x2, y2, side2) {
  const CTRL = 60;
  const d = {
    top:    { dx: 0,      dy: -CTRL },
    right:  { dx: CTRL,  dy: 0 },
    bottom: { dx: 0,      dy: CTRL },
    left:   { dx: -CTRL, dy: 0 },
  };
  const c1 = d[side1]; const c2 = d[side2 || "top"];
  return `M${x1},${y1} C${x1+c1.dx},${y1+c1.dy} ${x2+c2.dx},${y2+c2.dy} ${x2},${y2}`;
}

export class PkmCanvasView extends LitElement {
  static properties = {
    hass:     { type: Object },
    path:     { type: String },
    _canvas:  { state: true },
    _vp:      { state: true },
    _sel:     { state: true },
    _loading: { state: true },
    _dirty:   { state: true },
    _ctx:     { state: true },  // context menu { x, y, nodeId }
    _hovered: { state: true },  // hovered node id (for showing conn points)
    _pending: { state: true },  // pending edge drag { fromNode, fromSide, x2, y2 }
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; }

    .toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 10px; background: var(--pkm-surface);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0; font-size: 13px;
    }
    .toolbar .path { flex: 1; font-size: 12px; color: var(--pkm-text-muted); }
    .dirty-dot { color: var(--pkm-accent); font-size: 18px; }
    .pkm-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: none; background: transparent;
      color: var(--pkm-text-muted); border-radius: 4px; cursor: pointer;
    }
    .pkm-icon-btn:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }
    .hint { font-size: 10px; color: var(--pkm-text-muted); }

    /* Canvas */
    .canvas-area {
      flex: 1; position: relative; overflow: hidden;
      background: var(--pkm-bg);
      background-image: radial-gradient(circle, var(--pkm-border) 1px, transparent 1px);
      background-size: 24px 24px;
      user-select: none;
    }

    /* SVG layer for edges (below HTML nodes) */
    .edge-svg {
      position: absolute; inset: 0; width: 100%; height: 100%;
      pointer-events: none; overflow: visible;
    }

    /* Transform layer for HTML nodes */
    .node-layer { position: absolute; top: 0; left: 0; transform-origin: 0 0; }

    /* Nodes */
    .canvas-node {
      position: absolute;
      background: var(--pkm-surface);
      border: 1.5px solid var(--pkm-border);
      border-radius: 7px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25);
      display: flex; flex-direction: column;
      min-width: 100px; min-height: 50px;
      cursor: default;
    }
    .canvas-node.selected {
      border-color: var(--pkm-accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--pkm-accent) 40%, transparent), 0 2px 12px rgba(0,0,0,0.35);
    }
    .canvas-node.type-group {
      background: color-mix(in srgb, var(--pkm-accent) 5%, transparent);
      border-style: dashed;
    }

    .node-header {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 9px;
      font-size: 11px; font-weight: 600; color: var(--pkm-text-muted);
      border-bottom: 1px solid var(--pkm-border);
      cursor: move;
      flex-shrink: 0;
    }
    .node-body {
      flex: 1; padding: 8px 10px;
      font-size: 13px; overflow: auto;
      outline: none; white-space: pre-wrap; word-break: break-word;
      cursor: text;
    }

    /* Resize handle */
    .node-resize {
      position: absolute; bottom: 2px; right: 2px;
      width: 14px; height: 14px;
      cursor: se-resize; color: var(--pkm-text-muted);
      font-size: 10px; display: flex; align-items: center; justify-content: center;
      opacity: 0.5;
    }
    .canvas-node:hover .node-resize { opacity: 1; }

    /* Connection points */
    .conn-pt {
      position: absolute; width: 12px; height: 12px;
      background: var(--pkm-accent); border-radius: 50%;
      border: 2px solid var(--pkm-bg);
      cursor: crosshair;
      transform: translate(-50%, -50%);
      z-index: 5;
    }
    .conn-pt:hover { transform: translate(-50%,-50%) scale(1.3); }

    /* Context menu */
    .ctx-menu {
      position: fixed; background: var(--pkm-surface);
      border: 1px solid var(--pkm-border); border-radius: 7px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.45); z-index: 600;
      min-width: 160px; overflow: hidden;
      animation: ctx-in 100ms ease;
    }
    @keyframes ctx-in { from { opacity:0; transform: scale(0.95); } to { opacity:1; transform: scale(1); } }
    .ctx-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; cursor: pointer; font-size: 13px;
    }
    .ctx-item:hover { background: var(--pkm-surface-2); }
    .ctx-sep { height: 1px; background: var(--pkm-border); margin: 2px 0; }
    .ctx-danger { color: var(--pkm-link-unresolved); }

    /* Zoom controls */
    .zoom-ctrl {
      position: absolute; bottom: 14px; right: 14px;
      display: flex; flex-direction: column; gap: 4px;
    }

    /* Empty */
    .empty-hint {
      position: absolute; inset: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; color: var(--pkm-text-muted); pointer-events: none;
    }
  `;

  constructor() {
    super();
    this._canvas  = { nodes: [], edges: [] };
    this._vp      = { x: 0, y: 0, zoom: 1 };
    this._sel     = new Set();
    this._loading = false;
    this._dirty   = false;
    this._ctx     = null;
    this._hovered = null;
    this._pending = null;
    this._autosaveTimer = null;
    this._spaceDown = false;
    this._ctxCloseBound = this._closeCtx.bind(this);
    this._keydownBound  = this._onKeydown.bind(this);
    this._keyupBound    = (e) => { if (e.code === "Space") this._spaceDown = false; };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click",   this._ctxCloseBound);
    document.addEventListener("keydown", this._keydownBound);
    document.addEventListener("keyup",   this._keyupBound);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click",   this._ctxCloseBound);
    document.removeEventListener("keydown", this._keydownBound);
    document.removeEventListener("keyup",   this._keyupBound);
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
      if (data.viewport) this._vp = { ...this._vp, ...data.viewport };
      this._canvas = data;
    } catch (e) {
      if (e.code === "file_not_found") this._canvas = { nodes: [], edges: [] };
      else console.error("Canvas load error:", e);
    } finally {
      this._loading = false;
    }
  }

  async _saveCanvas() {
    if (!this.hass || !this.path) return;
    clearTimeout(this._autosaveTimer);
    try {
      await this.hass.callWS({ type: "ha_pkm/write_canvas", path: this.path,
        canvas: { ...this._canvas, viewport: this._vp } });
      this._dirty = false;
    } catch (e) { console.error("Canvas save error:", e); }
  }

  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => this._saveCanvas(), 1500);
    this._dirty = true;
  }

  // ── Coordinate helpers ───────────────────────────────────────────────────

  _toCanvas(clientX, clientY) {
    const rect = this.shadowRoot.querySelector(".canvas-area")?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - this._vp.x) / this._vp.zoom,
             y: (clientY - rect.top  - this._vp.y) / this._vp.zoom };
  }

  // ── Viewport (wheel + middle-drag) ───────────────────────────────────────

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const rect   = this.shadowRoot.querySelector(".canvas-area").getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const nz = Math.min(5, Math.max(0.15, this._vp.zoom * factor));
    this._vp = { x: cx - (cx - this._vp.x) * (nz / this._vp.zoom), y: cy - (cy - this._vp.y) * (nz / this._vp.zoom), zoom: nz };
  }

  _onAreaMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && this._spaceDown)) {
      e.preventDefault();
      const sx = e.clientX - this._vp.x, sy = e.clientY - this._vp.y;
      const onMove = (e2) => { this._vp = { ...this._vp, x: e2.clientX - sx, y: e2.clientY - sy }; };
      const onUp   = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }
    if (e.button === 0) this._sel = new Set();
  }

  _onKeydown(e) {
    if (e.code === "Space")  this._spaceDown = true;
    if (e.key  === "Delete" || e.key === "Backspace") this._deleteSelected();
  }

  // ── Node interactions ────────────────────────────────────────────────────

  _onNodeMouseDown(e, nodeId) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!this._sel.has(nodeId)) this._sel = new Set([nodeId]);
    const node   = this._canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const startX = e.clientX, startY = e.clientY;
    const origX  = node.x,    origY  = node.y;
    let moved = false;
    const onMove = (e2) => {
      const dx = (e2.clientX - startX) / this._vp.zoom;
      const dy = (e2.clientY - startY) / this._vp.zoom;
      moved = true;
      this._canvas = { ...this._canvas,
        nodes: this._canvas.nodes.map((n) => n.id === nodeId ? { ...n, x: origX + dx, y: origY + dy } : n) };
    };
    const onUp = () => {
      if (moved) this._scheduleAutosave();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  _onResizeMouseDown(e, nodeId) {
    e.stopPropagation();
    const node = this._canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const startX = e.clientX, startY = e.clientY;
    const origW  = node.width,  origH  = node.height;
    const onMove = (e2) => {
      const dw = (e2.clientX - startX) / this._vp.zoom;
      const dh = (e2.clientY - startY) / this._vp.zoom;
      this._canvas = { ...this._canvas,
        nodes: this._canvas.nodes.map((n) => n.id === nodeId
          ? { ...n, width: Math.max(100, origW + dw), height: Math.max(60, origH + dh) } : n) };
    };
    const onUp = () => { this._scheduleAutosave(); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  _onDblClick(e) {
    if (e.target !== e.currentTarget && !e.target.classList.contains("canvas-area")) return;
    const pos = this._toCanvas(e.clientX, e.clientY);
    const node = { id: uuid(), type: "text", x: pos.x - 120, y: pos.y - 50,
                   width: 240, height: 120, content: "New note", color: null };
    this._canvas = { ...this._canvas, nodes: [...this._canvas.nodes, node] };
    this._sel = new Set([node.id]);
    this._scheduleAutosave();
  }

  _onContextMenu(e, nodeId) {
    e.preventDefault(); e.stopPropagation();
    this._ctx = { x: e.clientX, y: e.clientY, nodeId };
  }

  _closeCtx() { this._ctx = null; }

  // ── Touch support ────────────────────────────────────────────────────────

  _onAreaTouchStart(e) {
    const t0 = e.touches[0];
    // Reserve the left 30 px for the HA sidebar swipe-from-edge gesture.
    // If HA's gesture handler checks defaultPrevented it would be blocked otherwise.
    if (t0.clientX < 30) return;

    if (e.touches.length === 1) {
      e.preventDefault();
      const sx = t0.clientX - this._vp.x, sy = t0.clientY - this._vp.y;
      this._touchPan = { sx, sy };
      this._touchPinch = null;
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      this._touchPinch = {
        dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        zoom: this._vp.zoom,
        cx: (a.clientX + b.clientX) / 2,
        cy: (a.clientY + b.clientY) / 2,
      };
      this._touchPan = null;
    }
  }

  _onAreaTouchMove(e) {
    e.preventDefault();
    if (this._touchPan && e.touches.length === 1) {
      const t = e.touches[0];
      this._vp = { ...this._vp, x: t.clientX - this._touchPan.sx, y: t.clientY - this._touchPan.sy };
    } else if (this._touchPinch && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const nz = Math.min(5, Math.max(0.15, this._touchPinch.zoom * (dist / this._touchPinch.dist)));
      const { cx, cy } = this._touchPinch;
      const rect = this.shadowRoot.querySelector(".canvas-area").getBoundingClientRect();
      const lx = cx - rect.left, ly = cy - rect.top;
      this._vp = { x: lx - (lx - this._vp.x) * (nz / this._vp.zoom), y: ly - (ly - this._vp.y) * (nz / this._vp.zoom), zoom: nz };
    }
  }

  _onAreaTouchEnd() {
    this._touchPan = null;
    this._touchPinch = null;
  }

  _onNodeTouchStart(e, nodeId) {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    if (!this._sel.has(nodeId)) this._sel = new Set([nodeId]);
    const node = this._canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const t0 = e.touches[0];
    const startX = t0.clientX, startY = t0.clientY;
    const origX = node.x, origY = node.y;
    let moved = false;
    const onMove = (e2) => {
      const t = e2.touches[0];
      const dx = (t.clientX - startX) / this._vp.zoom;
      const dy = (t.clientY - startY) / this._vp.zoom;
      moved = true;
      this._canvas = { ...this._canvas,
        nodes: this._canvas.nodes.map((n) => n.id === nodeId ? { ...n, x: origX + dx, y: origY + dy } : n) };
    };
    const onEnd = () => {
      if (moved) this._scheduleAutosave();
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  }

  _onResizeTouchStart(e, nodeId) {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const node = this._canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const t0 = e.touches[0];
    const startX = t0.clientX, startY = t0.clientY;
    const origW = node.width, origH = node.height;
    const onMove = (e2) => {
      const t = e2.touches[0];
      const dw = (t.clientX - startX) / this._vp.zoom;
      const dh = (t.clientY - startY) / this._vp.zoom;
      this._canvas = { ...this._canvas,
        nodes: this._canvas.nodes.map((n) => n.id === nodeId
          ? { ...n, width: Math.max(100, origW + dw), height: Math.max(60, origH + dh) } : n) };
    };
    const onEnd = () => { this._scheduleAutosave(); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  }

  // ── Connection points (edge drawing) ────────────────────────────────────

  _onConnPtMouseDown(e, nodeId, side) {
    e.stopPropagation();
    const pos = sidePos(this._canvas.nodes.find((n) => n.id === nodeId), side);
    this._pending = { fromNode: nodeId, fromSide: side, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };

    const onMove = (e2) => {
      const cp = this._toCanvas(e2.clientX, e2.clientY);
      this._pending = { ...this._pending, x2: cp.x, y2: cp.y };
    };
    const onUp = (e2) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Find target node under cursor
      const cp = this._toCanvas(e2.clientX, e2.clientY);
      const target = this._canvas.nodes.find((n) =>
        n.id !== nodeId &&
        cp.x >= n.x && cp.x <= n.x + n.width &&
        cp.y >= n.y && cp.y <= n.y + n.height
      );
      if (target) {
        // Find nearest side on target
        const targetSide = _nearestSide(target, cp);
        const edge = { id: uuid(), fromNode: nodeId, fromSide: side, toNode: target.id, toSide: targetSide, label: null };
        this._canvas = { ...this._canvas, edges: [...this._canvas.edges, edge] };
        this._scheduleAutosave();
      }
      this._pending = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // ── Context menu actions ─────────────────────────────────────────────────

  _ctxEditLabel() {
    const { nodeId } = this._ctx;
    this._closeCtx();
    const node = this._canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const val = prompt("Node label:", node.content);
    if (val !== null) {
      this._canvas = { ...this._canvas, nodes: this._canvas.nodes.map((n) => n.id === nodeId ? { ...n, content: val } : n) };
      this._scheduleAutosave();
    }
  }

  _ctxDuplicate() {
    const { nodeId } = this._ctx;
    this._closeCtx();
    const node = this._canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const copy = { ...node, id: uuid(), x: node.x + 20, y: node.y + 20 };
    this._canvas = { ...this._canvas, nodes: [...this._canvas.nodes, copy] };
    this._sel = new Set([copy.id]);
    this._scheduleAutosave();
  }

  _ctxOpenAsNote() {
    const { nodeId } = this._ctx;
    this._closeCtx();
    const node = this._canvas.nodes.find((n) => n.id === nodeId);
    if (node?.content?.endsWith(".md")) {
      this.dispatchEvent(new CustomEvent("file-open", { detail: { path: node.content }, bubbles: true, composed: true }));
    }
  }

  _ctxDelete() {
    const { nodeId } = this._ctx;
    this._closeCtx();
    this._canvas = {
      ...this._canvas,
      nodes: this._canvas.nodes.filter((n) => n.id !== nodeId),
      edges: this._canvas.edges.filter((e) => e.fromNode !== nodeId && e.toNode !== nodeId),
    };
    this._sel.delete(nodeId);
    this._sel = new Set(this._sel);
    this._scheduleAutosave();
  }

  _deleteSelected() {
    if (!this._sel.size) return;
    this._canvas = {
      ...this._canvas,
      nodes: this._canvas.nodes.filter((n) => !this._sel.has(n.id)),
      edges: this._canvas.edges.filter((e) => !this._sel.has(e.fromNode) && !this._sel.has(e.toNode)),
    };
    this._sel = new Set();
    this._scheduleAutosave();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  _renderEdges() {
    const nodeMap = Object.fromEntries(this._canvas.nodes.map((n) => [n.id, n]));
    const paths   = this._canvas.edges.map((edge) => {
      const fn = nodeMap[edge.fromNode]; const tn = nodeMap[edge.toNode];
      if (!fn || !tn) return "";
      const p1 = sidePos(fn, edge.fromSide || "right");
      const p2 = sidePos(tn, edge.toSide   || "left");
      const d  = bezierPath(p1.x, p1.y, edge.fromSide || "right", p2.x, p2.y, edge.toSide || "left");
      return html`
        <path d=${d} fill="none" stroke="var(--pkm-accent)" stroke-width="2" opacity="0.7"
          marker-end="url(#pkm-arrow-canvas)" />
        ${edge.label ? html`
          <text x=${(p1.x + p2.x) / 2} y=${(p1.y + p2.y) / 2 - 6}
            text-anchor="middle" font-size="11" fill="var(--pkm-text-muted)">${edge.label}</text>
        ` : ""}
      `;
    });

    // Pending edge preview
    let pending = "";
    if (this._pending) {
      const { x1, y1, x2, y2, fromSide } = this._pending;
      pending = html`<line x1=${x1} y1=${y1} x2=${x2} y2=${y2} stroke="var(--pkm-accent)" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.6" />`;
    }

    return html`${paths}${pending}`;
  }

  _renderConnPoints(node) {
    if (this._hovered !== node.id && !this._sel.has(node.id)) return "";
    return SIDES.map((side) => {
      const pos = sidePos(node, side);
      return html`
        <div class="conn-pt"
          style="left:${pos.x - node.x}px; top:${pos.y - node.y}px"
          @mousedown=${(e) => { e.stopPropagation(); this._onConnPtMouseDown(e, node.id, side); }}
        ></div>
      `;
    });
  }

  _renderNodes() {
    return this._canvas.nodes.map((node) => html`
      <div class="canvas-node type-${node.type} ${this._sel.has(node.id) ? "selected" : ""}"
        style="left:${node.x}px; top:${node.y}px; width:${node.width}px; height:${node.height}px;
               ${node.color ? `border-color:${node.color};` : ""}"
        @mousedown=${(e) => this._onNodeMouseDown(e, node.id)}
        @touchstart=${(e) => this._onNodeTouchStart(e, node.id)}
        @mouseenter=${() => { this._hovered = node.id; }}
        @mouseleave=${() => { this._hovered = null; }}
        @contextmenu=${(e) => this._onContextMenu(e, node.id)}
        @click=${(e) => { e.stopPropagation(); this._sel = new Set([node.id]); }}
      >
        <div class="node-header" style="${node.color ? `color:${node.color}` : ""}">
          ${node.type === "group" ? icon("group", 14) : node.type === "note" ? icon("file", 14) : icon("text", 14)} ${node.type}
        </div>
        <div class="node-body" contenteditable="true"
          @input=${(e) => { node.content = e.target.innerText; this._scheduleAutosave(); }}
          @mousedown=${(e) => e.stopPropagation()}
        >${node.content}</div>
        <div class="node-resize" @mousedown=${(e) => this._onResizeMouseDown(e, node.id)} @touchstart=${(e) => this._onResizeTouchStart(e, node.id)}>${icon("resizeHandle", 12)}</div>
        ${this._renderConnPoints(node)}
      </div>
    `);
  }

  _renderContextMenu() {
    if (!this._ctx) return "";
    return html`
      <div class="ctx-menu" style="left:${this._ctx.x}px; top:${this._ctx.y}px"
        @click=${(e) => e.stopPropagation()}>
        <div class="ctx-item" @click=${() => this._ctxEditLabel()}>${icon("pencil", 14)} Edit label</div>
        <div class="ctx-item" @click=${() => this._ctxDuplicate()}>${icon("copy", 14)} Duplicate</div>
        <div class="ctx-item" @click=${() => this._ctxOpenAsNote()}>${icon("file", 14)} Open as note</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item ctx-danger" @click=${() => this._ctxDelete()}>${icon("delete", 14)} Delete</div>
      </div>
    `;
  }

  render() {
    if (this.path && !this.path.endsWith(".canvas")) {
      return html`
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--pkm-text-muted)">
          <span style="opacity:0.25">${icon("noteEdit", 48)}</span>
          <span>Note file – switch to Editor view to edit it</span>
        </div>`;
    }

    const vp = this._vp;
    const transform = `translate(${vp.x}px,${vp.y}px) scale(${vp.zoom})`;

    return html`
      <div class="toolbar">
        <button class="pkm-icon-btn" title="Save" @click=${() => this._saveCanvas()}>${icon("save", 18)}</button>
        <span class="path">${this.path || "Untitled.canvas"}</span>
        ${this._dirty ? html`<span class="dirty-dot">●</span>` : ""}
        <button class="pkm-icon-btn" title="Delete selected (Del)" @click=${() => this._deleteSelected()}>${icon("delete", 18)}</button>
        <span class="hint">Dblclick: new node · Wheel: zoom · Mid/Space+drag: pan · Drag port: edge</span>
      </div>

      <div class="canvas-area"
        @dblclick=${this._onDblClick}
        @wheel=${this._onWheel}
        @mousedown=${this._onAreaMouseDown}
        @click=${() => { this._sel = new Set(); }}
        @contextmenu=${(e) => e.preventDefault()}
        @touchstart=${this._onAreaTouchStart}
        @touchmove=${this._onAreaTouchMove}
        @touchend=${this._onAreaTouchEnd}
      >
        <!-- Edge SVG (below nodes) -->
        <svg class="edge-svg" style="transform:${transform};transform-origin:0 0;">
          <defs>
            <marker id="pkm-arrow-canvas" viewBox="0 -5 10 10" refX="10" refY="0"
              markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,-5L10,0L0,5" fill="var(--pkm-accent)" opacity="0.8"/>
            </marker>
          </defs>
          ${this._renderEdges()}
        </svg>

        <!-- Node HTML layer -->
        <div class="node-layer" style="transform:${transform}">
          ${this._renderNodes()}
        </div>

        <!-- Empty hint -->
        ${this._canvas.nodes.length === 0 ? html`
          <div class="empty-hint">
            <span style="opacity:0.25;color:var(--pkm-text-muted)">${icon("canvas", 48)}</span>
            <span>Double-click to create a node</span>
          </div>
        ` : ""}

        <!-- Zoom controls -->
        <div class="zoom-ctrl">
          <button class="pkm-icon-btn" @click=${() => { this._vp = { ...vp, zoom: Math.min(5, vp.zoom * 1.25) }; }}>+</button>
          <button class="pkm-icon-btn" @click=${() => { this._vp = { x: 0, y: 0, zoom: 1 }; }}>${icon("home", 18)}</button>
          <button class="pkm-icon-btn" @click=${() => { this._vp = { ...vp, zoom: Math.max(0.15, vp.zoom * 0.8) }; }}>−</button>
        </div>
      </div>

      ${this._renderContextMenu()}
    `;
  }
}

function _nearestSide(node, pt) {
  const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
  const dx = pt.x - cx, dy = pt.y - cy;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

customElements.define("pkm-canvas-view", PkmCanvasView);
