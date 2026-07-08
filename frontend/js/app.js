// FiberPath Pro — app.js v11 (Industry Edition)
// Features: undo/redo, geocoding, project save/load, keyboard shortcuts,
//           loading overlay, CSV export, terrain-aware cost model

import { MapManager }  from './components/map.js?v=11';
import { UIManager }   from './components/ui.js?v=11';
import { calculateRoute, getHistory, getHistoryDetail, deleteHistory, geocodeAddress, getStats } from './api.js?v=11';

const RESOLUTION = 150;  // 150x150 grid — finer accuracy, still fast with PQ-based A*

// ── Obstacle weights ─────────────────────────────────────────────────────────
// moveCost in A* = base × cellWeight → LOWER weight = CHEAPER = preferred
//   Roads     0.7  → cheaper than open → fiber follows roads   ✓
//   Open      1.0  → baseline                                  ✓
//   BldgEdge  5.0  → expensive → routes AVOID building edges   ✓  (was 0.05 → BUG: routes went INTO buildings)
//   Blocked   0.0  → impassable                                ✓
const W = {
    ROAD:          0.7,
    ROAD_BUFFER:   0.85,
    OPEN:          1.0,
    BUILDING_EDGE: 5.0,   // HIGH cost = routes avoid building perimeters
    BLOCKED:       0.0,   // impassable
};

// ── Cost model (per metre, terrain-aware) ─────────────────────────────────────
const TRENCH_COST = {
    ROAD:  1.20,   // road-adjacent (council permit required, harder)
    OPEN:  1.00,   // open land baseline
};

// ── State ────────────────────────────────────────────────────────────────────
let currentExportData = null;
let currentFeatures   = [];
let currentWeightGrid = null;
let currentBounds     = null;
let undoStack = [];

// ── Grid helpers ─────────────────────────────────────────────────────────────
function buildDefaultGrid() {
    return Array.from({ length: RESOLUTION }, () => new Float32Array(RESOLUTION).fill(W.OPEN));
}

