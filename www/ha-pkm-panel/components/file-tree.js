import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

const EXPAND_STATE_KEY = "ha-pkm-tree-expand";

function loadExpandState() {
  try { return new Set(JSON.parse(localStorage.getItem(EXPAND_STATE_KEY) || "[]")); }
  catch { return new Set(); }
}

function saveExpandState(set) {
  localStorage.setItem(EXPAND_STATE_KEY, JSON.stringify([...set]));
}

export class PkmFileTree extends LitElement {
  static properties = {
    files: { type: Array },
    activePath: { type: String },
    dirtyPaths: { type: Object },
    _expanded: { state: true },
    _renaming: { state: true },
    _renameValue: { state: true },
    _contextMenu: { state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .tree-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--pkm-text-muted);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
    }
    .tree-header-actions { display: flex; gap: 2px; }

    .tree-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    .tree-item {
      display: flex;
      align-items: center;
      height: 28px;
      padding: 0 8px;
      cursor: pointer;
      gap: 4px;
      font-size: 13px;
      color: var(--pkm-text);
      border-radius: 4px;
      margin: 0 4px;
      user-select: none;
      position: relative;
    }
    .tree-item:hover { background: var(--pkm-surface-2); }
    .tree-item.active {
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
    }

    .tree-indent { display: inline-block; }

    .tree-arrow {
      width: 16px;
      font-size: 10px;
      color: var(--pkm-text-muted);
      flex-shrink: 0;
      transition: transform 150ms ease;
    }
    .tree-arrow.open { transform: rotate(90deg); }

    .tree-icon { font-size: 14px; flex-shrink: 0; }

