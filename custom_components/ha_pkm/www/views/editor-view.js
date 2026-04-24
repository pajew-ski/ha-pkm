/**
 * editor-view.js – Phase 3: resolved links, hover preview tooltip
 */

import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";
import { PkmEditor } from "../editor/codemirror-setup.js";

const MARKED_CDN      = "https://cdn.jsdelivr.net/npm/marked@12/+esm";
const DOMPURIFY_CDN   = "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.es.mjs";

let markedLib = null;
let dompurifyLib = null;

async function ensureLibs() {
  if (!markedLib)    { const m = await import(MARKED_CDN);    markedLib    = m.marked  || m.default; }
  if (!dompurifyLib) { const d = await import(DOMPURIFY_CDN); dompurifyLib = d.default || d.DOMPurify || d; }
}

const WIKILINK_IN_PREVIEW = /\[\[([^\]|#\n]+?)(?:\|([^\]\n]*))?\]\]/g;

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

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

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
    _tooltip:   { state: true },   // { link, x, y, preview }
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .toolbar {
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
    .mode-btn.active { background: var(--pkm-accent); color: #fff; border-color: var(--pkm-accent); }

    .dirty-dot { color: var(--pkm-accent); font-size: 18px; line-height: 1; }
    .saving    { color: var(--pkm-text-muted); font-size: 11px; }

    .pkm-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px;
      border: none; background: transparent;
      color: var(--pkm-text-muted); border-radius: 4px; cursor: pointer;
    }
    .pkm-icon-btn:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }

    /* Frontmatter bar */
    .fm-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 5px 12px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      flex-shrink: 0;
      align-items: center;
    }
    .fm-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 12px; font-size: 11px;
      background: var(--pkm-surface-2); color: var(--pkm-text-muted);
      border: 1px solid var(--pkm-border);
    }
    .fm-key  { color: var(--pkm-accent); font-weight: 600; margin-right: 2px; }
    .fm-toggle {
      margin-left: auto; background: none; border: none;
      color: var(--pkm-text-muted); cursor: pointer; font-size: 11px; padding: 2px 6px;
    }

    /* Editor area */
    .editor-area { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
    #cm-host     { flex: 1; overflow: hidden; }

    /* Preview */
    .preview-area {
      flex: 1; overflow-y: auto;
      padding: 24px 32px;
      max-width: 860px; margin: 0 auto; width: 100%;
    }
    .preview-area h1,.preview-area h2,.preview-area h3,
    .preview-area h4,.preview-area h5,.preview-area h6 {
      color: var(--pkm-text); margin-top: 1.4em; margin-bottom: 0.4em;
    }
    .preview-area p  { margin: 0.6em 0; line-height: 1.7; }
    .preview-area a  { color: var(--pkm-link); }
    .preview-area code {
      background: var(--pkm-surface-2); padding: 1px 5px;
      border-radius: 3px; font-family: var(--pkm-font-mono); font-size: 0.9em;
    }
    .preview-area pre {
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 6px; padding: 12px 16px; overflow-x: auto;
    }
    .preview-area pre code { background: none; padding: 0; }
    .preview-area blockquote {
      border-left: 3px solid var(--pkm-accent); margin: 0;
      padding: 4px 16px; color: var(--pkm-text-muted);
    }
    .preview-area table { border-collapse: collapse; width: 100%; }
    .preview-area th, .preview-area td {
      border: 1px solid var(--pkm-border); padding: 6px 12px; text-align: left;
    }
    .preview-area th { background: var(--pkm-surface-2); }
    [data-wikilink-target] {
      color: var(--pkm-link); cursor: pointer;
      border-bottom: 1px solid color-mix(in srgb, var(--pkm-link) 50%, transparent);
    }

    /* Hover tooltip */
    .link-tooltip {
      position: fixed;
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 6px;
      padding: 12px 14px;
      font-size: 12px;
      line-height: 1.5;
      max-width: 340px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      z-index: 900;
      pointer-events: none;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--pkm-text-muted);
    }
    .link-tooltip .tooltip-title {
      font-weight: 600; color: var(--pkm-text); margin-bottom: 6px; font-size: 13px;
    }
    .link-tooltip .tooltip-unresolved { color: var(--pkm-link-unresolved); font-style: italic; }

    .loading-overlay {
      display: flex; align-items: center; justify-content: center;
      height: 100%; color: var(--pkm-text-muted); font-size: 14px;
    }
    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 100%; gap: 12px; color: var(--pkm-text-muted);
    }
    .empty-state .icon { font-size: 48px; }
    .empty-state p { font-size: 14px; }
    .empty-state small { font-size: 12px; }
  `;

  constructor() {
    super();
    this._content   = "";
    this._isDirty   = false;
    this._isPreview = false;
    this._prevHtml  = "";
    this._loading   = false;
    this._saving    = false;
    this._fm        = {};
    this._fmOpen    = true;
    this._tooltip   = null;
    this._editor    = null;
    this._currentPath = null;
    this._resolvedLinks = new Set();
    this._tooltipTimer  = null;
  }

  updated(changed) {
    if ((changed.has("path") && this.path !== this._currentPath) ||
        (changed.has("hass") && this.hass && !this._currentPath && this.path)) {
      this._loadFile();
    }
  }

  async _loadFile() {
    if (!this.hass || !this.path) return;
    this._currentPath = this.path;
    this._loading = true;
    this._isDirty = false;
    this._tooltip = null;
    try {
      const result = await this.hass.callWS({ type: "ha_pkm/read_file", path: this.path });
      this._content = result.content;
      this._parseFrontmatter(result.content);
      await this.updateComplete;
      this._editor?.setContent(result.content);
      // Fetch backlinks to know which wikilinks in this file resolve
      this._refreshResolvedLinks(result.content);
    } catch (e) {
      console.error("File load error:", e);
    } finally {
      this._loading = false;
    }
  }

  /** Extract all [[links]] from content, resolve each via WS, update editor. */
  async _refreshResolvedLinks(content) {
    if (!this.hass) return;
    const linkRe = /\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g;
    const links  = [];
    let m;
    while ((m = linkRe.exec(content)) !== null) links.push(m[1].trim());
    if (!links.length) { this._resolvedLinks = new Set(); this._editor?.setResolvedLinks(this._resolvedLinks); return; }

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

  async _saveFile(content) {
    if (!this.hass || !this.path) return;
    this._saving = true;
    try {
      await this.hass.callWS({ type: "ha_pkm/write_file", path: this.path, content });
      this._isDirty = false;
      this._editor?.markClean();
      this._parseFrontmatter(content);
      this._refreshResolvedLinks(content);
      this.dispatchEvent(new CustomEvent("file-saved", { detail: { path: this.path }, bubbles: true, composed: true }));
    } catch (e) {
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
      const withLinks = content.replace(WIKILINK_IN_PREVIEW, (_, target, display) =>
        `<span data-wikilink-target="${target}">${display || target}</span>`
      );
      this._prevHtml = renderMarkdown(withLinks);
    }
  }

  // ── Hover tooltip ──────────────────────────────────────────────────────

  async _onHoverLink(link, anchorEl) {
    if (!link) { this._tooltip = null; return; }
    clearTimeout(this._tooltipTimer);

    if (!anchorEl) { this._tooltip = null; return; }

    const rect = anchorEl.getBoundingClientRect();
    const hostRect = this.getBoundingClientRect();
    const x = rect.left - hostRect.left;
    const y = rect.bottom - hostRect.top + 6;

    // Show loading tooltip immediately
    this._tooltip = { link, x, y, preview: null, resolved: true };

    this._tooltipTimer = setTimeout(async () => {
      try {
        const res = await this.hass.callWS({ type: "ha_pkm/resolve_link", link });
        if (!res.path) {
          this._tooltip = { link, x, y, preview: null, resolved: false };
          return;
        }
        const file = await this.hass.callWS({ type: "ha_pkm/read_file", path: res.path });
        // Strip frontmatter and take first 3 non-empty lines
        const body = file.content.replace(FRONTMATTER_RE, "").trim();
        const lines = body.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");
        this._tooltip = { link, x, y, preview: lines || "(empty)", resolved: true, path: res.path };
      } catch {
        this._tooltip = { link, x, y, preview: null, resolved: false };
      }
    }, 200);
  }

  _onClickLink(link) {
    this.dispatchEvent(new CustomEvent("open-link", { detail: { link }, bubbles: true, composed: true }));
  }

  firstUpdated() { this._initEditor(); }

  _initEditor() {
    const host = this.shadowRoot.getElementById("cm-host");
    if (!host || this._editor) return;
    this._editor = new PkmEditor(host, {
      initialContent:  this._content,
      onDirty:         ()  => { this._isDirty = true; this.dispatchEvent(new CustomEvent("dirty-change", { detail: { path: this.path, isDirty: true }, bubbles: true, composed: true })); },
      onSave:          (c) => this._saveFile(c),
      onTogglePreview: ()  => this._togglePreview(),
      onClickLink:     (l) => this._onClickLink(l),
      onHoverLink:     (l, el) => this._onHoverLink(l, el),
      getAllPaths:      ()  => this.allPaths || [],
    });
    this._editor.setResolvedLinks(this._resolvedLinks);
  }

  // ── Render ─────────────────────────────────────────────────────────────

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
    if (!this.path) {
      return html`
        <div class="empty-state">
          <span class="icon">📝</span>
          <p>Open a file to start editing</p>
          <small>Ctrl+K to search · Ctrl+P for commands</small>
        </div>
      `;
    }

    return html`
      <div class="toolbar">
        <button class="mode-btn ${!this._isPreview ? "active" : ""}" @click=${() => { if (this._isPreview) this._togglePreview(); }}>Edit</button>
        <button class="mode-btn ${this._isPreview  ? "active" : ""}" @click=${() => { if (!this._isPreview) this._togglePreview(); }}>Preview</button>
        <span class="toolbar-path">${this.path}</span>
        ${this._saving
          ? html`<span class="saving">Saving…</span>`
          : this._isDirty
          ? html`<span class="dirty-dot" title="Unsaved changes">●</span>`
          : ""}
        <button class="pkm-icon-btn" title="Save (Ctrl+S)"
          @click=${() => this._saveFile(this._editor?.getContent() ?? this._content)}>💾</button>
      </div>

      ${this._fmOpen ? this._renderFmBar() : html`
        ${Object.keys(this._fm).length
          ? html`<div class="fm-bar"><button class="fm-toggle" @click=${() => { this._fmOpen = true; }}>▼ Show metadata</button></div>`
          : ""}
      `}

      <div class="editor-area">
        ${this._loading
          ? html`<div class="loading-overlay">Loading…</div>`
          : this._isPreview
          ? html`<div class="preview-area" @click=${this._onPreviewClick.bind(this)} .innerHTML=${this._prevHtml}></div>`
          : html`<div id="cm-host" style="height:100%;"></div>`
        }
      </div>

      ${this._renderTooltip()}
    `;
  }

  _onPreviewClick(e) {
    const target = e.target.closest("[data-wikilink-target]");
    if (target) this._onClickLink(target.getAttribute("data-wikilink-target"));
  }
}

customElements.define("pkm-editor-view", PkmEditorView);
