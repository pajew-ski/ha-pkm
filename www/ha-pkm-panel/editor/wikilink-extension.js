/**
 * CodeMirror 6 Wikilink Extension – Phase 3 enhanced
 *
 * Changes vs Phase 2:
 * - Resolved links rendered in accent colour, unresolved in error colour
 * - Hover triggers onHoverLink callback with anchor element for tooltip
 * - resolvedLinks is a reactive Set passed from the outside; widget re-renders
 *   on each viewport update so colour stays in sync without extra state
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "https://cdn.jsdelivr.net/npm/@codemirror/view@6/+esm";
import { RangeSetBuilder } from "https://cdn.jsdelivr.net/npm/@codemirror/state@6/+esm";

const WIKILINK_RE = /\[\[([^\]|#\n]+?)(?:[|#]([^\]\n]*))?\]\]/g;

class WikilinkWidget extends WidgetType {
  constructor(target, display, resolved) {
    super();
    this.target  = target;
    this.display = display;
    this.resolved = resolved;
  }

  eq(other) {
    return other.target === this.target
        && other.display === this.display
        && other.resolved === this.resolved;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = `pkm-wikilink${this.resolved ? "" : " pkm-wikilink--unresolved"}`;
    span.textContent = this.display || this.target;
    span.setAttribute("data-wikilink-target", this.target);
    span.title = this.resolved
      ? `Open: ${this.target}`
      : `Unresolved link: ${this.target} (click to create)`;
    return span;
  }

  ignoreEvent() { return false; }
}

function buildDecorations(view, getResolved) {
  const builder = new RangeSetBuilder();
  const resolved = getResolved();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WIKILINK_RE.lastIndex = 0;
    let match;
    while ((match = WIKILINK_RE.exec(text)) !== null) {
      const start = from + match.index;
      const end   = start + match[0].length;
      const target  = match[1].trim();
      const display = match[2]?.trim() || null;
      const isResolved = resolved ? resolved.has(target) : true;
      builder.add(start, end, Decoration.replace({
        widget: new WikilinkWidget(target, display, isResolved),
      }));
    }
  }
  return builder.finish();
}

export function wikilinkExtension(options = {}) {
  const { onClickLink, onHoverLink } = options;
  // getResolved is a live getter so widgets stay current on every redraw
  const getResolved = options.getResolved || (() => null);

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDecorations(view, getResolved);
      }
      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, getResolved);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click(event) {
          const target = event.target.closest("[data-wikilink-target]");
          if (!target) return false;
          event.preventDefault();
          onClickLink?.(target.getAttribute("data-wikilink-target"));
          return true;
        },
        mouseover(event) {
          const target = event.target.closest("[data-wikilink-target]");
          if (!target || !onHoverLink) return false;
          onHoverLink(target.getAttribute("data-wikilink-target"), target);
          return false;
        },
        mouseout(event) {
          const target = event.target.closest("[data-wikilink-target]");
          if (!target || !onHoverLink) return false;
          onHoverLink(null, null);
          return false;
        },
      },
    }
  );

  const theme = EditorView.baseTheme({
    ".pkm-wikilink": {
      color: "var(--pkm-link)",
      cursor: "pointer",
      borderBottom: "1px solid color-mix(in srgb, var(--pkm-link) 50%, transparent)",
      padding: "0 1px",
      borderRadius: "2px",
      transition: "background 100ms",
    },
    ".pkm-wikilink:hover": {
      background: "color-mix(in srgb, var(--pkm-link) 15%, transparent)",
    },
    ".pkm-wikilink--unresolved": {
      color: "var(--pkm-link-unresolved)",
      borderBottomStyle: "dashed",
      borderBottomColor: "color-mix(in srgb, var(--pkm-link-unresolved) 50%, transparent)",
    },
    ".pkm-wikilink--unresolved:hover": {
      background: "color-mix(in srgb, var(--pkm-link-unresolved) 10%, transparent)",
    },
  });

  return [plugin, theme];
}
