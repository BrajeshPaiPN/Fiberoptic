// API Interface to FastAPI Backend

export async function calculateRoute(grid, resolution, nodes, algorithm) {
    try {
        const response = await fetch('/api/calculate-route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                grid,
                resolution,
                nodes,
                algorithm
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to calculate route');
        }

        const data = await response.json();
        if (data.status === 'error') {
            throw new Error(data.message);
        }
        return data.paths;
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}

export async function getHistory() {
    try {
        const response = await fetch('/api/history');
        if (!response.ok) throw new Error('Failed to fetch history');
        const data = await response.json();
        return data.history;
    } catch (error) {
        console.error("API Error:", error);
        return [];
    }
}

export async function getHistoryDetail(id) {
    try {
        const response = await fetch(`/api/history/${id}`);
        if (!response.ok) throw new Error('Failed to fetch history detail');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}
