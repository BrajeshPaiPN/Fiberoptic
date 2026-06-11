// UIManager — handles panel state and BOM rendering
export class UIManager {
    constructor() {
        this.statusEl    = document.getElementById('route-status');
        this.btnCalc     = document.getElementById('btn-calculate');
        this.btnClear    = document.getElementById('btn-clear-nodes');
        this.btnExport   = document.getElementById('btn-export');
        this.bomSection  = document.getElementById('acc-5');
        this.bomContent  = document.getElementById('bom-content');
        this.obsStatus   = document.getElementById('obstacle-status');
        this.historyList = document.getElementById('history-list');
    }

    setStatus(text, type = '') {
        this.statusEl.textContent = text;
        this.statusEl.className   = type ? `status-${type}` : '';
    }

    updateCalcButton(nodes) {
        const hasISP    = nodes.some(n => n.type === 'isp');
        const hasClient = nodes.some(n => n.type === 'client');
        this.btnCalc.disabled = !(hasISP && hasClient);
        if (!hasISP || !hasClient) {
            this.setStatus(!hasISP ? 'Place an ISP node first' : 'Place at least one Client node', '');
        } else {
            this.setStatus('Ready to calculate', '');
        }
    }

    hideBOM() {
        this.bomSection.style.display = 'none';
    }

