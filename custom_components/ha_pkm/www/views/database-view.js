/**
 * database-view.js – Phase 6
 *
 * New features:
 * - Visual filter builder: field + operator + value rows, AND-combined
 * - Inline cell editing (click to edit, Enter/blur to save frontmatter)
 * - Saved views (.dbview files) – save/load/delete via file panel
 * - Improved column picker (drag not needed – toggle buttons)
 * - Date formatting, tag pills in cells
 */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";
import { icon } from "../icons.js";

const OPERATORS = [
  { id: "eq",          label: "=" },
  { id: "ne",          label: "≠" },
  { id: "contains",    label: "contains" },
  { id: "startsWith",  label: "starts with" },
  { id: "before",      label: "before (ts)" },
  { id: "after",       label: "after (ts)" },
  { id: "isEmpty",     label: "is empty" },
  { id: "isNotEmpty",  label: "is not empty" },
];

const OP_TO_BACKEND = {
  eq:         (v) => v,
  ne:         (v) => ({ $ne: v }),
  contains:   (v) => ({ $contains: v }),
  startsWith: (v) => ({ $startsWith: v }),
  before:     (v) => ({ $before: Number(v) }),
  after:      (v) => ({ $after: Number(v) }),
  isEmpty:    ()  => ({ $isEmpty: true }),
  isNotEmpty: ()  => ({ $isEmpty: false }),
};

const NO_VALUE_OPS = new Set(["isEmpty", "isNotEmpty"]);

function buildFilter(rows) {
  const filter = {};
  for (const row of rows) {
    if (!row.field || !row.op) continue;
    filter[row.field] = OP_TO_BACKEND[row.op]?.(row.value);
  }
  return filter;
}

export class PkmDatabaseView extends LitElement {
  static properties = {
    hass:       { type: Object },
    _notes:     { state: true },
    _fields:    { state: true },
    _columns:   { state: true },
    _sortField: { state: true },
    _sortDir:   { state: true },
    _loading:   { state: true },
    _rowFilter: { state: true },   // quick text filter on rendered rows
    _filterRows:{ state: true },   // visual query builder rows
    _filterOpen:{ state: true },
    _editing:   { state: true },   // { path, field, value }
    _savedViews:{ state: true },   // [{ name, path }]
    _saveName:  { state: true },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    /* ── Toolbar ── */
    .toolbar {
      display: flex; align-items: center; flex-wrap: wrap;
      padding: 6px 10px; gap: 6px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      flex-shrink: 0;
    }
    .toolbar-title { font-weight: 600; font-size: 14px; }

    .filter-input {
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 4px; color: var(--pkm-text); padding: 4px 10px;
      font-size: 13px; font-family: inherit; outline: none; flex: 1; min-width: 140px;
    }
    .filter-input:focus { border-color: var(--pkm-accent); }

    .pkm-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: none; background: transparent;
      color: var(--pkm-text-muted); border-radius: 4px; cursor: pointer; flex-shrink: 0;
    }
    .pkm-icon-btn:hover  { background: var(--pkm-surface-2); color: var(--pkm-text); }
    .pkm-icon-btn.active { color: var(--pkm-accent); }

    .note-count { font-size: 11px; color: var(--pkm-text-muted); margin-left: auto; }

