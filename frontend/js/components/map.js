// MapManager v11 — Industry Edition
// Features: draggable nodes, right-click context menu, permanent labels,
//           tile layer switcher, fit-to-nodes, heatmap, A/B comparison

export class MapManager {
    constructor(containerId) {
        this.map = L.map(containerId, {
            center: [12.935, 77.624],
            zoom: 16,
            zoomControl: true,
            preferCanvas: true,
        });

        // ── Tile layers ──────────────────────────────────────────────────────
        this.tileLayers = {
            'OSM Standard': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                maxZoom: 19,
            }),
            'Satellite (Esri)': L.tileLayer(
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                { attribution: 'Tiles &copy; Esri', maxZoom: 19 }
            ),
            'CartoDB Dark': L.tileLayer(
                'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
                { attribution: '&copy; CartoDB', maxZoom: 19 }
            ),
            'CartoDB Light': L.tileLayer(
                'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
                { attribution: '&copy; CartoDB', maxZoom: 19 }
            ),
        };

        this.tileLayers['OSM Standard'].addTo(this.map);
        this.currentTileLayer = 'OSM Standard';

        L.control.layers(this.tileLayers, {}, { position: 'bottomright' }).addTo(this.map);

        setTimeout(() => this.map.invalidateSize(), 200);
        setTimeout(() => this.map.invalidateSize(), 600);

        this.nodes          = [];
        this.routeLayer     = null;
        this.obstacleLayer  = null;
        this.spliceLayer    = null;
        this.coverageLayer  = null;
        this.heatmapLayer   = null;
        this.heatmapVisible = false;
        this.onNodeChange   = null;
        this._contextMenu   = null;
        this._nodeIdCounter = 0;    // monotonically increasing — never resets on delete

        this.map.on('click', (e) => this._onMapClick(e));

        // Close context menu on map click
        this.map.on('mousedown', () => this._closeContextMenu());
    }

    // ── Node placement ───────────────────────────────────────────────────────
    _onMapClick(e) {
        this._closeContextMenu();
        const type = (document.querySelector('input[name="nodeType"]:checked') || {}).value || 'client';

        if (type === 'isp') {
            const idx = this.nodes.findIndex(n => n.type === 'isp');
            if (idx > -1) {
                this.map.removeLayer(this.nodes[idx].marker);
                if (this.nodes[idx].labelMarker) this.map.removeLayer(this.nodes[idx].labelMarker);
                this.nodes.splice(idx, 1);
            }
        }

        this._addNode(type, e.latlng);
        if (this.onNodeChange) this.onNodeChange(this.nodes);
    }

    _addNode(type, latlng, id = null, label = null) {
        const nodeId = id ?? (++this._nodeIdCounter);

        const sizes   = { isp: [18, 18], hub: [16, 16], client: [13, 13] };
        const anchors = { isp: [9, 9],   hub: [8, 8],   client: [6.5, 6.5] };

        const icon = L.divIcon({
            className: `node-marker node-${type}`,
            iconSize:  sizes[type]   || [13, 13],
            iconAnchor: anchors[type] || [6, 6],
        });

        const marker = L.marker(latlng, {
            icon,
            draggable: true,
            autoPan:   true,
        }).addTo(this.map);

        const typeLabels = { isp: 'ISP', hub: 'Hub', client: 'Client' };
        const displayLabel = label || `${typeLabels[type] || type} ${nodeId}`;
        marker.bindTooltip(displayLabel, {
            permanent:  true,
            direction:  'top',
            offset:     [0, -12],
            className:  `node-label node-label-${type}`,
        });

        const nodeObj = { id: nodeId, latlng, marker, type, label: displayLabel };

        // Drag: update latlng live and notify
        marker.on('dragstart', () => this._closeContextMenu());
        marker.on('drag',      (ev) => { nodeObj.latlng = ev.latlng; });
        marker.on('dragend',   (ev) => {
            nodeObj.latlng = ev.target.getLatLng();
            if (this.onNodeChange) this.onNodeChange(this.nodes);
        });

        // Right-click context menu
        marker.on('contextmenu', (ev) => {
            L.DomEvent.stopPropagation(ev);
            this._showContextMenu(ev.originalEvent, nodeObj);
        });

        this.nodes.push(nodeObj);
        return nodeObj;
    }

    // ── Context menu ─────────────────────────────────────────────────────────
    _showContextMenu(mouseEvent, nodeObj) {
        this._closeContextMenu();

        const menu = document.createElement('div');
        menu.id = 'map-context-menu';
        menu.className = 'map-ctx-menu';
        menu.innerHTML = `
            <div class="ctx-header">
                <span class="ctx-dot ctx-dot-${nodeObj.type}"></span>
                <strong>${nodeObj.label}</strong>
            </div>
            <button class="ctx-item" data-action="rename">✏️ Rename</button>
            <button class="ctx-item" data-action="delete" style="color:#ef4444;">🗑️ Delete Node</button>
        `;

        // Position at mouse
        menu.style.left = `${mouseEvent.clientX}px`;
        menu.style.top  = `${mouseEvent.clientY}px`;
        document.body.appendChild(menu);
        this._contextMenu = menu;

        menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
            this._closeContextMenu();
            const name = prompt('Enter new label:', nodeObj.label);
            if (name && name.trim()) {
                nodeObj.label = name.trim();
                nodeObj.marker.setTooltipContent(nodeObj.label);
            }
        });

        menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
            this._closeContextMenu();
            this._removeNode(nodeObj);
        });
    }

    _closeContextMenu() {
        if (this._contextMenu) {
            this._contextMenu.remove();
            this._contextMenu = null;
        }
    }

    _removeNode(nodeObj) {
        this.map.removeLayer(nodeObj.marker);
        const idx = this.nodes.findIndex(n => n.id === nodeObj.id);
        if (idx > -1) this.nodes.splice(idx, 1);
        if (this.onNodeChange) this.onNodeChange(this.nodes);
    }

    // ── Clear ────────────────────────────────────────────────────────────────
    clearNodes() {
        this._closeContextMenu();
        this.nodes.forEach(n => this.map.removeLayer(n.marker));
        this.nodes = [];
        if (this.routeLayer)    { this.map.removeLayer(this.routeLayer);    this.routeLayer    = null; }
        if (this.spliceLayer)   { this.map.removeLayer(this.spliceLayer);   this.spliceLayer   = null; }
        if (this.coverageLayer) { this.map.removeLayer(this.coverageLayer); this.coverageLayer = null; }
        if (this.onNodeChange) this.onNodeChange(this.nodes);
    }

    clearObstacles() {
        if (this.obstacleLayer) { this.map.removeLayer(this.obstacleLayer); this.obstacleLayer = null; }
    }

    clearHeatmap() {
        if (this.heatmapLayer) { this.map.removeLayer(this.heatmapLayer); this.heatmapLayer = null; }
        this.heatmapVisible = false;
    }

    // ── Fit to nodes ─────────────────────────────────────────────────────────
    fitToNodes() {
        if (this.nodes.length === 0) return;
        if (this.nodes.length === 1) {
            this.map.setView(this.nodes[0].latlng, 16);
            return;
        }
        const group = L.featureGroup(this.nodes.map(n => n.marker));
        this.map.fitBounds(group.getBounds().pad(0.15));
    }

    // ── Bounds ───────────────────────────────────────────────────────────────
    getBoundsObj() {
        const b = this.map.getBounds();
        return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    }

    // ── Obstacles ────────────────────────────────────────────────────────────
    drawObstacles(features) {
        this.clearObstacles();
        const layers = [];

        features.forEach(f => {
            const type = f.properties.type;
            const geom = f.geometry;

            if (geom.type === 'Polygon') {
                const latlngs = geom.coordinates[0].map(([lng, lat]) => [lat, lng]);
                const style = type === 'building'
                    ? { color: '#ef4444', fillColor: '#fee2e2', weight: 1.5, fillOpacity: 0.45, opacity: 0.85 }
                    : { color: '#3b82f6', fillColor: '#bfdbfe', weight: 1,   fillOpacity: 0.40, opacity: 0.70 };
                layers.push(L.polygon(latlngs, style).bindTooltip(type === 'building' ? '🏢 Building' : '💧 Water', { sticky: true }));
            }

            if (geom.type === 'LineString' && type === 'road') {
                const latlngs = geom.coordinates.map(([lng, lat]) => [lat, lng]);
                layers.push(
                    L.polyline(latlngs, { color: '#0ea5e9', weight: 3, opacity: 0.55, dashArray: '5 4' })
                     .bindTooltip('🛣️ Road (preferred routing)', { sticky: true })
                );
            }
        });

        this.obstacleLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── Terrain heatmap ──────────────────────────────────────────────────────
    toggleHeatmap(grid, bounds, resolution) {
        if (this.heatmapVisible) { this.clearHeatmap(); return; }

        const size   = 512;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx  = canvas.getContext('2d');
        const cellW = size / resolution;
        const cellH = size / resolution;

        for (let gy = 0; gy < resolution; gy++) {
            for (let gx = 0; gx < resolution; gx++) {
                const w = parseFloat(grid[gy][gx]);
                let r, g, b, a;
                if      (w <= 0)    { r=180; g=0;   b=0;   a=0.75; }
                else if (w <= 0.1)  { r=255; g=80;  b=20;  a=0.65; }
                else if (w < 0.8)   { const t=(w-0.1)/0.7; r=Math.round(20+t*40); g=Math.round(180+t*50); b=Math.round(20+t*20); a=0.55; }
                else if (w <= 0.9)  { r=150; g=220; b=100; a=0.35; }
                else                { r=240; g=245; b=255; a=0.10; }

                ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
                ctx.fillRect(gx * cellW, (resolution - 1 - gy) * cellH, Math.ceil(cellW), Math.ceil(cellH));
            }
        }

        const leafletBounds = [[bounds.south, bounds.west], [bounds.north, bounds.east]];
        this.heatmapLayer = L.imageOverlay(canvas.toDataURL('image/png'), leafletBounds, { opacity: 0.7, interactive: false }).addTo(this.map);
        this.heatmapVisible = true;
    }

    // ── Draw fiber routes ─────────────────────────────────────────────────────
    drawRoutes(paths, bounds, resolution) {
        if (this.routeLayer)    { this.map.removeLayer(this.routeLayer);    this.routeLayer    = null; }
        if (this.spliceLayer)   { this.map.removeLayer(this.spliceLayer);   this.spliceLayer   = null; }
        if (this.coverageLayer) { this.map.removeLayer(this.coverageLayer); this.coverageLayer = null; }

        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east  - bounds.west)  / resolution;
        const layers  = [];

        paths.forEach((p, i) => {
            const latlngs = p.path.map(c => [
                bounds.south + (c.y + 0.5) * latStep,
                bounds.west  + (c.x + 0.5) * lngStep,
            ]);
            layers.push(L.polyline(latlngs, {
                color:     '#2563eb',
                weight:    3.5,
                opacity:   0.92,
                lineJoin:  'round',
                lineCap:   'round',
            }).bindTooltip(`Fiber Path ${i + 1}`, { sticky: true }));
        });

        this.routeLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── A/B comparison ────────────────────────────────────────────────────────
    drawABComparison(astarPaths, kruskalPaths, bounds, resolution) {
        if (this.routeLayer)    { this.map.removeLayer(this.routeLayer);    this.routeLayer    = null; }
        if (this.spliceLayer)   { this.map.removeLayer(this.spliceLayer);   this.spliceLayer   = null; }
        if (this.coverageLayer) { this.map.removeLayer(this.coverageLayer); this.coverageLayer = null; }

        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east  - bounds.west)  / resolution;
        const layers  = [];

        const drawPaths = (paths, color, dash, label) => {
            if (!paths) return;
            paths.forEach((p, i) => {
                const latlngs = p.path.map(c => [
                    bounds.south + (c.y + 0.5) * latStep,
                    bounds.west  + (c.x + 0.5) * lngStep,
                ]);
                layers.push(L.polyline(latlngs, {
                    color, weight: 3.5, opacity: 0.88, dashArray: dash, lineJoin: 'round',
                }).bindTooltip(`${label} — Path ${i + 1}`, { sticky: true }));
            });
        };

        drawPaths(astarPaths,   '#2563eb', null,  'A* Hub & Spoke');
        drawPaths(kruskalPaths, '#9333ea', '9 5', "Kruskal's MST");

        this.routeLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── Splice point markers ──────────────────────────────────────────────────
    drawSplicePoints(paths, bounds, resolution) {
        if (this.spliceLayer) { this.map.removeLayer(this.spliceLayer); this.spliceLayer = null; }
        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east  - bounds.west)  / resolution;
        const layers  = [];

        paths.forEach(p => {
            const latlngs = p.path.map(c => L.latLng(
                bounds.south + (c.y + 0.5) * latStep,
                bounds.west  + (c.x + 0.5) * lngStep,
            ));
            let distAccum = 0;
            for (let i = 1; i < latlngs.length; i++) {
                distAccum += latlngs[i - 1].distanceTo(latlngs[i]);
                if (distAccum >= 2000) {
                    layers.push(L.marker(latlngs[i], {
                        icon: L.divIcon({
                            html: `<div style="width:10px;height:10px;background:#f59e0b;border:2.5px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`,
                            iconSize: [10, 10], iconAnchor: [5, 5], className: '',
                        }),
                    }).bindTooltip('⚡ Splice Point · $50', { direction: 'top', offset: [0, -8] }));
                    distAccum = 0;
                }
            }
        });

        this.spliceLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── Hub coverage circles ──────────────────────────────────────────────────
    drawCoverageCircles() {
        if (this.coverageLayer) { this.map.removeLayer(this.coverageLayer); this.coverageLayer = null; }
        const radiusM = parseInt(document.getElementById('coverage-radius')?.value) || 300;
        const layers  = [];
        const hubs    = this.nodes.filter(n => n.type === 'hub');
        const clients = this.nodes.filter(n => n.type === 'client');

        hubs.forEach(hub => {
            const served = clients.filter(c => hub.latlng.distanceTo(c.latlng) <= radiusM).length;
            const load   = served / 8;
            const color  = load > 1 ? '#ef4444' : load > 0.75 ? '#f59e0b' : '#22c55e';

            layers.push(L.circle(hub.latlng, {
                radius: radiusM, color, fillColor: color,
                fillOpacity: 0.08, weight: 1.5, dashArray: '6 4',
            }).bindTooltip(
                `📡 Hub coverage · ${served}/8 clients · ${Math.round(load * 100)}% load`,
                { sticky: true }
            ));
        });

        this.coverageLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── Jump to location (geocoding) ──────────────────────────────────────────
    jumpTo(lat, lng, zoom = 15) {
        this.map.setView([lat, lng], zoom, { animate: true });
    }
}
