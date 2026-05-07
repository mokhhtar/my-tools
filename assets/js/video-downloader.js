/**
 * video-downloader.js
 * Frontend logic for the Video Downloader tool.
 * Communicates with downloader_server.py (Flask, port 5000).
 */

(function () {
    'use strict';

    const API = 'http://localhost:5000';

    /* ── DOM references ─────────────────────────────────────── */
    const $ = id => document.getElementById(id);

    const serverBanner   = $('server-banner');
    const bannerMsg      = $('server-banner-msg');
    const serverHelpBtn  = $('server-help-btn');
    const setupGuide     = $('setup-guide');

    const dlUrl          = $('dl-url');
    const inspectBtn     = $('inspect-btn');

    const previewCard    = $('preview-card');
    const previewThumb   = $('preview-thumb');
    const previewTitle   = $('preview-title');
    const previewChannel = $('preview-channel');
    const previewDuration= $('preview-duration');
    const previewViews   = $('preview-views');

    const formatSection  = $('format-section');
    const qualityGrid    = $('quality-grid');
    const downloadBtn    = $('download-btn');
    const openFolderBtn  = $('open-folder-btn');

    const modeBtns       = document.querySelectorAll('.dl-mode-btn');
    const videoPanel     = $('video-quality-panel');
    const audioPanel     = $('audio-format-panel');

    const progressWrap   = $('dl-progress-wrap');
    const progressMsg    = $('dl-progress-msg');
    const progressPct    = $('dl-progress-pct');
    const progressBar    = $('dl-progress-bar');
    const dlSpeed        = $('dl-speed');
    const dlEta          = $('dl-eta');
    const dlSize         = $('dl-size');
    const cancelBtn      = $('dl-cancel-btn');

    const historySection = $('history-section');
    const historyList    = $('history-list');
    const statusArea     = $('status-area');

    /* ── State ──────────────────────────────────────────────── */
    let mode       = 'video';   // 'video' | 'audio'
    let selectedFmt= 'best';    // format_id for video
    let selectedCodec = 'mp3';  // audio codec
    let currentJobId = null;
    let serverOnline = false;

    /* ── Startup: ping server ───────────────────────────────── */
    async function checkServer() {
        setBanner('checking', 'Checking local server…');
        try {
            const res = await fetch(`${API}/ping`, { signal: AbortSignal.timeout(4000) });
            if (res.ok) {
                setBanner('online', 'Local server is running');
                serverOnline = true;
                setupGuide.style.display = 'none';
                serverHelpBtn.style.display = 'none';
                loadHistory();
            } else {
                throw new Error('bad response');
            }
        } catch {
            setBanner('offline', 'Local server is not running — see setup guide');
            serverHelpBtn.style.display = 'inline-flex';
        }
    }

    function setBanner(state, msg) {
        serverBanner.className = `server-banner server-banner--${state}`;
        bannerMsg.textContent = msg;
    }

    serverHelpBtn.addEventListener('click', () => {
        setupGuide.style.display = setupGuide.style.display === 'none' ? 'block' : 'none';
    });

    /* ── Status helpers ─────────────────────────────────────── */
    function showStatus(type, icon, msg) {
        statusArea.innerHTML = `
      <div class="alert alert-${type}" style="margin-bottom:20px;" role="alert">
        <i class="ti ${icon}" aria-hidden="true"></i>
        <span>${msg}</span>
      </div>`;
    }
    function clearStatus() { statusArea.innerHTML = ''; }

    /* ── Inspect ────────────────────────────────────────────── */
    inspectBtn.addEventListener('click', inspectURL);
    dlUrl.addEventListener('keydown', e => { if (e.key === 'Enter') inspectURL(); });

    async function inspectURL() {
        const url = dlUrl.value.trim();
        if (!url) { showStatus('error', 'ti-alert-circle', 'Please enter a URL first.'); return; }
        if (!serverOnline) { showStatus('error', 'ti-alert-circle', 'The local server is not running. Follow the setup guide above.'); return; }

        clearStatus();
        inspectBtn.disabled = true;
        inspectBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Fetching…';
        previewCard.style.display = 'none';
        formatSection.style.display = 'none';
        downloadBtn.disabled = true;

        try {
            const res  = await fetch(`${API}/info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            const data = await res.json();

            if (data.error) throw new Error(data.error);

            // Populate preview card
            if (data.thumbnail) {
                previewThumb.src = data.thumbnail;
                previewThumb.style.display = 'block';
            } else {
                previewThumb.style.display = 'none';
            }
            previewTitle.textContent    = data.title || '—';
            previewChannel.innerHTML    = `<i class="ti ti-user-circle" aria-hidden="true"></i> ${data.channel || '—'}`;
            previewDuration.innerHTML   = `<i class="ti ti-clock" aria-hidden="true"></i> ${data.duration || '—'}`;
            const views = data.view_count ? Number(data.view_count).toLocaleString() : '—';
            previewViews.innerHTML      = `<i class="ti ti-eye" aria-hidden="true"></i> ${views}`;
            previewCard.style.display   = 'flex';

            // Build quality grid
            qualityGrid.innerHTML = '';
            selectedFmt = 'best';
            (data.formats || []).forEach((f, i) => {
                const btn = document.createElement('button');
                btn.className = 'quality-btn' + (i === 0 ? ' active' : '');
                btn.dataset.fmtId = f.id;
                btn.innerHTML = `${f.label} <span class="q-sub">${f.size}</span>`;
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    selectedFmt = f.id;
                });
                qualityGrid.appendChild(btn);
            });
            if (data.formats && data.formats[0]) selectedFmt = data.formats[0].id;

            formatSection.style.display = 'block';
            downloadBtn.disabled = false;

        } catch (err) {
            showStatus('error', 'ti-alert-triangle', `Could not fetch video info: <strong>${err.message}</strong>`);
        } finally {
            inspectBtn.disabled = false;
            inspectBtn.innerHTML = '<i class="ti ti-search" aria-hidden="true"></i> Inspect';
        }
    }

    /* ── Mode tabs (video / audio) ──────────────────────────── */
    modeBtns.forEach(btn => btn.addEventListener('click', () => {
        modeBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        mode = btn.dataset.mode;
        videoPanel.style.display = mode === 'video' ? 'block' : 'none';
        audioPanel.style.display = mode === 'audio' ? 'block' : 'none';
    }));

    /* Audio codec selection */
    document.querySelectorAll('[data-codec]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-codec]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCodec = btn.dataset.codec;
        });
    });

    /* ── Download ───────────────────────────────────────────── */
    downloadBtn.addEventListener('click', startDownload);

    async function startDownload() {
        const url = dlUrl.value.trim();
        if (!url || !serverOnline) return;

        clearStatus();
        downloadBtn.disabled = true;
        inspectBtn.disabled  = true;

        // Show progress UI
        progressWrap.style.display = 'block';
        progressBar.style.width    = '0%';
        progressBar.setAttribute('aria-valuenow', 0);
        progressMsg.textContent    = 'Starting download…';
        progressPct.textContent    = '0%';
        dlSpeed.innerHTML          = '<i class="ti ti-bolt" aria-hidden="true"></i> —';
        dlEta.innerHTML            = '<i class="ti ti-clock" aria-hidden="true"></i> ETA —';
        dlSize.innerHTML           = '<i class="ti ti-file" aria-hidden="true"></i> —';

        try {
            const res = await fetch(`${API}/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    format_id:   mode === 'video' ? selectedFmt : 'best',
                    audio_only:  mode === 'audio',
                    audio_codec: selectedCodec,
                }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            currentJobId = data.job_id;
            listenToProgress(data.job_id);

        } catch (err) {
            showStatus('error', 'ti-alert-triangle', `Failed to start: <strong>${err.message}</strong>`);
            resetUI();
        }
    }

    /* ── SSE progress listener ──────────────────────────────── */
    function listenToProgress(jobId) {
        const es = new EventSource(`${API}/progress/${jobId}`);

        es.addEventListener('progress', e => {
            const d = JSON.parse(e.data);
            const pct = d.pct || 0;
            progressBar.style.width = pct + '%';
            progressBar.setAttribute('aria-valuenow', pct);
            progressPct.textContent = pct + '%';
            progressMsg.textContent = 'Downloading…';
            dlSpeed.innerHTML = `<i class="ti ti-bolt" aria-hidden="true"></i> ${d.speed}`;
            dlEta.innerHTML   = `<i class="ti ti-clock" aria-hidden="true"></i> ETA ${d.eta}`;
            dlSize.innerHTML  = `<i class="ti ti-file" aria-hidden="true"></i> ${d.downloaded} / ${d.total}`;
        });

        es.addEventListener('finished', e => {
            es.close();
            const d = JSON.parse(e.data);
            progressBar.style.width = '100%';
            progressBar.setAttribute('aria-valuenow', 100);
            progressPct.textContent = '100%';
            progressMsg.textContent = `Saved: ${d.filename}`;
            showStatus('success', 'ti-circle-check',
                `Download complete! File saved to the <strong>downloads/</strong> folder as <strong>${d.filename}</strong>.`);
            resetUI(false);
            loadHistory();
        });

        es.addEventListener('error', e => {
            es.close();
            let msg = 'Unknown error';
            try { msg = JSON.parse(e.data).message; } catch {}
            showStatus('error', 'ti-alert-triangle', `Download failed: <strong>${msg}</strong>`);
            resetUI();
        });

        es.onerror = () => {
            // Connection dropped unexpectedly
            es.close();
            resetUI();
        };
    }

    /* ── Cancel ─────────────────────────────────────────────── */
    cancelBtn.addEventListener('click', async () => {
        if (!currentJobId) return;
        try {
            await fetch(`${API}/cancel/${currentJobId}`, { method: 'POST' });
        } catch {}
        showStatus('warning', 'ti-alert-circle', 'Download cancelled.');
        resetUI();
    });

    /* ── Open downloads folder ──────────────────────────────── */
    openFolderBtn.addEventListener('click', async () => {
        if (!serverOnline) {
            showStatus('error', 'ti-alert-circle', 'The local server must be running to open the folder.');
            return;
        }
        try {
            await fetch(`${API}/open-folder`);
        } catch {}
    });

    /* ── History ────────────────────────────────────────────── */
    async function loadHistory() {
        try {
            const res  = await fetch(`${API}/history`);
            const data = await res.json();
            if (!Array.isArray(data) || !data.length) return;
            historySection.style.display = 'block';
            historyList.innerHTML = data.map(item => {
                const icon = item.audio ? 'ti-music' : 'ti-video';
                const when = new Date(item.finished).toLocaleTimeString();
                return `
          <div class="history-item">
            <i class="ti ${icon} history-icon" aria-hidden="true"></i>
            <div class="history-body">
              <span class="history-name">${escapeHTML(item.filename || '—')}</span>
              <span class="history-meta">${when}</span>
            </div>
          </div>`;
            }).join('');
        } catch {}
    }

    /* ── Reset UI ───────────────────────────────────────────── */
    function resetUI(hideProgress = true) {
        downloadBtn.disabled = false;
        inspectBtn.disabled  = false;
        currentJobId = null;
        if (hideProgress) progressWrap.style.display = 'none';
    }

    /* ── Helpers ─────────────────────────────────────────────── */
    function escapeHTML(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /* ── Init ───────────────────────────────────────────────── */
    checkServer();

})();
