import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

export class PkmBacklinksPanel extends LitElement {
  static properties = {
    hass: { type: Object },
    activePath: { type: String },
    _backlinks: { state: true },
    _tags: { state: true },
    _outgoing: { state: true },
    _loading: { state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      font-size: 13px;
    }

    .panel-header {
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--pkm-text-muted);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
    }

    .panel-scroll { flex: 1; overflow-y: auto; padding: 8px; }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--pkm-text-muted);
      padding: 6px 4px 4px;
    }

    .link-item {
      display: flex;
      align-items: center;
      padding: 5px 6px;
      border-radius: 4px;
      cursor: pointer;
      gap: 6px;
      color: var(--pkm-link);
      word-break: break-all;
    }
    .link-item:hover { background: var(--pkm-surface-2); }

    .tag-item {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
      border: 1px solid color-mix(in srgb, var(--pkm-accent) 40%, transparent);
      cursor: pointer;
      margin: 2px;
    }
    .tag-item:hover { background: color-mix(in srgb, var(--pkm-accent) 25%, transparent); }

    .tags-wrap { display: flex; flex-wrap: wrap; padding: 4px; }

    .empty-msg {
      color: var(--pkm-text-muted);
      font-size: 12px;
      padding: 8px 6px;
      font-style: italic;
    }

    .count-badge {
      margin-left: auto;
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 10px;
      background: var(--pkm-surface-2);
      color: var(--pkm-text-muted);
    }
  `;

  constructor() {
    super();
    this._backlinks = [];
    this._tags = [];
    this._outgoing = [];
    this._loading = false;
  }

  updated(changed) {
    if (changed.has("activePath") || changed.has("hass")) {
      this._loadData();
    }
  }

  async _loadData() {
    if (!this.hass || !this.activePath) return;
    this._loading = true;
    try {
      const [bl, tags] = await Promise.all([
        this.hass.callWS({ type: "ha_pkm/get_backlinks", path: this.activePath }),
        this.hass.callWS({ type: "ha_pkm/get_tags" }),
      ]);
      this._backlinks = bl.backlinks || [];
      // Filter tags that reference active path
      const allTags = tags.tags || {};
      this._tags = Object.entries(allTags)
        .filter(([, paths]) => paths.includes(this.activePath))
        .map(([tag]) => tag);
    } catch (e) {
      console.error("Backlinks load error:", e);
    } finally {
      this._loading = false;
    }
  }

  _openFile(path) {
    this.dispatchEvent(new CustomEvent("file-open", { detail: { path }, bubbles: true, composed: true }));
  }

  _openTag(tag) {
    this.dispatchEvent(new CustomEvent("tag-search", { detail: { tag }, bubbles: true, composed: true }));
  }

  render() {
    return html`
      <div class="panel-header">Links</div>
      <div class="panel-scroll">
        <div class="section-title">
          Backlinks
          <span class="count-badge">${this._backlinks.length}</span>
        </div>
        ${this._backlinks.length === 0
          ? html`<div class="empty-msg">No backlinks</div>`
          : this._backlinks.map((p) => html`
              <div class="link-item" @click=${() => this._openFile(p)} title=${p}>
                📄 ${p.split("/").pop().replace(/\.md$/, "")}
              </div>
            `)}

        <div class="section-title" style="margin-top:12px">Tags</div>
        ${this._tags.length === 0
          ? html`<div class="empty-msg">No tags</div>`
          : html`<div class="tags-wrap">
              ${this._tags.map((tag) => html`
                <span class="tag-item" @click=${() => this._openTag(tag)}>${tag}</span>
              `)}
            </div>`}
      </div>
    `;
  }
}

customElements.define("pkm-backlinks-panel", PkmBacklinksPanel);
