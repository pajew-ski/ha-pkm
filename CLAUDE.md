# ha-pkm – Claude Code Context

## What this is

A Home Assistant custom component that adds a full PKM (Personal Knowledge Management) panel to HA. It provides a markdown editor, canvas view, database view, graph view, wikilinks, backlinks, full-text search, and a file tree — all inside a single HA sidebar panel.

## Repo layout

```
custom_components/ha_pkm/
  __init__.py           # HA entry point, panel + static file registration
  manifest.json         # component metadata, version: 0.2.0
  const.py              # configuration constants
  config_flow.py        # HA config flow (vault path, watcher settings)
  file_manager.py       # file CRUD, trash, folder ops
  file_watcher.py       # watchdog-based file change events → HA events
  link_index.py         # wikilink → file-path index + backlinks
  search_engine.py      # full-text search over vault
  database.py           # structured query engine (front-matter as tables)
  ws_api.py             # all WebSocket API handlers (see below)
  www/                  # frontend static files (served at /ha-pkm-panel/)
    ha-pkm-panel.js     # root LitElement custom element <ha-pkm-panel>
    icons.js            # MDI SVG icon helper: icon(name, size?)
    styles/theme.css    # CSS custom properties (unused at runtime – vars live in ha-pkm-panel.js)
    components/
      tab-bar.js        # <pkm-tab-bar>
      file-tree.js      # <pkm-file-tree>
      backlinks-panel.js# <pkm-backlinks-panel>
      search-modal.js   # <pkm-search-modal>
      command-palette.js# <pkm-command-palette>
    views/
      editor-view.js    # <pkm-editor-view> – markdown editor (CodeMirror 6)
      canvas-view.js    # <pkm-canvas-view> – infinite canvas
      database-view.js  # <pkm-database-view>
      graph-view.js     # <pkm-graph-view>
    editor/
      codemirror-bundle.js   # LOCAL esbuild bundle (all @codemirror/* in one file)
      codemirror-setup.js    # PkmEditor class, imports only from codemirror-bundle.js
      wikilink-extension.js  # ViewPlugin for [[wikilink]] decorations
```

## WebSocket API (ws_api.py)

All calls use `hass.callWS({ type: "ha_pkm/<cmd>", ...params })` from the frontend.

| type | params | returns |
|------|--------|---------|
| `ha_pkm/list_files` | `path?` | `{ files: FileTree[] }` |
| `ha_pkm/read_file` | `path` | `{ content, mtime }` |
| `ha_pkm/write_file` | `path, content` | `{}` |
| `ha_pkm/delete_file` | `path` | `{}` (moves to .trash) |
| `ha_pkm/rename_file` | `old_path, new_path` | `{}` |
| `ha_pkm/create_folder` | `path` | `{}` |
| `ha_pkm/get_backlinks` | `path` | `{ backlinks: [] }` |
| `ha_pkm/resolve_link` | `link` | `{ path }` or `{ path: null }` |
| `ha_pkm/get_graph_data` | — | `{ nodes, edges }` |
| `ha_pkm/get_tags` | — | `{ tags: [] }` |
| `ha_pkm/search` | `query, limit?` | `{ results: [] }` |
| `ha_pkm/db_query` | `query` | `{ columns, rows }` |
| `ha_pkm/read_canvas` | `path` | `{ canvas: CanvasData }` |
| `ha_pkm/write_canvas` | `path, canvas` | `{}` |
| `ha_pkm/get_config` | — | `{ vault_path, ... }` |

File-change events are pushed via `ha_pkm_file_changed` HA events (`path`, `event_type`).

## Frontend architecture

- **Framework**: Lit 3 (from jsDelivr CDN `https://cdn.jsdelivr.net/npm/lit@3/+esm`)
- **Editor**: CodeMirror 6 (local bundle — see below)
- **Shadow DOM**: every component uses Lit's default closed shadow root

### `ha-pkm-panel.js` state

Key reactive properties: `_tabs`, `_activeTab`, `_currentView` (`"editor"|"canvas"|"database"|"graph"`), `_sidebarOpen`, `_backlinkOpen`, `narrow` (reflects to attribute for CSS).

