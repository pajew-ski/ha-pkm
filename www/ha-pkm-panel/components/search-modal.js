import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

export class PkmSearchModal extends LitElement {
  static properties = {
    hass: { type: Object },
    allPaths: { type: Array },
    _query: { state: true },
    _results: { state: true },
    _selected: { state: true },
    _loading: { state: true },
  };

  static styles = css`
    :host { display: block; }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 1000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 12vh;
    }

    .modal {
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      width: 640px;
      max-width: 90vw;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      max-height: 70vh;
    }

    .search-input-wrap {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--pkm-border);
      gap: 10px;
    }
    .search-icon { font-size: 16px; color: var(--pkm-text-muted); }
    input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--pkm-text);
      font-size: 16px;
      font-family: inherit;
    }
    input::placeholder { color: var(--pkm-text-muted); }

    .results { overflow-y: auto; flex: 1; }

    .result-item {
      display: flex;
      flex-direction: column;
      padding: 10px 16px;
      cursor: pointer;
      border-bottom: 1px solid var(--pkm-border);
      gap: 4px;
    }
    .result-item:hover, .result-item.selected {
      background: color-mix(in srgb, var(--pkm-accent) 12%, transparent);
    }

    .result-title { font-size: 14px; font-weight: 500; }
    .result-path { font-size: 11px; color: var(--pkm-text-muted); }
    .result-excerpt {
      font-size: 12px;
      color: var(--pkm-text-muted);
      white-space: pre-wrap;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .result-excerpt mark {
      background: color-mix(in srgb, var(--pkm-accent) 30%, transparent);
      color: var(--pkm-text);
      border-radius: 2px;
    }

    .section-label {
      padding: 6px 16px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--pkm-text-muted);
      background: var(--pkm-bg);
    }

    .empty { padding: 24px; text-align: center; color: var(--pkm-text-muted); font-size: 13px; }

    .hint {
      padding: 8px 16px;
      font-size: 11px;
      color: var(--pkm-text-muted);
      border-top: 1px solid var(--pkm-border);
      display: flex;
      gap: 12px;
    }
    kbd {
      display: inline-block;
      padding: 1px 5px;
      background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-border);
      border-radius: 3px;
      font-size: 10px;
      font-family: monospace;
    }
  `;

  constructor() {
    super();
    this._query = "";
    this._results = [];
    this._selected = 0;
    this._loading = false;
    this._ftsTimer = null;
  }

  open() {
    this._query = "";
    this._results = [];
    this._selected = 0;
    this.shadowRoot.querySelector("input")?.focus();
  }

  _onKeydown(e) {
    if (e.key === "Escape") { this._close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this._selected = Math.min(this._selected + 1, this._results.length - 1); }
    if (e.key === "ArrowUp") { e.preventDefault(); this._selected = Math.max(this._selected - 1, 0); }
    if (e.key === "Enter") { e.preventDefault(); this._selectResult(this._results[this._selected]); }
  }

  _onInput(e) {
    this._query = e.target.value;
    this._selected = 0;
    clearTimeout(this._ftsTimer);

    // Immediate fuzzy filename filter
    const q = this._query.toLowerCase().trim();
    if (!q) { this._results = []; return; }

    const fuzzy = (this.allPaths || [])
      .filter((p) => p.toLowerCase().includes(q))
      .slice(0, 8)
      .map((p) => ({ path: p, title: p.split("/").pop().replace(/\.md$/, ""), excerpt: null, _type: "path" }));
    this._results = fuzzy;

    // Fulltext search after debounce
    if (this.hass) {
      this._ftsTimer = setTimeout(async () => {
        this._loading = true;
        try {
          const res = await this.hass.callWS({ type: "ha_pkm/search", query: this._query, limit: 10 });
          const fts = (res.results || []).map((r) => ({ ...r, _type: "fts" }));
          // Merge: deduplicate by path
          const seen = new Set(fuzzy.map((r) => r.path));
          const merged = [...fuzzy, ...fts.filter((r) => !seen.has(r.path))];
          this._results = merged;
        } catch (e) {
          console.warn("Search error:", e);
        } finally {
          this._loading = false;
        }
      }, 300);
    }
  }

  _selectResult(result) {
    if (!result) return;
    this.dispatchEvent(new CustomEvent("file-open", { detail: { path: result.path }, bubbles: true, composed: true }));
    this._close();
  }

  _close() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) this._close();
  }

  render() {
    const q = this._query.trim();
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="modal">
          <div class="search-input-wrap">
            <span class="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search notes… (prefix #tag: or path:)"
              .value=${this._query}
              @input=${this._onInput}
              @keydown=${this._onKeydown}
              autofocus
            />
          </div>

          <div class="results">
            ${this._results.length === 0 && q
              ? html`<div class="empty">${this._loading ? "Searching…" : "No results"}</div>`
              : ""}
            ${this._results.map((result, i) => html`
              <div
                class="result-item ${i === this._selected ? "selected" : ""}"
                @click=${() => this._selectResult(result)}
                @mousemove=${() => { this._selected = i; }}
              >
                <div class="result-title">${result.title || result.path.split("/").pop()}</div>
                <div class="result-path">${result.path}</div>
                ${result.excerpt
                  ? html`<div class="result-excerpt" .innerHTML=${result.excerpt}></div>`
                  : ""}
              </div>
            `)}
          </div>

          <div class="hint">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("pkm-search-modal", PkmSearchModal);
