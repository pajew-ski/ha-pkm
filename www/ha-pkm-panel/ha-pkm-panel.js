/**
 * ha-pkm-panel.js – Entry Point Lit Element Custom Element
 *
 * Registered as HA panel component: ha-pkm-panel
 * URL path: /pkm
 */

import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

// Components
import "./components/tab-bar.js";
import "./components/file-tree.js";
import "./components/backlinks-panel.js";
import "./components/search-modal.js";
import "./components/command-palette.js";

// Views
import "./views/editor-view.js";
import "./views/canvas-view.js";
import "./views/database-view.js";
import "./views/graph-view.js";

const RECENT_FILES_KEY = "ha-pkm-recent-files";
const SIDEBAR_STATE_KEY = "ha-pkm-sidebar";
const VIEW_STATE_KEY = "ha-pkm-view";
const MAX_RECENT = 20;

function loadRecentFiles() {
  try { return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) || "[]"); }
  catch { return []; }
}

function saveRecentFiles(arr) {
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(arr.slice(0, MAX_RECENT)));
}

class HaPkmPanel extends LitElement {
  static get properties() {
    return {
      hass:   { type: Object },
      narrow: { type: Boolean },
      route:  { type: Object },
      panel:  { type: Object },
      // Internal state
      _tabs:         { state: true },
      _activeTab:    { state: true },
      _currentView:  { state: true },
      _sidebarOpen:  { state: true },
      _backlinkOpen: { state: true },
      _fileTree:     { state: true },
      _showSearch:   { state: true },
      _showCommand:  { state: true },
      _toasts:       { state: true },
      _recentFiles:  { state: true },
      _allPaths:     { state: true },
    };
  }

  static styles = css`
    :host {
      --pkm-bg: var(--primary-background-color, #1a1a2e);
      --pkm-surface: var(--card-background-color, #16213e);
      --pkm-surface-2: var(--secondary-background-color, #0f3460);
      --pkm-border: var(--divider-color, #2a2a4a);
      --pkm-text: var(--primary-text-color, #e0e0e0);
      --pkm-text-muted: var(--secondary-text-color, #888);
      --pkm-accent: var(--primary-color, #7b68ee);
      --pkm-link: var(--accent-color, #7b68ee);
      --pkm-link-unresolved: var(--error-color, #e74c3c);
      --pkm-font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --pkm-font-ui: var(--paper-font-body1_-_font-family, 'Roboto', sans-serif);
      --pkm-sidebar-width: 260px;
      --pkm-backlinks-width: 240px;
      --pkm-tab-height: 36px;
      --pkm-toolbar-height: 48px;
      --pkm-radius: 6px;
      --pkm-radius-sm: 3px;
      --pkm-shadow: 0 2px 8px rgba(0,0,0,0.3);
      --pkm-transition: 150ms ease;

      display: block;
      height: 100%;
      font-family: var(--pkm-font-ui);
      background: var(--pkm-bg);
      color: var(--pkm-text);
      box-sizing: border-box;
      overflow: hidden;
    }

    *, *::before, *::after { box-sizing: inherit; }

    /* Scrollbars */
    * { scrollbar-width: thin; scrollbar-color: var(--pkm-border) transparent; }
    *::-webkit-scrollbar { width: 6px; height: 6px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb { background: var(--pkm-border); border-radius: 3px; }

    .pkm-layout {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    /* ── Toolbar ─────────────────────────────── */
    .pkm-toolbar {
      display: flex;
      align-items: center;
      height: var(--pkm-toolbar-height);
      padding: 0 8px;
      background: var(--pkm-surface);
      border-bottom: 1px solid var(--pkm-border);
      gap: 2px;
      flex-shrink: 0;
      z-index: 10;
    }

    .toolbar-brand {
      font-weight: 700;
      font-size: 14px;
      padding: 0 8px;
      color: var(--pkm-accent);
      letter-spacing: 0.02em;
      margin-right: 4px;
    }

    .toolbar-sep {
      width: 1px;
      height: 24px;
      background: var(--pkm-border);
      margin: 0 6px;
    }

    .view-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: var(--pkm-radius);
      border: none;
      background: transparent;
      color: var(--pkm-text-muted);
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
      transition: background var(--pkm-transition), color var(--pkm-transition);
    }
    .view-btn:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }
    .view-btn.active {
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
    }

    .toolbar-spacer { flex: 1; }

    .pkm-icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: var(--pkm-text-muted);
      border-radius: var(--pkm-radius-sm);
      cursor: pointer;
      transition: background var(--pkm-transition), color var(--pkm-transition);
      padding: 0;
      font-size: 16px;
    }
    .pkm-icon-btn:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }

    /* ── Main area ───────────────────────────── */
    .pkm-main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── Sidebars ────────────────────────────── */
    .pkm-sidebar-left {
      width: var(--pkm-sidebar-width);
      min-width: var(--pkm-sidebar-width);
      background: var(--pkm-surface);
      border-right: 1px solid var(--pkm-border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width var(--pkm-transition), min-width var(--pkm-transition);
      flex-shrink: 0;
    }
    .pkm-sidebar-left.collapsed { width: 0; min-width: 0; }

    .pkm-sidebar-right {
      width: var(--pkm-backlinks-width);
      min-width: var(--pkm-backlinks-width);
      background: var(--pkm-surface);
      border-left: 1px solid var(--pkm-border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: width var(--pkm-transition), min-width var(--pkm-transition);
      flex-shrink: 0;
    }
    .pkm-sidebar-right.collapsed { width: 0; min-width: 0; }

    /* ── Content ─────────────────────────────── */
    .pkm-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    pkm-tab-bar { flex-shrink: 0; }

    .view-area {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    pkm-editor-view,
    pkm-canvas-view,
    pkm-database-view,
    pkm-graph-view {
      flex: 1;
      overflow: hidden;
    }

    /* ── Toasts ──────────────────────────────── */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 2000;
      pointer-events: none;
    }
    .toast {
      padding: 10px 16px;
      border-radius: var(--pkm-radius);
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      box-shadow: var(--pkm-shadow);
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      animation: toast-in 200ms ease;
      pointer-events: auto;
    }
    .toast.info  { border-left: 3px solid var(--pkm-accent); }
    .toast.warn  { border-left: 3px solid #f39c12; }
    .toast.error { border-left: 3px solid var(--pkm-link-unresolved); }
    .toast-action {
      cursor: pointer;
      color: var(--pkm-accent);
      font-weight: 600;
      margin-left: 8px;
      text-decoration: underline;
    }

    @keyframes toast-in {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
  `;

