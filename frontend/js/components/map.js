// MapManager v10 — Leaflet map with obstacle rendering, weighted routing, heatmap, A/B comparison
export class MapManager {
    constructor(containerId) {
        this.map = L.map(containerId, { center: [12.935, 77.624], zoom: 16, zoomControl: true });

        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(this.map);

        setTimeout(() => { this.map.invalidateSize(); }, 200);
        setTimeout(() => { this.map.invalidateSize(); }, 600);

        this.nodes           = [];
        this.routeLayer      = null;
        this.obstacleLayer   = null;
        this.spliceLayer     = null;
        this.coverageLayer   = null;
        this.heatmapLayer    = null;   // terrain heatmap overlay
        this.heatmapVisible  = false;
        this.onNodeChange    = null;

        this.map.on('click', (e) => this.handleMapClick(e));
    }

    handleMapClick(e) {
        const type = (document.querySelector('input[name="nodeType"]:checked') || {}).value || 'client';

        if (type === 'isp') {
            const idx = this.nodes.findIndex(n => n.type === 'isp');
            if (idx > -1) { this.map.removeLayer(this.nodes[idx].marker); this.nodes.splice(idx, 1); }
        }

        const sizes   = { isp: [16,16], hub: [14,14], client: [12,12] };
        const anchors = { isp: [8,8],   hub: [7,7],   client: [6,6]   };
        const icon = L.divIcon({ className: `node-${type}`, iconSize: sizes[type], iconAnchor: anchors[type] });
        const marker = L.marker(e.latlng, { icon }).addTo(this.map);

        const labels = { isp: 'ISP Node', hub: 'Splitter Hub', client: 'Client' };
        marker.bindTooltip(labels[type] || type, { permanent: false, direction: 'top', offset: [0, -10] });

        this.nodes.push({ id: this.nodes.length, latlng: e.latlng, marker, type });
        if (this.onNodeChange) this.onNodeChange(this.nodes);
    }

    clearNodes() {
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

    getBoundsObj() {
        const b = this.map.getBounds();
        return { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() };
    }

    // ── Draw obstacle polygons (buildings=red, water=blue, roads=teal) ────────
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
                layers.push(L.polygon(latlngs, style).bindTooltip(type, { sticky: true }));
            }

