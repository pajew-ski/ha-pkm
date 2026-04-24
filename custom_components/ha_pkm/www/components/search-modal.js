/**
 * search-modal.js – Phase 4
 *
 * Prefix modes:
 *   #tag:<query>  → tag search via get_tags WS command
 *   path:<query>  → pure path prefix/contains filter (no fulltext)
 *   (default)     → fuzzy filename + fulltext WS search
 */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

const FTS_DEBOUNCE = 300;   // ms before firing fulltext WS search

function fuzzyMatch(needle, haystack) {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (h.includes(n)) return 2;
  let ni = 0;
  for (let i = 0; i < h.length && ni < n.length; i++) {
    if (h[i] === n[ni]) ni++;
  }
  return ni === n.length ? 1 : 0;
}

function highlight(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

export class PkmSearchModal extends LitElement {
  static properties = {
    hass:     { type: Object },
    allPaths: { type: Array },
    _query:   { state: true },
    _mode:    { state: true },   // "normal" | "tag" | "path"
    _results: { state: true },
    _sel:     { state: true },
    _busy:    { state: true },
  };

  static styles = css`
    :host { display: block; }

    .overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 1000;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 12vh;
    }

    .modal {
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      width: 640px; max-width: 90vw;
      max-height: 70vh;
      display: flex; flex-direction: column;
      overflow: hidden;
    }

    .input-row {
      display: flex; align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--pkm-border);
      gap: 10px;
    }
    .search-icon { font-size: 16px; color: var(--pkm-text-muted); flex-shrink: 0; }

    .mode-pill {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
      white-space: nowrap; flex-shrink: 0;
    }
    .mode-pill.tag  { background: color-mix(in srgb, var(--pkm-accent) 20%, transparent); color: var(--pkm-accent); }
    .mode-pill.path { background: color-mix(in srgb, #f39c12 20%, transparent);            color: #f39c12; }

    input {
      flex: 1; background: none; border: none; outline: none;
      color: var(--pkm-text); font-size: 16px; font-family: inherit;
    }
    input::placeholder { color: var(--pkm-text-muted); }

    .spinner {
      width: 14px; height: 14px;
      border: 2px solid var(--pkm-border);
      border-top-color: var(--pkm-accent);
      border-radius: 50%;
      animation: spin 600ms linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .results { overflow-y: auto; flex: 1; }

    .group-label {
      padding: 5px 16px 2px;
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--pkm-text-muted);
      background: var(--pkm-bg);
      position: sticky; top: 0;
    }

    .result-item {
      display: flex; flex-direction: column;
      padding: 9px 16px;
      cursor: pointer;
      border-bottom: 1px solid color-mix(in srgb, var(--pkm-border) 40%, transparent);
      gap: 3px;
    }
    .result-item:hover, .result-item.sel {
      background: color-mix(in srgb, var(--pkm-accent) 12%, transparent);
    }

    .r-title {
      font-size: 13px; font-weight: 500;
      display: flex; align-items: center; gap: 8px;
    }
    .r-title mark { background: color-mix(in srgb, var(--pkm-accent) 30%, transparent); color: var(--pkm-text); border-radius: 2px; }
    .r-path  { font-size: 11px; color: var(--pkm-text-muted); }
    .r-excerpt {
      font-size: 11px; color: var(--pkm-text-muted);
      overflow: hidden; display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .r-excerpt mark { background: color-mix(in srgb, var(--pkm-accent) 25%, transparent); color: var(--pkm-text); border-radius: 2px; }

    .tag-result {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 16px; cursor: pointer;
    }
    .tag-result:hover, .tag-result.sel { background: color-mix(in srgb, var(--pkm-accent) 12%, transparent); }
    .tag-pill {
      padding: 2px 10px; border-radius: 12px; font-size: 12px;
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
      border: 1px solid color-mix(in srgb, var(--pkm-accent) 40%, transparent);
    }
    .tag-count { font-size: 11px; color: var(--pkm-text-muted); margin-left: auto; }

    .empty { padding: 24px; text-align: center; color: var(--pkm-text-muted); font-size: 13px; }

    .hint {
      padding: 7px 16px;
      font-size: 11px; color: var(--pkm-text-muted);
      border-top: 1px solid var(--pkm-border);
      display: flex; gap: 14px; align-items: center;
    }
    kbd {
      display: inline-block; padding: 1px 5px;
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 3px; font-size: 10px; font-family: monospace;
    }
    .hint-sep { margin-left: auto; font-size: 10px; opacity: 0.6; }
  `;

  constructor() {
    super();
    this._query   = "";
    this._mode    = "normal";
    this._results = [];
    this._sel     = 0;
    this._busy    = false;
    this._ftsTimer = null;
  }

  open(initialQuery = "") {
    this._query   = initialQuery;
    this._results = [];
    this._sel     = 0;
    this._mode    = this._detectMode(initialQuery);
    this.updateComplete.then(() => {
      const inp = this.shadowRoot.querySelector("input");
      if (inp) { inp.focus(); if (initialQuery) inp.select(); }
    });
    if (initialQuery) this._runSearch(initialQuery);
  }

  _detectMode(q) {
    if (q.startsWith("#tag:")) return "tag";
    if (q.startsWith("path:"))  return "path";
    return "normal";
  }

  _inputQuery(q) {
    // strip mode prefix for display in input
    if (q.startsWith("#tag:")) return q.slice(5);
    if (q.startsWith("path:")) return q.slice(5);
    return q;
  }

  _onInput(e) {
    this._query = e.target.value;
    this._mode  = this._detectMode(this._query);
    this._sel   = 0;
    clearTimeout(this._ftsTimer);
    this._runSearch(this._query);
  }

  _runSearch(q) {
    const bare  = this._inputQuery(q).trim().toLowerCase();
    const paths = this.allPaths || [];

    if (!bare) { this._results = []; return; }

    if (this._mode === "tag") {
      this._searchTags(bare);
      return;
    }

    if (this._mode === "path") {
      this._results = paths
        .filter((p) => p.toLowerCase().includes(bare))
        .slice(0, 15)
        .map((p) => ({ _group: "path", path: p, title: p.split("/").pop().replace(/\.md$/, ""), titleHl: highlight(p.split("/").pop().replace(/\.md$/, ""), bare) }));
      return;
    }

    // Normal: fuzzy filename immediately, then FTS after debounce
    const fuzzy = paths
      .map((p) => ({ p, score: fuzzyMatch(bare, p.split("/").pop().replace(/\.md$/, "")) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ p }) => ({
        _group: "file",
        path: p,
        title: p.split("/").pop().replace(/\.md$/, ""),
        titleHl: highlight(p.split("/").pop().replace(/\.md$/, ""), bare),
      }));

    this._results = fuzzy;

    if (this.hass) {
      this._ftsTimer = setTimeout(async () => {
        this._busy = true;
        try {
          const res = await this.hass.callWS({ type: "ha_pkm/search", query: bare, limit: 12 });
          const seen = new Set(fuzzy.map((r) => r.path));
          const fts  = (res.results || [])
            .filter((r) => !seen.has(r.path))
            .map((r) => ({ _group: "fts", ...r }));
          this._results = [...fuzzy, ...fts];
        } catch { /* ignore */ } finally {
          this._busy = false;
        }
      }, FTS_DEBOUNCE);
    }
  }

  async _searchTags(q) {
    if (!this.hass) return;
    this._busy = true;
    try {
      const res  = await this.hass.callWS({ type: "ha_pkm/get_tags" });
      const tags = res.tags || {};
      this._results = Object.entries(tags)
        .filter(([tag]) => tag.toLowerCase().includes(q))
        .map(([tag, files]) => ({ _group: "tag", tag, count: files.length, files }))
        .sort((a, b) => b.count - a.count);
    } catch { /* ignore */ } finally {
      this._busy = false;
    }
  }

  _flatItems() {
    return this._results;
  }

  _onKeydown(e) {
    const items = this._flatItems();
    if (e.key === "Escape")    { this._close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this._sel = Math.min(this._sel + 1, items.length - 1); }
    if (e.key === "ArrowUp")   { e.preventDefault(); this._sel = Math.max(this._sel - 1, 0); }
    if (e.key === "Enter")     { e.preventDefault(); this._select(items[this._sel]); }
  }

  _select(item) {
    if (!item) return;
    if (item._group === "tag") {
      // Drill into tag: show notes with this tag
      this._query   = `#tag:${item.tag}`;
      this._mode    = "normal";
      this._results = (item.files || []).map((p) => ({
        _group: "file", path: p,
        title: p.split("/").pop().replace(/\.md$/, ""),
        titleHl: p.split("/").pop().replace(/\.md$/, ""),
      }));
      return;
    }
    this.dispatchEvent(new CustomEvent("file-open", { detail: { path: item.path }, bubbles: true, composed: true }));
    this._close();
  }

  _close() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  _onOverlayClick(e) { if (e.target === e.currentTarget) this._close(); }

  _renderModePrefix() {
    if (this._mode === "tag")  return html`<span class="mode-pill tag">#tag:</span>`;
    if (this._mode === "path") return html`<span class="mode-pill path">path:</span>`;
    return "";
  }

  _renderResults() {
    const items = this._flatItems();
    const q     = this._inputQuery(this._query).trim();
    if (!q) return "";
    if (!items.length) return html`<div class="empty">${this._busy ? "Searching…" : "No results"}</div>`;

    const groups = [];
    let lastGroup = null;
    items.forEach((item, i) => {
      if (item._group !== lastGroup) {
        lastGroup = item._group;
        const label = item._group === "fts" ? "Full-text matches"
                    : item._group === "tag" ? "Tags"
                    : item._group === "path" ? "Path matches"
                    : "File matches";
        groups.push(html`<div class="group-label">${label}</div>`);
      }

      if (item._group === "tag") {
        groups.push(html`
          <div class="tag-result ${i === this._sel ? "sel" : ""}"
            @click=${() => this._select(item)}
            @mousemove=${() => { this._sel = i; }}>
            <span class="tag-pill">${item.tag}</span>
            <span style="font-size:12px;color:var(--pkm-text-muted)">${item.count} notes</span>
          </div>
        `);
      } else {
        groups.push(html`
          <div class="result-item ${i === this._sel ? "sel" : ""}"
            @click=${() => this._select(item)}
            @mousemove=${() => { this._sel = i; }}>
            <div class="r-title" .innerHTML=${"📄 " + (item.titleHl || item.title || item.path.split("/").pop())}></div>
            <div class="r-path">${item.path}</div>
            ${item.excerpt
              ? html`<div class="r-excerpt" .innerHTML=${item.excerpt}></div>`
              : ""}
          </div>
        `);
      }
    });
    return groups;
  }

  render() {
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="modal">
          <div class="input-row">
            <span class="search-icon">🔍</span>
            ${this._renderModePrefix()}
            <input
              type="text"
              placeholder="Search… (#tag: · path: prefix supported)"
              .value=${this._inputQuery(this._query)}
              @input=${this._onInput}
              @keydown=${this._onKeydown}
              autofocus
            />
            ${this._busy ? html`<div class="spinner"></div>` : ""}
          </div>

          <div class="results">${this._renderResults()}</div>

          <div class="hint">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
            <span class="hint-sep">#tag:… · path:…</span>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("pkm-search-modal", PkmSearchModal);