function gridToSerializable(grid) {
    return Array.from(grid, row => Array.from(row, v => +v));
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────
function snapshotNodes(map) {
    undoStack.push(map.nodes.map(n => ({
        id:     n.id,
        latlng: { lat: n.latlng.lat, lng: n.latlng.lng },
        type:   n.type,
        label:  n.label,
    })));
    if (undoStack.length > 30) undoStack.shift();
}

function undoLastNode(map, ui) {
    if (undoStack.length === 0) { ui.toast('Nothing to undo', 'info', 2000); return; }
    const snapshot = undoStack.pop();

    // Remove all current markers
    map.nodes.forEach(n => map.map.removeLayer(n.marker));
    map.nodes = [];

    // Restore snapshot
    snapshot.forEach(n => {
        map._addNode(n.type, L.latLng(n.latlng.lat, n.latlng.lng), n.id, n.label);
    });
    if (map.onNodeChange) map.onNodeChange(map.nodes);
    ui.toast('Undo node placement', 'info', 1800);
}

// ── Point-in-polygon (ray-casting) ───────────────────────────────────────────
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

// ── Grid rasterizer (accurate: checks cell corners + centre) ─────────────────
function rasterizeFeatures(features, bounds) {
    const grid    = buildDefaultGrid();
    const latSpan = bounds.north - bounds.south;
    const lngSpan = bounds.east  - bounds.west;

    // Convert lat/lng to fractional grid coords
    function toGrid(lat, lng) {
        return [
            ((lng - bounds.west)  / lngSpan) * RESOLUTION,
            ((lat - bounds.south) / latSpan) * RESOLUTION,
        ];
    }

    // Bresenham line fill between two grid points (for road centre-lines)
    function bresenham(x0,y0,x1,y1, fn) {
        let ddx=Math.abs(x1-x0), ddy=Math.abs(y1-y0);
        let sx=x0<x1?1:-1, sy=y0<y1?1:-1, err=ddx-ddy;
        while (true) {
            fn(x0,y0);
            if (x0===x1&&y0===y1) break;
            let e2=2*err;
            if (e2>-ddy){err-=ddy;x0+=sx;}
            if (e2< ddx){err+=ddx;y0+=sy;}
        }
    }

    features.forEach(f => {
        const geom = f.geometry;
        const type = (f.properties && f.properties.type) || '';

        if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
            const rings = geom.type === 'Polygon'
                ? [geom.coordinates[0]]
                : geom.coordinates.map(p => p[0]);

            rings.forEach(ring => {
                const gridRing = ring.map(([lng, lat]) => toGrid(lat, lng));

                // Bounding box in grid space
                let minGx=Infinity,maxGx=-Infinity,minGy=Infinity,maxGy=-Infinity;
                for (const [gx,gy] of gridRing) {
                    if(gx<minGx)minGx=gx; if(gx>maxGx)maxGx=gx;
                    if(gy<minGy)minGy=gy; if(gy>maxGy)maxGy=gy;
                }
                const x0=Math.max(0,Math.floor(minGx)), x1=Math.min(RESOLUTION-1,Math.ceil(maxGx));
                const y0=Math.max(0,Math.floor(minGy)), y1=Math.min(RESOLUTION-1,Math.ceil(maxGy));
                if (x1<x0||y1<y0) return;

                // For each candidate cell, test CENTRE and all 4 CORNERS
                // A cell is inside the polygon if its centre OR any corner is inside
                for (let gy=y0; gy<=y1; gy++) {
                    for (let gx=x0; gx<=x1; gx++) {
                        // Test 5 sample points: centre + 4 corners
                        const samples = [
                            [gx+0.5, gy+0.5],  // centre
                            [gx+0.1, gy+0.1],  // bottom-left
                            [gx+0.9, gy+0.1],  // bottom-right
                            [gx+0.1, gy+0.9],  // top-left
                            [gx+0.9, gy+0.9],  // top-right
                        ];
                        const inside = samples.some(([px,py]) => pointInPolygon(px, py, gridRing));
                        if (inside && (type==='building'||type==='water')) {
                            grid[gy][gx] = W.BLOCKED;
                        }
                    }
                }

                // Building edge halo (mark adjacent open cells as expensive)
                if (type === 'building') {
                    const border = [];
                    const sx0=Math.max(0,x0-2), sx1=Math.min(RESOLUTION-1,x1+2);
                    const sy0=Math.max(0,y0-2), sy1=Math.min(RESOLUTION-1,y1+2);
                    for (let gy=sy0; gy<=sy1; gy++) {
                        for (let gx=sx0; gx<=sx1; gx++) {
                            if (grid[gy][gx]===W.BLOCKED) {
                                for (let dy=-2; dy<=2; dy++) for (let dx=-2; dx<=2; dx++) {
                                    const nx=gx+dx, ny=gy+dy;
                                    if (nx>=0&&nx<RESOLUTION&&ny>=0&&ny<RESOLUTION
                                        && grid[ny][nx]!==W.BLOCKED)
                                        border.push([nx,ny]);
                                }
                            }
                        }
                    }
                    // Mark building edges as high-cost (routes avoid them)
                    border.forEach(([nx,ny]) => {
                        if (grid[ny][nx]!==W.BLOCKED) grid[ny][nx] = W.BUILDING_EDGE;
                    });
                }
            });
        }

        if (geom.type === 'LineString' && type === 'road') {
            const coords = geom.coordinates;
            for (let i=0; i<coords.length-1; i++) {
                const [gx0f,gy0f] = toGrid(coords[i][1],   coords[i][0]);
                const [gx1f,gy1f] = toGrid(coords[i+1][1], coords[i+1][0]);
                const rx0=Math.round(gx0f), ry0=Math.round(gy0f);
                const rx1=Math.round(gx1f), ry1=Math.round(gy1f);

                bresenham(rx0,ry0,rx1,ry1, (gx,gy) => {
                    if (gx>=0&&gx<RESOLUTION&&gy>=0&&gy<RESOLUTION) {
                        if (grid[gy][gx]!==W.BLOCKED) grid[gy][gx] = W.ROAD;
                        // Road buffer (1-cell wide halo around roads)
                        for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
                            const nx=gx+dx, ny=gy+dy;
                            if (nx>=0&&nx<RESOLUTION&&ny>=0&&ny<RESOLUTION
                                && grid[ny][nx]===W.OPEN)
                                grid[ny][nx] = W.ROAD_BUFFER;
                        }
                    }
                });
            }
        }
    });

    return grid;
}