            if (geom.type === 'LineString' && type === 'road') {
                const latlngs = geom.coordinates.map(([lng, lat]) => [lat, lng]);
                layers.push(
                    L.polyline(latlngs, { color: '#0ea5e9', weight: 3, opacity: 0.6, dashArray: '5 4' })
                     .bindTooltip('Road (preferred routing)', { sticky: true })
                );
            }
        });

        this.obstacleLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── Heatmap: terrain cost overlay ─────────────────────────────────────────
    // Uses an ImageOverlay (canvas → PNG) for efficiency
    toggleHeatmap(grid, bounds, resolution) {
        if (this.heatmapVisible) {
            this.clearHeatmap();
            return;
        }

        const size = 512; // canvas resolution for overlay
        const canvas = document.createElement('canvas');
        canvas.width  = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const cellW = size / resolution;
        const cellH = size / resolution;

        for (let gy = 0; gy < resolution; gy++) {
            for (let gx = 0; gx < resolution; gx++) {
                const w = parseFloat(grid[gy][gx]);  // explicit float conversion

                let r, g, b, a;
                if (w <= 0) {
                    // Blocked — dark red
                    r = 180; g = 0; b = 0; a = 0.75;
                } else if (w <= 0.1) {
                    // Building edge buffer — orange-red
                    r = 255; g = 80; b = 20; a = 0.65;
                } else if (w < 0.8) {
                    // Road (preferred) — green
                    const t = (w - 0.1) / 0.7;
                    r = Math.round(20 + t * 40);
                    g = Math.round(180 + t * 50);
                    b = Math.round(20 + t * 20);
                    a = 0.55;
                } else if (w <= 0.9) {
                    // Road buffer — light green
                    r = 150; g = 220; b = 100; a = 0.35;
                } else {
                    // Open land — near-white / transparent
                    r = 240; g = 245; b = 255; a = 0.10;
                }

                ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
                // Flip Y axis: grid y=0 is south (bottom of map)
                const px = gx * cellW;
                const py = (resolution - 1 - gy) * cellH;
                ctx.fillRect(px, py, Math.ceil(cellW), Math.ceil(cellH));
            }
        }

        const imgUrl = canvas.toDataURL('image/png');
        const leafletBounds = [[bounds.south, bounds.west], [bounds.north, bounds.east]];
        this.heatmapLayer = L.imageOverlay(imgUrl, leafletBounds, { opacity: 0.7, interactive: false }).addTo(this.map);
        this.heatmapVisible = true;
    }

    // ── Draw fiber routes ──────────────────────────────────────────────────────
    drawRoutes(paths, bounds, resolution) {
        if (this.routeLayer)   { this.map.removeLayer(this.routeLayer);   this.routeLayer   = null; }
        if (this.spliceLayer)  { this.map.removeLayer(this.spliceLayer);  this.spliceLayer  = null; }
        if (this.coverageLayer){ this.map.removeLayer(this.coverageLayer);this.coverageLayer= null; }

        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east  - bounds.west)  / resolution;
        const layers  = [];

        paths.forEach(p => {
            const latlngs = p.path.map(c => [
                bounds.south + (c.y + 0.5) * latStep,
                bounds.west  + (c.x + 0.5) * lngStep
            ]);
            const isRing = p.type === 'ring';
            layers.push(L.polyline(latlngs, {
                color:   isRing ? '#f59e0b' : (p.type === 'backbone' ? '#2563eb' : '#64748b'),
                weight:  isRing ? 4 : (p.type === 'backbone' ? 3 : 2),
                opacity: 0.9,
                dashArray: isRing ? '10 5' : null,
                lineJoin: 'round',
                lineCap:  'round'
            }).bindTooltip(isRing ? 'Ring Topology' : 'Fiber Path', { sticky: true }));
        });

        this.routeLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── A/B comparison: draw A* in blue, MST in purple ────────────────────────
    drawABComparison(astarPaths, kruskalPaths, bounds, resolution) {
        if (this.routeLayer)   { this.map.removeLayer(this.routeLayer);    this.routeLayer    = null; }
        if (this.spliceLayer)  { this.map.removeLayer(this.spliceLayer);   this.spliceLayer   = null; }
        if (this.coverageLayer){ this.map.removeLayer(this.coverageLayer); this.coverageLayer = null; }

        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east  - bounds.west)  / resolution;
        const layers  = [];

        const drawPaths = (paths, color, dash) => {
            if (!paths) return;
            paths.forEach(p => {
                const latlngs = p.path.map(c => [
                    bounds.south + (c.y + 0.5) * latStep,
                    bounds.west  + (c.x + 0.5) * lngStep
                ]);
                layers.push(L.polyline(latlngs, { color, weight: 3, opacity: 0.85, dashArray: dash, lineJoin: 'round' }));
            });
        };

        drawPaths(astarPaths,   '#2563eb', null);    // A* = solid blue
        drawPaths(kruskalPaths, '#9333ea', '8 4');   // MST = dashed purple

        this.routeLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── Auto-place splice point markers every 2km ──────────────────────────────
    drawSplicePoints(paths, bounds, resolution) {
        if (this.spliceLayer) { this.map.removeLayer(this.spliceLayer); this.spliceLayer = null; }
        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east  - bounds.west)  / resolution;
        const layers  = [];

        paths.forEach(p => {
            const latlngs = p.path.map(c => L.latLng(
                bounds.south + (c.y + 0.5) * latStep,
                bounds.west  + (c.x + 0.5) * lngStep
            ));
            let distAccum = 0;
            for (let i = 1; i < latlngs.length; i++) {
                distAccum += latlngs[i - 1].distanceTo(latlngs[i]);
                if (distAccum >= 2000) {
                    const spliceIcon = L.divIcon({
                        html: `<div style="width:12px;height:12px;background:#f59e0b;border:2.5px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
                        iconSize: [12, 12], iconAnchor: [6, 6], className: ''
                    });
                    layers.push(
                        L.marker(latlngs[i], { icon: spliceIcon })
                         .bindTooltip('Splice Point · $50', { direction: 'top', offset: [0, -8] })
                    );
                    distAccum = 0;
                }
            }
        });

        this.spliceLayer = L.layerGroup(layers).addTo(this.map);
    }

    // ── Coverage radius circles around hubs ────────────────────────────────────
    drawCoverageCircles() {
        if (this.coverageLayer) { this.map.removeLayer(this.coverageLayer); this.coverageLayer = null; }
        const radiusEl = document.getElementById('coverage-radius');
        const radiusM  = radiusEl ? (parseInt(radiusEl.value) || 300) : 300;
        const layers   = [];
        const hubs     = this.nodes.filter(n => n.type === 'hub');
        const clients  = this.nodes.filter(n => n.type === 'client');

        hubs.forEach(hub => {
            const served   = clients.filter(c => hub.latlng.distanceTo(c.latlng) <= radiusM).length;
            const capacity = 8;   // 1×8 splitter
            const load     = served / capacity;
            const color    = load > 1 ? '#ef4444' : load > 0.8 ? '#f59e0b' : '#22c55e';

            layers.push(L.circle(hub.latlng, {
                radius: radiusM, color, fillColor: color,
                fillOpacity: 0.08, weight: 1.5, dashArray: '6 4'
            }).bindTooltip(
                `Hub coverage · ${served}/${capacity} clients · ${Math.round(load * 100)}% load`,
                { sticky: true }
            ));
        });

        this.coverageLayer = L.layerGroup(layers).addTo(this.map);
    }
}