    /* ── Column picker ── */
    .col-bar {
      display: flex; flex-wrap: wrap; gap: 4px; padding: 5px 10px;
      background: var(--pkm-surface); border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
    }
    .col-btn {
      padding: 2px 10px; border-radius: 12px; border: 1px solid var(--pkm-border);
      background: transparent; color: var(--pkm-text-muted); cursor: pointer;
      font-size: 11px; font-family: inherit;
    }
    .col-btn.on {
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent);
      border-color: color-mix(in srgb, var(--pkm-accent) 40%, transparent);
    }

    /* ── Filter builder ── */
    .filter-builder {
      background: var(--pkm-surface);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
      padding: 8px 10px;
      display: flex; flex-direction: column; gap: 6px;
    }
    .filter-row {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    }
    .filter-row select, .filter-row input {
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 4px; color: var(--pkm-text); padding: 3px 6px;
      font-size: 12px; font-family: inherit; outline: none;
    }
    .filter-row select:focus, .filter-row input:focus { border-color: var(--pkm-accent); }
    .filter-row .field-sel { width: 130px; }
    .filter-row .op-sel    { width: 110px; }
    .filter-row .val-inp   { flex: 1; min-width: 100px; }
    .rm-btn {
      background: none; border: none; color: var(--pkm-text-muted);
      cursor: pointer; font-size: 16px; padding: 0 4px; line-height: 1;
    }
    .rm-btn:hover { color: var(--pkm-link-unresolved); }

    .filter-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn-sm {
      padding: 3px 10px; border-radius: 4px; font-size: 12px; font-family: inherit;
      border: 1px solid var(--pkm-border); background: transparent;
      color: var(--pkm-text-muted); cursor: pointer;
    }
    .btn-sm:hover { background: var(--pkm-surface-2); }
    .btn-sm.primary {
      background: var(--pkm-accent); border-color: var(--pkm-accent); color: #fff;
    }
    .btn-sm.primary:hover { opacity: 0.85; }
    .save-name {
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 4px; color: var(--pkm-text); padding: 3px 8px;
      font-size: 12px; font-family: inherit; outline: none; width: 130px;
    }
    .save-name:focus { border-color: var(--pkm-accent); }

    /* Saved views */
    .saved-views { display: flex; gap: 4px; flex-wrap: wrap; }
    .view-pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 12px; font-size: 11px;
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      cursor: pointer;
    }
    .view-pill:hover { background: color-mix(in srgb, var(--pkm-accent) 10%, transparent); }
    .view-del { color: var(--pkm-text-muted); font-size: 12px; }
    .view-del:hover { color: var(--pkm-link-unresolved); }

    /* ── Table ── */
    .table-wrap { flex: 1; overflow: auto; }

    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead { position: sticky; top: 0; z-index: 1; }

    th {
      background: var(--pkm-surface); border: 1px solid var(--pkm-border);
      padding: 7px 12px; text-align: left; white-space: nowrap;
      cursor: pointer; user-select: none; font-weight: 600; font-size: 12px;
    }
    th:hover { background: var(--pkm-surface-2); }
    th .sort-icon { font-size: 9px; margin-left: 3px; }

    td {
      border: 1px solid color-mix(in srgb, var(--pkm-border) 50%, transparent);
      padding: 5px 10px; max-width: 260px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    tr:hover td { background: color-mix(in srgb, var(--pkm-accent) 4%, transparent); }

    .note-link { color: var(--pkm-link); cursor: pointer; }
    .note-link:hover { text-decoration: underline; }

    .tag-pill {
      display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 10px;
      background: color-mix(in srgb, var(--pkm-accent) 15%, transparent);
      color: var(--pkm-accent); margin: 1px;
    }

    .cell-edit-input {
      width: 100%; background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-accent); border-radius: 3px;
      color: var(--pkm-text); padding: 2px 5px; font-size: 12px;
      font-family: inherit; outline: none;
    }

    .loading { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--pkm-text-muted); }
    .empty   { padding: 32px; text-align: center; color: var(--pkm-text-muted); }
  `;

  constructor() {
    super();
    this._notes      = [];
    this._fields     = [];
    this._columns    = ["title", "mtime"];
    this._sortField  = "title";
    this._sortDir    = "asc";
    this._loading    = false;
    this._rowFilter  = "";
    this._filterRows = [];
    this._filterOpen = false;
    this._editing    = null;
    this._savedViews = [];
    this._saveName   = "";
  }

  updated(changed) {
    if (changed.has("hass") && this.hass) this._loadData();
  }

  async _loadData(filterObj = {}) {
    this._loading = true;
    try {
      const res = await this.hass.callWS({ type: "ha_pkm/db_query", filter: filterObj });
      this._notes  = res.notes  || [];
      this._fields = ["title", "mtime", ...res.fields.filter((f) => f !== "title" && f !== "mtime")];
      // Ensure current columns stay valid
      this._columns = this._columns.filter((c) => this._fields.includes(c) || c === "title" || c === "mtime");
    } catch (e) {
      console.error("DB query error:", e);
    } finally {
      this._loading = false;
    }
  }

  _applyFilter() {
    const filter = buildFilter(this._filterRows);
    this._loadData(filter);
  }

  _clearFilter() {
    this._filterRows = [];
    this._loadData({});
  }

  // ── Filter builder ──────────────────────────────────────────────────────

  _addFilterRow() {
    this._filterRows = [...this._filterRows, { id: Date.now(), field: this._fields[0] || "", op: "contains", value: "" }];
  }

  _updateFilterRow(id, key, val) {
    this._filterRows = this._filterRows.map((r) => r.id === id ? { ...r, [key]: val } : r);
  }

  _removeFilterRow(id) {
    this._filterRows = this._filterRows.filter((r) => r.id !== id);
  }

  // ── Saved views ──────────────────────────────────────────────────────────

  async _saveView() {
    if (!this._saveName.trim() || !this.hass) return;
    const viewData = { columns: this._columns, filterRows: this._filterRows, sortField: this._sortField, sortDir: this._sortDir };
    const path = `.pkm/${this._saveName.trim().replace(/[^a-z0-9_\-]/gi, "_")}.dbview`;
    try {
      await this.hass.callWS({ type: "ha_pkm/write_file", path, content: JSON.stringify(viewData, null, 2) });
      this._savedViews = [...this._savedViews.filter((v) => v.name !== this._saveName.trim()), { name: this._saveName.trim(), path }];
      this._saveName = "";
    } catch (e) {
      console.error("Save view error:", e);
    }
  }

  async _loadView(view) {
    try {
      const res  = await this.hass.callWS({ type: "ha_pkm/read_file", path: view.path });
      const data = JSON.parse(res.content);
      this._columns    = data.columns    || this._columns;
      this._filterRows = data.filterRows || [];
      this._sortField  = data.sortField  || "title";
      this._sortDir    = data.sortDir    || "asc";
      this._applyFilter();
    } catch (e) {
      console.error("Load view error:", e);
    }
  }

  async _deleteView(view) {
    try {
      await this.hass.callWS({ type: "ha_pkm/delete_file", path: view.path });
      this._savedViews = this._savedViews.filter((v) => v.path !== view.path);
    } catch (e) {
      console.error("Delete view error:", e);
    }
  }

  // ── Table ────────────────────────────────────────────────────────────────

  _toggleColumn(f) {
    this._columns = this._columns.includes(f)
      ? this._columns.filter((c) => c !== f)
      : [...this._columns, f];
  }

  _sort(field) {
    if (this._sortField === field) this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
    else { this._sortField = field; this._sortDir = "asc"; }
  }

  _filteredNotes() {
    const q = this._rowFilter.toLowerCase().trim();
    let notes = this._notes;
    if (q) notes = notes.filter((n) => Object.values(n).some((v) => String(v ?? "").toLowerCase().includes(q)));
    const { _sortField: sf, _sortDir: sd } = this;
    return [...notes].sort((a, b) => {
      const av = String(a[sf] ?? ""), bv = String(b[sf] ?? "");
      return sd === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  _openNote(path) {
    this.dispatchEvent(new CustomEvent("file-open", { detail: { path }, bubbles: true, composed: true }));
  }

  // ── Inline editing ───────────────────────────────────────────────────────

  _startEdit(note, field) {
    if (field === "mtime" || field === "path") return;
    this._editing = { path: note.path, field, value: String(note[field] ?? "") };
  }

  async _commitEdit() {
    if (!this._editing || !this.hass) return;
    const { path, field, value } = this._editing;
    this._editing = null;
    try {
      const res     = await this.hass.callWS({ type: "ha_pkm/read_file", path });
      const content = res.content;
      // Patch frontmatter key
      const patched = patchFrontmatterKey(content, field, value);
      await this.hass.callWS({ type: "ha_pkm/write_file", path, content: patched });
      // Update local note
      this._notes = this._notes.map((n) => n.path === path ? { ...n, [field]: value } : n);
    } catch (e) {
      console.error("Inline edit error:", e);
    }
  }

  _cancelEdit() { this._editing = null; }

  // ── Cell rendering ───────────────────────────────────────────────────────

  _renderCell(note, field) {
    const isEditing = this._editing?.path === note.path && this._editing?.field === field;
    const val = note[field];

    if (isEditing) {
      return html`
        <input class="cell-edit-input"
          .value=${this._editing.value}
          @input=${(e) => { this._editing = { ...this._editing, value: e.target.value }; }}
          @keydown=${(e) => { if (e.key === "Enter") this._commitEdit(); if (e.key === "Escape") this._cancelEdit(); }}
          @blur=${() => this._commitEdit()}
          @click=${(e) => e.stopPropagation()}
          autofocus
        />`;
    }

    if (val === null || val === undefined) return html`<span style="color:var(--pkm-text-muted);font-size:11px">—</span>`;
    if (field === "title") return html`<span class="note-link" @click=${() => this._openNote(note.path)}>${val}</span>`;
    if (field === "mtime") return new Date(val * 1000).toLocaleDateString();
    if (Array.isArray(val)) return html`${val.map((t) => html`<span class="tag-pill">${t}</span>`)}`;
    return String(val);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  _renderFilterBuilder() {
    if (!this._filterOpen) return "";
    return html`
      <div class="filter-builder">
        ${this._filterRows.map((row) => html`
          <div class="filter-row">
            <select class="field-sel" .value=${row.field}
              @change=${(e) => this._updateFilterRow(row.id, "field", e.target.value)}>
              ${this._fields.map((f) => html`<option value=${f}>${f}</option>`)}
            </select>
            <select class="op-sel" .value=${row.op}
              @change=${(e) => this._updateFilterRow(row.id, "op", e.target.value)}>
              ${OPERATORS.map((op) => html`<option value=${op.id}>${op.label}</option>`)}
            </select>
            ${NO_VALUE_OPS.has(row.op) ? "" : html`
              <input class="val-inp" type="text" .value=${row.value}
                @input=${(e) => this._updateFilterRow(row.id, "value", e.target.value)}
                @keydown=${(e) => { if (e.key === "Enter") this._applyFilter(); }}
                placeholder="value…"
              />
            `}
            <button class="rm-btn" @click=${() => this._removeFilterRow(row.id)}>×</button>
          </div>
        `)}

        <div class="filter-actions">
          <button class="btn-sm" @click=${() => this._addFilterRow()}>+ Add condition</button>
          ${this._filterRows.length ? html`
            <button class="btn-sm primary" @click=${() => this._applyFilter()}>Apply</button>
            <button class="btn-sm" @click=${() => this._clearFilter()}>Clear</button>
          ` : ""}

          <span style="margin-left:auto;display:flex;align-items:center;gap:6px">
            <input class="save-name" type="text" placeholder="View name…"
              .value=${this._saveName}
              @input=${(e) => { this._saveName = e.target.value; }}
              @keydown=${(e) => { if (e.key === "Enter") this._saveView(); }}
            />
            <button class="btn-sm" @click=${() => this._saveView()}>${icon("save", 14)} Save view</button>
          </span>
        </div>

        ${this._savedViews.length ? html`
          <div class="saved-views">
            ${this._savedViews.map((v) => html`
              <div class="view-pill">
                <span @click=${() => this._loadView(v)}>${v.name}</span>
                <span class="view-del" @click=${(e) => { e.stopPropagation(); this._deleteView(v); }}>×</span>
              </div>
            `)}
          </div>
        ` : ""}
      </div>
    `;
  }

  render() {
    if (this._loading) return html`<div class="loading">Loading database…</div>`;

    const notes = this._filteredNotes();

    return html`
      <div class="toolbar">
        <span class="toolbar-title">${icon("database", 16)} Database</span>
        <input class="filter-input" type="text" placeholder="Filter rows…"
          .value=${this._rowFilter}
          @input=${(e) => { this._rowFilter = e.target.value; }}
        />
        <button class="pkm-icon-btn ${this._filterOpen ? "active" : ""}" title="Query builder"
          @click=${() => { this._filterOpen = !this._filterOpen; }}>${icon("tune", 18)}</button>
        <button class="pkm-icon-btn" title="Refresh" @click=${() => this._applyFilter()}>${icon("refresh", 18)}</button>
        <span class="note-count">${notes.length} / ${this._notes.length}</span>
      </div>

      <!-- Column picker -->
      <div class="col-bar">
        ${this._fields.map((f) => html`
          <button class="col-btn ${this._columns.includes(f) ? "on" : ""}"
            @click=${() => this._toggleColumn(f)}>${f}</button>
        `)}
      </div>

      ${this._renderFilterBuilder()}

      <div class="table-wrap">
        ${notes.length === 0
          ? html`<div class="empty">No notes match the current filter</div>`
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
                    ${this._columns.map((col) => html`
                      <td
                        @dblclick=${() => this._startEdit(note, col)}
                        title="Double-click to edit"
                      >${this._renderCell(note, col)}</td>
                    `)}
                  </tr>
                `)}
              </tbody>
            </table>
          `}
      </div>
    `;
  }
}

// Patch a single frontmatter key in markdown content, creating frontmatter if absent.
function patchFrontmatterKey(content, key, value) {
  const FM_RE = /^---\n([\s\S]*?)\n---\n?/;
  const match = FM_RE.exec(content);
  if (!match) {
    return `---\n${key}: ${value}\n---\n${content}`;
  }
  const body = content.slice(match[0].length);
  const lines = match[1].split("\n");
  const idx   = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (idx >= 0) lines[idx] = `${key}: ${value}`;
  else lines.push(`${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

customElements.define("pkm-database-view", PkmDatabaseView);
