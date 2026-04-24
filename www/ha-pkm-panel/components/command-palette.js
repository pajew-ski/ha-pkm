/**
 * command-palette.js – Phase 4: full command set, fuzzy scoring, recent files
 */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

function fuzzyScore(needle, haystack) {
  if (!needle) return 1;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (h === n) return 100;
  if (h.startsWith(n)) return 50;
  if (h.includes(n)) return 20;
  let ni = 0, score = 0;
  for (let i = 0; i < h.length && ni < n.length; i++) {
    if (h[i] === n[ni]) { ni++; score++; }
  }
  return ni === n.length ? score : 0;
}

function hlMatch(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "gi"), "<mark>$1</mark>");
}

const COMMANDS = [
  { id: "new-note",         icon: "📄", label: "New Note",             shortcut: "" },
  { id: "new-canvas",       icon: "🔲", label: "New Canvas",           shortcut: "" },
  { id: "new-folder",       icon: "📁", label: "New Folder",           shortcut: "" },
  { id: "open-graph",       icon: "⬡",  label: "Open Graph View",      shortcut: "" },
  { id: "open-database",    icon: "⊞",  label: "Open Database View",   shortcut: "" },
  { id: "open-editor",      icon: "📝", label: "Open Editor View",     shortcut: "" },
  { id: "open-canvas-view", icon: "🔲", label: "Open Canvas View",     shortcut: "" },
  { id: "toggle-sidebar",   icon: "≡",  label: "Toggle Sidebar",       shortcut: "Ctrl+\\" },
  { id: "toggle-backlinks", icon: "🔗", label: "Toggle Backlinks Panel",shortcut: "" },
  { id: "search",           icon: "🔍", label: "Search Notes",          shortcut: "Ctrl+K" },
  { id: "rebuild-index",    icon: "🔄", label: "Rebuild Link Index",    shortcut: "" },
  { id: "close-tab",        icon: "✕",  label: "Close Current Tab",     shortcut: "Ctrl+W" },
];

export class PkmCommandPalette extends LitElement {
  static properties = {
    recentFiles: { type: Array },
    _query: { state: true },
    _sel:   { state: true },
  };

  static styles = css`
    :host { display: block; }

    .overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 1000;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: 10vh;
    }

    .modal {
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      width: 580px; max-width: 90vw;
      max-height: 60vh;
      display: flex; flex-direction: column;
      overflow: hidden;
    }

    .input-row {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--pkm-border);
    }
    .cmd-icon { font-size: 16px; flex-shrink: 0; }
    input {
      flex: 1; background: none; border: none; outline: none;
      color: var(--pkm-text); font-size: 15px; font-family: inherit;
    }
    input::placeholder { color: var(--pkm-text-muted); }

    .results { overflow-y: auto; flex: 1; }

    .group-label {
      padding: 5px 14px 2px;
      font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--pkm-text-muted);
      background: var(--pkm-bg);
      position: sticky; top: 0;
    }

    .item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 14px; cursor: pointer; font-size: 13px;
    }
    .item:hover, .item.sel {
      background: color-mix(in srgb, var(--pkm-accent) 12%, transparent);
    }
    .item .icon { font-size: 16px; width: 24px; text-align: center; flex-shrink: 0; }
    .item .label { flex: 1; }
    .item .label mark { background: color-mix(in srgb, var(--pkm-accent) 30%, transparent); color: var(--pkm-text); border-radius: 2px; }
    .item .kbd {
      font-size: 11px; color: var(--pkm-text-muted);
      padding: 1px 5px; background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-border); border-radius: 3px;
      font-family: monospace;
    }

    .hint {
      padding: 8px 14px; font-size: 11px; color: var(--pkm-text-muted);
      border-top: 1px solid var(--pkm-border); display: flex; gap: 12px;
    }
    kbd {
      display: inline-block; padding: 1px 5px;
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 3px; font-size: 10px; font-family: monospace;
    }
  `;

  constructor() {
    super();
    this._query      = "";
    this._sel        = 0;
    this.recentFiles = [];
  }

  open() {
    this._query = "";
    this._sel   = 0;
    this.updateComplete.then(() => this.shadowRoot.querySelector("input")?.focus());
  }

  _items() {
    const q       = this._query.trim();
    const cmds    = COMMANDS
      .map((c) => ({ ...c, score: fuzzyScore(q, c.label) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    const recents = q ? [] : (this.recentFiles || []).slice(0, 6).map((p) => ({
      id: `recent:${p}`, icon: "🕒",
      label: p.split("/").pop().replace(/\.md$/, ""),
      path: p, _recent: true, score: 1,
    }));

    return { cmds, recents };
  }

  _allItems() {
    const { cmds, recents } = this._items();
    return [...recents, ...cmds];
  }

  _onKeydown(e) {
    const all = this._allItems();
    if (e.key === "Escape")    { this._close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); this._sel = Math.min(this._sel + 1, all.length - 1); }
    if (e.key === "ArrowUp")   { e.preventDefault(); this._sel = Math.max(this._sel - 1, 0); }
    if (e.key === "Enter")     { e.preventDefault(); this._run(all[this._sel]); }
  }

  _run(item) {
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

  _onOverlayClick(e) { if (e.target === e.currentTarget) this._close(); }

  render() {
    const { cmds, recents } = this._items();
    const all = [...recents, ...cmds];
    const q   = this._query.trim();

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="modal">
          <div class="input-row">
            <span class="cmd-icon">⌘</span>
            <input type="text" placeholder="Type a command…"
              .value=${this._query}
              @input=${(e) => { this._query = e.target.value; this._sel = 0; }}
              @keydown=${this._onKeydown}
              autofocus
            />
          </div>

          <div class="results">
            ${recents.length ? html`<div class="group-label">Recent Files</div>` : ""}
            ${recents.map((item, i) => html`
              <div class="item ${i === this._sel ? "sel" : ""}"
                @click=${() => this._run(item)}
                @mousemove=${() => { this._sel = i; }}>
                <span class="icon">${item.icon}</span>
                <span class="label">${item.label}</span>
              </div>
            `)}

            ${cmds.length ? html`<div class="group-label">Commands</div>` : ""}
            ${cmds.map((item, i) => {
              const idx = recents.length + i;
              return html`
                <div class="item ${idx === this._sel ? "sel" : ""}"
                  @click=${() => this._run(item)}
                  @mousemove=${() => { this._sel = idx; }}>
                  <span class="icon">${item.icon}</span>
                  <span class="label" .innerHTML=${hlMatch(item.label, q)}></span>
                  ${item.shortcut ? html`<span class="kbd">${item.shortcut}</span>` : ""}
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
