import { MapManager } from './components/map.js';
import { UIManager } from './components/ui.js';
import { calculateRoute, getHistory, getHistoryDetail } from './api.js';

document.addEventListener('DOMContentLoaded', async () => {
    const mapManager = new MapManager('map');
    const uiManager = new UIManager();

    const RESOLUTION = 100; // 100x100 routing grid
    
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
                uiManager.showBOM(detail.paths);
                uiManager.setSuccess(`Loaded ${detail.algorithm} route from history.`);
            } catch (err) {
                uiManager.setError('Failed to load history');
            }
        });
    }

    refreshHistory();
    
    // Wire up UI events
    mapManager.onNodeChange = (nodes) => {
        uiManager.updateCalcButton(nodes);
    };

    uiManager.btnClear.addEventListener('click', () => {
        mapManager.clearNodes();
        uiManager.hideBOM();
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
            uiManager.showBOM(paths);
            uiManager.setSuccess('Route calculation complete!');
            
            // Refresh history
            refreshHistory();
            
        } catch (error) {
            console.error(error);
            uiManager.setError(error.message || 'Routing failed');
        }
    });
});