// ── OSM fetch ─────────────────────────────────────────────────────────────────
async function fetchOSMObstacles(bounds, ui) {
    const { south, west, north, east } = bounds;
    const bbox  = `${south},${west},${north},${east}`;
    const query = `[out:json][timeout:25];(way["building"](${bbox});way["natural"="water"](${bbox});way["waterway"="riverbank"](${bbox});way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service)$"](${bbox}););out body;>;out skel qt;`;

    ui.setStatus('Fetching OSM data…', 'working');
    document.getElementById('obstacle-status').textContent = 'Fetching from OpenStreetMap…';

    try {
        const resp = await fetch('/api/osm-proxy-raw', { method: 'POST', body: 'data=' + encodeURIComponent(query) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.elements || data.elements.length === 0) {
            ui.toast('No OSM elements found — try zooming in more', 'warning');
            document.getElementById('obstacle-status').textContent = 'No elements found';
            return null;
        }
        document.getElementById('obstacle-status').textContent = `Fetched ${data.elements.length} elements ✓`;
        return data;
    } catch (e) {
        ui.toast(`OSM fetch failed: ${e.message}`, 'error');
        document.getElementById('obstacle-status').textContent = 'Fetch failed';
        return null;
    }
}

// ── Overpass JSON → GeoJSON ────────────────────────────────────────────────────
function overpassToFeatures(data) {
    if (!data || !data.elements) return [];
    const nodeMap = {};
    data.elements.filter(e => e.type === 'node').forEach(e => { nodeMap[e.id] = [e.lon, e.lat]; });
    const features = [];
    data.elements.filter(e => e.type === 'way').forEach(way => {
        const coords = (way.nodes || []).map(id => nodeMap[id]).filter(Boolean);
        if (coords.length < 2) return;
        const tags = way.tags || {};
        let type = 'unknown';
        if (tags.building) type = 'building';
        else if (tags.natural === 'water' || tags.waterway) type = 'water';
        else if (tags.highway) type = 'road';
        if (type === 'unknown') return;
        const isClosed = coords.length > 2 && coords[0][0] === coords[coords.length-1][0] && coords[0][1] === coords[coords.length-1][1];
        features.push({
            geometry: { type: (isClosed && type !== 'road') ? 'Polygon' : 'LineString', coordinates: (isClosed && type !== 'road') ? [coords] : coords },
            properties: { type },
        });
    });
    return features;
}

// ── BOM calculation (terrain-aware) ──────────────────────────────────────────
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

    return { totalDistanceMeters: totalDist, fiberCost, hubCount, hubCost, clientCount, clientCost, spliceCount, spliceCost, totalCost, opticalLoss: parseFloat(opticalLoss.toFixed(2)), paths, nodes, bounds };
}

function readCosts() {
    return {
        fiber:  parseFloat(document.getElementById('cost-fiber')?.value)  || 2.50,
        hub:    parseFloat(document.getElementById('cost-hub')?.value)    || 500,
        client: parseFloat(document.getElementById('cost-client')?.value) || 150,
    };
}

