/**
 * CodeMirror 6 setup – Phase 3: resolved-link awareness wired in
 */

import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from "https://cdn.jsdelivr.net/npm/@codemirror/view@6/+esm";
import { EditorState } from "https://cdn.jsdelivr.net/npm/@codemirror/state@6/+esm";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "https://cdn.jsdelivr.net/npm/@codemirror/commands@6/+esm";
import { markdown, markdownLanguage } from "https://cdn.jsdelivr.net/npm/@codemirror/lang-markdown@6/+esm";
import { oneDark } from "https://cdn.jsdelivr.net/npm/@codemirror/theme-one-dark@6/+esm";
import { highlightSelectionMatches, searchKeymap } from "https://cdn.jsdelivr.net/npm/@codemirror/search@6/+esm";
import { autocompletion, completionKeymap } from "https://cdn.jsdelivr.net/npm/@codemirror/autocomplete@6/+esm";
import { wikilinkExtension } from "./wikilink-extension.js";

const AUTOSAVE_DELAY = 1500;

const haTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      background: "var(--pkm-bg)",
      color: "var(--pkm-text)",
      fontFamily: "var(--pkm-font-mono)",
    },
    ".cm-scroller": {
      fontFamily: "var(--pkm-font-mono)",
      fontSize: "14px",
      lineHeight: "1.7",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "16px",
      maxWidth: "860px",
      margin: "0 auto",
    },
    ".cm-gutters": {
      background: "var(--pkm-bg)",
      borderRight: "1px solid var(--pkm-border)",
      color: "var(--pkm-text-muted)",
    },
    ".cm-activeLineGutter": { background: "color-mix(in srgb, var(--pkm-accent) 10%, transparent)" },
    ".cm-activeLine":       { background: "color-mix(in srgb, var(--pkm-accent) 5%, transparent)" },
    ".cm-selectionBackground, ::selection": {
      background: "color-mix(in srgb, var(--pkm-accent) 30%, transparent) !important",
    },
    ".cm-cursor": { borderLeftColor: "var(--pkm-accent)" },
    ".cm-matchingBracket": {
      background: "color-mix(in srgb, var(--pkm-accent) 20%, transparent)",
      outline: "1px solid var(--pkm-accent)",
    },
    ".cm-tooltip": {
      background: "var(--pkm-surface)",
      border: "1px solid var(--pkm-border)",
      borderRadius: "6px",
      padding: "0",
      color: "var(--pkm-text)",
      fontSize: "13px",
      maxWidth: "400px",
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      overflow: "hidden",
    },
  },
  { dark: true }
);

export class PkmEditor {
  constructor(container, options = {}) {
    this._options = options;
    this._autosaveTimer = null;
    this._isDirty = false;
    // Mutable set – wikilink extension reads via getter on every render
    this._resolvedLinks = new Set();

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        this._isDirty = true;
        options.onDirty?.();
        this._scheduleAutosave();
      }
    });

    const wikilinks = wikilinkExtension({
      getResolved: () => this._resolvedLinks,
      onClickLink: (link) => options.onClickLink?.(link),
      onHoverLink: (link, el) => options.onHoverLink?.(link, el),
    });

    const extensions = [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage }),
      haTheme,
      oneDark,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        indentWithTab,
        { key: "Ctrl-s", run: () => { this._triggerSave(); return true; }, preventDefault: true },
        { key: "Ctrl-e", run: () => { options.onTogglePreview?.(); return true; }, preventDefault: true },
      ]),
      autocompletion({ override: [this._wikilinkCompletion.bind(this)] }),
      wikilinks,
      updateListener,
    ];

    this.view = new EditorView({
      state: EditorState.create({ doc: options.initialContent || "", extensions }),
      parent: container,
    });
  }

  setContent(content) {
    const current = this.view.state.doc.toString();
    if (current === content) return;
    this.view.dispatch({ changes: { from: 0, to: current.length, insert: content } });
    this._isDirty = false;
  }

  getContent()  { return this.view.state.doc.toString(); }
  markClean()   { this._isDirty = false; }
  isDirty()     { return this._isDirty; }
  focus()       { this.view.focus(); }
  destroy()     { if (this._autosaveTimer) clearTimeout(this._autosaveTimer); this.view.destroy(); }

  /** Call whenever the resolved-link set changes so wikilinks re-colour. */
  setResolvedLinks(links) {
    this._resolvedLinks = links instanceof Set ? links : new Set(links);
    // Force a viewport re-render so decoration builder runs again
    this.view.dispatch({});
  }

  _scheduleAutosave() {
    if (this._autosaveTimer) clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => { if (this._isDirty) this._triggerSave(); }, AUTOSAVE_DELAY);
  }

  _triggerSave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = null;
    this._options.onSave?.(this.getContent());
  }

  _wikilinkCompletion(context) {
    const match = context.matchBefore(/\[\[[^\]]*$/);
    if (!match || (match.from === match.to && !context.explicit)) return null;
    const query = match.text.slice(2).toLowerCase();
    const paths = this._options.getAllPaths?.() ?? [];
    return {
      from: match.from + 2,
      options: paths
        .filter((p) => p.toLowerCase().includes(query))
        .slice(0, 20)
        .map((p) => ({
          label: p,
          type: "text",
          apply: (view, _c, _f, _t) => {
            view.dispatch({ changes: { from: match.from, to: context.pos, insert: `[[${p}]]` } });
          },
        })),
    };
  }
}
