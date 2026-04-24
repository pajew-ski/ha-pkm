import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

export class PkmTabBar extends LitElement {
  static properties = {
    tabs: { type: Array },
    activeTab: { type: String },
  };

  static styles = css`
    :host {
      display: flex;
      align-items: stretch;
      height: var(--pkm-tab-height, 36px);
      background: var(--pkm-surface);
      border-bottom: 1px solid var(--pkm-border);
      overflow-x: auto;
      overflow-y: hidden;
      flex-shrink: 0;
    }
    :host::-webkit-scrollbar { height: 3px; }

    .tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 12px;
      min-width: 100px;
      max-width: 200px;
      cursor: pointer;
      white-space: nowrap;
      font-size: 13px;
      color: var(--pkm-text-muted);
      border-right: 1px solid var(--pkm-border);
      flex-shrink: 0;
      position: relative;
      user-select: none;
      transition: background 150ms ease, color 150ms ease;
    }
    .tab:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }
    .tab.active {
      color: var(--pkm-text);
      background: var(--pkm-bg);
      border-top: 2px solid var(--pkm-accent);
    }

    .tab-title {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }

    .tab-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 3px;
      opacity: 0.5;
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
    }
    .tab-close:hover { opacity: 1; background: var(--pkm-surface-2); }

    .dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--pkm-accent);
      flex-shrink: 0;
    }

    .new-tab-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      min-width: 36px;
      cursor: pointer;
      color: var(--pkm-text-muted);
      font-size: 20px;
      flex-shrink: 0;
    }
    .new-tab-btn:hover { color: var(--pkm-text); background: var(--pkm-surface-2); }
  `;

  _onTabClick(path) {
    this.dispatchEvent(new CustomEvent("tab-select", { detail: { path }, bubbles: true, composed: true }));
  }

  _onTabClose(e, path) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("tab-close", { detail: { path }, bubbles: true, composed: true }));
  }

  _onNewTab() {
    this.dispatchEvent(new CustomEvent("tab-new", { bubbles: true, composed: true }));
  }

  render() {
    return html`
      ${(this.tabs || []).map((tab) => html`
        <div
          class="tab ${tab.path === this.activeTab ? "active" : ""}"
          @click=${() => this._onTabClick(tab.path)}
          title=${tab.path}
        >
          ${tab.isDirty ? html`<span class="dirty-dot"></span>` : ""}
          <span class="tab-title">${tab.title || tab.path.split("/").pop()}</span>
          <span class="tab-close" @click=${(e) => this._onTabClose(e, tab.path)}>×</span>
        </div>
      `)}
      <div class="new-tab-btn" @click=${this._onNewTab} title="New note">+</div>
    `;
  }
}

customElements.define("pkm-tab-bar", PkmTabBar);