// ── GeoJSON export ────────────────────────────────────────────────────────────
function exportGeoJSON() {
    if (!currentExportData) return;
    const { nodes, paths, bounds } = currentExportData;
    const latStep = (bounds.north - bounds.south) / RESOLUTION;
    const lngStep = (bounds.east  - bounds.west)  / RESOLUTION;
    const features = [];
    nodes.forEach(n => features.push({ type:'Feature', geometry:{ type:'Point', coordinates:[n.lng, n.lat] }, properties:{ type:n.type, id:n.id, label:n.label } }));
    paths.forEach(p => {
        const coords = p.path.map(c => [bounds.west + (c.x + 0.5) * lngStep, bounds.south + (c.y + 0.5) * latStep]);
        features.push({ type:'Feature', geometry:{ type:'LineString', coordinates:coords }, properties:{ type:p.type } });
    });
    _downloadFile(JSON.stringify({ type:'FeatureCollection', features }, null, 2), 'fiber_network.geojson', 'application/json');
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV(bom) {
    const rows = [
        ['Item', 'Quantity', 'Unit', 'Unit Cost (USD)', 'Total (USD)'],
        ['Fiber Cable', bom.totalDistanceMeters, 'metres', readCosts().fiber.toFixed(2), bom.fiberCost.toFixed(2)],
        ['Splitter Hub', bom.hubCount, 'units', readCosts().hub.toFixed(2), bom.hubCost.toFixed(2)],
        ['Client Termination', bom.clientCount, 'units', readCosts().client.toFixed(2), bom.clientCost.toFixed(2)],
        ['Splice Point', bom.spliceCount, 'units', '50.00', bom.spliceCost.toFixed(2)],
        ['', '', '', 'TOTAL CapEx', bom.totalCost.toFixed(2)],
        ['', '', '', 'Optical Loss (dB)', bom.opticalLoss],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    _downloadFile(csv, 'fiberpath_bom.csv', 'text/csv');
}

function _downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

// ── Project save/load ─────────────────────────────────────────────────────────
function saveProject(map) {
    const project = {
        version: 2,
        savedAt: new Date().toISOString(),
        nodes:   map.nodes.map(n => ({ id: n.id, lat: n.latlng.lat, lng: n.latlng.lng, type: n.type, label: n.label })),
        bounds:  currentBounds,
        costs:   readCosts(),
    };
    _downloadFile(JSON.stringify(project, null, 2), 'fiberpath_project.json', 'application/json');
}

function loadProject(map, ui, file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const project = JSON.parse(e.target.result);
            if (!project.nodes) throw new Error('Invalid project file');
            map.clearNodes();
            project.nodes.forEach(n => {
                map._addNode(n.type, L.latLng(n.lat, n.lng), n.id, n.label);
            });
            if (map.onNodeChange) map.onNodeChange(map.nodes);
            // Restore cost inputs
            if (project.costs) {
                document.getElementById('cost-fiber').value  = project.costs.fiber  || 2.50;
                document.getElementById('cost-hub').value    = project.costs.hub    || 500;
                document.getElementById('cost-client').value = project.costs.client || 150;
            }
            map.fitToNodes();
            ui.toast('Project loaded successfully', 'success');
        } catch (err) {
            ui.toast(`Failed to load project: ${err.message}`, 'error');
        }
    };
    reader.readAsText(file);
}

// ── History ───────────────────────────────────────────────────────────────────
async function refreshHistory(map, ui) {
    try {
        const history = await getHistory();
        ui.renderHistory(
            history,
            async (id) => {
                try {
                    ui.showLoading('Loading saved route…');
                    const detail = await getHistoryDetail(id);
                    map.clearNodes();
                    detail.nodes.forEach(n => {
                        map._addNode(n.type, L.latLng(n.lat, n.lng), n.id, n.label);
                    });
                    const bounds = map.getBoundsObj();
                    map.drawRoutes(detail.paths, bounds, RESOLUTION);
                    map.drawSplicePoints(detail.paths, bounds, RESOLUTION);
                    map.drawCoverageCircles();
                    const bom = calcBOM(detail.paths, detail.nodes, bounds, readCosts());
                    currentExportData = bom;
                    ui.showBOM(bom, detail.algorithm);
                    ui.setStatus(`Loaded: ${detail.name || detail.algorithm} topology`, 'success');
                    document.getElementById('history-drawer').classList.remove('open');
                    ui.toast(`Loaded "${detail.name || detail.algorithm}" route`, 'success');
                } catch (err) {
                    ui.toast('Failed to load saved route', 'error');
                } finally {
                    ui.hideLoading();
                }
            },
            async (id) => {
                try {
                    await deleteHistory(id);
                    ui.toast('Route deleted', 'info');
                } catch (err) {
                    ui.toast('Delete failed', 'error');
                }
            }
        );
    } catch (e) {
        console.warn('History load failed:', e);
    }
}

// ── A/B Comparison ────────────────────────────────────────────────────────────
async function runABComparison(map, ui, gridNodes, serializableGrid, bounds) {
    ui.showLoading('Running A/B comparison…');
    try {
        const [aRes, kRes] = await Promise.all([
            calculateRoute(serializableGrid, RESOLUTION, gridNodes, 'astar').catch(() => null),
            calculateRoute(serializableGrid, RESOLUTION, gridNodes, 'kruskal').catch(() => null),
        ]);
        const astarPaths   = aRes?.paths   || null;
        const kruskalPaths = kRes?.paths   || null;
        map.drawABComparison(astarPaths, kruskalPaths, bounds, RESOLUTION);
        const astarBOM   = astarPaths   ? calcBOM(astarPaths,   gridNodes, bounds, readCosts()) : null;
        const kruskalBOM = kruskalPaths ? calcBOM(kruskalPaths, gridNodes, bounds, readCosts()) : null;
        ui.showABComparison(astarBOM, kruskalBOM);
        ui.setStatus('A/B comparison complete', 'success');
        ui.toast('A/B comparison complete', 'success');
    } catch (err) {
        ui.toast(err.message || 'Comparison failed', 'error');
        ui.setStatus(err.message || 'Comparison failed', 'error');
    } finally {
        ui.hideLoading();
    }
}

