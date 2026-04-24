/**
 * file-tree.js – Phase 8+9: drag-and-drop move, improved edge cases
 */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

const EXPAND_KEY = "ha-pkm-tree-expand";

function loadExpand() {
  try { return new Set(JSON.parse(localStorage.getItem(EXPAND_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveExpand(s) {
  localStorage.setItem(EXPAND_KEY, JSON.stringify([...s]));
}

export class PkmFileTree extends LitElement {
  static properties = {
    files:      { type: Array },
    activePath: { type: String },
    dirtyPaths: { type: Object },
    _expanded:  { state: true },
    _renaming:  { state: true },
    _renameVal: { state: true },
    _ctx:       { state: true },
    _dragOver:  { state: true },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 7px 12px;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--pkm-text-muted);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
    }
    .header-actions { display: flex; gap: 2px; }

    .scroll { flex: 1; overflow-y: auto; padding: 4px 0; }

    .item {
      display: flex; align-items: center; height: 28px;
      padding: 0 8px; cursor: pointer; gap: 4px;
      font-size: 13px; border-radius: 4px; margin: 0 4px;
      user-select: none; position: relative;
    }
    .item:hover  { background: var(--pkm-surface-2); }
    .item.active {
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
    }
    .item.drag-over { background: color-mix(in srgb, var(--pkm-accent) 20%, transparent); outline: 1px dashed var(--pkm-accent); }

    .arrow {
      width: 16px; font-size: 9px; color: var(--pkm-text-muted);
      flex-shrink: 0; transition: transform 150ms;
    }
    .arrow.open { transform: rotate(90deg); }

    .icon { font-size: 14px; flex-shrink: 0; }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .dirty { width: 6px; height: 6px; border-radius: 50%; background: var(--pkm-accent); flex-shrink: 0; }

    .rename-input {
      flex: 1; background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-accent); border-radius: 3px;
      color: var(--pkm-text); padding: 1px 4px; font-size: 13px; outline: none;
    }

    .pkm-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border: none; background: transparent;
      color: var(--pkm-text-muted); border-radius: 3px; cursor: pointer;
    }
    .pkm-icon-btn:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }

    .ctx-menu {
      position: fixed; background: var(--pkm-surface);
      border: 1px solid var(--pkm-border); border-radius: 7px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 500; min-width: 160px; overflow: hidden;
    }
    .ctx-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; cursor: pointer; font-size: 13px;
    }
    .ctx-item:hover { background: var(--pkm-surface-2); }
    .ctx-item.danger { color: var(--pkm-link-unresolved); }
    .ctx-sep { height: 1px; background: var(--pkm-border); margin: 2px 0; }
  `;

  constructor() {
    super();
    this.files      = [];
    this.activePath = null;
    this.dirtyPaths = new Set();
    this._expanded  = loadExpand();
    this._renaming  = null;
    this._renameVal = "";
    this._ctx       = null;
    this._dragOver  = null;
    this._ctxCloseBound = () => { this._ctx = null; };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._ctxCloseBound);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._ctxCloseBound);
  }

  _toggle(path) {
    const s = new Set(this._expanded);
    s.has(path) ? s.delete(path) : s.add(path);
    this._expanded = s;
    saveExpand(s);
  }

  _open(path)  { this.dispatchEvent(new CustomEvent("file-open",   { detail: { path }, bubbles: true, composed: true })); }
  _newNote(p)  { this._ctx = null; this.dispatchEvent(new CustomEvent("file-new",    { detail: { basePath: p ? p + "/" : "" }, bubbles: true, composed: true })); }
  _newFolder(p){ this._ctx = null; this.dispatchEvent(new CustomEvent("folder-new",  { detail: { basePath: p ? p + "/" : "" }, bubbles: true, composed: true })); }
  _delete(n)   { this._ctx = null; this.dispatchEvent(new CustomEvent("file-delete", { detail: { path: n.path, type: n.type }, bubbles: true, composed: true })); }
  _copyPath(n) { this._ctx = null; navigator.clipboard.writeText(n.path).catch(() => {}); }

  _startRename(node) {
    this._ctx = null;
    this._renaming  = node.path;
    this._renameVal = node.name;
    this.updateComplete.then(() => {
      const inp = this.shadowRoot.querySelector(".rename-input");
      if (inp) { inp.focus(); inp.select(); }
    });
  }

  _commitRename(node) {
    if (this._renameVal && this._renameVal !== node.name) {
      const dir = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/") + 1) : "";
      this.dispatchEvent(new CustomEvent("file-rename", {
        detail: { oldPath: node.path, newPath: dir + this._renameVal },
        bubbles: true, composed: true,
      }));
    }
    this._renaming = null;
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────────

  _onDragStart(e, node) {
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
  }

  _onDragOver(e, node) {
    if (node.type !== "folder") { e.preventDefault(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    this._dragOver = node.path;
  }

  _onDragLeave() { this._dragOver = null; }

  _onDrop(e, node) {
    e.preventDefault();
    this._dragOver = null;
    const src = e.dataTransfer.getData("text/plain");
    if (!src || src === node.path) return;
    const name = src.split("/").pop();
    const dest = node.type === "folder" ? `${node.path}/${name}` : (() => {
      const dir = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
      return dir ? `${dir}/${name}` : name;
    })();
    if (dest !== src) {
      this.dispatchEvent(new CustomEvent("file-rename", {
        detail: { oldPath: src, newPath: dest }, bubbles: true, composed: true,
      }));
    }
  }

  _onContextMenu(e, node) {
    e.preventDefault(); e.stopPropagation();
    this._ctx = { x: e.clientX, y: e.clientY, node };
  }

  _renderNode(node, depth = 0) {
    const isFolder  = node.type === "folder";
    const isOpen    = this._expanded.has(node.path);
    const isActive  = node.path === this.activePath;
    const isDirty   = this.dirtyPaths instanceof Set ? this.dirtyPaths.has(node.path) : false;
    const isRen     = this._renaming === node.path;
    const isDragOver= this._dragOver === node.path;

    return html`
      <div
        class="item ${isActive ? "active" : ""} ${isDragOver ? "drag-over" : ""}"
        style="padding-left:${8 + depth * 16}px"
        draggable="true"
        @click=${() => isFolder ? this._toggle(node.path) : this._open(node.path)}
        @contextmenu=${(e) => this._onContextMenu(e, node)}
        @dragstart=${(e) => this._onDragStart(e, node)}
        @dragover=${(e) => this._onDragOver(e, node)}
        @dragleave=${() => this._onDragLeave()}
        @drop=${(e) => this._onDrop(e, node)}
      >
        ${isFolder
          ? html`<span class="arrow ${isOpen ? "open" : ""}">▶</span>`
          : html`<span style="width:16px;display:inline-block"></span>`}
        <span class="icon">${isFolder ? (isOpen ? "📂" : "📁") : "📄"}</span>
        ${isRen
          ? html`<input class="rename-input" .value=${this._renameVal}
              @input=${(e) => { this._renameVal = e.target.value; }}
              @keydown=${(e) => { if (e.key === "Enter") { e.preventDefault(); this._commitRename(node); } if (e.key === "Escape") this._renaming = null; }}
              @blur=${() => this._commitRename(node)}
              @click=${(e) => e.stopPropagation()}
            />`
          : html`<span class="name">${node.name}</span>`}
        ${isDirty ? html`<span class="dirty"></span>` : ""}
      </div>
      ${isFolder && isOpen && node.children
        ? node.children.map((child) => this._renderNode(child, depth + 1))
        : ""}
    `;
  }

  _renderCtx() {
    if (!this._ctx) return "";
    const { x, y, node } = this._ctx;
    const isFolder = node.type === "folder";
    return html`
      <div class="ctx-menu" style="left:${x}px; top:${y}px;" @click=${(e) => e.stopPropagation()}>
        ${isFolder ? html`
          <div class="ctx-item" @click=${() => this._newNote(node.path)}>📄 New Note</div>
          <div class="ctx-item" @click=${() => this._newFolder(node.path)}>📁 New Folder</div>
          <div class="ctx-sep"></div>
        ` : ""}
        <div class="ctx-item" @click=${() => this._startRename(node)}>✏️ Rename</div>
        <div class="ctx-item" @click=${() => this._copyPath(node)}>📋 Copy Path</div>
        <div class="ctx-sep"></div>
        <div class="ctx-item danger" @click=${() => this._delete(node)}>🗑️ Delete</div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="header">
        Files
        <div class="header-actions">
          <button class="pkm-icon-btn" title="New note"   @click=${() => this._newNote("")}>📄</button>
          <button class="pkm-icon-btn" title="New folder" @click=${() => this._newFolder("")}>📁</button>
        </div>
      </div>
      <div class="scroll">
        ${(this.files || []).map((n) => this._renderNode(n, 0))}
      </div>
      ${this._renderCtx()}
    `;
  }
}

customElements.define("pkm-file-tree", PkmFileTree);
