import { MapManager } from './components/map.js?v=10';
import { UIManager }  from './components/ui.js?v=10';
import { calculateRoute, getHistory, getHistoryDetail } from './api.js?v=10';

const RESOLUTION = 100;

// ── Overpass mirror list (tries each in order until one works) ─────────────────
// kumi.systems listed first — overpass-api.de returns 406 in some regions
const OVERPASS_ENDPOINTS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.ru/api/interpreter',
];

let currentExportData = null;
let currentFeatures   = [];      // raw GeoJSON features — stored for re-rasterisation
let currentWeightGrid = null;    // Float32Array[100][100] weight grid
let currentBounds     = null;    // bounds used when grid was built — MUST stay in sync

// ── Obstacle weights ──────────────────────────────────────────────────────────
const W = {
    ROAD:          0.7,
    ROAD_BUFFER:   0.85,
    OPEN:          1.0,
    BUILDING_EDGE: 0.05,
    BLOCKED:       0.0,
};

// ── Build empty weight grid (Float32Array rows for memory efficiency) ─────────
function buildDefaultGrid() {
    return Array.from({ length: RESOLUTION }, () =>
        new Float32Array(RESOLUTION).fill(W.OPEN)
    );
}

// Convert Float32Array rows → plain number arrays for JSON serialisation
function gridToSerializable(grid) {
    return Array.from(grid, row => Array.from(row, v => +v));
}