// ── Geocoding search ──────────────────────────────────────────────────────────
let geocodeDebounce = null;
function initGeocodingSearch(map, ui) {
    const searchInput   = document.getElementById('geocode-input');
    const searchResults = document.getElementById('geocode-results');
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
        clearTimeout(geocodeDebounce);
        const q = searchInput.value.trim();
        if (q.length < 3) { searchResults.style.display = 'none'; return; }

        geocodeDebounce = setTimeout(async () => {
            const results = await geocodeAddress(q);
            if (results.length === 0) { searchResults.style.display = 'none'; return; }
            searchResults.innerHTML = '';
            results.slice(0, 5).forEach(r => {
                const li = document.createElement('div');
                li.className = 'geocode-item';
                li.textContent = r.display_name;
                li.addEventListener('click', () => {
                    map.jumpTo(r.lat, r.lng, 15);
                    searchInput.value = r.display_name.split(',').slice(0, 2).join(',');
                    searchResults.style.display = 'none';
                    ui.toast(`Navigated to ${searchInput.value}`, 'info', 2000);
                });
                searchResults.appendChild(li);
            });
            searchResults.style.display = 'block';
        }, 400);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !searchResults.contains(e.target))
            searchResults.style.display = 'none';
    });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function initKeyboardShortcuts(map, ui) {
    document.addEventListener('keydown', async (e) => {
        // Don't fire on input fields
        if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;

        switch (e.key.toLowerCase()) {
            case 'z':
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    snapshotNodes(map);   // snapshot current before undo
                    undoLastNode(map, ui);
                }
                break;
            case 'f':
                document.getElementById('btn-fetch-obstacles')?.click();
                break;
            case 'h':
                map.toggleHeatmap(currentWeightGrid, currentBounds || map.getBoundsObj(), RESOLUTION);
                break;
            case 'escape':
                document.getElementById('history-drawer')?.classList.remove('open');
                map._closeContextMenu?.();
                break;
            case 'd':
                document.getElementById('btn-dark-toggle')?.click();
                break;
            case 'g':
                document.getElementById('geocode-input')?.focus();
                break;
        }
        if (e.key === 'Enter' && !e.ctrlKey) {
            const btn = document.getElementById('btn-calculate');
            if (btn && !btn.disabled) btn.click();
        }
    });
}

// ── Dark mode ─────────────────────────────────────────────────────────────────
function initDarkMode() {
    const btn  = document.getElementById('btn-dark-toggle');
    const html = document.documentElement;
    const stored = localStorage.getItem('fiberpath-dark');
    if (stored === 'true' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        html.setAttribute('data-theme', 'dark');
        if (btn) btn.title = 'Light mode (D)';
    }
    if (!btn) return;
    btn.addEventListener('click', () => {
        const isDark = html.getAttribute('data-theme') === 'dark';
        html.setAttribute('data-theme', isDark ? 'light' : 'dark');
        localStorage.setItem('fiberpath-dark', String(!isDark));
        btn.title = isDark ? 'Dark mode (D)' : 'Light mode (D)';
    });
}

