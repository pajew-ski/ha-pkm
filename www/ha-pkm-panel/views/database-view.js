import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

export class PkmDatabaseView extends LitElement {
  static properties = {
    hass: { type: Object },
    _notes: { state: true },
    _fields: { state: true },
    _columns: { state: true },
    _filters: { state: true },
    _sortField: { state: true },
    _sortDir: { state: true },
    _loading: { state: true },
    _filterQuery: { state: true },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .db-toolbar {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      gap: 8px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .db-toolbar-title {
      font-weight: 600;
      font-size: 14px;
      margin-right: 8px;
    }

    .filter-input {
      flex: 1;
      min-width: 200px;
      background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-border);
      border-radius: 4px;
      color: var(--pkm-text);
      padding: 4px 10px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
    }
    .filter-input:focus { border-color: var(--pkm-accent); }

    .column-selector {
      position: relative;
    }

    .table-wrap {
      flex: 1;
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead { position: sticky; top: 0; z-index: 1; }

    th {
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      padding: 8px 12px;
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
    }
    th:hover { background: var(--pkm-surface-2); }
    th .sort-icon { font-size: 10px; margin-left: 4px; }

    td {
      border: 1px solid var(--pkm-border);
      padding: 6px 12px;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    tr:hover td { background: color-mix(in srgb, var(--pkm-accent) 5%, transparent); }

    .note-link {
      color: var(--pkm-link);
      cursor: pointer;
    }
    .note-link:hover { text-decoration: underline; }

    .tag-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .tag-pill {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
    }

    .loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--pkm-text-muted); }
    .empty-msg { padding: 32px; text-align: center; color: var(--pkm-text-muted); }

    .col-toggle-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
      background: var(--pkm-surface);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
    }
    .col-toggle-btn {
      padding: 2px 10px;
      border-radius: 12px;
      border: 1px solid var(--pkm-border);
      background: transparent;
      color: var(--pkm-text-muted);
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }
    .col-toggle-btn.active {
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
      border-color: color-mix(in srgb, var(--pkm-accent) 40%, transparent);
    }
  `;

  constructor() {
    super();
    this._notes = [];
    this._fields = [];
    this._columns = ["title", "mtime"];
    this._filters = {};
    this._sortField = "title";
    this._sortDir = "asc";
    this._loading = false;
    this._filterQuery = "";
  }

  updated(changed) {
    if ((changed.has("hass")) && this.hass) {
      this._loadData();
    }
  }

  async _loadData() {
    this._loading = true;
    try {
      const res = await this.hass.callWS({ type: "ha_pkm/db_query", filter: this._filters });
      this._notes = res.notes || [];
      this._fields = ["title", ...res.fields.filter((f) => f !== "title")];
      const missing = this._columns.filter((c) => !this._fields.includes(c));
      if (missing.length) {
        this._columns = this._columns.filter((c) => !missing.includes(c));
      }
    } catch (e) {
      console.error("DB query error:", e);
    } finally {
      this._loading = false;
    }
  }

  _toggleColumn(field) {
    if (this._columns.includes(field)) {
      this._columns = this._columns.filter((c) => c !== field);
    } else {
      this._columns = [...this._columns, field];
    }
  }

  _sort(field) {
    if (this._sortField === field) {
      this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
    } else {
      this._sortField = field;
      this._sortDir = "asc";
    }
  }

  _filteredNotes() {
    const q = this._filterQuery.toLowerCase().trim();
    let notes = this._notes;
    if (q) {
      notes = notes.filter((n) =>
        Object.values(n).some((v) => String(v).toLowerCase().includes(q))
      );
    }
    const { _sortField: sf, _sortDir: sd } = this;
    return [...notes].sort((a, b) => {
      const av = String(a[sf] ?? "");
      const bv = String(b[sf] ?? "");
      return sd === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  _openNote(path) {
    this.dispatchEvent(new CustomEvent("file-open", { detail: { path }, bubbles: true, composed: true }));
  }

  _renderCell(note, field) {
    const val = note[field];
    if (val === null || val === undefined) return html`<span style="color:var(--pkm-text-muted)">—</span>`;
    if (field === "title" || field === "path") {
      return html`<span class="note-link" @click=${() => this._openNote(note.path)}>${val}</span>`;
    }
    if (field === "mtime") {
      return new Date(val * 1000).toLocaleDateString();
    }
    if (Array.isArray(val)) {
      return html`<div class="tag-cell">${val.map((t) => html`<span class="tag-pill">${t}</span>`)}</div>`;
    }
    return String(val);
  }

  render() {
    if (this._loading) {
      return html`<div class="loading">Loading database…</div>`;
    }

    const notes = this._filteredNotes();
    const allFields = this._fields;

    return html`
      <div class="db-toolbar">
        <span class="db-toolbar-title">⊞ Database</span>
        <input
          class="filter-input"
          type="text"
          placeholder="Filter rows…"
          .value=${this._filterQuery}
          @input=${(e) => { this._filterQuery = e.target.value; }}
        />
        <button class="pkm-icon-btn" title="Refresh" @click=${() => this._loadData()}>🔄</button>
        <span style="font-size:12px;color:var(--pkm-text-muted)">${notes.length} notes</span>
      </div>

      <div class="col-toggle-wrap">
        ${allFields.map((f) => html`
          <button
            class="col-toggle-btn ${this._columns.includes(f) ? "active" : ""}"
            @click=${() => this._toggleColumn(f)}
          >${f}</button>
        `)}
      </div>

      <div class="table-wrap">
        ${notes.length === 0
          ? html`<div class="empty-msg">No notes found</div>`
          : html`
            <table>
              <thead>
                <tr>
                  ${this._columns.map((col) => html`
                    <th @click=${() => this._sort(col)}>
                      ${col}
                      ${this._sortField === col
                        ? html`<span class="sort-icon">${this._sortDir === "asc" ? "▲" : "▼"}</span>`
                        : ""}
                    </th>
                  `)}
                </tr>
              </thead>
              <tbody>
                ${notes.map((note) => html`
                  <tr>
                    ${this._columns.map((col) => html`<td>${this._renderCell(note, col)}</td>`)}
                  </tr>
                `)}
              </tbody>
            </table>
          `}
      </div>
    `;
  }
}

customElements.define("pkm-database-view", PkmDatabaseView);
