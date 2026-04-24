/**
 * CodeMirror 6 Wikilink Extension
 * Decorates [[link]] patterns as clickable spans.
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "https://cdn.jsdelivr.net/npm/@codemirror/view@6/+esm";
import { RangeSetBuilder } from "https://cdn.jsdelivr.net/npm/@codemirror/state@6/+esm";

const WIKILINK_RE = /\[\[([^\]|#\n]+?)(?:[|#]([^\]\n]*))?\]\]/g;

class WikilinkWidget extends WidgetType {
  constructor(target, display, resolved) {
    super();
    this.target = target;
    this.display = display;
    this.resolved = resolved;
  }

  eq(other) {
    return other.target === this.target && other.display === this.display && other.resolved === this.resolved;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `pkm-wikilink${this.resolved ? "" : " pkm-wikilink--unresolved"}`;
    span.textContent = this.display || this.target;
    span.setAttribute("data-wikilink-target", this.target);
    span.title = this.resolved ? `Open: ${this.target}` : `Unresolved: ${this.target}`;
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

function buildDecorations(view, resolvedLinks) {
  const builder = new RangeSetBuilder();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    let match;
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;
      const target = match[1].trim();
      const display = match[2]?.trim() || null;
      const resolved = resolvedLinks ? resolvedLinks.has(target) : true;
      builder.add(
        start,
        end,
        Decoration.replace({
          widget: new WikilinkWidget(target, display, resolved),
        })
      );
    }
  }
  return builder.finish();
}

export function wikilinkExtension(options = {}) {
  const { onClickLink, resolvedLinks, onHoverLink } = options;

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view, resolvedLinks);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, resolvedLinks);
        }
      }
    },
    {
      decorations: (v) => v.decorations,

      eventHandlers: {
        click(event, view) {
          const target = event.target.closest("[data-wikilink-target]");
          if (!target) return false;
          event.preventDefault();
          const link = target.getAttribute("data-wikilink-target");
          if (onClickLink) onClickLink(link);
          return true;
        },

        mouseover(event, view) {
          const target = event.target.closest("[data-wikilink-target]");
          if (!target || !onHoverLink) return false;
          const link = target.getAttribute("data-wikilink-target");
          onHoverLink(link, target);
          return false;
        },
      },
    }
  );

  const theme = EditorView.baseTheme({
    ".pkm-wikilink": {
      color: "var(--pkm-link)",
      cursor: "pointer",
      textDecoration: "none",
      borderBottom: "1px solid color-mix(in srgb, var(--pkm-link) 50%, transparent)",
      padding: "0 1px",
      borderRadius: "2px",
    },
    ".pkm-wikilink:hover": {
      background: "color-mix(in srgb, var(--pkm-link) 15%, transparent)",
    },
    ".pkm-wikilink--unresolved": {
      color: "var(--pkm-link-unresolved)",
      borderBottomColor: "color-mix(in srgb, var(--pkm-link-unresolved) 50%, transparent)",
      borderBottomStyle: "dashed",
    },
  });

  return [plugin, theme];
}
