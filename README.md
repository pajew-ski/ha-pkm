# ha-pkm

A personal knowledge management (PKM) panel for Home Assistant — Obsidian-style, no cloud required.

## Features

- **Markdown editor** with wikilinks, syntax highlighting, live preview, and autosave
- **Graph view** — force-directed link graph with folder clustering and hover highlights
- **Canvas view** — Obsidian-compatible `.canvas` spatial notes (drag, connect, resize)
- **Database view** — filter notes by frontmatter fields; inline cell editing; save as `.dbview`
- **Search** — fulltext search with excerpts; `#tag:` and `path:` prefixes; keyboard-driven
- **Command palette** — Ctrl+P; fuzzy-scored with keyboard navigation
- **Backlinks panel** — live backlinks, outgoing links, unresolved links, and tags per note
- **File watcher** — automatic index refresh on external vault changes (configurable)

## Requirements

- Home Assistant 2023.6 or newer (Python 3.11+)
- [HACS](https://hacs.xyz/) for easiest installation

## Installation via HACS

1. Open HACS → **Integrations** → menu → **Custom repositories**
2. Add `https://github.com/pajew-ski/ha-pkm` with category **Integration**
3. Search for **ha-pkm** and click **Download**
4. Restart Home Assistant
5. Go to **Settings → Devices & Services → Add Integration** and search for **ha-pkm**

## Manual Installation

1. Copy `custom_components/ha_pkm/` into your `<config>/custom_components/` directory
2. Copy `www/ha-pkm-panel/` into `<config>/www/ha-pkm-panel/`
3. Restart Home Assistant and add the integration as above

## Configuration

| Option | Default | Description |
|---|---|---|
| Vault path | `/config/pkm/` | Absolute path to your Markdown vault |
| Enable file watcher | `true` | Auto-refresh on external file changes |
| Watcher debounce (ms) | `500` | Delay before re-indexing after a change |

## Usage

After setup the **PKM** entry appears in the Home Assistant sidebar. Click it to open the panel.

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Open command palette |
| `Ctrl+K` | Open search |
| `Ctrl+S` | Save current note |
| `Ctrl+E` | Toggle preview |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` | Next tab |

Notes are stored as plain `.md` files in your vault. Wikilinks (`[[Note Name]]`) are resolved automatically. Deleted notes go to `.trash/` and can be recovered manually.

## License

MIT