    .tree-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tree-dirty {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--pkm-accent);
      flex-shrink: 0;
    }

    .rename-input {
      flex: 1;
      background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-accent);
      border-radius: 3px;
      color: var(--pkm-text);
      padding: 1px 4px;
      font-size: 13px;
      outline: none;
    }

    .context-menu {
      position: fixed;
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 500;
      min-width: 160px;
      overflow: hidden;
    }
    .context-menu-item {
      display: flex;
      align-items: center;
      padding: 8px 14px;
      cursor: pointer;
      font-size: 13px;
      gap: 8px;
    }
    .context-menu-item:hover { background: var(--pkm-surface-2); }
    .context-menu-item.danger { color: var(--pkm-link-unresolved); }
    .context-separator { height: 1px; background: var(--pkm-border); margin: 2px 0; }
  `;

  constructor() {
    super();
    this.files = [];
    this.activePath = null;
    this.dirtyPaths = new Set();
    this._expanded = loadExpandState();
    this._renaming = null;
    this._renameValue = "";
    this._contextMenu = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._closeContextBound = this._closeContext.bind(this);
    document.addEventListener("click", this._closeContextBound);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._closeContextBound);
  }

  _closeContext() { this._contextMenu = null; }

  _toggleFolder(path) {
    if (this._expanded.has(path)) this._expanded.delete(path);
    else this._expanded.add(path);
    this._expanded = new Set(this._expanded);
    saveExpandState(this._expanded);
  }

  _openFile(path) {
    this.dispatchEvent(new CustomEvent("file-open", { detail: { path }, bubbles: true, composed: true }));
  }

  _onContextMenu(e, node) {
    e.preventDefault();
    e.stopPropagation();
    this._contextMenu = { x: e.clientX, y: e.clientY, node };
  }

  _startRename(node) {
    this._renaming = node.path;
    this._renameValue = node.name;
    this._contextMenu = null;
    this.updateComplete.then(() => {
      const input = this.shadowRoot.querySelector(".rename-input");
      if (input) { input.focus(); input.select(); }
    });
  }

  _commitRename(node) {
    if (this._renameValue && this._renameValue !== node.name) {
      const newPath = node.path.replace(node.name, this._renameValue);
      this.dispatchEvent(new CustomEvent("file-rename", {
        detail: { oldPath: node.path, newPath },
        bubbles: true, composed: true,
      }));
    }
    this._renaming = null;
  }

  _newNote(parentPath) {
    this._contextMenu = null;
    const base = parentPath ? parentPath + "/" : "";
    this.dispatchEvent(new CustomEvent("file-new", { detail: { basePath: base }, bubbles: true, composed: true }));
  }

  _newFolder(parentPath) {
    this._contextMenu = null;
    const base = parentPath ? parentPath + "/" : "";
    this.dispatchEvent(new CustomEvent("folder-new", { detail: { basePath: base }, bubbles: true, composed: true }));
  }

  _deleteNode(node) {
    this._contextMenu = null;
    this.dispatchEvent(new CustomEvent("file-delete", { detail: { path: node.path, type: node.type }, bubbles: true, composed: true }));
  }

  _copyPath(node) {
    this._contextMenu = null;
    navigator.clipboard.writeText(node.path).catch(() => {});
  }

  _renderNode(node, depth = 0) {
    const indent = depth * 16;
    const isFolder = node.type === "folder";
    const isOpen = this._expanded.has(node.path);
    const isActive = node.path === this.activePath;
    const isDirty = this.dirtyPaths instanceof Set ? this.dirtyPaths.has(node.path) : false;
    const isRenaming = this._renaming === node.path;

    return html`
      <div
        class="tree-item ${isActive ? "active" : ""}"
        style="padding-left: ${8 + indent}px"
        @click=${() => isFolder ? this._toggleFolder(node.path) : this._openFile(node.path)}
        @contextmenu=${(e) => this._onContextMenu(e, node)}
      >
        ${isFolder
          ? html`<span class="tree-arrow ${isOpen ? "open" : ""}">▶</span>`
          : html`<span style="width:16px;display:inline-block"></span>`}
        <span class="tree-icon">${isFolder ? (isOpen ? "📂" : "📁") : "📄"}</span>
        ${isRenaming
          ? html`<input
              class="rename-input"
              .value=${this._renameValue}
              @input=${(e) => { this._renameValue = e.target.value; }}
              @keydown=${(e) => {
                if (e.key === "Enter") { e.preventDefault(); this._commitRename(node); }
                if (e.key === "Escape") { this._renaming = null; }
              }}
              @blur=${() => this._commitRename(node)}
              @click=${(e) => e.stopPropagation()}
            />`
          : html`<span class="tree-name">${node.name}</span>`}
        ${isDirty ? html`<span class="tree-dirty"></span>` : ""}
      </div>
      ${isFolder && isOpen && node.children
        ? node.children.map((child) => this._renderNode(child, depth + 1))
        : ""}
    `;
  }

  _renderContextMenu() {
    if (!this._contextMenu) return "";
    const { x, y, node } = this._contextMenu;
    const isFolder = node.type === "folder";
    return html`
      <div class="context-menu" style="left:${x}px; top:${y}px" @click=${(e) => e.stopPropagation()}>
        ${isFolder ? html`
          <div class="context-menu-item" @click=${() => this._newNote(node.path)}>📄 New Note</div>
          <div class="context-menu-item" @click=${() => this._newFolder(node.path)}>📁 New Folder</div>
          <div class="context-separator"></div>
        ` : ""}
        <div class="context-menu-item" @click=${() => this._startRename(node)}>✏️ Rename</div>
        <div class="context-menu-item" @click=${() => this._copyPath(node)}>📋 Copy Path</div>
        <div class="context-separator"></div>
        <div class="context-menu-item danger" @click=${() => this._deleteNode(node)}>🗑️ Delete</div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="tree-header">
        Files
        <div class="tree-header-actions">
          <button class="pkm-icon-btn" title="New note" @click=${() => this._newNote("")}>📄</button>
          <button class="pkm-icon-btn" title="New folder" @click=${() => this._newFolder("")}>📁</button>
        </div>
      </div>
      <div class="tree-scroll">
        ${(this.files || []).map((node) => this._renderNode(node, 0))}
      </div>
      ${this._renderContextMenu()}
    `;
  }
}

customElements.define("pkm-file-tree", PkmFileTree);