// ── Point-in-polygon (ray-casting) — [x,y] pairs, floating-point safe ─────────
function pointInPolygon(px, py, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

// ── Rasterize OSM GeoJSON features onto a 100×100 float weight grid ───────────
function rasterizeFeatures(features, bounds) {
    const grid    = buildDefaultGrid();
    const latSpan = bounds.north - bounds.south;
    const lngSpan = bounds.east  - bounds.west;

    // lat/lng → floating-point grid coordinates [gx, gy]
    // gx=0..100 means west..east,  gy=0..100 means south..north
    function toGrid(lat, lng) {
        return [
            ((lng - bounds.west)  / lngSpan) * RESOLUTION,
            ((lat - bounds.south) / latSpan) * RESOLUTION,
        ];
    }

    features.forEach(f => {
        const geom = f.geometry;
        const type = (f.properties && f.properties.type) || '';

        // ── Filled polygons: buildings & water ────────────────────────────
        if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
            const rings = geom.type === 'Polygon'
                ? [geom.coordinates[0]]
                : geom.coordinates.map(p => p[0]);

            rings.forEach(ring => {
                // Build gridRing in floating-point grid space [gx, gy]
                const gridRing = ring.map(([lng, lat]) => toGrid(lat, lng));

                // AABB with correct Infinity initialisers
                let minGx = Infinity, maxGx = -Infinity;
                let minGy = Infinity, maxGy = -Infinity;
                for (const [gx, gy] of gridRing) {
                    if (gx < minGx) minGx = gx;
                    if (gx > maxGx) maxGx = gx;
                    if (gy < minGy) minGy = gy;
                    if (gy > maxGy) maxGy = gy;
                }

                // Clamp scan window to grid
                const x0 = Math.max(0, Math.floor(minGx));
                const x1 = Math.min(RESOLUTION - 1, Math.ceil(maxGx));
                const y0 = Math.max(0, Math.floor(minGy));
                const y1 = Math.min(RESOLUTION - 1, Math.ceil(maxGy));

                if (x1 < x0 || y1 < y0) return;   // polygon entirely off-grid

                // Fill interior cells
                for (let gy = y0; gy <= y1; gy++) {
                    for (let gx = x0; gx <= x1; gx++) {
                        if (pointInPolygon(gx + 0.5, gy + 0.5, gridRing)) {
                            if (type === 'building' || type === 'water') {
                                grid[gy][gx] = W.BLOCKED;
                            }
                        }
                    }
                }

                // 1-cell edge buffer around buildings
                if (type === 'building') {
                    const border = [];
                    const sx0 = Math.max(0, x0 - 1), sx1 = Math.min(RESOLUTION - 1, x1 + 1);
                    const sy0 = Math.max(0, y0 - 1), sy1 = Math.min(RESOLUTION - 1, y1 + 1);
                    for (let gy = sy0; gy <= sy1; gy++) {
                        for (let gx = sx0; gx <= sx1; gx++) {
                            if (grid[gy][gx] === W.BLOCKED) {
                                for (let dy = -1; dy <= 1; dy++) {
                                    for (let dx = -1; dx <= 1; dx++) {
                                        const nx = gx + dx, ny = gy + dy;
                                        if (nx >= 0 && nx < RESOLUTION && ny >= 0 && ny < RESOLUTION
                                            && grid[ny][nx] !== W.BLOCKED) {
                                            border.push([nx, ny]);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    border.forEach(([nx, ny]) => {
                        if (grid[ny][nx] !== W.BLOCKED) grid[ny][nx] = W.BUILDING_EDGE;
                    });
                }
            });
        }

        // ── Road polylines — Bresenham rasterisation ────────────────────────
        if (geom.type === 'LineString' && type === 'road') {
            const coords = geom.coordinates;
            for (let i = 0; i < coords.length - 1; i++) {
                const [gx0f, gy0f] = toGrid(coords[i][1],     coords[i][0]);
                const [gx1f, gy1f] = toGrid(coords[i+1][1],   coords[i+1][0]);
                let x0 = Math.round(gx0f), y0 = Math.round(gy0f);
                let x1 = Math.round(gx1f), y1 = Math.round(gy1f);
                let ddx = Math.abs(x1 - x0), ddy = Math.abs(y1 - y0);
                let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
                let err = ddx - ddy;
                while (true) {
                    if (x0 >= 0 && x0 < RESOLUTION && y0 >= 0 && y0 < RESOLUTION) {
                        if (grid[y0][x0] !== W.BLOCKED) grid[y0][x0] = W.ROAD;
                        for (let rdy = -1; rdy <= 1; rdy++) for (let rdx = -1; rdx <= 1; rdx++) {
                            const rx = x0 + rdx, ry = y0 + rdy;
                            if (rx >= 0 && rx < RESOLUTION && ry >= 0 && ry < RESOLUTION
                                && grid[ry][rx] === W.OPEN)
                                grid[ry][rx] = W.ROAD_BUFFER;
                        }
                    }
                    if (x0 === x1 && y0 === y1) break;
                    const e2 = 2 * err;
                    if (e2 > -ddy) { err -= ddy; x0 += sx; }
                    if (e2 <  ddx) { err += ddx; y0 += sy; }
                }
            }
        }
    });

    return grid;
}

// ── Fetch OSM obstacles via backend proxy to bypass CORS/SSL issues ─────────────
async function fetchOSMObstacles(bounds, statusEl) {
    const { south, west, north, east } = bounds;
    const bbox = `${south},${west},${north},${east}`;

    const query =
`[out:json][timeout:25];
(
  way["building"](${bbox});
  way["natural"="water"](${bbox});
  way["waterway"="riverbank"](${bbox});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service)$"](${bbox});
);
out body;
>;
out skel qt;`;

    statusEl.textContent = 'Fetching OSM data via backend proxy…';
    try {
        const resp = await fetch('/api/osm-proxy-raw', {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query)
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (!data.elements || data.elements.length === 0) {
            statusEl.textContent = 'No OSM elements found in this area — try zooming in more';
            return null;
        }
        statusEl.textContent = `Fetched ${data.elements.length} OSM elements ✓`;
        return data;
    } catch (e) {
        console.warn(`OSM proxy fetch failed:`, e.message);
        statusEl.textContent = `OSM fetch failed — check network or backend logs`;
        return null;
    }
}

// ── Convert Overpass JSON → simple GeoJSON features ───────────────────────────
function overpassToFeatures(data) {
    if (!data || !data.elements) return [];

    const nodeMap = {};
    data.elements
        .filter(e => e.type === 'node')
        .forEach(e => { nodeMap[e.id] = [e.lon, e.lat]; });

    const features = [];
    data.elements
        .filter(e => e.type === 'way')
        .forEach(way => {
            const coords = (way.nodes || []).map(id => nodeMap[id]).filter(Boolean);
            if (coords.length < 2) return;

            const tags = way.tags || {};
            let type = 'unknown';
            if (tags.building)                                  type = 'building';
            else if (tags.natural === 'water' || tags.waterway) type = 'water';
            else if (tags.highway)                              type = 'road';
            if (type === 'unknown') return;

            // Detect closed ring: first and last coord are equal
            const isClosed =
                coords.length > 2 &&
                coords[0][0] === coords[coords.length - 1][0] &&
                coords[0][1] === coords[coords.length - 1][1];

            features.push({
                geometry: {
                    type: (isClosed && type !== 'road') ? 'Polygon' : 'LineString',
                    coordinates: (isClosed && type !== 'road') ? [coords] : coords,
                },
                properties: { type },
            });
        });

    return features;
}

// ── BOM calculation ───────────────────────────────────────────────────────────
function calcBOM(paths, nodes, bounds, costs) {
    const latStep = (bounds.north - bounds.south) / RESOLUTION;
    const lngStep = (bounds.east  - bounds.west)  / RESOLUTION;
    let totalDist = 0;

    paths.forEach(p => {
        const lls = p.path.map(c => [
            bounds.south + (c.y + 0.5) * latStep,
            bounds.west  + (c.x + 0.5) * lngStep,
        ]);
        for (let i = 0; i < lls.length - 1; i++)
            totalDist += L.latLng(lls[i]).distanceTo(L.latLng(lls[i + 1]));
    });

    totalDist = Math.round(totalDist);
    const hubCount    = nodes.filter(n => n.type === 'hub').length;
    const clientCount = nodes.filter(n => n.type === 'client').length;
    const spliceCount = Math.floor(totalDist / 2000);
    const fiberCost   = totalDist * costs.fiber;
    const hubCost     = hubCount  * costs.hub;
    const clientCost  = clientCount * costs.client;
    const spliceCost  = spliceCount * 50;
    const totalCost   = fiberCost + hubCost + clientCost + spliceCost;
    const opticalLoss = (totalDist / 1000) * 0.35 + hubCount * 10.5 + clientCount * 0.5 + spliceCount * 0.1;

    return {
        totalDistanceMeters: totalDist,
        fiberCost, hubCount, hubCost,
        clientCount, clientCost,
        spliceCount, spliceCost,
        totalCost,
        opticalLoss: parseFloat(opticalLoss.toFixed(2)),
        paths, nodes, bounds,
    };
}

function readCosts() {
    return {
        fiber:  parseFloat(document.getElementById('cost-fiber').value)  || 2.50,
        hub:    parseFloat(document.getElementById('cost-hub').value)    || 500,
        client: parseFloat(document.getElementById('cost-client').value) || 150,
    };
}

// ── GeoJSON export ────────────────────────────────────────────────────────────
function exportGeoJSON() {
    if (!currentExportData) return;
    const { nodes, paths, bounds } = currentExportData;
    const latStep = (bounds.north - bounds.south) / RESOLUTION;
    const lngStep = (bounds.east  - bounds.west)  / RESOLUTION;
    const features = [];

    nodes.forEach(n => features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
        properties: { type: n.type, id: n.id },
    }));

    paths.forEach(p => {
        const coords = p.path.map(c => [
            bounds.west  + (c.x + 0.5) * lngStep,
            bounds.south + (c.y + 0.5) * latStep,
        ]);
        features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coords },
            properties: { type: p.type },
        });
    });

    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'fiber_network.geojson';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

// ── History ───────────────────────────────────────────────────────────────────
async function refreshHistory(map, ui) {
    try {
        const history = await getHistory();
        ui.renderHistory(history, async (id) => {
            try {
                ui.setStatus('Loading saved route…', 'working');
                const detail = await getHistoryDetail(id);
                map.clearNodes();
                detail.nodes.forEach(n => {
                    const sizes   = { isp: [16,16], hub: [14,14], client: [12,12] };
                    const anchors = { isp: [8,8],   hub: [7,7],   client: [6,6] };
                    const icon = L.divIcon({
                        className: `node-${n.type}`,
                        iconSize:  sizes[n.type]   || [12,12],
                        iconAnchor: anchors[n.type] || [6,6],
                    });
                    const marker = L.marker([n.lat, n.lng], { icon }).addTo(map.map);
                    map.nodes.push({ id: n.id, latlng: L.latLng(n.lat, n.lng), marker, type: n.type });
                });
                const bounds = map.getBoundsObj();
                map.drawRoutes(detail.paths, bounds, RESOLUTION);
                map.drawSplicePoints(detail.paths, bounds, RESOLUTION);
                map.drawCoverageCircles();
                const bom = calcBOM(detail.paths, detail.nodes, bounds, readCosts());
                currentExportData = bom;
                ui.showBOM(bom, detail.algorithm);
                ui.setStatus(`Loaded: ${detail.algorithm} topology`, 'success');
                document.getElementById('history-drawer').classList.remove('open');
            } catch (e) {
                ui.setStatus('Failed to load saved route', 'error');
            }
        });
    } catch (e) {
        console.warn('History load failed:', e);
    }
}

// ── A/B Route Comparison ──────────────────────────────────────────────────────
async function runABComparison(map, ui, gridNodes, serializableGrid, bounds) {
    ui.setStatus('Running A/B comparison (A* vs MST)…', 'working');
    try {
        const [astarPaths, kruskalPaths] = await Promise.all([
            calculateRoute(serializableGrid, RESOLUTION, gridNodes, 'astar').catch(() => null),
            calculateRoute(serializableGrid, RESOLUTION, gridNodes, 'kruskal').catch(() => null),
        ]);
        map.drawABComparison(astarPaths, kruskalPaths, bounds, RESOLUTION);
        const astarBOM   = astarPaths   ? calcBOM(astarPaths,   gridNodes, bounds, readCosts()) : null;
        const kruskalBOM = kruskalPaths ? calcBOM(kruskalPaths, gridNodes, bounds, readCosts()) : null;
        ui.showABComparison(astarBOM, kruskalBOM);
        ui.setStatus('A/B comparison complete', 'success');
    } catch (err) {
        ui.setStatus(err.message || 'Comparison failed', 'error');
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const map = new MapManager('map');
    const ui  = new UIManager();

    currentWeightGrid = buildDefaultGrid();

    map.onNodeChange = nodes => ui.updateCalcButton(nodes);

    // ── Clear All ────────────────────────────────────────────────────────────
    ui.btnClear.addEventListener('click', () => {
        map.clearNodes();
        map.clearObstacles();
        map.clearHeatmap();
        ui.hideBOM();
        ui.setStatus('', '');
        currentExportData = null;
        currentFeatures   = [];
        currentWeightGrid = buildDefaultGrid();
        currentBounds     = null;
    });

    ui.btnExport.addEventListener('click', exportGeoJSON);

    // ── Fetch Obstacles ──────────────────────────────────────────────────────
    document.getElementById('btn-fetch-obstacles').addEventListener('click', async () => {
        const statusEl = document.getElementById('obstacle-status');

        // Snapshot the bounds NOW — everything downstream uses this same snapshot
        currentBounds = map.getBoundsObj();

        const osmData = await fetchOSMObstacles(currentBounds, statusEl);
        if (!osmData) {
            // Keep a fully-open grid if fetch failed; don't corrupt the old one
            currentFeatures   = [];
            currentWeightGrid = buildDefaultGrid();
            return;
        }

        currentFeatures   = overpassToFeatures(osmData);
        currentWeightGrid = rasterizeFeatures(currentFeatures, currentBounds);

        map.drawObstacles(currentFeatures);

        const bCount = currentFeatures.filter(f => f.properties.type === 'building').length;
        const rCount = currentFeatures.filter(f => f.properties.type === 'road').length;
        const wCount = currentFeatures.filter(f => f.properties.type === 'water').length;
        statusEl.textContent = `${bCount} buildings · ${rCount} roads · ${wCount} water`;
    });

    // ── Heatmap Toggle ───────────────────────────────────────────────────────
    document.getElementById('btn-heatmap').addEventListener('click', () => {
        // If no obstacles fetched yet, snapshot bounds now so heatmap matches
        const bounds = currentBounds || map.getBoundsObj();
        map.toggleHeatmap(currentWeightGrid, bounds, RESOLUTION);
    });

    // ── Calculate Route ──────────────────────────────────────────────────────
    ui.btnCalc.addEventListener('click', async () => {
        const algorithm = document.querySelector('input[name="algorithm"]:checked').value;

        // ── CRITICAL FIX ────────────────────────────────────────────────────
        // ALWAYS use the same bounds for:
        //   1. The weight grid (rasterized at fetch time into currentBounds)
        //   2. Converting node lat/lng → grid [x,y]
        //   3. Converting grid [x,y] → lat/lng for drawing
        //
        // If the user panned the map since fetching obstacles, re-rasterise
        // using the NEW bounds so everything stays aligned.
        const mapBounds = map.getBoundsObj();

        if (currentFeatures.length > 0) {
            // Check if map has moved significantly since last rasterisation
            const b  = currentBounds;
            const moved = !b
                || Math.abs(mapBounds.north - b.north) > 1e-6
                || Math.abs(mapBounds.south - b.south) > 1e-6
                || Math.abs(mapBounds.east  - b.east)  > 1e-6
                || Math.abs(mapBounds.west  - b.west)  > 1e-6;

            if (moved) {
                // Re-rasterise with current view so grid ↔ node coords align
                currentBounds     = mapBounds;
                currentWeightGrid = rasterizeFeatures(currentFeatures, currentBounds);
                // Re-draw obstacle polygons in the new view
                map.drawObstacles(currentFeatures);
            }
        } else {
            // No obstacles fetched → just use the current view
            currentBounds = mapBounds;
        }

        // From here on, use `currentBounds` exclusively
        const bounds  = currentBounds;
        const latStep = (bounds.north - bounds.south) / RESOLUTION;
        const lngStep = (bounds.east  - bounds.west)  / RESOLUTION;

        // Project node lat/lng into the SAME grid space as the weight grid
        const gridNodes = map.nodes.map(n => ({
            id:  n.id,
            x:   Math.max(0, Math.min(RESOLUTION - 1, Math.floor((n.latlng.lng - bounds.west)  / lngStep))),
            y:   Math.max(0, Math.min(RESOLUTION - 1, Math.floor((n.latlng.lat - bounds.south) / latStep))),
            lat: n.latlng.lat,
            lng: n.latlng.lng,
            type: n.type,
        }));

        // Guarantee node cells are walkable (in case a node was placed on a building)
        gridNodes.forEach(n => { currentWeightGrid[n.y][n.x] = W.OPEN; });

        // Serialise for JSON (Float32Array → plain number array)
        const serializableGrid = gridToSerializable(currentWeightGrid);

        // Console debug: sample a few grid values to verify obstacles are present
        const blockedCount = serializableGrid.flat().filter(v => v === 0).length;
        const roadCount    = serializableGrid.flat().filter(v => v === W.ROAD).length;
        console.log(`[FiberPath] Grid: ${blockedCount} blocked cells, ${roadCount} road cells, bounds=`, bounds);

        if (algorithm === 'compare') {
            await runABComparison(map, ui, gridNodes, serializableGrid, bounds);
            await refreshHistory(map, ui);
            return;
        }

        ui.setStatus('Calculating terrain-aware route…', 'working');
        try {
            const paths = await calculateRoute(serializableGrid, RESOLUTION, gridNodes, algorithm);

            // Draw using the SAME bounds as node projection
            map.drawRoutes(paths, bounds, RESOLUTION);
            map.drawSplicePoints(paths, bounds, RESOLUTION);
            map.drawCoverageCircles();

            const bom = calcBOM(paths, gridNodes, bounds, readCosts());
            currentExportData = bom;
            ui.showBOM(bom, algorithm);
            ui.setStatus('Route calculated — obstacles avoided ✓', 'success');
            await refreshHistory(map, ui);
        } catch (err) {
            console.error('[FiberPath] Route error:', err);
            ui.setStatus(err.message || 'Calculation failed', 'error');
        }
    });

    refreshHistory(map, ui);
});
