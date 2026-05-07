/**
 * link-analyzer.js
 * Frontend logic for the Link Analyzer tool.
 * Calls the devtoolbox-backend API and renders results.
 */

(function () {
    'use strict';

    /* ── DOM refs ────────────────────────────────────────── */
    const $ = id => document.getElementById(id);

    const targetUrlIn = $('target-url');
    const analyzeBtn = $('analyze-btn');
    const statusArea = $('status-area');
    const progressWrap = $('progress-wrap');
    const progressMsg = $('progress-msg');
    const mainProgress = $('main-progress');
    const resultsSection = $('results-section');
    const guideSection = $('guide-section');
    const pageMetaInner = $('page-meta-inner');
    const summaryGrid = $('summary-grid');
    const issueLegend = $('issue-legend');
    const filterTabs = $('filter-tabs');
    const tableBody = $('table-body');
    const tableSearch = $('table-search');
    const truncatedNote = $('truncated-note');
    const exportCsvBtn = $('export-csv-btn');
    const exportJsonBtn = $('export-json-btn');
    const apiUrlIn = $('api-url');
    const apiToggle = $('api-toggle');
    const apiPanel = $('api-panel');
    const toggleChevron = apiToggle.querySelector('.toggle-chevron');

    /* Options */
    const opts = {
        checkStatus: () => $('opt-check-status').checked,
        followRedirects: () => $('opt-follow-redirects').checked,
        internal: () => $('opt-internal').checked,
        external: () => $('opt-external').checked,
        maxLinks: () => parseInt($('opt-max-links').value, 10),
        concurrency: () => parseInt($('opt-concurrency').value, 10),
        includeImages: () => $('opt-images').checked,
        apiUrl: () => apiUrlIn.value.trim().replace(/\/$/, ''),
    };

    /* State */
    let allLinks = [];
    let issueMeta = {};
    let currentFilter = 'all';
    let sortCol = null;
    let sortDir = 1; // 1=asc, -1=desc
    let fullPayload = null;

    /* ── Initial Check ───────────────────────────────────── */
    window.addEventListener('DOMContentLoaded', checkServerHealth);

    async function checkServerHealth() {
        const apiBase = opts.apiUrl() || 'http://localhost:3000';
        const bannerId = 'server-banner-top';
        
        // Remove old banner if exists
        const old = $(bannerId);
        if (old) old.remove();

        const banner = document.createElement('div');
        banner.id = bannerId;
        banner.className = 'server-banner server-banner--checking';
        banner.innerHTML = `<div class="server-dot"></div><span>Checking local backend...</span>`;
        statusArea.prepend(banner);

        try {
            const res = await fetch(`${apiBase}/health`);
            if (res.ok) {
                banner.className = 'server-banner server-banner--online';
                banner.innerHTML = `<div class="server-dot"></div><span>Backend Online (${apiBase})</span>`;
            } else {
                throw new Error();
            }
        } catch {
            banner.className = 'server-banner server-banner--offline';
            banner.innerHTML = `
                <div class="server-dot"></div>
                <span>Backend Offline. Run <code>npm start</code> in <code>devtoolbox-backend/</code></span>
                <button class="server-help-btn" onclick="location.reload()">Retry</button>
            `;
        }
    }

    /* ── API config toggle ───────────────────────────────── */
    apiToggle.addEventListener('click', () => {
        const open = apiPanel.getAttribute('aria-hidden') !== 'true' ? false : true;
        apiPanel.setAttribute('aria-hidden', String(!open));
        apiPanel.style.display = open ? 'block' : 'none';
        apiToggle.setAttribute('aria-expanded', String(open));
        toggleChevron.style.transform = open ? 'rotate(180deg)' : '';
    });
    apiPanel.style.display = 'none';

    /* ── Status helpers ──────────────────────────────────── */
    function showStatus(type, icon, msg) {
        statusArea.innerHTML = `
      <div class="alert alert-${type}" style="margin-bottom:16px;" role="alert">
        <i class="ti ${icon}" aria-hidden="true"></i>
        <span>${msg}</span>
      </div>`;
    }
    function clearStatus() { statusArea.innerHTML = ''; }

    function setLoading(on) {
        analyzeBtn.disabled = on;
        analyzeBtn.innerHTML = on
            ? '<span class="spinner" aria-hidden="true"></span> Analyzing…'
            : '<i class="ti ti-search" aria-hidden="true"></i> Analyze';
        progressWrap.style.display = on ? 'block' : 'none';
        if (on) {
            mainProgress.style.width = '';
            mainProgress.classList.add('progress-indeterminate');
        } else {
            mainProgress.classList.remove('progress-indeterminate');
        }
    }

    /* ── Main: analyze ───────────────────────────────────── */
    analyzeBtn.addEventListener('click', runAnalysis);
    targetUrlIn.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });

    async function runAnalysis() {
        let url = targetUrlIn.value.trim();
        if (!url) { showStatus('error', 'ti-alert-circle', 'Please enter a URL.'); return; }

        // Normalize URL: add https:// if no protocol
        if (!url.match(/^[a-zA-Z]+:\/\//)) {
            url = 'https://' + url;
            targetUrlIn.value = url;
        }

        try { new URL(url); }
        catch { showStatus('error', 'ti-alert-circle', 'Invalid URL format.'); return; }

        clearStatus();
        resultsSection.style.display = 'none';
        guideSection.style.display = 'none';
        setLoading(true);
        progressMsg.textContent = 'Connecting to backend…';

        const payload = {
            url,
            checkStatus: opts.checkStatus(),
            followRedirects: opts.followRedirects(),
            maxLinks: opts.maxLinks(),
            concurrency: opts.concurrency(),
            includeInternal: opts.internal(),
            includeExternal: opts.external(),
            includeImages: opts.includeImages(),
        };

        const apiBase = opts.apiUrl() || 'http://localhost:3000';

        // Health check first
        try {
            await fetch(`${apiBase}/health`);
        } catch {
            setLoading(false);
            showStatus('error', 'ti-server-off',
                `Cannot reach backend at <code>${apiBase}</code>.<br>
         Run <code>npm install &amp;&amp; npm start</code> in the <strong>devtoolbox-backend/</strong> folder.`);
            guideSection.style.display = 'block';
            return;
        }

        progressMsg.textContent = `Fetching page and extracting links…`;

        try {
            const res = await fetch(`${apiBase}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const data = await res.json();
            setLoading(false);
            fullPayload = data;
            renderResults(data);

        } catch (err) {
            setLoading(false);
            showStatus('error', 'ti-alert-triangle', `Analysis failed: <strong>${err.message}</strong>`);
            guideSection.style.display = 'block';
        }
    }

    /* ── Render results ──────────────────────────────────── */
    function renderResults(data) {
        allLinks = data.links || [];
        issueMeta = data.issueMeta || {};
        currentFilter = 'all';
        sortCol = null;

        renderPageMeta(data.meta);
        renderSummary(data.summary);
        renderIssueLegend();
        updateFilterCounts();
        renderTable();

        if (data.summary.truncated) {
            truncatedNote.style.display = 'block';
            truncatedNote.textContent =
                `⚠ Results capped at ${data.summary.maxLinks} links. Increase the limit in options to see more.`;
        } else {
            truncatedNote.style.display = 'none';
        }

        resultsSection.style.display = 'block';
        guideSection.style.display = 'block';
        showStatus('success', 'ti-circle-check',
            `Done! Found <strong>${allLinks.length}</strong> unique links — 
       <strong>${data.summary.broken}</strong> broken, 
       <strong>${data.summary.totalIssues}</strong> with SEO issues.`);
    }

    /* ── Page meta card ──────────────────────────────────── */
    function renderPageMeta(meta) {
        if (!meta) { $('page-meta-card').style.display = 'none'; return; }
        $('page-meta-card').style.display = 'block';

        const row = (label, val, warn) => val
            ? `<div class="pm-row">
           <span class="pm-label">${label}</span>
           <span class="pm-val ${warn ? 'pm-warn' : ''}">${escHtml(val)}</span>
         </div>`
            : `<div class="pm-row">
           <span class="pm-label">${label}</span>
           <span class="pm-val pm-missing">—</span>
         </div>`;

        pageMetaInner.innerHTML = `
      <div class="pm-title">
        <i class="ti ti-file-text" aria-hidden="true"></i>
        Page Overview — <a href="${escHtml(meta.pageUrl)}" target="_blank" rel="noopener" 
          style="color:var(--accent);font-size:12px;font-family:var(--font-mono);">${escHtml(truncUrl(meta.pageUrl, 60))}</a>
      </div>
      <div class="pm-grid">
        ${row('Title', meta.title, !meta.title)}
        ${row('Description', meta.description, !meta.description)}
        ${row('Canonical', meta.canonical, false)}
        ${row('Robots Meta', meta.robotsMeta, false)}
        ${row('H1 Count', meta.h1Count !== undefined ? `${meta.h1Count} ${meta.h1Count !== 1 ? '⚠ (should be 1)' : '✓'}` : null, meta.h1Count !== 1)}
        ${row('H2 Count', meta.h2Count !== undefined ? String(meta.h2Count) : null, false)}
      </div>`;
    }

    /* ── Summary cards ───────────────────────────────────── */
    function renderSummary(s) {
        if (!s) return;
        const avgT = s.avgResponseTime != null ? `${s.avgResponseTime} ms` : '—';
        
        const cards = [
            { label: 'Total Links', val: s.total, accent: false },
            { label: 'Internal', val: s.internal, accent: false },
            { label: 'External', val: s.external, accent: false },
            { label: 'Images', val: s.images || 0, accent: false },
            { label: 'Broken', val: s.broken, accent: s.broken > 0, danger: s.broken > 0 },
            { label: 'Redirects', val: s.redirects, accent: false },
            { label: 'With Issues', val: s.totalIssues, accent: s.totalIssues > 0, danger: false },
            { label: 'Avg Response', val: avgT, accent: false },
        ];

        summaryGrid.innerHTML = cards.map(c => `
      <div class="la-stat-card ${c.danger ? 'la-stat-danger' : c.accent ? 'la-stat-accent' : ''}">
        <p class="stat-label">${c.label}</p>
        <p class="stat-value">${c.val}</p>
      </div>`).join('');
    }

    /* ── Issue legend ────────────────────────────────────── */
    function renderIssueLegend() {
        const usedIssues = new Set();
        allLinks.forEach(l => (l.issues || []).forEach(i => usedIssues.add(i)));
        if (!usedIssues.size) { issueLegend.innerHTML = ''; return; }

        issueLegend.innerHTML =
            '<span style="font-size:11px;font-weight:600;color:var(--text-3);letter-spacing:1px;font-family:var(--font-mono);">ISSUES FOUND: </span>' +
            [...usedIssues].map(id => {
                const m = issueMeta[id] || { label: id, color: '#888' };
                return `<span class="issue-pill" style="--ic:${m.color}" title="${m.severity}">${m.label}</span>`;
            }).join('');
    }

    /* ── Filter counts ───────────────────────────────────── */
    function updateFilterCounts() {
        $('fc-all').textContent = allLinks.length;
        $('fc-internal').textContent = allLinks.filter(l => l.type === 'internal').length;
        $('fc-external').textContent = allLinks.filter(l => l.type === 'external').length;
        $('fc-broken').textContent = allLinks.filter(l => typeof l.statusCode === 'number' && l.statusCode >= 400).length;
        $('fc-issues').textContent = allLinks.filter(l => l.issues && l.issues.length > 0).length;
        $('fc-nofollow').textContent = allLinks.filter(l => (l.issues || []).includes('nofollow')).length;
    }

    /* ── Filter tabs ─────────────────────────────────────── */
    filterTabs.addEventListener('click', e => {
        const btn = e.target.closest('.ftab');
        if (!btn) return;
        document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTable();
    });

    /* ── Table search ────────────────────────────────────── */
    tableSearch.addEventListener('input', renderTable);

    /* ── Sortable headers ────────────────────────────────── */
    document.querySelectorAll('.th-sortable').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.col;
            if (sortCol === col) sortDir *= -1;
            else { sortCol = col; sortDir = 1; }
            document.querySelectorAll('.th-sortable .sort-icon').forEach(ic => ic.textContent = '↕');
            th.querySelector('.sort-icon').textContent = sortDir === 1 ? '↑' : '↓';
            renderTable();
        });
    });

    /* ── Render table ────────────────────────────────────── */
    function renderTable() {
        let rows = [...allLinks];
        const q = tableSearch.value.toLowerCase().trim();

        /* Filter by tab */
        switch (currentFilter) {
            case 'internal': rows = rows.filter(l => l.type === 'internal'); break;
            case 'external': rows = rows.filter(l => l.type === 'external'); break;
            case 'broken': rows = rows.filter(l => typeof l.statusCode === 'number' && l.statusCode >= 400); break;
            case 'issues': rows = rows.filter(l => l.issues && l.issues.length > 0); break;
            case 'nofollow': rows = rows.filter(l => (l.issues || []).includes('nofollow')); break;
        }

        /* Search filter */
        if (q) {
            rows = rows.filter(l =>
                l.url.toLowerCase().includes(q) ||
                (l.text || '').toLowerCase().includes(q)
            );
        }

        /* Sort */
        if (sortCol) {
            rows.sort((a, b) => {
                let av, bv;
                switch (sortCol) {
                    case 'url': av = a.url; bv = b.url; break;
                    case 'text': av = a.text || ''; bv = b.text || ''; break;
                    case 'type': av = a.type; bv = b.type; break;
                    case 'status': av = a.statusCode ?? 999; bv = b.statusCode ?? 999; break;
                    case 'time': av = a.responseTime ?? 99999; bv = b.responseTime ?? 99999; break;
                    default: av = 0; bv = 0;
                }
                if (av < bv) return -sortDir;
                if (av > bv) return sortDir;
                return 0;
            });
        }

        if (!rows.length) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:24px;font-size:13px;">No links match the current filter.</td></tr>`;
            return;
        }

        tableBody.innerHTML = rows.map((l, i) => {
            const sc = l.statusCode;
            const scNum = typeof sc === 'number' ? sc : null;
            const scClass = scNum
                ? scNum < 300 ? 'sc-2xx' : scNum < 400 ? 'sc-3xx' : scNum < 500 ? 'sc-4xx' : 'sc-5xx'
                : 'sc-err';
            const scText = scNum || (sc === 'Error' ? 'ERR' : (sc ?? '—'));

            const timeStr = typeof l.responseTime === 'number'
                ? `<span class="${l.responseTime > 3000 ? 'slow-time' : ''}">${l.responseTime}</span>` : '—';

            const issues = (l.issues || []).map(id => {
                const m = issueMeta[id] || { label: id, color: '#888' };
                return `<span class="issue-pill-sm" style="--ic:${m.color}">${m.label}</span>`;
            }).join('');

            const relBadges = l.rel
                ? l.rel.split(/\s+/).map(r => `<span class="rel-badge">${escHtml(r)}</span>`).join('')
                : '—';

            const displayUrl = truncUrl(l.url, 55);
            const finalNote = l.finalUrl ? ` → <span style="color:var(--text-3);font-size:10px;">${truncUrl(l.finalUrl, 30)}</span>` : '';

            return `<tr>
        <td class="td-num">${i + 1}</td>
        <td class="td-url">
          <a href="${escHtml(l.url)}" target="_blank" rel="noopener noreferrer"
             title="${escHtml(l.url)}">${escHtml(displayUrl)}</a>${finalNote}
          <button class="copy-btn" data-copy="${escHtml(l.url)}" title="Copy URL" aria-label="Copy URL">
            <i class="ti ti-copy" aria-hidden="true"></i>
          </button>
        </td>
        <td class="td-anchor" title="${escHtml(l.text || '')}">${escHtml(truncStr(l.text || '—', 40))}</td>
        <td><span class="type-badge type-${l.type}">${l.type}</span></td>
        <td class="td-rel">${relBadges}</td>
        <td><span class="sc-badge ${scClass}">${scText}</span></td>
        <td class="td-time">${timeStr}</td>
        <td class="td-issues">${issues || '<span style="color:var(--text-3)">—</span>'}</td>
      </tr>`;
        }).join('');

        /* Copy buttons */
        tableBody.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(btn.dataset.copy);
                    btn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i>';
                    setTimeout(() => { btn.innerHTML = '<i class="ti ti-copy" aria-hidden="true"></i>'; }, 1500);
                } catch { /* noop */ }
            });
        });
    }

    /* ── Export CSV ──────────────────────────────────────── */
    exportCsvBtn.addEventListener('click', () => {
        if (!allLinks.length) return;
        const headers = ['#', 'URL', 'Anchor Text', 'Type', 'Rel', 'Status Code', 'Response Time (ms)', 'Issues', 'Final URL', 'Error'];
        const rows = allLinks.map((l, i) => [
            i + 1,
            l.url,
            l.text || '',
            l.type,
            l.rel || '',
            l.statusCode ?? '',
            l.responseTime ?? '',
            (l.issues || []).join(' | '),
            l.finalUrl || '',
            l.error || '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

        downloadText([headers.join(','), ...rows].join('\n'), 'text/csv', 'links-analysis.csv');
    });

    /* ── Export JSON ─────────────────────────────────────── */
    exportJsonBtn.addEventListener('click', () => {
        if (!fullPayload) return;
        downloadText(JSON.stringify(fullPayload, null, 2), 'application/json', 'links-analysis.json');
    });

    function downloadText(content, mimeType, filename) {
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([content], { type: mimeType })),
            download: filename,
        });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    /* ── Utilities ───────────────────────────────────────── */
    function truncUrl(url, maxLen) {
        if (!url || url.length <= maxLen) return url;
        try {
            const u = new URL(url);
            const display = u.hostname + u.pathname + u.search;
            return display.length > maxLen ? display.slice(0, maxLen - 1) + '…' : display;
        } catch {
            return url.slice(0, maxLen - 1) + '…';
        }
    }

    function truncStr(s, n) {
        if (!s) return '';
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    function escHtml(s) {
        if (!s) return '';
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

})();