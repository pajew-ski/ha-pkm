/**
 * graph-view.js – Phase 5
 *
 * New features:
 * - Folder-based node colouring (stable hash → hue)
 * - Hover: highlight direct neighbours, fade others
 * - Filter sidebar: show/hide individual folders
 * - Node size proportional to backlink count
 * - Ghost nodes (unresolved) distinguished by shape (diamond via transform)
 * - Cluster strength pulls nodes of same folder together
 * - Label visibility: always above zoom 1.5, on hover otherwise
 */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";
import { icon } from "../icons.js";

const D3_CDN = "https://cdn.jsdelivr.net/npm/d3@7/+esm";

function folderOf(path) {
  const parts = (path || "").split("/");
  return parts.length > 1 ? parts[0] : "(root)";
}

function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 65%, 62%)`;
}

export class PkmGraphView extends LitElement {
  static properties = {
    hass:         { type: Object },
    _loading:     { state: true },
    _query:       { state: true },
    _folders:     { state: true },   // Set of all folder names
    _hidden:      { state: true },   // Set of hidden folders
    _filterOpen:  { state: true },
    _colorMode:   { state: true },   // "folder" | "none"
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .toolbar {
      display: flex; align-items: center; flex-wrap: wrap;
      padding: 6px 12px; gap: 8px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      flex-shrink: 0;
    }
    .toolbar-title { font-weight: 600; font-size: 14px; }

    .search-input {
      background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-border);
      border-radius: 4px;
      color: var(--pkm-text); padding: 4px 10px;
      font-size: 13px; font-family: inherit; outline: none; width: 180px;
    }
    .search-input:focus { border-color: var(--pkm-accent); }

    select {
      background: var(--pkm-surface-2); border: 1px solid var(--pkm-border);
      border-radius: 4px; color: var(--pkm-text); padding: 4px 8px;
      font-size: 12px; font-family: inherit; outline: none; cursor: pointer;
    }

    .stats { font-size: 11px; color: var(--pkm-text-muted); margin-left: auto; }

    .pkm-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border: none; background: transparent;
      color: var(--pkm-text-muted); border-radius: 4px; cursor: pointer;
    }
    .pkm-icon-btn:hover { background: var(--pkm-surface-2); color: var(--pkm-text); }
    .pkm-icon-btn.active { color: var(--pkm-accent); }

    /* Main area */
    .main { flex: 1; display: flex; overflow: hidden; }

    .graph-area { flex: 1; position: relative; overflow: hidden; }
    svg { width: 100%; height: 100%; background: var(--pkm-bg); display: block; }

    /* Filter panel */
    .filter-panel {
      width: 200px; min-width: 200px;
      background: var(--pkm-surface);
      border-left: 1px solid var(--pkm-border);
      display: flex; flex-direction: column;
      overflow: hidden;
      transition: width 150ms, min-width 150ms;
    }
    .filter-panel.closed { width: 0; min-width: 0; }

    .filter-header {
      padding: 8px 12px;
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--pkm-text-muted);
      border-bottom: 1px solid var(--pkm-border);
      flex-shrink: 0;
    }
    .filter-scroll { flex: 1; overflow-y: auto; padding: 6px 8px; }

    .folder-row {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 4px; border-radius: 4px; cursor: pointer;
      font-size: 12px;
    }
    .folder-row:hover { background: var(--pkm-surface-2); }
    .folder-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .folder-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .folder-count { font-size: 10px; color: var(--pkm-text-muted); }

    /* Legend */
    .legend {
      position: absolute; bottom: 12px; left: 12px;
      background: var(--pkm-surface); border: 1px solid var(--pkm-border);
      border-radius: 6px; padding: 8px 12px; font-size: 11px;
      color: var(--pkm-text-muted); display: flex; flex-direction: column; gap: 4px;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot  { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

    /* Zoom controls */
    .zoom-controls {
      position: absolute; bottom: 12px; right: 12px;
      display: flex; flex-direction: column; gap: 4px;
    }

    .loading {
      display: flex; align-items: center; justify-content: center;
      height: 100%; color: var(--pkm-text-muted);
    }
  `;

  constructor() {
    super();
    this._loading    = false;
    this._query      = "";
    this._folders    = new Set();
    this._hidden     = new Set();
    this._filterOpen = true;
    this._colorMode  = "folder";
    this._d3         = null;
    this._simulation = null;
    this._graphData  = { nodes: [], edges: [] };
    this._zoom       = null;
    this._svgG       = null;
  }

  updated(changed) {
    if (changed.has("hass") && this.hass) this._loadGraph();
  }

  async _loadGraph() {
    this._loading = true;
    try {
      if (!this._d3) this._d3 = await import(D3_CDN);
      const res = await this.hass.callWS({ type: "ha_pkm/get_graph_data" });
      this._graphData = res;
      // Collect folders
      this._folders = new Set(
        (res.nodes || []).filter((n) => !n.ghost).map((n) => folderOf(n.path))
      );
      await this.updateComplete;
      this._renderGraph();
    } catch (e) {
      console.error("Graph error:", e);
    } finally {
      this._loading = false;
    }
  }

  _visibleNodes() {
    return (this._graphData.nodes || []).filter((n) => {
      if (n.ghost) return true;  // always show ghost nodes
      return !this._hidden.has(folderOf(n.path));
    });
  }

  _visibleEdges(nodeIds) {
    return (this._graphData.edges || []).filter(
      (e) => nodeIds.has(e.source?.id ?? e.source) && nodeIds.has(e.target?.id ?? e.target)
    );
  }

  _nodeColor(d) {
    if (d.ghost) return "var(--pkm-link-unresolved)";
    if (this._colorMode === "folder") return hashColor(folderOf(d.path));
    return "var(--pkm-accent)";
  }

  _nodeRadius(d) {
    return d.ghost ? 5 : Math.max(5, Math.min(18, 5 + (d.backlink_count || 0) * 1.8));
  }

  _renderGraph() {
    const d3 = this._d3;
    if (!d3) return;
    const container = this.shadowRoot.querySelector(".graph-area");
    if (!container) return;

    const nodes = this._visibleNodes().map((n) => ({ ...n }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = this._visibleEdges(nodeIds).map((e) => ({ ...e }));

    const svg = d3.select(container).select("svg");
    svg.selectAll("*").remove();

    const W = container.clientWidth;
    const H = container.clientHeight;
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    // Arrow marker
    svg.append("defs").append("marker")
      .attr("id", "pkm-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 22).attr("refY", 0)
      .attr("markerWidth", 5).attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#666").attr("opacity", 0.7);

    const g = svg.append("g");
    this._svgG = g;

    // Zoom + pan
    this._zoom = d3.zoom()
      .scaleExtent([0.05, 6])
      .on("zoom", (ev) => {
        g.attr("transform", ev.transform);
        // Show labels permanently when zoomed in
        g.selectAll(".node-label")
          .style("display", ev.transform.k > 1.4 ? "block" : "none");
      });
    svg.call(this._zoom);

    // Simulation
    if (this._simulation) this._simulation.stop();
    this._simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d) => d.id).distance(80).strength(0.8))
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide((d) => this._nodeRadius(d) + 4))
      .force("folder-cluster", this._folderClusterForce(nodes, 0.04));

    // Edges
    const link = g.append("g").attr("class", "links")
      .selectAll("line").data(edges).join("line")
      .attr("stroke", "#444").attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#pkm-arrow)");

    // Nodes
    const node = g.append("g").attr("class", "nodes")
      .selectAll("g").data(nodes).join("g")
      .attr("class", "node-g")
      .attr("cursor", "pointer")
      .on("click", (_ev, d) => {
        if (!d.ghost) this.dispatchEvent(new CustomEvent("file-open", { detail: { path: d.path }, bubbles: true, composed: true }));
      })
      .on("mouseover", (_ev, d) => this._onNodeHover(d, link, node, label))
      .on("mouseout",  ()      => this._onNodeOut(link, node, label))
      .call(d3.drag()
        .on("start", (ev, d) => { if (!ev.active) this._simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag",  (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on("end",   (ev, d) => { if (!ev.active) this._simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    // Circle for normal nodes
    node.filter((d) => !d.ghost)
      .append("circle")
      .attr("r", (d) => this._nodeRadius(d))
      .attr("fill", (d) => this._nodeColor(d))
      .attr("stroke", "#000").attr("stroke-opacity", 0.2).attr("stroke-width", 1);

    // Diamond for ghost nodes
    node.filter((d) => d.ghost)
      .append("rect")
      .attr("width", 10).attr("height", 10)
      .attr("transform", "rotate(45) translate(-5,-5)")
      .attr("fill", "var(--pkm-link-unresolved)")
      .attr("stroke", "#000").attr("stroke-opacity", 0.2);

    node.append("title").text((d) => d.ghost ? `Ghost: ${d.label}` : d.path);

    // Labels
    const label = g.append("g").attr("class", "labels")
      .selectAll("text").data(nodes).join("text")
      .attr("class", "node-label")
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("fill", "var(--pkm-text-muted)")
      .attr("pointer-events", "none")
      .attr("user-select", "none")
      .style("display", "none")   // hidden until zoom > 1.4 or hover
      .text((d) => d.ghost ? d.label : (d.id.split("/").pop().replace(/\.md$/, "")));

    this._simulation.on("tick", () => {
      link
        .attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      label.attr("x", (d) => d.x).attr("y", (d) => d.y - this._nodeRadius(d) - 4);
    });
  }

  _onNodeHover(d, link, node, label) {
    const neighbours = new Set([d.id]);
    link.each((e) => {
      const src = e.source?.id ?? e.source;
      const tgt = e.target?.id ?? e.target;
      if (src === d.id) neighbours.add(tgt);
      if (tgt === d.id) neighbours.add(src);
    });
    node.attr("opacity", (n) => neighbours.has(n.id) ? 1 : 0.15);
    link.attr("opacity", (e) => {
      const src = e.source?.id ?? e.source;
      const tgt = e.target?.id ?? e.target;
      return (src === d.id || tgt === d.id) ? 1 : 0.05;
    });
    label.style("display", (n) => neighbours.has(n.id) ? "block" : "none");
  }

  _onNodeOut(link, node, label) {
    node.attr("opacity", 1);
    link.attr("opacity", 0.5);
    // Labels hidden after hover; zoom listener will re-show them above threshold
    label.style("display", "none");
  }

  /** Weak force that pulls nodes of the same folder toward their centroid. */
  _folderClusterForce(nodes, strength) {
    return () => {
      const centroids = {};
      const counts    = {};
      for (const n of nodes) {
        const f = folderOf(n.path);
        if (!centroids[f]) { centroids[f] = { x: 0, y: 0 }; counts[f] = 0; }
        centroids[f].x += n.x || 0;
        centroids[f].y += n.y || 0;
        counts[f]++;
      }
      for (const f of Object.keys(centroids)) {
        centroids[f].x /= counts[f];
        centroids[f].y /= counts[f];
      }
      for (const n of nodes) {
        const f = folderOf(n.path);
        if (!centroids[f]) continue;
        n.vx = (n.vx || 0) + (centroids[f].x - (n.x || 0)) * strength;
        n.vy = (n.vy || 0) + (centroids[f].y - (n.y || 0)) * strength;
      }
    };
  }

  _filterGraph() {
    if (!this._d3 || !this._svgG) return;
    const q = this._query.toLowerCase().trim();
    if (!q) {
      this._svgG.selectAll(".node-g").attr("opacity", 1);
      this._svgG.selectAll(".node-label").style("display", "none");
      return;
    }
    this._svgG.selectAll(".node-g").attr("opacity", (d) => {
      const lbl = d.ghost ? d.label : d.id;
      return lbl.toLowerCase().includes(q) ? 1 : 0.1;
    });
    this._svgG.selectAll(".node-label").style("display", (d) => {
      const lbl = d.ghost ? d.label : d.id;
      return lbl.toLowerCase().includes(q) ? "block" : "none";
    });
  }

  _toggleFolder(folder) {
    const next = new Set(this._hidden);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    this._hidden = next;
    this.updateComplete.then(() => this._renderGraph());
  }

  _resetZoom() {
    if (!this._d3 || !this._zoom) return;
    const svg = this._d3.select(this.shadowRoot.querySelector("svg"));
    svg.transition().duration(300).call(this._zoom.transform, this._d3.zoomIdentity);
  }

  render() {
    const nodes = this._graphData.nodes || [];
    const edges = this._graphData.edges || [];
    const folders = [...this._folders].sort();

    return html`
      <div class="toolbar">
        <span class="toolbar-title">${icon("graph", 16)} Graph</span>
        <input class="search-input" type="text" placeholder="Filter nodes…"
          .value=${this._query}
          @input=${(e) => { this._query = e.target.value; this._filterGraph(); }}
        />
        <select .value=${this._colorMode} @change=${(e) => { this._colorMode = e.target.value; this._renderGraph(); }}>
          <option value="folder">Colour: Folder</option>
          <option value="none">Colour: Uniform</option>
        </select>
        <button class="pkm-icon-btn" title="Refresh" @click=${() => this._loadGraph()}>${icon("refresh", 18)}</button>
        <button class="pkm-icon-btn ${this._filterOpen ? "active" : ""}" title="Toggle filter panel"
          @click=${() => { this._filterOpen = !this._filterOpen; }}>${icon("tune", 18)}</button>
        <span class="stats">${nodes.length} nodes · ${edges.length} edges</span>
      </div>

      <div class="main">
        <div class="graph-area">
          ${this._loading
            ? html`<div class="loading">Loading graph…</div>`
            : html`<svg></svg>`}

          <div class="legend">
            <div class="legend-item">
              <div class="legend-dot" style="background:var(--pkm-accent)"></div>
              Note (size = backlinks)
            </div>
            <div class="legend-item">
              <div class="legend-dot" style="background:var(--pkm-link-unresolved);border-radius:2px;transform:rotate(45deg)"></div>
              Ghost / Unresolved
            </div>
          </div>

          <div class="zoom-controls">
            <button class="pkm-icon-btn" @click=${() => {
              if (!this._d3 || !this._zoom) return;
              const svg = this._d3.select(this.shadowRoot.querySelector("svg"));
              svg.transition().duration(200).call(this._zoom.scaleBy, 1.3);
            }}>+</button>
            <button class="pkm-icon-btn" @click=${() => this._resetZoom()}>⌂</button>
            <button class="pkm-icon-btn" @click=${() => {
              if (!this._d3 || !this._zoom) return;
              const svg = this._d3.select(this.shadowRoot.querySelector("svg"));
              svg.transition().duration(200).call(this._zoom.scaleBy, 0.77);
            }}>−</button>
          </div>
        </div>

        <!-- Filter panel -->
        <div class="filter-panel ${this._filterOpen ? "" : "closed"}">
          <div class="filter-header">Folders</div>
          <div class="filter-scroll">
            ${folders.map((f) => html`
              <div class="folder-row" @click=${() => this._toggleFolder(f)}>
                <input type="checkbox" .checked=${!this._hidden.has(f)}
                  @click=${(e) => e.stopPropagation()}
                  @change=${() => this._toggleFolder(f)}
                />
                <div class="folder-dot" style="background:${hashColor(f)}"></div>
                <span class="folder-name">${f}</span>
                <span class="folder-count">
                  ${nodes.filter((n) => !n.ghost && folderOf(n.path) === f).length}
                </span>
              </div>
            `)}
          </div>
        </div>
      </div>
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._simulation) this._simulation.stop();
  }
}

customElements.define("pkm-graph-view", PkmGraphView);
