import { MapManager } from './components/map.js';
import { UIManager } from './components/ui.js';
import { calculateRoute, getHistory, getHistoryDetail } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    const mapManager = new MapManager('map');
    const uiManager = new UIManager();

    const RESOLUTION = 100; // 100x100 routing grid
    let currentExportData = null; // Store data for GeoJSON export
    
    function calculateAdvancedMetrics(paths, nodes, bounds, resolution) {
        let totalDistanceMeters = 0;
        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east - bounds.west) / resolution;
        
        paths.forEach(p => {
            const latlngs = p.path.map(coord => [
                bounds.south + (coord.y + 0.5) * latStep,
                bounds.west + (coord.x + 0.5) * lngStep
            ]);
            for (let i = 0; i < latlngs.length - 1; i++) {
                const ll1 = L.latLng(latlngs[i][0], latlngs[i][1]);
                const ll2 = L.latLng(latlngs[i+1][0], latlngs[i+1][1]);
                totalDistanceMeters += ll1.distanceTo(ll2);
            }
        });
        
        totalDistanceMeters = Math.round(totalDistanceMeters);
        
        const hubCount = nodes.filter(n => n.type === 'hub').length;
        const clientCount = nodes.filter(n => n.type === 'client').length;
        
        const fiberCost = totalDistanceMeters * 2.50; // $2.50 per meter
        const hubCost = hubCount * 500; // $500 per hub
        const clientCost = clientCount * 150; // $150 per client termination
        const totalCost = fiberCost + hubCost + clientCost;
        
        // Optical loss: 0.35 dB/km + 10.5 dB per hub (1x8 splitter) + 0.5 dB per client
        const opticalLoss = ((totalDistanceMeters / 1000) * 0.35) + (hubCount * 10.5) + (clientCount * 0.5);
        
        return {
            totalDistanceMeters,
            fiberCost,
            hubCount,
            hubCost,
            clientCount,
            clientCost,
            totalCost,
            opticalLoss: parseFloat(opticalLoss.toFixed(2)),
            paths,
            nodes,
            bounds
        };
    }

    function exportToGeoJSON() {
        if (!currentExportData) return;
        
        const features = [];
        
        // Add nodes
        currentExportData.nodes.forEach(n => {
            features.push({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [n.lng, n.lat]
                },
                "properties": {
                    "type": n.type,
                    "id": n.id
                }
            });
        });
        
        // Add paths
        const latStep = (currentExportData.bounds.north - currentExportData.bounds.south) / RESOLUTION;
        const lngStep = (currentExportData.bounds.east - currentExportData.bounds.west) / RESOLUTION;
        
        currentExportData.paths.forEach(p => {
            const coordinates = p.path.map(coord => [
                currentExportData.bounds.west + (coord.x + 0.5) * lngStep,
                currentExportData.bounds.south + (coord.y + 0.5) * latStep
            ]);
            features.push({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates
                },
                "properties": {
                    "type": p.type
                }
            });
        });
        
        const geojson = {
            "type": "FeatureCollection",
            "features": features
        };
        
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(geojson, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "fiber_network.geojson");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    // Load Initial History
    async function refreshHistory() {
        const history = await getHistory();
        uiManager.renderHistory(history, async (id) => {
            try {
                uiManager.setWorking('Loading saved connection...');
                const detail = await getHistoryDetail(id);
                
                // Clear current and reconstruct nodes
                mapManager.clearNodes();
                detail.nodes.forEach(n => {
                    const iconClass = `${n.type}-node`;
                    const size = n.type === 'isp' ? 16 : n.type === 'hub' ? 14 : 12;
                    const icon = L.divIcon({ className: iconClass, iconSize: [size, size] });
                    const marker = L.marker([n.lat, n.lng], { icon }).addTo(mapManager.map);
                    
                    mapManager.nodes.push({
                        id: n.id,
                        latlng: L.latLng(n.lat, n.lng),
                        marker: marker,
                        type: n.type
                    });
                });
                
                const bounds = mapManager.getBoundsObj();
                mapManager.drawRoutes(detail.paths, bounds, RESOLUTION);
                
                const bomData = calculateAdvancedMetrics(detail.paths, detail.nodes, bounds, RESOLUTION);
                currentExportData = bomData;
                uiManager.showBOM(bomData);
                uiManager.setSuccess(`Loaded ${detail.algorithm} route from history.`);
            } catch (err) {
                uiManager.setError('Failed to load history');
            }
        });
    }

    refreshHistory();
    
    // Wire up UI events
    uiManager.btnExport.addEventListener('click', exportToGeoJSON);

    mapManager.onNodeChange = (nodes) => {
        uiManager.updateCalcButton(nodes);
    };

    uiManager.btnClear.addEventListener('click', () => {
        mapManager.clearNodes();
        uiManager.hideBOM();
        currentExportData = null;
    });

    uiManager.btnCalc.addEventListener('click', async () => {
        uiManager.setWorking('Calculating Route via Backend...');
        
        try {
            const algorithm = document.querySelector('input[name="algorithm"]:checked').value;
            const bounds = mapManager.getBoundsObj();
            
            // Map lat/lng to grid coordinates
            const latStep = (bounds.north - bounds.south) / RESOLUTION;
            const lngStep = (bounds.east - bounds.west) / RESOLUTION;
            
            const gridNodes = mapManager.nodes.map(n => {
                let x = Math.floor((n.latlng.lng - bounds.west) / lngStep);
                let y = Math.floor((n.latlng.lat - bounds.south) / latStep);
                x = Math.max(0, Math.min(RESOLUTION - 1, x));
                y = Math.max(0, Math.min(RESOLUTION - 1, y));
                return {
                    id: n.id,
                    x: x,
                    y: y,
                    lat: n.latlng.lat,
                    lng: n.latlng.lng,
                    type: n.type
                };
            });

            // Create empty grid (all true/1) for walkable space
            // In a full implementation, you'd integrate the OSM obstacles here
            const grid = Array(RESOLUTION).fill().map(() => Array(RESOLUTION).fill(true));

            // Call Backend API
            const paths = await calculateRoute(grid, RESOLUTION, gridNodes, algorithm);
            
            // Draw Results
            mapManager.drawRoutes(paths, bounds, RESOLUTION);
            
            // Calculate advanced BOM
            const bomData = calculateAdvancedMetrics(paths, gridNodes, bounds, RESOLUTION);
            currentExportData = bomData;
            uiManager.showBOM(bomData);
            
            uiManager.setSuccess('Route calculation complete!');
            
            // Refresh history
            refreshHistory();
            
        } catch (error) {
            console.error(error);
            uiManager.setError(error.message || 'Routing failed');
        }
    });
});
