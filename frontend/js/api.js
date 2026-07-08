// API Interface to FastAPI Backend — v11 (Industry Edition)

function extractErrorMessage(detail) {
    if (!detail) return 'Request failed';
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        const first = detail[0];
        if (first && first.msg) return `Validation: ${first.msg} (at ${(first.loc || []).join('.')})`;
        return `Validation error (${detail.length} issues)`;
    }
    return JSON.stringify(detail);
}

export async function calculateRoute(grid, resolution, nodes, algorithm, name = null) {
    const safeGrid = grid.map(row => {
        if (Array.isArray(row) || (row && typeof row[Symbol.iterator] === 'function'))
            return Array.from(row, cell => (typeof cell === 'number' && isFinite(cell)) ? cell : 1.0);
        return Array(resolution).fill(1.0);
    });

    let response;
    try {
        response = await fetch('/api/calculate-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grid: safeGrid, resolution, nodes, algorithm, name }),
        });
    } catch (e) {
        throw new Error('Network error — is the server running?');
    }

    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try { const d = await response.json(); detail = extractErrorMessage(d.detail); } catch (_) {}
        throw new Error(detail);
    }

    const data = await response.json();
    if (data.status === 'error') throw new Error(data.message || 'Calculation failed');
    return { paths: data.paths, routeId: data.route_id };
}

export async function getHistory() {
    try {
        const r = await fetch('/api/history');
        if (!r.ok) throw new Error('Failed to fetch history');
        const d = await r.json();
        return d.history || [];
    } catch (e) {
        console.warn('History fetch failed:', e.message);
        return [];
    }
}

export async function getHistoryDetail(id) {
    const r = await fetch(`/api/history/${id}`);
    if (!r.ok) throw new Error('Route not found');
    return await r.json();
}

export async function deleteHistory(id) {
    const r = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error('Delete failed');
    return await r.json();
}

export async function renameHistory(id, name) {
    const r = await fetch(`/api/history/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    if (!r.ok) throw new Error('Rename failed');
    return await r.json();
}

export async function getStats() {
    try {
        const r = await fetch('/api/stats');
        if (!r.ok) return null;
        return await r.json();
    } catch (e) {
        return null;
    }
}

export async function geocodeAddress(query) {
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
        const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!r.ok) return [];
        const results = await r.json();
        return results.map(item => ({
            display_name: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            bbox: item.boundingbox,   // [south, north, west, east]
        }));
    } catch (e) {
        console.warn('Geocoding failed:', e.message);
        return [];
    }
}