// ── Main ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const map = new MapManager('map');
    const ui  = new UIManager();

    currentWeightGrid = buildDefaultGrid();

    initDarkMode();
    initGeocodingSearch(map, ui);
    initKeyboardShortcuts(map, ui);

    // ── Node placement with undo snapshot ───────────────────────────────────
    const origAddNode = map._addNode.bind(map);
    map._onMapClick = (e) => {
        map._closeContextMenu();
        const type = (document.querySelector('input[name="nodeType"]:checked') || {}).value || 'client';
        snapshotNodes(map);  // snapshot before adding
        if (type === 'isp') {
            const idx = map.nodes.findIndex(n => n.type === 'isp');
            if (idx > -1) { map.map.removeLayer(map.nodes[idx].marker); map.nodes.splice(idx, 1); }
        }
        origAddNode(type, e.latlng);
        if (map.onNodeChange) map.onNodeChange(map.nodes);
    };

    map.onNodeChange = nodes => ui.updateCalcButton(nodes);

    // ── Clear ────────────────────────────────────────────────────────────────
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
        undoStack         = [];
        ui.toast('Canvas cleared', 'info', 1800);
    });

    // ── Export GeoJSON ───────────────────────────────────────────────────────
    ui.btnExport.addEventListener('click', () => {
        if (!currentExportData) { ui.toast('Run a calculation first', 'warning'); return; }
        exportGeoJSON();
        ui.toast('GeoJSON exported', 'success', 2000);
    });

    // ── Export CSV ───────────────────────────────────────────────────────────
    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
        if (!currentExportData) { ui.toast('Run a calculation first', 'warning'); return; }
        exportCSV(currentExportData);
        ui.toast('BOM exported as CSV', 'success', 2000);
    });

    // ── Project Save ─────────────────────────────────────────────────────────
    document.getElementById('btn-save-project')?.addEventListener('click', () => {
        saveProject(map);
        ui.toast('Project saved as JSON', 'success', 2000);
    });

    // ── Project Load ─────────────────────────────────────────────────────────
    document.getElementById('btn-load-project')?.addEventListener('click', () => {
        document.getElementById('project-file-input')?.click();
    });
    document.getElementById('project-file-input')?.addEventListener('change', (e) => {
        if (e.target.files[0]) loadProject(map, ui, e.target.files[0]);
        e.target.value = '';
    });

    // ── Fit to nodes ─────────────────────────────────────────────────────────
    document.getElementById('btn-fit-nodes')?.addEventListener('click', () => {
        if (map.nodes.length === 0) { ui.toast('Place nodes first', 'warning', 2000); return; }
        map.fitToNodes();
        ui.toast('Fit to nodes', 'info', 1500);
    });

    // ── Fetch Obstacles ──────────────────────────────────────────────────────
    document.getElementById('btn-fetch-obstacles').addEventListener('click', async () => {
        currentBounds = map.getBoundsObj();
        const osmData = await fetchOSMObstacles(currentBounds, ui);
        if (!osmData) {
            currentFeatures   = [];
            currentWeightGrid = buildDefaultGrid();
            return;
        }
        currentFeatures   = overpassToFeatures(osmData);
        currentWeightGrid = rasterizeFeatures(currentFeatures, currentBounds);
        map.drawObstacles(currentFeatures);
        const b = currentFeatures.filter(f => f.properties.type === 'building').length;
        const r = currentFeatures.filter(f => f.properties.type === 'road').length;
        const w = currentFeatures.filter(f => f.properties.type === 'water').length;
        document.getElementById('obstacle-status').textContent = `${b} buildings · ${r} roads · ${w} water`;
        ui.toast(`Loaded ${b} buildings, ${r} roads, ${w} water bodies`, 'success');
        ui.setStatus('Obstacles loaded ✓', 'success');
    });

    // ── Heatmap ──────────────────────────────────────────────────────────────
    document.getElementById('btn-heatmap').addEventListener('click', () => {
        const bounds = currentBounds || map.getBoundsObj();
        map.toggleHeatmap(currentWeightGrid, bounds, RESOLUTION);
    });

    // ── Calculate Route ──────────────────────────────────────────────────────
    ui.btnCalc.addEventListener('click', async () => {
        const algorithm = document.querySelector('input[name="algorithm"]:checked').value;
        const mapBounds = map.getBoundsObj();

        // ── Auto-fetch obstacles if not already loaded ────────────────────────
        // Obstacles are REQUIRED for accurate routing — auto-fetch if missing
        // or if the map has panned/zoomed significantly since the last fetch.
        const needFetch = currentFeatures.length === 0;
        const moved = !needFetch && currentBounds && (
            Math.abs(mapBounds.north - currentBounds.north) > 1e-6 ||
            Math.abs(mapBounds.south - currentBounds.south) > 1e-6 ||
            Math.abs(mapBounds.east  - currentBounds.east)  > 1e-6 ||
            Math.abs(mapBounds.west  - currentBounds.west)  > 1e-6
        );

        if (needFetch || moved) {
            if (needFetch)
                ui.toast('No obstacles loaded — auto-fetching from OSM…', 'info', 3500);
            else
                ui.toast('Map moved — re-fetching obstacles for new view…', 'info', 3000);

            ui.showLoading('Fetching obstacles from OpenStreetMap…');
            try {
                const osmData = await fetchOSMObstacles(mapBounds, ui);
                if (osmData) {
                    currentFeatures   = overpassToFeatures(osmData);
                    currentBounds     = mapBounds;
                    currentWeightGrid = rasterizeFeatures(currentFeatures, currentBounds);
                    map.drawObstacles(currentFeatures);
                    const bCount = currentFeatures.filter(f => f.properties.type === 'building').length;
                    const rCount = currentFeatures.filter(f => f.properties.type === 'road').length;
                    document.getElementById('obstacle-status').textContent =
                        `${bCount} buildings · ${rCount} roads (auto-fetched)`;
                    ui.toast(`Obstacles loaded: ${bCount} buildings, ${rCount} roads`, 'success');
                }
            } catch (err) {
                ui.toast('Failed to fetch obstacles — using open grid', 'warning');
                currentBounds     = mapBounds;
                currentWeightGrid = buildDefaultGrid();
            } finally {
                ui.hideLoading();
            }
        }


        const bounds  = currentBounds;
        const latStep = (bounds.north - bounds.south) / RESOLUTION;
        const lngStep = (bounds.east  - bounds.west)  / RESOLUTION;

        const gridNodes = map.nodes.map(n => ({
            id:   n.id,
            x:    Math.max(0, Math.min(RESOLUTION - 1, Math.floor((n.latlng.lng - bounds.west)  / lngStep))),
            y:    Math.max(0, Math.min(RESOLUTION - 1, Math.floor((n.latlng.lat - bounds.south) / latStep))),
            lat:  n.latlng.lat,
            lng:  n.latlng.lng,
            type: n.type,
            label: n.label,
        }));

        // ── Node clearance: open a 7×7 neighbourhood around every node ────────
        // This guarantees A* can always expand from a node even if the user
        // placed it inside a building footprint. The clearance fades from ROAD
        // (preferred, centre 1×1) → OPEN (neutral, inner ring) → leave outer
        // cells alone only if they were already open.
        gridNodes.forEach(n => {
            for (let dy = -3; dy <= 3; dy++) {
                for (let dx = -3; dx <= 3; dx++) {
                    const nx = Math.max(0, Math.min(RESOLUTION - 1, n.x + dx));
                    const ny = Math.max(0, Math.min(RESOLUTION - 1, n.y + dy));
                    const dist = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance
                    if (dist === 0) {
                        currentWeightGrid[ny][nx] = W.ROAD;   // node cell = very walkable
                    } else if (dist <= 1) {
                        // 3×3 core: force open (clear buildings)
                        if (currentWeightGrid[ny][nx] <= 0) currentWeightGrid[ny][nx] = W.OPEN;
                    } else {
                        // 5×5 and 7×7 outer ring: only clear completely blocked cells
                        if (currentWeightGrid[ny][nx] <= 0) currentWeightGrid[ny][nx] = W.ROAD_BUFFER;
                    }
                }
            }
        });
        const serializableGrid = gridToSerializable(currentWeightGrid);

        if (algorithm === 'compare') {
            await runABComparison(map, ui, gridNodes, serializableGrid, bounds);
            await refreshHistory(map, ui);
            return;
        }

        ui.showLoading('Computing terrain-aware route…');
        try {
            const result = await calculateRoute(serializableGrid, RESOLUTION, gridNodes, algorithm);
            const paths  = result.paths;
            map.drawRoutes(paths, bounds, RESOLUTION);
            map.drawSplicePoints(paths, bounds, RESOLUTION);
            map.drawCoverageCircles();
            const bom = calcBOM(paths, gridNodes, bounds, readCosts());
            currentExportData = bom;
            ui.showBOM(bom, algorithm);
            ui.setStatus('Route calculated — obstacles avoided ✓', 'success');
            ui.toast('Route calculated successfully!', 'success');
            await refreshHistory(map, ui);
        } catch (err) {
            ui.setStatus(err.message || 'Calculation failed', 'error');
            ui.toast(err.message || 'Calculation failed', 'error');
        } finally {
            ui.hideLoading();
        }
    });

    // ── History drawer ────────────────────────────────────────────────────────
    document.getElementById('history-btn')?.addEventListener('click', () => {
        document.getElementById('history-drawer').classList.toggle('open');
    });

    refreshHistory(map, ui);
});
