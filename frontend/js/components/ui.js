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
        this.btnExport = document.getElementById('btn-export');
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

    showBOM(bomData) {
        let warningHtml = '';
        if (bomData.opticalLoss > 28) {
            warningHtml = `
                <div style="background: rgba(239, 68, 68, 0.2); border: 1px solid var(--danger); padding: 0.8rem; border-radius: 6px; margin-top: 1rem;">
                    <strong style="color: var(--danger);">[WARNING] Optical Loss Threshold Exceeded</strong>
                    <p style="font-size: 0.85rem; margin-top: 0.4rem;">
                        Estimated optical loss is ${bomData.opticalLoss} dB, exceeding the standard GPON 28 dB limit. Consider adding more splitters or repeating the signal.
                    </p>
                </div>
            `;
        }

        this.bomContent.innerHTML = `
            <div style="padding: 1rem; background: rgba(0,0,0,0.3); border-radius: 8px;">
                <p><strong>Bill of Materials & Cost</strong></p>
                <table style="width: 100%; margin-top: 0.8rem; font-size: 0.85rem; border-collapse: collapse;">
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 4px 0;">Fiber Optic Cable (${bomData.totalDistanceMeters}m)</td>
                        <td style="text-align: right; padding: 4px 0;">$${bomData.fiberCost.toLocaleString()}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 4px 0;">Splitter Hubs (${bomData.hubCount})</td>
                        <td style="text-align: right; padding: 4px 0;">$${bomData.hubCost.toLocaleString()}</td>
                    </tr>
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 4px 0;">Client Terminations (${bomData.clientCount})</td>
                        <td style="text-align: right; padding: 4px 0;">$${bomData.clientCost.toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; font-weight: bold; color: var(--success);">Total CAPEX</td>
                        <td style="text-align: right; padding: 8px 0; font-weight: bold; color: var(--success);">$${bomData.totalCost.toLocaleString()}</td>
                    </tr>
                </table>
                <div style="margin-top: 1rem; font-size: 0.85rem;">
                    <strong>Optical Loss Estimate:</strong> ${bomData.opticalLoss} dB
                </div>
                ${warningHtml}
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
