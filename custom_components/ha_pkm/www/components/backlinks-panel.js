/**
 * backlinks-panel.js – Phase 3: backlinks + outgoing + unresolved + tags
 */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";
import { icon } from "../icons.js";

export class PkmBacklinksPanel extends LitElement {
  static properties = {
    hass:       { type: Object },
    activePath: { type: String },
    _backlinks: { state: true },
    _outgoing:  { state: true },
    _unresolved:{ state: true },
    _tags:      { state: true },
    _loading:   { state: true },
    _sections:  { state: true },  // which sections are expanded
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; font-size: 13px; }

    .panel-header {
      padding: 8px 12px;
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--pkm-text-muted);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
    }

    .panel-scroll { flex: 1; overflow-y: auto; }

    .section {
      border-bottom: 1px solid var(--pkm-border);
    }

    .section-header {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 12px;
      cursor: pointer;
      user-select: none;
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--pkm-text-muted);
    }
    .section-header:hover { background: var(--pkm-surface-2); }
    .section-arrow { font-size: 9px; transition: transform 150ms; }
    .section-arrow.open { transform: rotate(90deg); }
    .section-count {
      margin-left: auto;
      padding: 1px 5px; border-radius: 10px;
      background: var(--pkm-surface-2); font-size: 10px;
    }

    .section-body { padding: 0 0 4px; }

    .link-item {
      display: flex; align-items: center;
      padding: 5px 12px 5px 20px;
      cursor: pointer; gap: 6px;
      color: var(--pkm-link);
      font-size: 12px;
      word-break: break-all;
    }
    .link-item:hover { background: var(--pkm-surface-2); }
    .link-item.unresolved { color: var(--pkm-link-unresolved); }

    .tags-wrap { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 12px; }
    .tag-pill {
      display: inline-flex; align-items: center;
      padding: 2px 8px; border-radius: 12px; font-size: 11px;
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
      border: 1px solid color-mix(in srgb, var(--pkm-accent) 40%, transparent);
      cursor: pointer;
    }
    .tag-pill:hover { background: color-mix(in srgb, var(--pkm-accent) 25%, transparent); }

    .empty-msg {
      padding: 6px 20px; color: var(--pkm-text-muted); font-size: 11px; font-style: italic;
    }
  `;

  constructor() {
    super();
    this._backlinks  = [];
    this._outgoing   = [];
    this._unresolved = [];
    this._tags       = [];
    this._loading    = false;
    this._sections   = { backlinks: true, outgoing: false, unresolved: false, tags: true };
  }

  updated(changed) {
    if ((changed.has("activePath") || changed.has("hass")) && this.hass && this.activePath) {
      this._loadData();
    }
  }

  async _loadData() {
    this._loading = true;
    try {
      const [bl, graph, tags] = await Promise.all([
        this.hass.callWS({ type: "ha_pkm/get_backlinks", path: this.activePath }),
        this.hass.callWS({ type: "ha_pkm/get_graph_data" }),
        this.hass.callWS({ type: "ha_pkm/get_tags" }),
      ]);

      this._backlinks = bl.backlinks || [];

      // Outgoing & unresolved from graph edges
      const outgoing   = [];
      const unresolved = [];
      for (const edge of (graph.edges || [])) {
        if (edge.source === this.activePath) {
          if (edge.target.startsWith("__ghost__")) {
            unresolved.push(edge.target.slice(9));
          } else {
            outgoing.push(edge.target);
          }
        }
      }
      this._outgoing   = [...new Set(outgoing)];
      this._unresolved = [...new Set(unresolved)];

      // Tags for active file
      const allTags = tags.tags || {};
      this._tags = Object.entries(allTags)
        .filter(([, paths]) => paths.includes(this.activePath))
        .map(([tag]) => tag);
    } catch (e) {
      console.error("Backlinks panel error:", e);
    } finally {
      this._loading = false;
    }
  }

  _openFile(path) {
    this.dispatchEvent(new CustomEvent("file-open", { detail: { path }, bubbles: true, composed: true }));
  }

  _toggleSection(name) {
    this._sections = { ...this._sections, [name]: !this._sections[name] };
  }

  _renderSection(key, icon, label, items, renderItem) {
    const open  = this._sections[key];
    const count = items.length;
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._toggleSection(key)}>
          <span class="section-arrow ${open ? "open" : ""}">▶</span>
          ${icon} ${label}
          <span class="section-count">${count}</span>
        </div>
        ${open ? html`
          <div class="section-body">
            ${count === 0
              ? html`<div class="empty-msg">None</div>`
              : items.map(renderItem)}
          </div>
        ` : ""}
      </div>
    `;
  }

  render() {
    return html`
      <div class="panel-header">Links</div>
      <div class="panel-scroll">

        ${this._renderSection("backlinks", "←", "Backlinks", this._backlinks, (p) => html`
          <div class="link-item" @click=${() => this._openFile(p)} title=${p}>
            ${icon("file", 14)} ${p.split("/").pop().replace(/\.md$/, "")}
          </div>
        `)}

        ${this._renderSection("outgoing", "→", "Outgoing", this._outgoing, (p) => html`
          <div class="link-item" @click=${() => this._openFile(p)} title=${p}>
            ${icon("file", 14)} ${p.split("/").pop().replace(/\.md$/, "")}
          </div>
        `)}

        ${this._unresolved.length ? this._renderSection("unresolved", "!", "Unresolved", this._unresolved, (link) => html`
          <div class="link-item unresolved" title="Unresolved: ${link}">
            ${icon("alert", 14)} ${link}
          </div>
        `) : ""}

        <div class="section">
          <div class="section-header" @click=${() => this._toggleSection("tags")}>
            <span class="section-arrow ${this._sections.tags ? "open" : ""}">▶</span>
            # Tags
            <span class="section-count">${this._tags.length}</span>
          </div>
          ${this._sections.tags ? html`
            <div class="section-body">
              ${this._tags.length === 0 ? html`<div class="empty-msg">None</div>` : html`
                <div class="tags-wrap">
                  ${this._tags.map((tag) => html`
                    <span class="tag-pill"
                      @click=${() => this.dispatchEvent(new CustomEvent("tag-search", { detail: { tag }, bubbles: true, composed: true }))}>
                      ${tag}
                    </span>
                  `)}
                </div>
              `}
            </div>
          ` : ""}
        </div>
      </div>
    `;
  }
}

customElements.define("pkm-backlinks-panel", PkmBacklinksPanel);