`narrow` has `reflect: true` so `:host([narrow])` CSS selectors work. It is set by a `ResizeObserver` on the host element (not only from HA's `narrow` prop) to handle fold/unfold on foldable devices.

`_renderView()` returns a different component element based on `_currentView`. Switching views destroys and recreates the view element — Lit handles this via template reconciliation.

### `editor-view.js` — critical design invariants

1. **`#cm-host` is always in the DOM** — never conditionally removed. Empty-state, canvas-guard, loading, and preview are `position: absolute` overlays (z-index 3–5) that sit on top.
2. **`#cm-host` uses `position: absolute; inset: 0`** — gives CodeMirror an explicitly-computed height so its internal `height: 100%` resolves correctly. `flex: 1` alone does not guarantee a "definite" height in all browsers.
3. **`firstUpdated()` always finds `#cm-host`** — CodeMirror is initialised exactly once. `updated()` retries `_initEditor()` as a safety net.
4. **`root: container.getRootNode()`** must be passed to `new EditorView()` — required for CodeMirror to handle keyboard/selection/paste inside a Shadow DOM.

### CodeMirror bundle — DO NOT use CDN imports

`codemirror-bundle.js` is a vendored esbuild bundle. **All** CodeMirror imports in `codemirror-setup.js` and `wikilink-extension.js` must come from `./codemirror-bundle.js`, not from any CDN URL.

**Why:** jsDelivr's `+esm` format and esm.sh both inline or version-pin `@codemirror/state` differently per package. Any split across CDN URLs creates two module instances of `@codemirror/state`. CodeMirror validates extensions with `instanceof` checks and throws:
> "Unrecognized extension value in extension set … multiple instances of @codemirror/state are loaded"

The local bundle has exactly one instance. **Never add CDN imports for `@codemirror/*`.**

### Rebuilding the CodeMirror bundle

Run from the repo root when CodeMirror packages need updating:

```bash
cd /tmp && mkdir cm-build && cd cm-build
npm init -y
npm install --save-exact \
  @codemirror/state \
  @codemirror/view \
  @codemirror/commands \
  @codemirror/language \
  @codemirror/lang-markdown \
  @codemirror/theme-one-dark \
  @codemirror/search \
  @codemirror/autocomplete \
  esbuild
# Create entry.js that exports everything needed (see editor/codemirror-setup.js imports)
node_modules/.bin/esbuild entry.js \
  --bundle --format=esm --minify \
  --outfile=/path/to/www/editor/codemirror-bundle.js
```

## CSS variables (defined in `ha-pkm-panel.js` `:host`)

| variable | purpose |
|----------|---------|
| `--pkm-bg` | page/editor background |
| `--pkm-surface` | card/panel background |
| `--pkm-surface-2` | hover/secondary background |
| `--pkm-border` | borders, dividers |
| `--pkm-text` | primary text |
| `--pkm-text-muted` | secondary/dim text |
| `--pkm-accent` | accent / primary colour |
| `--pkm-link` | resolved wikilink colour |
| `--pkm-link-unresolved` | unresolved wikilink (dashed) |
| `--pkm-font-mono` | monospace font stack |
| `--pkm-font-ui` | UI font (inherits from HA) |

## Development workflow

1. Edit files in `custom_components/ha_pkm/www/`
2. HA serves them with `cache_headers=False` so a normal refresh (F5) picks up changes. Static files do **not** need a server restart.
3. Python backend changes require an HA restart (`ha core restart` or developer tools → restart).
4. The active branch is `claude/ha-pkm-backend-editor-8QNtt`.

## Known gotchas

- **Lit conditional rendering destroys elements** — never put CodeMirror's host div inside a conditional `${condition ? html`...` : ""}`. Use absolute-positioned overlays instead.
- **Shadow DOM + CodeMirror**: always pass `root: container.getRootNode()` to `new EditorView()`.
- **`narrow` must reflect** — `narrow: { type: Boolean, reflect: true }` required for `:host([narrow])` CSS selectors.
- **Touch left-edge exclusion** — canvas `touchstart` handler skips `e.clientX < 30` to preserve HA's swipe-sidebar gesture.
- **`height: 100%` inside flex** — CodeMirror's `.cm-editor` uses `height: 100%`. This only resolves if the parent has an explicitly-defined height. Use `position: absolute; inset: 0` on the host div rather than `flex: 1`.
