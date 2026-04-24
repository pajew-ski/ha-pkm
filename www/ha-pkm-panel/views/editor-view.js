import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";
import { PkmEditor } from "../editor/codemirror-setup.js";

const MARKED_CDN = "https://cdn.jsdelivr.net/npm/marked@12/+esm";
const DOMPURIFY_CDN = "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.es.mjs";

let markedLib = null;
let dompurifyLib = null;

async function ensureLibs() {
  if (!markedLib) {
    const m = await import(MARKED_CDN);
    markedLib = m.marked || m.default;
  }
  if (!dompurifyLib) {
    const d = await import(DOMPURIFY_CDN);
    dompurifyLib = d.default || d.DOMPurify || d;
  }
}

const WIKILINK_IN_PREVIEW_RE = /\[\[([^\]|#\n]+?)(?:\|([^\]\n]*))?\]\]/g;

function renderMarkdown(content) {
  if (!markedLib || !dompurifyLib) return content;
  const raw = markedLib.parse(content);
  return dompurifyLib.sanitize(raw, {
    ALLOWED_TAGS: [
      "h1","h2","h3","h4","h5","h6","p","ul","ol","li","blockquote",
      "pre","code","em","strong","del","a","img","table","thead","tbody",
      "tr","th","td","br","hr","span","div","mark",
    ],
    ALLOWED_ATTR: ["href","src","alt","class","data-wikilink-target","title"],
  });
}

export class PkmEditorView extends LitElement {
  static properties = {
    hass: { type: Object },
    path: { type: String },
    _content: { state: true },
    _isDirty: { state: true },
    _isPreview: { state: true },
    _previewHtml: { state: true },
    _loading: { state: true },
    _frontmatter: { state: true },
    _fmCollapsed: { state: true },
    _saving: { state: true },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .editor-toolbar {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      gap: 4px;
      flex-shrink: 0;
    }

    .toolbar-path {
      flex: 1;
      font-size: 12px;
      color: var(--pkm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0 8px;
    }

    .dirty-indicator { color: var(--pkm-accent); font-size: 18px; line-height: 1; }
    .saving-indicator { color: var(--pkm-text-muted); font-size: 11px; }

    .mode-btn {
      padding: 3px 10px;
      border-radius: 4px;
      border: 1px solid var(--pkm-border);
      background: transparent;
      color: var(--pkm-text-muted);
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }
    .mode-btn.active {
      background: var(--pkm-accent);
      color: #fff;
      border-color: var(--pkm-accent);
    }

    .fm-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      flex-shrink: 0;
      align-items: center;
    }
    .fm-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      background: var(--pkm-surface-2);
      color: var(--pkm-text-muted);
      border: 1px solid var(--pkm-border);
    }
    .fm-key { color: var(--pkm-accent); font-weight: 600; }
    .fm-toggle {
      margin-left: auto;
      background: none;
      border: none;
      color: var(--pkm-text-muted);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 6px;
    }

    .editor-area { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    #cm-host { flex: 1; overflow: hidden; }

    .preview-area {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
      max-width: 860px;
      margin: 0 auto;
      width: 100%;
    }

    .preview-area h1, .preview-area h2, .preview-area h3,
    .preview-area h4, .preview-area h5, .preview-area h6 {
      color: var(--pkm-text);
      margin-top: 1.4em;
      margin-bottom: 0.4em;
    }
    .preview-area p { margin: 0.6em 0; line-height: 1.7; }
    .preview-area a { color: var(--pkm-link); }
    .preview-area code {
      background: var(--pkm-surface-2);
      padding: 1px 5px;
      border-radius: 3px;
      font-family: var(--pkm-font-mono);
      font-size: 0.9em;
    }
    .preview-area pre {
      background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-border);
      border-radius: 6px;
      padding: 12px 16px;
      overflow-x: auto;
    }
    .preview-area pre code { background: none; padding: 0; }
    .preview-area blockquote {
      border-left: 3px solid var(--pkm-accent);
      margin: 0;
      padding: 4px 16px;
      color: var(--pkm-text-muted);
    }
    .preview-area table { border-collapse: collapse; width: 100%; }
    .preview-area th, .preview-area td {
      border: 1px solid var(--pkm-border);
      padding: 6px 12px;
      text-align: left;
    }
    .preview-area th { background: var(--pkm-surface-2); }

    [data-wikilink-target] {
      color: var(--pkm-link);
      cursor: pointer;
      border-bottom: 1px solid color-mix(in srgb, var(--pkm-link) 50%, transparent);
    }

    .loading-overlay {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--pkm-text-muted);
      font-size: 14px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 12px;
      color: var(--pkm-text-muted);
    }
    .empty-state .big-icon { font-size: 48px; }
    .empty-state p { font-size: 14px; }
  `;

  constructor() {
    super();
    this._content = "";
    this._isDirty = false;
    this._isPreview = false;
    this._previewHtml = "";
    this._loading = false;
    this._frontmatter = {};
    this._fmCollapsed = false;
    this._saving = false;
    this._editor = null;
    this._currentPath = null;
  }

  updated(changed) {
    if (changed.has("path") && this.path !== this._currentPath) {
      this._loadFile();
    }
    if (changed.has("hass") && !this._currentPath && this.path) {
      this._loadFile();
    }
  }

  async _loadFile() {
    if (!this.hass || !this.path) return;
    this._currentPath = this.path;
    this._loading = true;
    this._isDirty = false;
    try {
      const result = await this.hass.callWS({ type: "ha_pkm/read_file", path: this.path });
      this._content = result.content;
      this._parseFrontmatter(result.content);
      await this.updateComplete;
      if (this._editor) {
        this._editor.setContent(result.content);
      }
    } catch (e) {
      console.error("File load error:", e);
    } finally {
      this._loading = false;
    }
  }

  _parseFrontmatter(content) {
    const fm = {};
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (match) {
      const lines = match[1].split("\n");
      for (const line of lines) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          const key = line.slice(0, idx).trim();
          const val = line.slice(idx + 1).trim();
          fm[key] = val;
        }
      }
    }
    this._frontmatter = fm;
  }

  async _saveFile(content) {
    if (!this.hass || !this.path) return;
    this._saving = true;
    try {
      await this.hass.callWS({ type: "ha_pkm/write_file", path: this.path, content });
      this._isDirty = false;
      this._editor?.markClean();
      this._parseFrontmatter(content);
      this.dispatchEvent(new CustomEvent("file-saved", { detail: { path: this.path }, bubbles: true, composed: true }));
    } catch (e) {
      console.error("Save error:", e);
      this.dispatchEvent(new CustomEvent("show-toast", {
        detail: { message: `Save failed: ${e.message}`, type: "error" },
        bubbles: true, composed: true,
      }));
    } finally {
      this._saving = false;
    }
  }

  async _togglePreview() {
    this._isPreview = !this._isPreview;
    if (this._isPreview) {
      await ensureLibs();
      const content = this._editor ? this._editor.getContent() : this._content;
      const withWikilinks = content.replace(WIKILINK_IN_PREVIEW_RE, (_, target, display) =>
        `<span data-wikilink-target="${target}" class="pkm-preview-link">${display || target}</span>`
      );
      this._previewHtml = renderMarkdown(withWikilinks);
    }
  }

  _onEditorDirty() {
    this._isDirty = true;
    this.dispatchEvent(new CustomEvent("dirty-change", { detail: { path: this.path, isDirty: true }, bubbles: true, composed: true }));
  }

  _onEditorSave(content) {
    this._saveFile(content);
  }

  _onClickLink(link) {
    this.dispatchEvent(new CustomEvent("open-link", { detail: { link }, bubbles: true, composed: true }));
  }

  _onPreviewClick(e) {
    const target = e.target.closest("[data-wikilink-target]");
    if (target) {
      const link = target.getAttribute("data-wikilink-target");
      this._onClickLink(link);
    }
  }

  firstUpdated() {
    this._initEditor();
  }

  _initEditor() {
    const host = this.shadowRoot.getElementById("cm-host");
    if (!host || this._editor) return;
    this._editor = new PkmEditor(host, {
      initialContent: this._content,
      onDirty: () => this._onEditorDirty(),
      onSave: (c) => this._onEditorSave(c),
      onTogglePreview: () => this._togglePreview(),
      onClickLink: (link) => this._onClickLink(link),
      getAllPaths: () => this._getAllPaths(),
    });
  }

  _getAllPaths() {
    return [];
  }

  _renderFmBadges() {
    const entries = Object.entries(this._frontmatter);
    if (entries.length === 0) return "";
    return html`
      <div class="fm-bar">
        ${entries.map(([k, v]) => html`
          <span class="fm-badge"><span class="fm-key">${k}</span>${v}</span>
        `)}
        <button class="fm-toggle" @click=${() => { this._fmCollapsed = !this._fmCollapsed; }}>
          ${this._fmCollapsed ? "▼ Show metadata" : "▲ Hide"}
        </button>
      </div>
    `;
  }

  render() {
    if (!this.path) {
      return html`
        <div class="empty-state">
          <span class="big-icon">📝</span>
          <p>Open a file from the sidebar to start editing</p>
          <p style="font-size:12px;color:var(--pkm-text-muted)">Ctrl+K to search · Ctrl+P for commands</p>
        </div>
      `;
    }

    return html`
      <div class="editor-toolbar">
        <button
          class="mode-btn ${!this._isPreview ? "active" : ""}"
          @click=${() => { if (this._isPreview) this._togglePreview(); }}
        >Edit</button>
        <button
          class="mode-btn ${this._isPreview ? "active" : ""}"
          @click=${() => { if (!this._isPreview) this._togglePreview(); }}
        >Preview</button>
        <span class="toolbar-path">${this.path}</span>
        ${this._saving
          ? html`<span class="saving-indicator">Saving…</span>`
          : this._isDirty
          ? html`<span class="dirty-indicator" title="Unsaved changes">●</span>`
          : ""}
        <button class="pkm-icon-btn" title="Save (Ctrl+S)" @click=${() => this._saveFile(this._editor?.getContent() || this._content)}>💾</button>
      </div>

      ${!this._fmCollapsed ? this._renderFmBadges() : ""}

      <div class="editor-area">
        ${this._loading
          ? html`<div class="loading-overlay">Loading…</div>`
          : this._isPreview
          ? html`
              <div class="preview-area" @click=${this._onPreviewClick} .innerHTML=${this._previewHtml}></div>
            `
          : html`<div id="cm-host" style="height:100%;"></div>`}
      </div>
    `;
  }
}

customElements.define("pkm-editor-view", PkmEditorView);
