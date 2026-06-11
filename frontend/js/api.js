// API Interface to FastAPI Backend — v9

function extractErrorMessage(detail) {
    if (!detail) return 'Request failed';
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
        const first = detail[0];
        if (first && first.msg) {
            return `Validation error: ${first.msg} (at ${(first.loc || []).join('.')})`;
        }
        return `Validation error (${detail.length} issues)`;
    }
    return JSON.stringify(detail);
}

export async function calculateRoute(grid, resolution, nodes, algorithm) {
    // Ensure grid is a proper 2D plain number array — no Float32Array or objects
    const safeGrid = grid.map(row => {
        if (Array.isArray(row) || (row && typeof row[Symbol.iterator] === 'function')) {
            return Array.from(row, cell => (typeof cell === 'number' && isFinite(cell)) ? cell : 1.0);
        }
        return Array(resolution).fill(1.0);
    });

    let response;
    try {
        response = await fetch('/api/calculate-route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grid: safeGrid, resolution, nodes, algorithm })
        });
    } catch (e) {
        throw new Error('Network error — is the server running?');
    }

    if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
            const errorData = await response.json();
            detail = extractErrorMessage(errorData.detail);
        } catch (_) { /* ignore json parse failure */ }
        throw new Error(detail);
    }

    const data = await response.json();
    if (data.status === 'error') {
        throw new Error(data.message || 'Calculation failed');
    }
    return data.paths;
}

export async function getHistory() {
    try {
        const response = await fetch('/api/history');
        if (!response.ok) throw new Error('Failed to fetch history');
        const data = await response.json();
        return data.history || [];
    } catch (error) {
        console.warn('History fetch failed:', error.message);
        return [];
    }
}

export async function getHistoryDetail(id) {
    const response = await fetch(`/api/history/${id}`);
    if (!response.ok) throw new Error('Route not found');
    return await response.json();
}
