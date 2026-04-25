/**
 * editor-view.js – Markdown editor with CodeMirror 6
 *
 * Design principles:
 * - #cm-host is ALWAYS in the DOM, regardless of path/loading/preview state.
 *   CodeMirror is therefore initialised exactly once and never re-mounted.
 * - Empty state, canvas guard, loading and preview are absolute-positioned
 *   overlays that sit on top of the (always-mounted) editor.
 * - Path changes call setContent() on the existing editor instance.
 */

import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";
import { icon } from "../icons.js";
import { PkmEditor } from "../editor/codemirror-setup.js";

const MARKED_CDN    = "https://cdn.jsdelivr.net/npm/marked@12/+esm";
const DOMPURIFY_CDN = "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.es.mjs";

let markedLib = null;
let dompurifyLib = null;

async function ensureLibs() {
  if (!markedLib)    { const m = await import(MARKED_CDN);    markedLib    = m.marked  || m.default; }
  if (!dompurifyLib) { const d = await import(DOMPURIFY_CDN); dompurifyLib = d.default || d.DOMPurify || d; }
}

const WIKILINK_IN_PREVIEW = /\[\[([^\]|#\n]+?)(?:\|([^\]\n]*))?\]\]/g;
const FRONTMATTER_RE      = /^---\n([\s\S]*?)\n---\n?/;

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
    hass:       { type: Object },
    path:       { type: String },
    allPaths:   { type: Array },
    _content:   { state: true },
    _isDirty:   { state: true },
    _isPreview: { state: true },
    _prevHtml:  { state: true },
    _loading:   { state: true },
    _saving:    { state: true },
    _fm:        { state: true },
    _fmOpen:    { state: true },
    _tooltip:   { state: true },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .toolbar {
      display: flex; align-items: center;
      padding: 4px 8px; gap: 4px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      flex-shrink: 0;
      min-height: 36px;
    }
    .toolbar.hidden { visibility: hidden; height: 0; min-height: 0; padding: 0; border: none; }

    .toolbar-path {
      flex: 1; padding: 0 8px;
      font-size: 12px; color: var(--pkm-text-muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .mode-btn {
      padding: 3px 10px; border-radius: 4px;
      border: 1px solid var(--pkm-border); background: transparent;
      color: var(--pkm-text-muted); cursor: pointer;
      font-size: 12px; font-family: inherit;
    }
    .mode-btn.active { background: var(--pkm-accent); color: #fff; border-color: var(--pkm-accent); }

    .dirty-dot { color: var(--pkm-accent); font-size: 18px; line-height: 1; }
    .saving    { color: var(--pkm-text-muted); font-size: 11px; }

    .pkm-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px;
      border: none; background: transparent;
      color: var(--pkm-text-muted); border-radius: 4px; cursor: pointer;
    }
    .pkm-icon-btn:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }

    /* Frontmatter bar */
    .fm-bar {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 5px 12px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      flex-shrink: 0; align-items: center;
    }
    .fm-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 12px; font-size: 11px;
      background: var(--pkm-surface-2); color: var(--pkm-text-muted);
      border: 1px solid var(--pkm-border);
    }
    .fm-key { color: var(--pkm-accent); font-weight: 600; margin-right: 2px; }
    .fm-toggle {
      margin-left: auto; background: none; border: none;
      color: var(--pkm-text-muted); cursor: pointer;
      font-size: 11px; padding: 2px 6px;
    }

    /* Editor area – the editor host is ALWAYS mounted here */
    .editor-area {
      flex: 1; position: relative; overflow: hidden;
      display: flex; flex-direction: column;
      min-height: 0;
    }
    #cm-host {
      flex: 1; min-height: 0; min-width: 0;
      width: 100%;
    }

    /* Overlays sit on top of the editor without removing it from DOM */
    .overlay {
      position: absolute; inset: 0;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 12px; padding: 24px;
      background: var(--pkm-bg);
      color: var(--pkm-text-muted);
      text-align: center;
    }
    .overlay .icon { opacity: 0.25; }
    .overlay p { font-size: 14px; margin: 0; }
    .overlay small { font-size: 12px; }

    .overlay-empty   { z-index: 4; }   /* shown when no path */
    .overlay-canvas  { z-index: 4; }   /* shown when path is .canvas */
    .overlay-loading { z-index: 5; }   /* highest – covers everything */

    .preview-overlay {
      position: absolute; inset: 0; z-index: 3;
      overflow-y: auto; background: var(--pkm-bg);
      padding: 24px;
    }
    .preview-inner { max-width: 860px; margin: 0 auto; }
    .preview-inner h1, .preview-inner h2, .preview-inner h3,
    .preview-inner h4, .preview-inner h5, .preview-inner h6 {
      color: var(--pkm-text); margin: 1.4em 0 0.4em;
    }
    .preview-inner p { margin: 0.6em 0; line-height: 1.7; }
    .preview-inner a { color: var(--pkm-link); }
    .preview-inner code {
      background: var(--pkm-surface-2); padding: 1px 5px;
      border-radius: 3px; font-family: var(--pkm-font-mono); font-size: 0.9em;
    }
    .preview-inner pre {
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 6px; padding: 12px 16px; overflow-x: auto;
    }
    .preview-inner pre code { background: none; padding: 0; }
    .preview-inner blockquote {
      border-left: 3px solid var(--pkm-accent); margin: 0;
      padding: 4px 16px; color: var(--pkm-text-muted);
    }
    .preview-inner table { border-collapse: collapse; width: 100%; }
    .preview-inner th, .preview-inner td {
      border: 1px solid var(--pkm-border); padding: 6px 12px; text-align: left;
    }
    .preview-inner th { background: var(--pkm-surface-2); }
    [data-wikilink-target] {
      color: var(--pkm-link); cursor: pointer;
      border-bottom: 1px solid color-mix(in srgb, var(--pkm-link) 50%, transparent);
    }

    /* Hover tooltip */
    .link-tooltip {
      position: fixed; z-index: 900; pointer-events: none;
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border); border-radius: 6px;
      padding: 12px 14px; font-size: 12px; line-height: 1.5;
      max-width: 340px; white-space: pre-wrap; word-break: break-word;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      color: var(--pkm-text-muted);
    }
    .link-tooltip .tooltip-title {
      font-weight: 600; color: var(--pkm-text);
      margin-bottom: 6px; font-size: 13px;
    }
    .link-tooltip .tooltip-unresolved {
      color: var(--pkm-link-unresolved); font-style: italic;
    }
  `;

  constructor() {
    super();
    this._content       = "";
    this._isDirty       = false;
    this._isPreview     = false;
    this._prevHtml      = "";
    this._loading       = false;
    this._saving        = false;
    this._fm            = {};
    this._fmOpen        = true;
    this._tooltip       = null;
    this._editor        = null;
    this._currentPath   = null;
    this._resolvedLinks = new Set();
    this._tooltipTimer  = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  firstUpdated() {
    // #cm-host is guaranteed to be in DOM (rendered unconditionally).
    this._initEditor();
    if (this._isMarkdownPath()) this._loadFile();
  }

  updated(changed) {
    if (changed.has("path") && this.path !== this._currentPath) {
      this._currentPath = this.path;
      if (this._isMarkdownPath()) {
        this._loadFile();
      } else {
        // Switching to a non-markdown path: clear editor content
        this._editor?.setContent("");
        this._content = "";
        this._fm = {};
      }
    }
    // Defensive: if for any reason _editor is null after firstUpdated, retry.
    if (!this._editor) this._initEditor();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this._tooltipTimer);
    this._editor?.destroy();
    this._editor = null;
  }

  _initEditor() {
    const host = this.shadowRoot?.getElementById("cm-host");
    if (!host || this._editor) return;
    try {
      this._editor = new PkmEditor(host, {
        initialContent:  this._content,
        onDirty:         ()  => {
          this._isDirty = true;
          this.dispatchEvent(new CustomEvent("dirty-change", {
            detail: { path: this.path, isDirty: true },
            bubbles: true, composed: true,
          }));
        },
        onSave:          (c) => this._saveFile(c),
        onTogglePreview: ()  => this._togglePreview(),
        onClickLink:     (l) => this._onClickLink(l),
        onHoverLink:     (l, el) => this._onHoverLink(l, el),
        getAllPaths:     ()  => this.allPaths || [],
      });
      this._editor.setResolvedLinks(this._resolvedLinks);
    } catch (e) {
      console.error("[PkmEditorView] CodeMirror init failed:", e);
    }
  }

  _isMarkdownPath() {
    return !!(this.path && !this.path.endsWith(".canvas"));
  }

  // ── File I/O ────────────────────────────────────────────────────────────

  async _loadFile() {
    if (!this.hass || !this._isMarkdownPath()) return;
    this._loading = true;
    this._isDirty = false;
    this._tooltip = null;
    try {
      const result = await this.hass.callWS({ type: "ha_pkm/read_file", path: this.path });
      this._content = result.content ?? "";
      this._parseFrontmatter(this._content);
      this._editor?.setContent(this._content);
      this._refreshResolvedLinks(this._content);
    } catch (e) {
      console.error("[PkmEditorView] File load error:", e);
      this.dispatchEvent(new CustomEvent("show-toast", {
        detail: { message: `Failed to load "${this.path}": ${e.message || e}`, type: "error" },
        bubbles: true, composed: true,
      }));
    } finally {
      this._loading = false;
    }
  }

  async _saveFile(content) {
    if (!this.hass || !this._isMarkdownPath()) return;
    this._saving = true;
    try {
      await this.hass.callWS({ type: "ha_pkm/write_file", path: this.path, content });
      this._isDirty = false;
      this._editor?.markClean();
      this._parseFrontmatter(content);
      this._refreshResolvedLinks(content);
      this.dispatchEvent(new CustomEvent("file-saved", {
        detail: { path: this.path }, bubbles: true, composed: true,
      }));
    } catch (e) {
      this.dispatchEvent(new CustomEvent("show-toast", {
        detail: { message: `Save failed: ${e.message || e}`, type: "error" },
        bubbles: true, composed: true,
      }));
    } finally {
      this._saving = false;
    }
  }

  async _refreshResolvedLinks(content) {
    if (!this.hass) return;
    const linkRe = /\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;
    const links = [];
    let m;
    while ((m = linkRe.exec(content)) !== null) links.push(m[1].trim());
    if (!links.length) {
      this._resolvedLinks = new Set();
      this._editor?.setResolvedLinks(this._resolvedLinks);
      return;
    }
    const resolved = new Set();
    await Promise.all(links.map(async (link) => {
      try {
        const r = await this.hass.callWS({ type: "ha_pkm/resolve_link", link });
        if (r.path) resolved.add(link);
      } catch { /* ignore */ }
    }));
    this._resolvedLinks = resolved;
    this._editor?.setResolvedLinks(resolved);
  }

  _parseFrontmatter(content) {
    const fm = {};
    const match = FRONTMATTER_RE.exec(content);
    if (match) {
      for (const line of match[1].split("\n")) {
        const idx = line.indexOf(":");
        if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    this._fm = fm;
  }

  // ── Preview toggle ──────────────────────────────────────────────────────

  async _togglePreview() {
    this._isPreview = !this._isPreview;
    if (this._isPreview) {
      await ensureLibs();
      const content = this._editor ? this._editor.getContent() : this._content;
      const withLinks = content.replace(WIKILINK_IN_PREVIEW, (_, target, display) =>
        `<span data-wikilink-target="${target}">${display || target}</span>`
      );
      this._prevHtml = renderMarkdown(withLinks);
    } else {
      // Re-measure CodeMirror after the overlay disappears
      await this.updateComplete;
      this._editor?.view?.requestMeasure?.();
      this._editor?.focus?.();
    }
  }

  _onPreviewClick(e) {
    const target = e.target.closest("[data-wikilink-target]");
    if (target) this._onClickLink(target.getAttribute("data-wikilink-target"));
  }

  // ── Hover tooltip ───────────────────────────────────────────────────────

  async _onHoverLink(link, anchorEl) {
    if (!link || !anchorEl) { this._tooltip = null; clearTimeout(this._tooltipTimer); return; }
    clearTimeout(this._tooltipTimer);

    const rect = anchorEl.getBoundingClientRect();
    const hostRect = this.getBoundingClientRect();
    const x = rect.left - hostRect.left;
    const y = rect.bottom - hostRect.top + 6;
    this._tooltip = { link, x, y, preview: null, resolved: true };

    this._tooltipTimer = setTimeout(async () => {
      try {
        const res = await this.hass.callWS({ type: "ha_pkm/resolve_link", link });
        if (!res.path) {
          this._tooltip = { link, x, y, preview: null, resolved: false };
          return;
        }
        const file = await this.hass.callWS({ type: "ha_pkm/read_file", path: res.path });
        const body = file.content.replace(FRONTMATTER_RE, "").trim();
        const lines = body.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");
        this._tooltip = { link, x, y, preview: lines || "(empty)", resolved: true, path: res.path };
      } catch {
        this._tooltip = { link, x, y, preview: null, resolved: false };
      }
    }, 200);
  }

  _onClickLink(link) {
    this.dispatchEvent(new CustomEvent("open-link", {
      detail: { link }, bubbles: true, composed: true,
    }));
  }

  // ── Render ──────────────────────────────────────────────────────────────

  _renderFmBar() {
    const entries = Object.entries(this._fm);
    if (!entries.length) return "";
    return html`
      <div class="fm-bar">
        ${entries.map(([k, v]) => html`
          <span class="fm-badge"><span class="fm-key">${k}:</span>${v}</span>
        `)}
        <button class="fm-toggle" @click=${() => { this._fmOpen = !this._fmOpen; }}>
          ${this._fmOpen ? "▲" : "▼ Show metadata"}
        </button>
      </div>
    `;
  }

  _renderTooltip() {
    if (!this._tooltip) return "";
    const { link, x, y, preview, resolved, path } = this._tooltip;
    return html`
      <div class="link-tooltip" style="left:${x}px; top:${y}px;">
        <div class="tooltip-title">[[${link}]]</div>
        ${!resolved
          ? html`<div class="tooltip-unresolved">Unresolved – click to create</div>`
          : preview === null
          ? html`<span style="color:var(--pkm-text-muted)">Loading…</span>`
          : html`<div>${preview}</div>`}
        ${path ? html`<div style="font-size:10px;margin-top:6px;opacity:0.5;">${path}</div>` : ""}
      </div>
    `;
  }

  render() {
    const isMd     = this._isMarkdownPath();
    const noPath   = !this.path;
    const isCanvas = !!this.path && this.path.endsWith(".canvas");
    const showFm   = isMd && this._fmOpen && Object.keys(this._fm).length;
    const showFmCollapsed = isMd && !this._fmOpen && Object.keys(this._fm).length;

    return html`
      <!-- Toolbar (hidden when no editable file is active) -->
      <div class="toolbar ${isMd ? "" : "hidden"}">
        <button class="mode-btn ${!this._isPreview ? "active" : ""}"
          @click=${() => { if (this._isPreview) this._togglePreview(); }}>Edit</button>
        <button class="mode-btn ${this._isPreview ? "active" : ""}"
          @click=${() => { if (!this._isPreview) this._togglePreview(); }}>Preview</button>
        <span class="toolbar-path">${this.path || ""}</span>
        ${this._saving
          ? html`<span class="saving">Saving…</span>`
          : this._isDirty
          ? html`<span class="dirty-dot" title="Unsaved changes">●</span>`
          : ""}
        <button class="pkm-icon-btn" title="Save (Ctrl+S)"
          @click=${() => this._saveFile(this._editor?.getContent() ?? this._content)}>${icon("save", 18)}</button>
      </div>

      ${showFm ? this._renderFmBar() : ""}
      ${showFmCollapsed ? html`
        <div class="fm-bar"><button class="fm-toggle" @click=${() => { this._fmOpen = true; }}>▼ Show metadata</button></div>
      ` : ""}

      <div class="editor-area">
        <!-- ALWAYS-MOUNTED CodeMirror host. Never removed from DOM. -->
        <div id="cm-host"></div>

        ${noPath ? html`
          <div class="overlay overlay-empty">
            <span class="icon">${icon("noteEdit", 48)}</span>
            <p>Open a file to start editing</p>
            <small>Ctrl+K to search · Ctrl+P for commands</small>
          </div>
        ` : ""}

        ${isCanvas ? html`
          <div class="overlay overlay-canvas">
            <span class="icon">${icon("canvas", 48)}</span>
            <p>This is a canvas file</p>
            <small>Switch to Canvas view to edit it</small>
          </div>
        ` : ""}

        ${this._isPreview ? html`
          <div class="preview-overlay" @click=${this._onPreviewClick.bind(this)}>
            <div class="preview-inner" .innerHTML=${this._prevHtml}></div>
          </div>
        ` : ""}

        ${this._loading ? html`
          <div class="overlay overlay-loading">Loading…</div>
        ` : ""}
      </div>

      ${this._renderTooltip()}
    `;
  }
}

customElements.define("pkm-editor-view", PkmEditorView);
