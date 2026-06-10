// Map Module

export class MapManager {
    constructor(containerId) {
        this.map = L.map(containerId).setView([12.935, 77.624], 16);
        this.nodes = [];
        this.routeLayer = null;
        this.obstacleLayer = null;
        
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
            maxZoom: 20
        }).addTo(this.map);

        L.Control.geocoder({ defaultMarkGeocode: false })
            .on('markgeocode', (e) => {
                this.map.fitBounds(e.geocode.bbox);
            }).addTo(this.map);
            
        this.map.on('click', (e) => this.handleMapClick(e));
        this.onNodeChange = null;
    }

    handleMapClick(e) {
        const type = document.querySelector('input[name="nodeType"]:checked').value;
        
        if (type === 'isp') {
            const existing = this.nodes.findIndex(n => n.type === 'isp');
            if (existing > -1) {
                this.map.removeLayer(this.nodes[existing].marker);
                this.nodes.splice(existing, 1);
            }
        }

        const iconClass = `${type}-node`;
        const size = type === 'isp' ? 16 : type === 'hub' ? 14 : 12;

        const icon = L.divIcon({ className: iconClass, iconSize: [size, size] });
        const marker = L.marker(e.latlng, { icon }).addTo(this.map);
        
        this.nodes.push({
            id: this.nodes.length,
            latlng: e.latlng,
            marker: marker,
            type: type
        });
        
        if (this.onNodeChange) this.onNodeChange(this.nodes);
    }

    clearNodes() {
        this.nodes.forEach(n => this.map.removeLayer(n.marker));
        this.nodes = [];
        if (this.routeLayer) {
            this.map.removeLayer(this.routeLayer);
            this.routeLayer = null;
        }
        if (this.onNodeChange) this.onNodeChange(this.nodes);
    }

    drawRoutes(paths, bounds, resolution) {
        if (this.routeLayer) this.map.removeLayer(this.routeLayer);
        
        const latStep = (bounds.north - bounds.south) / resolution;
        const lngStep = (bounds.east - bounds.west) / resolution;
        
        const lines = paths.flat().map(p => {
            const latlngs = p.path.map(coord => [
                bounds.south + (coord.y + 0.5) * latStep,
                bounds.west + (coord.x + 0.5) * lngStep
            ]);
            return L.polyline(latlngs, {
                color: p.type === 'backbone' ? '#10b981' : '#60a5fa', 
                weight: 4, 
                className: 'fiber-backbone'
            });
        });
        
        this.routeLayer = L.layerGroup(lines).addTo(this.map);
    }

    getBoundsObj() {
        let b;
        if (this.nodes.length > 0) {
            const group = new L.featureGroup(this.nodes.map(n => n.marker));
            b = group.getBounds().pad(0.2);
        } else {
            b = this.map.getBounds();
        }
        return {
            south: b.getSouth(), west: b.getWest(),
            north: b.getNorth(), east: b.getEast()
        };
    }
}
