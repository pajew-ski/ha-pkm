import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

function fuzzyScore(needle, haystack) {
  if (!needle) return 1;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (h.includes(n)) return 2;
  let ni = 0;
  for (let i = 0; i < h.length && ni < n.length; i++) {
    if (h[i] === n[ni]) ni++;
  }
  return ni === n.length ? 1 : 0;
}

export class PkmCommandPalette extends LitElement {
  static properties = {
    recentFiles: { type: Array },
    _query: { state: true },
    _selected: { state: true },
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
      padding-top: 10vh;
    }

    .modal {
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      width: 580px;
      max-width: 90vw;
      max-height: 60vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .input-wrap {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      border-bottom: 1px solid var(--pkm-border);
      gap: 10px;
    }
    .cmd-icon { font-size: 16px; }
    input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--pkm-text);
      font-size: 15px;
      font-family: inherit;
    }
    input::placeholder { color: var(--pkm-text-muted); }

    .results { overflow-y: auto; flex: 1; }

    .section-label {
      padding: 6px 14px 2px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--pkm-text-muted);
    }

    .cmd-item {
      display: flex;
      align-items: center;
      padding: 9px 14px;
      cursor: pointer;
      gap: 10px;
      font-size: 14px;
    }
    .cmd-item:hover, .cmd-item.selected {
      background: color-mix(in srgb, var(--pkm-accent) 12%, transparent);
    }
    .cmd-item .icon { font-size: 16px; width: 24px; text-align: center; }
    .cmd-item .label { flex: 1; }
    .cmd-item .shortcut {
      font-size: 11px;
      color: var(--pkm-text-muted);
      font-family: monospace;
    }

    .hint {
      padding: 8px 14px;
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
    this._selected = 0;
    this.recentFiles = [];

    this._commands = [
      { id: "new-note",      icon: "📄", label: "New Note",            shortcut: "" },
      { id: "new-canvas",    icon: "🔲", label: "New Canvas",          shortcut: "" },
      { id: "new-folder",    icon: "📁", label: "New Folder",          shortcut: "" },
      { id: "open-graph",    icon: "⬡",  label: "Open Graph View",     shortcut: "" },
      { id: "open-database", icon: "⊞",  label: "Open Database View",  shortcut: "" },
      { id: "toggle-sidebar",icon: "≡",  label: "Toggle Sidebar",      shortcut: "Ctrl+\\" },
      { id: "search",        icon: "🔍", label: "Search Notes",         shortcut: "Ctrl+K" },
      { id: "export-vault",  icon: "📦", label: "Export Vault",         shortcut: "" },
    ];
  }

  open() {
    this._query = "";
    this._selected = 0;
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector("input")?.focus();
    });
  }

  _filteredCommands() {
    const q = this._query.trim();
    return this._commands
      .map((cmd) => ({ ...cmd, score: fuzzyScore(q, cmd.label) }))
      .filter((cmd) => cmd.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  _allItems() {
    const cmds = this._filteredCommands();
    const q = this._query.trim().toLowerCase();
    const recents = q
      ? []
      : (this.recentFiles || []).slice(0, 5).map((p) => ({
          id: `recent:${p}`,
          icon: "🕒",
          label: p.split("/").pop().replace(/\.md$/, ""),
          path: p,
          _recent: true,
        }));
    return [...cmds, ...recents];
  }

  _onKeydown(e) {
    const items = this._allItems();
    if (e.key === "Escape") { this._close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this._selected = Math.min(this._selected + 1, items.length - 1); }
    if (e.key === "ArrowUp")   { e.preventDefault(); this._selected = Math.max(this._selected - 1, 0); }
    if (e.key === "Enter") { e.preventDefault(); this._execute(items[this._selected]); }
  }

  _execute(item) {
    if (!item) return;
    if (item._recent) {
      this.dispatchEvent(new CustomEvent("file-open", { detail: { path: item.path }, bubbles: true, composed: true }));
    } else {
      this.dispatchEvent(new CustomEvent("command", { detail: { id: item.id }, bubbles: true, composed: true }));
    }
    this._close();
  }

  _close() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) this._close();
  }

  render() {
    const items = this._allItems();
    const cmds = items.filter((i) => !i._recent);
    const recents = items.filter((i) => i._recent);

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="modal">
          <div class="input-wrap">
            <span class="cmd-icon">⌘</span>
            <input
              type="text"
              placeholder="Type a command…"
              .value=${this._query}
              @input=${(e) => { this._query = e.target.value; this._selected = 0; }}
              @keydown=${this._onKeydown}
              autofocus
            />
          </div>

          <div class="results">
            ${recents.length ? html`<div class="section-label">Recent Files</div>` : ""}
            ${recents.map((item, i) => {
              const idx = i;
              return html`
                <div
                  class="cmd-item ${idx === this._selected ? "selected" : ""}"
                  @click=${() => this._execute(item)}
                  @mousemove=${() => { this._selected = idx; }}
                >
                  <span class="icon">${item.icon}</span>
                  <span class="label">${item.label}</span>
                </div>
              `;
            })}

            ${cmds.length ? html`<div class="section-label">Commands</div>` : ""}
            ${cmds.map((item, i) => {
              const idx = recents.length + i;
              return html`
                <div
                  class="cmd-item ${idx === this._selected ? "selected" : ""}"
                  @click=${() => this._execute(item)}
                  @mousemove=${() => { this._selected = idx; }}
                >
                  <span class="icon">${item.icon}</span>
                  <span class="label">${item.label}</span>
                  ${item.shortcut ? html`<span class="shortcut">${item.shortcut}</span>` : ""}
                </div>
              `;
            })}
          </div>

          <div class="hint">
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> run</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("pkm-command-palette", PkmCommandPalette);
