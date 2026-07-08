// UIManager v11 — Industry Edition
// Features: toast notifications, enhanced BOM, savings badge, signal budget,
//           node summary table, named history with delete button

import { deleteHistory, renameHistory } from '../api.js?v=11';

export class UIManager {
    constructor() {
        this.statusEl    = document.getElementById('route-status');
        this.btnCalc     = document.getElementById('btn-calculate');
        this.btnClear    = document.getElementById('btn-clear-nodes');
        this.btnExport   = document.getElementById('btn-export');
        this.bomSection  = document.getElementById('acc-5');
        this.bomContent  = document.getElementById('bom-content');
        this.historyList = document.getElementById('history-list');
        this._toastContainer = null;
        this._ensureToastContainer();
    }

    // ── Toast notifications ──────────────────────────────────────────────────
    _ensureToastContainer() {
        if (document.getElementById('toast-container')) {
            this._toastContainer = document.getElementById('toast-container');
            return;
        }
        const el = document.createElement('div');
        el.id = 'toast-container';
        el.style.cssText = `
            position:fixed; bottom:24px; right:24px; z-index:9999;
            display:flex; flex-direction:column; gap:10px; pointer-events:none;
        `;
        document.body.appendChild(el);
        this._toastContainer = el;
    }

    toast(message, type = 'info', duration = 3500) {
        const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
        const colors = {
            success: { bg: '#f0fdf4', border: '#86efac', text: '#15803d' },
            error:   { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626' },
            info:    { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8' },
            warning: { bg: '#fffbeb', border: '#fcd34d', text: '#b45309' },
        };
        const c = colors[type] || colors.info;

        const toast = document.createElement('div');
        toast.style.cssText = `
            display:flex; align-items:center; gap:10px;
            background:${c.bg}; border:1.5px solid ${c.border}; color:${c.text};
            padding:12px 16px; border-radius:10px; font-size:0.8rem; font-weight:500;
            box-shadow:0 4px 16px rgba(0,0,0,0.1);
            max-width:320px; pointer-events:auto;
            animation: toast-in 0.3s cubic-bezier(.2,.8,.4,1);
            font-family: 'Inter', sans-serif;
        `;
        toast.innerHTML = `<span style="font-size:1rem">${icons[type]}</span><span>${message}</span>`;

        const style = document.createElement('style');
        style.textContent = `
            @keyframes toast-in  { from { opacity:0; transform:translateY(20px) scale(0.95); } to { opacity:1; transform:none; } }
            @keyframes toast-out { from { opacity:1; transform:none; } to { opacity:0; transform:translateY(10px) scale(0.95); } }
        `;
        if (!document.querySelector('#toast-anim-style')) {
            style.id = 'toast-anim-style';
            document.head.appendChild(style);
        }

        this._toastContainer.appendChild(toast);

        const dismiss = () => {
            toast.style.animation = 'toast-out 0.25s ease forwards';
            setTimeout(() => toast.remove(), 250);
        };
        toast.addEventListener('click', dismiss);
        setTimeout(dismiss, duration);
    }

    // ── Status bar ───────────────────────────────────────────────────────────
    setStatus(text, type = '') {
        this.statusEl.textContent = text;
        this.statusEl.className   = type ? `status-${type}` : '';
    }

    // ── Loading overlay ───────────────────────────────────────────────────────
    showLoading(msg = 'Computing route…') {
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.style.cssText = `
                position:fixed; inset:0; z-index:5000;
                background:rgba(15,23,42,0.55); backdrop-filter:blur(2px);
                display:flex; align-items:center; justify-content:center;
                flex-direction:column; gap:16px;
            `;
            overlay.innerHTML = `
                <div style="width:48px;height:48px;border:4px solid rgba(255,255,255,0.2);border-top-color:#3b82f6;border-radius:50%;animation:spin 0.9s linear infinite;"></div>
                <div id="loading-msg" style="color:white;font-size:0.88rem;font-weight:500;font-family:'Inter',sans-serif;">${msg}</div>
                <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
            `;
            document.body.appendChild(overlay);
        } else {
            document.getElementById('loading-msg').textContent = msg;
            overlay.style.display = 'flex';
        }
    }

    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    // ── Calculate button ─────────────────────────────────────────────────────
    updateCalcButton(nodes) {
        const hasISP    = nodes.some(n => n.type === 'isp');
        const hasClient = nodes.some(n => n.type === 'client');
        this.btnCalc.disabled = !(hasISP && hasClient);
        const nodeCount = document.getElementById('node-count-badge');
        if (nodeCount) nodeCount.textContent = nodes.length;
        if (!hasISP || !hasClient) {
            this.setStatus(!hasISP ? '📍 Place an ISP node first' : '📍 Place at least one Client node', '');
        } else {
            this.setStatus(`✅ ${nodes.length} nodes ready — choose algorithm & calculate`, '');
        }
    }

    // ── BOM display ──────────────────────────────────────────────────────────
    hideBOM() { this.bomSection.style.display = 'none'; }

    showBOM(data, algorithm) {
        const fc = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
        const lossWarning = data.opticalLoss > 28 ? `
            <div class="bom-alert bom-alert-danger">
                <strong>⚠️ Optical Loss Exceeded</strong>
                <p>${data.opticalLoss} dB exceeds GPON 28 dB limit. Consider amplifiers or fewer splitters.</p>
            </div>` : '';

        const isAstar = algorithm === 'astar';
        const analysisText = isAstar
            ? 'A* provides dedicated paths per client — higher CapEx but maximum redundancy and equal SLA for all.'
            : "Kruskal's MST minimises total fiber length (avg 40% savings). Trade-off: shared backbones reduce fault isolation.";
        const algColor  = isAstar ? '#1d4ed8' : '#7c3aed';
        const algBg     = isAstar ? '#eff6ff'  : '#f5f3ff';
        const algBorder = isAstar ? '#bfdbfe'  : '#ddd6fe';

        // Signal budget (GPON downstream: -8 dBm launch, -27 dBm receiver sensitivity)
        const launchPower = -8;
        const rxSensitivity = -27;
        const budget = launchPower - rxSensitivity;   // 19 dB
        const margin = budget - data.opticalLoss;
        const marginColor = margin >= 3 ? '#059669' : margin >= 0 ? '#d97706' : '#dc2626';
        const marginIcon  = margin >= 3 ? '✅' : margin >= 0 ? '⚠️' : '❌';

        this.bomContent.innerHTML = `
            <div class="bom-section-label">Bill of Materials</div>
            <table class="bom-table">
                <tbody>
                    <tr><td class="bom-td-label">📦 Fiber Cable <span class="bom-sub">(${data.totalDistanceMeters.toLocaleString()} m)</span></td>
                        <td class="bom-td-val">${fc(data.fiberCost)}</td></tr>
                    <tr><td class="bom-td-label">🔀 Splitter Hubs <span class="bom-sub">(×${data.hubCount})</span></td>
                        <td class="bom-td-val">${fc(data.hubCost)}</td></tr>
                    <tr><td class="bom-td-label">🏠 Client Terminations <span class="bom-sub">(×${data.clientCount})</span></td>
                        <td class="bom-td-val">${fc(data.clientCost)}</td></tr>
                    <tr><td class="bom-td-label">⚡ Splice Points <span class="bom-sub">(×${data.spliceCount} @ $50)</span></td>
                        <td class="bom-td-val">${fc(data.spliceCost)}</td></tr>
                    <tr class="bom-total-row">
                        <td class="bom-td-label" style="font-weight:700;color:var(--c-success);">Total CapEx</td>
                        <td class="bom-td-val" style="font-weight:700;color:var(--c-success);font-size:1rem;">${fc(data.totalCost)}</td>
                    </tr>
                </tbody>
            </table>

            <div class="bom-metrics">
                <div class="bom-metric">
                    <div class="bom-metric-val" style="color:${data.opticalLoss > 28 ? 'var(--c-danger)' : 'var(--c-text)'};">${data.opticalLoss} dB</div>
                    <div class="bom-metric-label">Optical Loss</div>
                </div>
                <div class="bom-metric">
                    <div class="bom-metric-val" style="color:${marginColor};">${marginIcon} ${margin.toFixed(1)} dB</div>
                    <div class="bom-metric-label">Power Margin</div>
                </div>
                <div class="bom-metric">
                    <div class="bom-metric-val">${data.spliceCount}</div>
                    <div class="bom-metric-label">Splice Points</div>
                </div>
            </div>

            ${lossWarning}

            <div class="bom-analysis" style="background:${algBg};border-color:${algBorder};">
                <div class="bom-analysis-label" style="color:${algColor};">
                    ${isAstar ? '⚡ A* Hub & Spoke' : '🌐 Kruskal MST'}
                </div>
                <p class="bom-analysis-text">${analysisText}</p>
            </div>
        `;

        this.bomSection.style.display = 'block';
        // Auto-scroll to BOM
        setTimeout(() => this.bomSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }

    // ── A/B Comparison ────────────────────────────────────────────────────────
    showABComparison(astarBOM, kruskalBOM) {
        const fc   = n => n != null ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }) : '—';
        const dist = bom => bom ? `${bom.totalDistanceMeters.toLocaleString()} m` : '—';
        const loss = bom => bom ? `${bom.opticalLoss} dB` : '—';

        const winner = (a, k) => {
            if (a == null || k == null) return ['', ''];
            const aN = parseFloat(String(a).replace(/[^0-9.]/g, ''));
            const kN = parseFloat(String(k).replace(/[^0-9.]/g, ''));
            if (isNaN(aN) || isNaN(kN)) return ['', ''];
            return aN <= kN
                ? ['bom-winner', '']
                : ['', 'bom-winner'];
        };

        const [ad, kd] = winner(astarBOM?.totalDistanceMeters, kruskalBOM?.totalDistanceMeters);
        const [ac, kc] = winner(astarBOM?.totalCost, kruskalBOM?.totalCost);
        const [al, kl] = winner(astarBOM?.opticalLoss, kruskalBOM?.opticalLoss);

        // Savings badge
        let savingsBadge = '';
        if (astarBOM && kruskalBOM && astarBOM.totalCost > 0) {
            const savingsPct = ((astarBOM.totalCost - kruskalBOM.totalCost) / astarBOM.totalCost * 100).toFixed(1);
            const savedAmt   = (astarBOM.totalCost - kruskalBOM.totalCost).toLocaleString('en-US', { style:'currency', currency:'USD', minimumFractionDigits: 0 });
            if (parseFloat(savingsPct) > 0) {
                savingsBadge = `
                    <div class="savings-badge">
                        🎯 MST saves <strong>${savedAmt}</strong> (${savingsPct}%) vs A* Hub &amp; Spoke
                    </div>`;
            }
        }

        this.bomContent.innerHTML = `
            <div class="bom-section-label">A/B Route Comparison</div>
            <table class="bom-table">
                <thead>
                    <tr>
                        <th class="bom-th">Metric</th>
                        <th class="bom-th" style="color:#2563eb;">⚡ A* Path</th>
                        <th class="bom-th" style="color:#9333ea;">🌐 MST</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td class="bom-td-label">Total Distance</td>
                        <td class="bom-td-val ${ad}">${dist(astarBOM)}</td>
                        <td class="bom-td-val ${kd}">${dist(kruskalBOM)}</td></tr>
                    <tr><td class="bom-td-label">Total CapEx</td>
                        <td class="bom-td-val ${ac}">${fc(astarBOM?.totalCost)}</td>
                        <td class="bom-td-val ${kc}">${fc(kruskalBOM?.totalCost)}</td></tr>
                    <tr><td class="bom-td-label">Optical Loss</td>
                        <td class="bom-td-val ${al}">${loss(astarBOM)}</td>
                        <td class="bom-td-val ${kl}">${loss(kruskalBOM)}</td></tr>
                    <tr><td class="bom-td-label">Splice Points</td>
                        <td class="bom-td-val">${astarBOM?.spliceCount ?? '—'}</td>
                        <td class="bom-td-val">${kruskalBOM?.spliceCount ?? '—'}</td></tr>
                </tbody>
            </table>
            ${savingsBadge}
            <div style="font-size:0.69rem;color:var(--c-muted);margin-top:0.5rem;">
                🔵 Solid blue = A* on map &nbsp;·&nbsp; 🟣 Dashed purple = MST on map
            </div>
        `;

        this.bomSection.style.display = 'block';
        setTimeout(() => this.bomSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }

    // ── History list ──────────────────────────────────────────────────────────
    renderHistory(items, onClickCb, onDeleteCb) {
        if (!items || items.length === 0) {
            this.historyList.innerHTML = '<div class="history-empty">No saved routes yet.<br>Calculate a route to save it.</div>';
            return;
        }

        this.historyList.innerHTML = '';
        items.forEach(item => {
            const d       = new Date(item.created_at || item.timestamp);
            const dateStr = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
            const name    = item.name || `${item.algorithm} Topology`;

            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.4rem;">
                    <div style="flex:1;min-width:0;">
                        <div class="h-title">${name}</div>
                        <div class="h-date">${dateStr} · ${timeStr}</div>
                        <div class="h-meta">
                            <span class="h-tag">${item.node_count ?? '?'} nodes</span>
                            <span class="h-tag" style="color:${item.algorithm === 'astar' ? '#2563eb' : '#9333ea'};">${item.algorithm}</span>
                        </div>
                    </div>
                    <button class="h-delete-btn" title="Delete this route" data-id="${item.id}">×</button>
                </div>
            `;
            div.addEventListener('click', (e) => {
                if (!e.target.classList.contains('h-delete-btn')) onClickCb(item.id);
            });
            div.querySelector('.h-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete "${name}"?`)) {
                    await onDeleteCb(item.id);
                    div.remove();
                    if (this.historyList.children.length === 0) {
                        this.historyList.innerHTML = '<div class="history-empty">No saved routes yet.</div>';
                    }
                }
            });
            this.historyList.appendChild(div);
        });
    }
}