    showBOM(data, algorithm) {
        const fc = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

        const warningHtml = data.opticalLoss > 28 ? `
            <div style="margin-top:0.75rem;padding:0.75rem;background:#fef2f2;border:1.5px solid #fca5a5;border-radius:8px;">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.3rem;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                    <strong style="font-size:0.75rem;color:#dc2626;font-weight:600;">Optical Loss Threshold Exceeded</strong>
                </div>
                <p style="font-size:0.72rem;color:#991b1b;line-height:1.4;">${data.opticalLoss} dB — exceeds the GPON 28 dB limit. Consider adding amplifiers or reducing split ratio.</p>
            </div>` : '';

        const isAstar   = algorithm === 'astar';
        const analysisText = isAstar
            ? 'A* routing provides optimal dedicated paths per client, maximising bandwidth and minimising per-link optical loss. CapEx is higher due to independent fiber runs.'
            : "Kruskal's MST minimises total fiber length and CapEx. The trade-off is shared backbones — a single break can disrupt downstream clients.";
        const analysisColor  = isAstar ? '#1d4ed8' : '#7c3aed';
        const analysisBg     = isAstar ? '#eff6ff' : '#f5f3ff';
        const analysisBorder = isAstar ? '#bfdbfe' : '#ddd6fe';

        this.bomContent.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem;">
                <tbody>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.45rem 0;color:var(--c-muted);">Fiber Cable <span style="font-size:0.68rem;">(${data.totalDistanceMeters} m)</span></td>
                        <td style="padding:0.45rem 0;text-align:right;font-weight:500;">${fc(data.fiberCost)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.45rem 0;color:var(--c-muted);">Splitter Hubs <span style="font-size:0.68rem;">(×${data.hubCount})</span></td>
                        <td style="padding:0.45rem 0;text-align:right;font-weight:500;">${fc(data.hubCost)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.45rem 0;color:var(--c-muted);">Client Terminations <span style="font-size:0.68rem;">(×${data.clientCount})</span></td>
                        <td style="padding:0.45rem 0;text-align:right;font-weight:500;">${fc(data.clientCost)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.45rem 0;color:var(--c-muted);">Splice Points <span style="font-size:0.68rem;">(×${data.spliceCount} @ $50ea)</span></td>
                        <td style="padding:0.45rem 0;text-align:right;font-weight:500;">${fc(data.spliceCost)}</td>
                    </tr>
                    <tr>
                        <td style="padding:0.6rem 0;font-weight:700;color:var(--c-success);">Total CapEx</td>
                        <td style="padding:0.6rem 0;text-align:right;font-weight:700;color:var(--c-success);font-size:0.9rem;">${fc(data.totalCost)}</td>
                    </tr>
                </tbody>
            </table>

            <div style="margin-top:0.6rem;font-size:0.72rem;color:var(--c-muted);">
                Optical Loss: <strong style="color:${data.opticalLoss > 28 ? 'var(--c-danger)' : 'var(--c-text)'};">${data.opticalLoss} dB</strong>
            </div>

            ${warningHtml}

            <div style="margin-top:0.75rem;padding:0.75rem;background:${analysisBg};border:1.5px solid ${analysisBorder};border-radius:8px;">
                <strong style="font-size:0.72rem;color:${analysisColor};text-transform:uppercase;letter-spacing:0.04em;">Architecture Analysis</strong>
                <p style="font-size:0.72rem;color:var(--c-text);margin-top:0.3rem;line-height:1.5;">${analysisText}</p>
            </div>
        `;

        this.bomSection.style.display = 'block';
    }

    // ── A/B Side-by-side comparison table ─────────────────────────────────────
    showABComparison(astarBOM, kruskalBOM) {
        const fc    = n => n != null ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }) : '—';
        const dist  = bom => bom ? `${bom.totalDistanceMeters} m` : '—';
        const loss  = bom => bom ? `${bom.opticalLoss} dB` : '—';
        const cost  = bom => bom ? fc(bom.totalCost) : '—';
        const red   = bom => bom ? (bom.paths && bom.paths.length > 1 ? 'Partial' : 'None') : '—';

        const winner = (aVal, kVal, lowerIsBetter = true) => {
            if (!aVal || !kVal) return ['', ''];
            const aNum = parseFloat(String(aVal).replace(/[^0-9.]/g, ''));
            const kNum = parseFloat(String(kVal).replace(/[^0-9.]/g, ''));
            if (isNaN(aNum) || isNaN(kNum)) return ['', ''];
            const aWins = lowerIsBetter ? aNum <= kNum : aNum >= kNum;
            return aWins
                ? ['color:#059669;font-weight:700;', 'color:var(--c-muted);']
                : ['color:var(--c-muted);', 'color:#059669;font-weight:700;'];
        };

        const [ad1, kd1] = winner(astarBOM?.totalDistanceMeters, kruskalBOM?.totalDistanceMeters);
        const [ac1, kc1] = winner(astarBOM?.totalCost, kruskalBOM?.totalCost);
        const [al1, kl1] = winner(astarBOM?.opticalLoss, kruskalBOM?.opticalLoss);

        this.bomContent.innerHTML = `
            <div style="font-size:0.72rem;font-weight:600;color:var(--c-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.5rem;">
                A/B Route Comparison
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:0.77rem;">
                <thead>
                    <tr style="border-bottom:2px solid var(--c-border);">
                        <th style="padding:0.3rem 0;text-align:left;font-weight:600;color:var(--c-muted);">Metric</th>
                        <th style="padding:0.3rem 0;text-align:right;color:#2563eb;font-weight:700;">A* Path</th>
                        <th style="padding:0.3rem 0;text-align:right;color:#9333ea;font-weight:700;">MST</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.4rem 0;color:var(--c-muted);">Total Distance</td>
                        <td style="padding:0.4rem 0;text-align:right;${ad1}">${dist(astarBOM)}</td>
                        <td style="padding:0.4rem 0;text-align:right;${kd1}">${dist(kruskalBOM)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.4rem 0;color:var(--c-muted);">Total CapEx</td>
                        <td style="padding:0.4rem 0;text-align:right;${ac1}">${cost(astarBOM)}</td>
                        <td style="padding:0.4rem 0;text-align:right;${kc1}">${cost(kruskalBOM)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.4rem 0;color:var(--c-muted);">Optical Loss</td>
                        <td style="padding:0.4rem 0;text-align:right;${al1}">${loss(astarBOM)}</td>
                        <td style="padding:0.4rem 0;text-align:right;${kl1}">${loss(kruskalBOM)}</td>
                    </tr>
                    <tr style="border-bottom:1px solid var(--c-border);">
                        <td style="padding:0.4rem 0;color:var(--c-muted);">Splice Points</td>
                        <td style="padding:0.4rem 0;text-align:right;">${astarBOM   ? astarBOM.spliceCount   : '—'}</td>
                        <td style="padding:0.4rem 0;text-align:right;">${kruskalBOM ? kruskalBOM.spliceCount : '—'}</td>
                    </tr>
                    <tr>
                        <td style="padding:0.4rem 0;color:var(--c-muted);">Redundancy</td>
                        <td style="padding:0.4rem 0;text-align:right;">${red(astarBOM)}</td>
                        <td style="padding:0.4rem 0;text-align:right;">${red(kruskalBOM)}</td>
                    </tr>
                </tbody>
            </table>
            <div style="margin-top:0.65rem;font-size:0.7rem;color:var(--c-muted);">
                🔵 A* shown as solid blue · 🟣 MST shown as dashed purple on map
            </div>
        `;

        this.bomSection.style.display = 'block';
    }

    renderHistory(items, onClickCb) {
        const list = this.historyList;
        if (!items || items.length === 0) {
            list.innerHTML = '<div class="history-empty">No saved routes yet.<br>Calculate a route to save it.</div>';
            return;
        }

        list.innerHTML = '';
        items.forEach(item => {
            const d = new Date(item.created_at || item.timestamp);
            const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="h-title">${item.algorithm} Topology</div>
                <div class="h-date">${dateStr} · ${timeStr}</div>
                <div class="h-meta">
                    <span class="h-tag">${item.node_count || '?'} nodes</span>
                    <span class="h-tag">${item.algorithm}</span>
                </div>`;
            div.addEventListener('click', () => onClickCb(item.id));
            list.appendChild(div);
        });
    }
}
