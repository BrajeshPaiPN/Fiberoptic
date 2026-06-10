// UI Component Manager

export class UIManager {
    constructor() {
        this.statusText = document.getElementById('route-status');
        this.btnCalc = document.getElementById('btn-calculate');
        this.btnClear = document.getElementById('btn-clear-nodes');
        this.bomSection = document.getElementById('bom-results');
        this.bomContent = document.getElementById('bom-content');
        this.obsStatus = document.getElementById('obstacle-status');
        this.historyList = document.getElementById('history-list');
    }

    setWorking(text) {
        this.statusText.className = 'status-text status-working';
        this.statusText.innerText = text;
        this.btnCalc.disabled = true;
    }

    setSuccess(text) {
        this.statusText.className = 'status-text status-success';
        this.statusText.innerText = text;
        this.btnCalc.disabled = false;
    }

    setError(text) {
        this.statusText.className = 'status-text status-error';
        this.statusText.innerText = text;
        this.btnCalc.disabled = false;
    }

    updateCalcButton(nodes) {
        if (nodes.length >= 2) {
            this.btnCalc.disabled = false;
        } else {
            this.btnCalc.disabled = true;
            this.statusText.innerText = "";
        }
    }

    showBOM(paths) {
        let totalSegments = 0;
        paths.forEach(pList => totalSegments += pList.length);
        
        this.bomContent.innerHTML = `
            <div style="padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 8px;">
                <p><strong>Route Calculation Complete!</strong></p>
                <p style="color: var(--text-muted); margin-top: 0.5rem; font-size: 0.9rem;">
                   Successfully calculated ${paths.length} network paths containing ${totalSegments} segments.
                </p>
            </div>
        `;
        this.bomSection.style.display = 'block';
    }

    hideBOM() {
        this.bomSection.style.display = 'none';
    }

    renderHistory(historyItems, onClickCallback) {
        if (!historyItems || historyItems.length === 0) {
            this.historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; margin-top: 10px;">No saved connections yet.</div>`;
            return;
        }

        this.historyList.innerHTML = '';
        historyItems.forEach(item => {
            const dateStr = new Date(item.timestamp).toLocaleString();
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="history-title">${item.algorithm} Topology</div>
                <div class="history-date">${dateStr}</div>
            `;
            div.addEventListener('click', () => onClickCallback(item.id));
            this.historyList.appendChild(div);
        });
    }
}
