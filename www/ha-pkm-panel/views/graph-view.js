import { LitElement, html, css } from "https://cdn.jsdelivr.net/npm/lit@3/+esm";

const D3_CDN = "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export class PkmGraphView extends LitElement {
  static properties = {
    hass: { type: Object },
    _loading: { state: true },
    _searchQuery: { state: true },
    _simulation: { state: false },
  };

  static styles = css`
    :host { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

    .graph-toolbar {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      border-bottom: 1px solid var(--pkm-border);
      background: var(--pkm-surface);
      gap: 8px;
      flex-shrink: 0;
    }

    .search-input {
      background: var(--pkm-surface-2);
      border: 1px solid var(--pkm-border);
      border-radius: 4px;
      color: var(--pkm-text);
      padding: 4px 10px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      width: 200px;
    }
    .search-input:focus { border-color: var(--pkm-accent); }

    .graph-area { flex: 1; overflow: hidden; position: relative; }

    svg {
      width: 100%;
      height: 100%;
      background: var(--pkm-bg);
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--pkm-text-muted);
    }

    .node-label {
      font-size: 11px;
      fill: var(--pkm-text-muted);
      pointer-events: none;
      user-select: none;
    }

    .legend {
      position: absolute;
      bottom: 12px;
      left: 12px;
      background: var(--pkm-surface);
      border: 1px solid var(--pkm-border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 11px;
      color: var(--pkm-text-muted);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  `;

  constructor() {
    super();
    this._loading = false;
    this._searchQuery = "";
    this._d3 = null;
    this._simulation = null;
    this._graphData = { nodes: [], edges: [] };
  }

  updated(changed) {
    if ((changed.has("hass")) && this.hass) {
      this._loadGraph();
    }
  }

  async _loadGraph() {
    this._loading = true;
    try {
      if (!this._d3) {
        this._d3 = await import(D3_CDN);
      }
      const res = await this.hass.callWS({ type: "ha_pkm/get_graph_data" });
      this._graphData = res;
      await this.updateComplete;
      this._renderGraph();
    } catch (e) {
      console.error("Graph load error:", e);
    } finally {
      this._loading = false;
    }
  }

  _renderGraph() {
    const d3 = this._d3;
    if (!d3) return;
    const container = this.shadowRoot.querySelector(".graph-area");
    if (!container) return;

    const svg = d3.select(container).select("svg");
    if (svg.empty()) return;

    svg.selectAll("*").remove();

    const width = container.clientWidth;
    const height = container.clientHeight;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "var(--pkm-accent)")
      .attr("opacity", 0.6);

    const g = svg.append("g");

    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    const nodes = (this._graphData.nodes || []).map((n) => ({ ...n }));
    const edges = (this._graphData.edges || []).map((e) => ({ ...e }));

    if (this._simulation) this._simulation.stop();

    this._simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d) => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide(20));

    const link = g.append("g")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", "var(--pkm-accent)")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrow)");

    const node = g.append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => Math.max(6, Math.min(20, 6 + d.backlink_count * 2)))
      .attr("fill", (d) => d.ghost ? "var(--pkm-link-unresolved)" : "var(--pkm-accent)")
      .attr("opacity", 0.85)
      .attr("cursor", "pointer")
      .on("click", (event, d) => {
        if (!d.ghost) {
          this.dispatchEvent(new CustomEvent("file-open", { detail: { path: d.path }, bubbles: true, composed: true }));
        }
      })
      .on("mouseover", function(event, d) {
        d3.select(this).attr("opacity", 1).attr("stroke", "var(--pkm-text)").attr("stroke-width", 2);
      })
      .on("mouseout", function() {
        d3.select(this).attr("opacity", 0.85).attr("stroke", "none");
      });

    node.call(
      d3.drag()
        .on("start", (event, d) => {
          if (!event.active) this._simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!event.active) this._simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
    );

    node.append("title").text((d) => d.ghost ? `Ghost: ${d.label}` : d.path);

    const labels = g.append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("class", "node-label")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => -Math.max(6, 6 + d.backlink_count * 2) - 4)
      .text((d) => (d.ghost ? d.label : d.id.split("/").pop().replace(/\.md$/, "")));

    this._simulation.on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
      labels.attr("x", (d) => d.x).attr("y", (d) => d.y);
    });
  }

  _filterGraph() {
    const q = this._searchQuery.toLowerCase().trim();
    if (!q || !this._d3) return;
    const d3 = this._d3;
    const container = this.shadowRoot.querySelector(".graph-area");
    if (!container) return;
    d3.select(container).selectAll("circle")
      .attr("opacity", (d) => {
        const label = d.ghost ? d.label : d.id;
        return label.toLowerCase().includes(q) ? 1 : 0.15;
      });
    d3.select(container).selectAll("text")
      .attr("opacity", (d) => {
        const label = d.ghost ? d.label : d.id;
        return label.toLowerCase().includes(q) ? 1 : 0.1;
      });
  }

  render() {
    return html`
      <div class="graph-toolbar">
        <span style="font-weight:600;font-size:14px">⬡ Graph</span>
        <input
          class="search-input"
          type="text"
          placeholder="Filter nodes…"
          .value=${this._searchQuery}
          @input=${(e) => {
            this._searchQuery = e.target.value;
            this._filterGraph();
          }}
        />
        <button class="pkm-icon-btn" title="Refresh" @click=${() => this._loadGraph()}>🔄</button>
        <span style="font-size:12px;color:var(--pkm-text-muted)">
          ${this._graphData.nodes?.length || 0} nodes · ${this._graphData.edges?.length || 0} edges
        </span>
      </div>

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
            <div class="legend-dot" style="background:var(--pkm-link-unresolved)"></div>
            Ghost / Unresolved
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