  constructor() {
    super();
    this._tabs = [];
    this._activeTab = null;
    this._currentView = localStorage.getItem(VIEW_STATE_KEY) || "editor";
    this._sidebarOpen = localStorage.getItem(SIDEBAR_STATE_KEY) !== "false";
    this._backlinkOpen = true;
    this._fileTree = [];
    this._showSearch = false;
    this._showCommand = false;
    this._toasts = [];
    this._recentFiles = loadRecentFiles();
    this._allPaths = [];
    this._toastId = 0;
    this._eventUnsub = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._keydownBound = this._onKeydown.bind(this);
    window.addEventListener("keydown", this._keydownBound, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("keydown", this._keydownBound, true);
    if (this._eventUnsub) this._eventUnsub();
  }

  updated(changed) {
    if (changed.has("hass") && this.hass) {
      this._initIfNeeded();
    }
    if (changed.has("narrow") && this.narrow) {
      this._sidebarOpen = false;
      this._backlinkOpen = false;
    }
  }

  async _initIfNeeded() {
    if (this._initialized) return;
    this._initialized = true;
    await this._loadFileTree();
    this._subscribeFileEvents();
  }

  async _loadFileTree() {
    try {
      const res = await this.hass.callWS({ type: "ha_pkm/list_files" });
      this._fileTree = res.files || [];
      this._allPaths = this._collectPaths(this._fileTree);
    } catch (e) {
      console.error("File tree load error:", e);
    }
  }

  _collectPaths(nodes, result = []) {
    for (const node of nodes) {
      if (node.type === "file") result.push(node.path);
      if (node.children) this._collectPaths(node.children, result);
    }
    return result;
  }

  _subscribeFileEvents() {
    if (!this.hass?.connection) return;
    this._eventUnsub = this.hass.connection.subscribeEvents(
      (event) => this._onFileChanged(event.data),
      "ha_pkm_file_changed"
    );
  }

  async _onFileChanged({ path, event_type }) {
    // Refresh file tree
    await this._loadFileTree();

    const tab = this._tabs.find((t) => t.path === path);
    if (!tab) return;

    if (event_type === "modified") {
      if (tab.isDirty) {
        this._showToast(`External change in "${path.split("/").pop()}"`, "warn", [
          { label: "Reload", action: () => this._reloadTab(path) },
          { label: "Ignore", action: () => {} },
        ]);
      } else {
        await this._reloadTab(path);
        this._showToast(`"${path.split("/").pop()}" reloaded from disk`, "info");
      }
    } else if (event_type === "deleted") {
      this._setTabDirty(path, true);
      this._showToast(`"${path.split("/").pop()}" was deleted externally`, "warn");
    }
  }

  async _reloadTab(path) {
    const editorEl = this.shadowRoot.querySelector("pkm-editor-view");
    if (editorEl && this._activeTab === path) {
      await editorEl._loadFile();
    }
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  _openFile(path) {
    const existing = this._tabs.find((t) => t.path === path);
    if (existing) {
      this._activeTab = path;
    } else {
      const title = path.split("/").pop().replace(/\.md$/, "");
      this._tabs = [...this._tabs, { path, title, isDirty: false }];
      this._activeTab = path;
    }
    this._currentView = path.endsWith(".canvas") ? "canvas" : "editor";
    this._addToRecent(path);
  }

  _closeTab(path) {
    const idx = this._tabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const newTabs = this._tabs.filter((t) => t.path !== path);
    this._tabs = newTabs;
    if (this._activeTab === path) {
      this._activeTab = newTabs[Math.min(idx, newTabs.length - 1)]?.path || null;
    }
  }

  _nextTab() {
    if (this._tabs.length === 0) return;
    const idx = this._tabs.findIndex((t) => t.path === this._activeTab);
    this._activeTab = this._tabs[(idx + 1) % this._tabs.length].path;
  }

  _setView(view) {
    this._currentView = view;
    localStorage.setItem(VIEW_STATE_KEY, view);
  }

  _toggleSidebar() {
    this._sidebarOpen = !this._sidebarOpen;
    localStorage.setItem(SIDEBAR_STATE_KEY, String(this._sidebarOpen));
  }

  _addToRecent(path) {
    this._recentFiles = [path, ...this._recentFiles.filter((p) => p !== path)];
    saveRecentFiles(this._recentFiles);
  }

  _setTabDirty(path, dirty) {
    this._tabs = this._tabs.map((t) => t.path === path ? { ...t, isDirty: dirty } : t);
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  _onKeydown(e) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    if (e.key === "k" || e.key === "K") { e.preventDefault(); this._openSearch(); return; }
    if (e.key === "p" || e.key === "P") { e.preventDefault(); this._openCommand(); return; }
    if (e.key === "w" || e.key === "W") { e.preventDefault(); if (this._activeTab) this._closeTab(this._activeTab); return; }
    if (e.key === "Tab") { e.preventDefault(); this._nextTab(); return; }
    if (e.key === "\\") { e.preventDefault(); this._toggleSidebar(); return; }
    // Ctrl+S handled inside CodeMirror keymap; no-op here
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  _openSearch(initialQuery = "") {
    this._showSearch = true;
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector("pkm-search-modal")?.open(initialQuery);
    });
  }

  _openCommand() {
    this._showCommand = true;
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector("pkm-command-palette")?.open();
    });
  }

  async _runCommand(id) {
    switch (id) {
      case "new-note":         await this._newNote(""); break;
      case "new-canvas":       await this._newFile("Untitled.canvas"); break;
      case "new-folder":       await this._newFolder(""); break;
      case "open-graph":       this._setView("graph"); break;
      case "open-database":    this._setView("database"); break;
      case "open-editor":      this._setView("editor"); break;
      case "open-canvas-view": this._setView("canvas"); break;
      case "toggle-sidebar":   this._toggleSidebar(); break;
      case "toggle-backlinks": this._backlinkOpen = !this._backlinkOpen; break;
      case "search":           this._openSearch(); break;
      case "close-tab":        if (this._activeTab) this._closeTab(this._activeTab); break;
      case "rebuild-index":    await this._rebuildIndex(); break;
    }
  }

  async _rebuildIndex() {
    try {
      await this.hass.callWS({ type: "ha_pkm/list_files" }); // triggers backend rebuild via init
      this._showToast("Index rebuilt", "info");
    } catch (e) {
      this._showToast(`Rebuild failed: ${e.message}`, "error");
    }
  }

  async _newNote(basePath) {
    const name = `${basePath}Untitled-${Date.now()}.md`;
    await this.hass.callWS({ type: "ha_pkm/write_file", path: name, content: `# ${name.split("/").pop().replace(".md","")}\n` });
    await this._loadFileTree();
    this._openFile(name);
    this._showToast("New note created", "info");
  }

  async _newFile(name) {
    const content = name.endsWith(".canvas") ? '{"nodes":[],"edges":[]}' : "";
    await this.hass.callWS({ type: "ha_pkm/write_file", path: name, content });
    await this._loadFileTree();
    this._openFile(name);
  }

  async _newFolder(basePath) {
    const name = `${basePath}New Folder`;
    await this.hass.callWS({ type: "ha_pkm/create_folder", path: name });
    await this._loadFileTree();
  }

  async _renameFile(oldPath, newPath) {
    await this.hass.callWS({ type: "ha_pkm/rename_file", old_path: oldPath, new_path: newPath });
    // Update open tab if renamed
    const tab = this._tabs.find((t) => t.path === oldPath);
    if (tab) {
      this._tabs = this._tabs.map((t) => t.path === oldPath ? { ...t, path: newPath, title: newPath.split("/").pop().replace(/\.md$/, "") } : t);
      if (this._activeTab === oldPath) this._activeTab = newPath;
    }
    await this._loadFileTree();
  }

  async _deleteFile(path, type) {
    if (!confirm(`Delete "${path}"? It will be moved to .trash`)) return;
    await this.hass.callWS({ type: "ha_pkm/delete_file", path });
    if (type === "file") this._closeTab(path);
    await this._loadFileTree();
    this._showToast(`"${path.split("/").pop()}" moved to trash`, "info");
  }

  // ── Toasts ───────────────────────────────────────────────────────────────

  _showToast(message, type = "info", actions = [], duration = 5000) {
    const id = ++this._toastId;
    this._toasts = [...this._toasts, { id, message, type, actions }];
    if (duration > 0) {
      setTimeout(() => { this._toasts = this._toasts.filter((t) => t.id !== id); }, duration);
    }
  }

  _dismissToast(id) {
    this._toasts = this._toasts.filter((t) => t.id !== id);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  _renderView() {
    switch (this._currentView) {
      case "canvas":
        return html`<pkm-canvas-view
          .hass=${this.hass}
          .path=${this._activeTab}
        ></pkm-canvas-view>`;
      case "database":
        return html`<pkm-database-view
          .hass=${this.hass}
          @file-open=${(e) => this._openFile(e.detail.path)}
        ></pkm-database-view>`;
      case "graph":
        return html`<pkm-graph-view
          .hass=${this.hass}
          @file-open=${(e) => this._openFile(e.detail.path)}
        ></pkm-graph-view>`;
      default:
        return html`<pkm-editor-view
          .hass=${this.hass}
          .path=${this._activeTab}
          .allPaths=${this._allPaths}
          @file-saved=${(e) => this._setTabDirty(e.detail.path, false)}
          @dirty-change=${(e) => this._setTabDirty(e.detail.path, e.detail.isDirty)}
          @open-link=${(e) => this._resolveLinkAndOpen(e.detail.link)}
          @show-toast=${(e) => this._showToast(e.detail.message, e.detail.type)}
        ></pkm-editor-view>`;
    }
  }

  async _resolveLinkAndOpen(link) {
    try {
      const res = await this.hass.callWS({ type: "ha_pkm/resolve_link", link });
      if (res.path) {
        this._openFile(res.path);
      } else {
        if (confirm(`Note "${link}" doesn't exist. Create it?`)) {
          await this._newNote(`${link}.md`);
        }
      }
    } catch (e) {
      console.error("Link resolve error:", e);
    }
  }

  render() {
    const isNarrow = this.narrow;

    return html`
      <div class="pkm-layout">

        <!-- Toolbar -->
        <div class="pkm-toolbar">
          <button class="pkm-icon-btn" title="Toggle sidebar (Ctrl+\\)" @click=${this._toggleSidebar}>≡</button>
          <span class="toolbar-brand">PKM</span>
          <div class="toolbar-sep"></div>

          <button class="view-btn ${this._currentView === "editor" ? "active" : ""}" @click=${() => this._setView("editor")}>
            📝 Editor
          </button>
          <button class="view-btn ${this._currentView === "canvas" ? "active" : ""}" @click=${() => this._setView("canvas")}>
            🔲 Canvas
          </button>
          <button class="view-btn ${this._currentView === "database" ? "active" : ""}" @click=${() => this._setView("database")}>
            ⊞ Database
          </button>
          <button class="view-btn ${this._currentView === "graph" ? "active" : ""}" @click=${() => this._setView("graph")}>
            ⬡ Graph
          </button>

          <span class="toolbar-spacer"></span>

          <button class="pkm-icon-btn" title="Search (Ctrl+K)" @click=${() => this._openSearch()}>🔍</button>
          <button class="pkm-icon-btn" title="Commands (Ctrl+P)" @click=${() => this._openCommand()}>⌘</button>
          <button class="pkm-icon-btn" title="Toggle backlinks panel" @click=${() => { this._backlinkOpen = !this._backlinkOpen; }}>🔗</button>
        </div>

        <!-- Main -->
        <div class="pkm-main">

          <!-- Left sidebar: File tree -->
          <div class="pkm-sidebar-left ${(!this._sidebarOpen || isNarrow) ? "collapsed" : ""}">
            <pkm-file-tree
              .files=${this._fileTree}
              .activePath=${this._activeTab}
              .dirtyPaths=${new Set(this._tabs.filter((t) => t.isDirty).map((t) => t.path))}
              @file-open=${(e) => this._openFile(e.detail.path)}
              @file-new=${(e) => this._newNote(e.detail.basePath)}
              @folder-new=${(e) => this._newFolder(e.detail.basePath)}
              @file-rename=${(e) => this._renameFile(e.detail.oldPath, e.detail.newPath)}
              @file-delete=${(e) => this._deleteFile(e.detail.path, e.detail.type)}
            ></pkm-file-tree>
          </div>

          <!-- Content area -->
          <div class="pkm-content">
            <pkm-tab-bar
              .tabs=${this._tabs}
              .activeTab=${this._activeTab}
              @tab-select=${(e) => { this._activeTab = e.detail.path; this._currentView = e.detail.path?.endsWith(".canvas") ? "canvas" : "editor"; }}
              @tab-close=${(e) => this._closeTab(e.detail.path)}
              @tab-new=${() => this._showCommand = true}
            ></pkm-tab-bar>

            <div class="view-area">
              ${this._renderView()}
            </div>
          </div>

          <!-- Right sidebar: Backlinks -->
          <div class="pkm-sidebar-right ${(!this._backlinkOpen || isNarrow) ? "collapsed" : ""}">
            <pkm-backlinks-panel
              .hass=${this.hass}
              .activePath=${this._activeTab}
              @file-open=${(e) => this._openFile(e.detail.path)}
              @tag-search=${(e) => this._openSearch(`#tag:${e.detail.tag}`)}
            ></pkm-backlinks-panel>
          </div>

        </div>
      </div>

      <!-- Search modal -->
      ${this._showSearch ? html`
        <pkm-search-modal
          .hass=${this.hass}
          .allPaths=${this._allPaths}
          @file-open=${(e) => { this._openFile(e.detail.path); this._showSearch = false; }}
          @close=${() => { this._showSearch = false; }}
        ></pkm-search-modal>
      ` : ""}

      <!-- Command palette -->
      ${this._showCommand ? html`
        <pkm-command-palette
          .recentFiles=${this._recentFiles}
          @file-open=${(e) => { this._openFile(e.detail.path); this._showCommand = false; }}
          @command=${(e) => { this._runCommand(e.detail.id); this._showCommand = false; }}
          @close=${() => { this._showCommand = false; }}
        ></pkm-command-palette>
      ` : ""}

      <!-- Toasts -->
      <div class="toast-container">
        ${this._toasts.map((toast) => html`
          <div class="toast ${toast.type}" @click=${() => this._dismissToast(toast.id)}>
            ${toast.message}
            ${(toast.actions || []).map((action) => html`
              <span class="toast-action" @click=${(e) => { e.stopPropagation(); action.action(); this._dismissToast(toast.id); }}>
                ${action.label}
              </span>
            `)}
          </div>
        `)}
      </div>
    `;
  }
}

customElements.define("ha-pkm-panel", HaPkmPanel);
