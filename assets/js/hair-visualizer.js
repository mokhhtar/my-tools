/**
 * hair-visualizer.js
 * Handles: photo upload → resize → hairstyle selection →
 *          backend call → before/after display
 */

(function () {
    'use strict';

    /* ── DOM helpers ─────────────────────────────────────────────── */
    const $ = id => document.getElementById(id);

    /* Steps */
    const stepStyle = $('step-style');
    const stepGenerate = $('step-generate');
    const resultSection = $('result-section');
    const statusArea = $('status-area');

    /* Upload */
    const dropZone = $('drop-zone');
    const fileInput = $('file-input');
    const dropIdle = $('drop-idle');
    const dropPreview = $('drop-preview');
    const previewImg = $('preview-img');
    const changePhotoBtn = $('change-photo-btn');
    const maskPreviewBtn = $('mask-preview-btn');

    /* Style selection */
    const catTabs = $('cat-tabs');
    const styleGrid = $('style-grid');
    const customPromptEl = $('custom-prompt');

    /* Generate */
    const apiUrlIn = $('api-url');
    const apiToggle = $('api-toggle');
    const apiPanel = $('api-panel');
    const optSteps = $('opt-steps');
    const generateBtn = $('generate-btn');
    const loadingState = $('loading-state');
    const loadingMsg = $('loading-msg');
    const loadingHint = $('loading-hint');

    /* Result */
    const baContainer = $('ba-container');
    const baBeforeImg = $('ba-before-img');
    const baAfterImg = $('ba-after-img');
    const baDivider = $('ba-divider');
    const resultMeta = $('result-meta');
    const downloadBtn = $('download-btn');
    const tryAgainBtn = $('try-again-btn');
    const showMaskBtn = $('show-mask-btn');
    const maskSection = $('mask-section');
    const maskImg = $('mask-img');
    const overlayImg = $('overlay-img');

    /* State */
    let uploadedBlob = null;  // resized Blob to send
    let uploadedDataUrl = null; // preview DataURL
    let selectedStyleId = null;
    let hairstylesData = {};
    let currentResultB64 = null;
    let isGenerating = false;

    const API_URL = () => (apiUrlIn.value.trim() || 'http://localhost:5001').replace(/\/$/, '');

    /* ── Loading messages ────────────────────────────────────────── */
    const LOADING_PHASES = [
        { msg: 'Detecting your face…', hint: 'Running MediaPipe on the backend — no GPU needed.', delay: 0 },
        { msg: 'Generating hair mask…', hint: 'Identifying the exact region to modify.', delay: 2500 },
        { msg: 'Sending to AI model…', hint: 'Uploading image + mask to HuggingFace servers.', delay: 5000 },
        { msg: 'AI is painting your new hair…', hint: 'Stable Diffusion Inpainting is running (~20-40s).', delay: 9000 },
        { msg: 'Refining details…', hint: 'Almost there. The AI is finalising the output.', delay: 28000 },
        { msg: 'Still working (model was loading)', hint: 'HuggingFace free tier sometimes needs 1-2 min. Hang tight!', delay: 55000 },
    ];

    let _phaseTimers = [];

    function startLoadingMessages() {
        _phaseTimers.forEach(clearTimeout);
        _phaseTimers = [];
        LOADING_PHASES.forEach(({ msg, hint, delay }) => {
            _phaseTimers.push(setTimeout(() => {
                loadingMsg.textContent = msg;
                loadingHint.textContent = hint;
            }, delay));
        });
    }

    function stopLoadingMessages() {
        _phaseTimers.forEach(clearTimeout);
        _phaseTimers = [];
    }

    /* ── Status helpers ──────────────────────────────────────────── */
    function showStatus(type, icon, html) {
        statusArea.innerHTML = `
      <div class="alert alert-${type}" style="margin-bottom:16px;" role="alert">
        <i class="ti ${icon}" aria-hidden="true"></i>
        <span>${html}</span>
      </div>`;
        statusArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function clearStatus() { statusArea.innerHTML = ''; }

    /* ── Step locking ────────────────────────────────────────────── */
    function unlockStep(el) { el.classList.remove('hv-step-locked'); }
    function lockStep(el) { el.classList.add('hv-step-locked'); }

    /* ── API config toggle ───────────────────────────────────────── */
    const toggleChevron = apiToggle.querySelector('.toggle-chevron');
    apiToggle.addEventListener('click', () => {
        const isOpen = apiPanel.getAttribute('aria-hidden') !== 'true';
        apiPanel.setAttribute('aria-hidden', String(isOpen));
        apiPanel.style.display = isOpen ? 'none' : 'block';
        apiToggle.setAttribute('aria-expanded', String(!isOpen));
        toggleChevron.style.transform = isOpen ? '' : 'rotate(180deg)';
    });

    /* ══════════════════════════════════════════════════════════════
       IMAGE UPLOAD & RESIZE
    ══════════════════════════════════════════════════════════════ */

    /** Resize image client-side to max 512×512, returns { blob, dataUrl } */
    function resizeImage(file) {
        return new Promise((resolve, reject) => {
            const MAX = 512;
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Cannot read file.'));
            reader.onload = e => {
                const img = new window.Image();
                img.onerror = () => reject(new Error('Cannot decode image.'));
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let w = img.naturalWidth, h = img.naturalHeight;

                    // Scale down proportionally
                    if (w > MAX || h > MAX) {
                        const scale = Math.min(MAX / w, MAX / h);
                        w = Math.round(w * scale);
                        h = Math.round(h * scale);
                    }

                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    canvas.toBlob(blob => {
                        if (!blob) { reject(new Error('Canvas toBlob failed.')); return; }
                        resolve({ blob, dataUrl });
                    }, 'image/jpeg', 0.92);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function handleFileSelected(file) {
        if (!file) return;

        // Basic MIME check
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            showStatus('error', 'ti-alert-circle', 'Please upload a JPEG, PNG, or WebP image.');
            return;
        }

        if (file.size > 20 * 1024 * 1024) {
            showStatus('error', 'ti-alert-circle', 'File too large (max 20 MB).');
            return;
        }

        clearStatus();

        try {
            const { blob, dataUrl } = await resizeImage(file);
            uploadedBlob = blob;
            uploadedDataUrl = dataUrl;

            // Show preview
            previewImg.src = dataUrl;
            dropIdle.style.display = 'none';
            dropPreview.style.display = 'block';
            maskPreviewBtn.style.display = 'flex';

            // Unlock step 2
            unlockStep(stepStyle);

            // Enable generate if style already selected or custom prompt filled
            updateGenerateBtn();

        } catch (err) {
            showStatus('error', 'ti-alert-circle', `Image error: ${err.message}`);
        }
    }

    // Drag & drop
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('hv-dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('hv-dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('hv-dragover');
        handleFileSelected(e.dataTransfer.files[0]);
    });

    // Click to browse
    dropZone.addEventListener('click', e => {
        if (e.target === changePhotoBtn || changePhotoBtn.contains(e.target)) return;
        if (uploadedBlob) return; // Already has image, don't re-open picker
        fileInput.click();
    });
    fileInput.addEventListener('change', () => handleFileSelected(fileInput.files[0]));

    // Change photo
    changePhotoBtn.addEventListener('click', e => {
        e.stopPropagation();
        uploadedBlob = null;
        uploadedDataUrl = null;
        fileInput.value = '';
        dropIdle.style.display = 'block';
        dropPreview.style.display = 'none';
        maskPreviewBtn.style.display = 'none';
        selectedStyleId = null;
        clearStatus();
        lockStep(stepStyle);
        lockStep(stepGenerate);
        resultSection.style.display = 'none';
        generateBtn.disabled = true;
        document.querySelectorAll('.hv-style-card').forEach(c => c.classList.remove('selected'));
    });

    // Keyboard accessible drop zone
    dropZone.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && !uploadedBlob) {
            fileInput.click();
        }
    });

    /* ══════════════════════════════════════════════════════════════
       HAIRSTYLE CATALOGUE
    ══════════════════════════════════════════════════════════════ */

    async function loadHairstyles() {
        try {
            const res = await fetch(`${API_URL()}/api/hairstyles`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            hairstylesData = await res.json();
            renderCatalogue();
        } catch {
            // Backend might be offline — render a minimal offline UI
            catTabs.innerHTML = '<p class="field-hint">⚠ Backend offline — start the Flask server to load styles.</p>';
            styleGrid.innerHTML = '';
        }
    }

    function renderCatalogue() {
        const cats = Object.entries(hairstylesData);
        if (!cats.length) return;

        // Category tabs
        catTabs.innerHTML = cats.map(([key, cat], i) => `
      <button class="hv-cat-tab ${i === 0 ? 'active' : ''}"
              data-cat="${key}" type="button" role="tab"
              aria-selected="${i === 0}">
        <i class="ti ${cat.icon}" aria-hidden="true"></i>
        ${cat.label}
      </button>`).join('');

        // Show first category
        const firstKey = cats[0][0];
        renderStyles(firstKey);

        // Tab click
        catTabs.addEventListener('click', e => {
            const btn = e.target.closest('.hv-cat-tab');
            if (!btn) return;
            document.querySelectorAll('.hv-cat-tab').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            renderStyles(btn.dataset.cat);
        });
    }

    function renderStyles(catKey) {
        const cat = hairstylesData[catKey];
        if (!cat) return;

        styleGrid.innerHTML = cat.styles.map(s => `
      <button class="hv-style-card ${selectedStyleId === s.id ? 'selected' : ''}"
              data-id="${s.id}" type="button" role="option"
              aria-selected="${selectedStyleId === s.id}">
        <span class="hv-card-name">${s.name}</span>
        <span class="hv-card-desc">${s.desc}</span>
      </button>`).join('');

        // Style selection
        styleGrid.querySelectorAll('.hv-style-card').forEach(card => {
            card.addEventListener('click', () => {
                styleGrid.querySelectorAll('.hv-style-card').forEach(c => {
                    c.classList.remove('selected');
                    c.setAttribute('aria-selected', 'false');
                });
                card.classList.add('selected');
                card.setAttribute('aria-selected', 'true');
                selectedStyleId = card.dataset.id;
                customPromptEl.value = ''; // clear custom prompt if style chosen
                unlockStep(stepGenerate);
                updateGenerateBtn();
            });
        });
    }

    // Custom prompt → unlocks generate
    customPromptEl.addEventListener('input', () => {
        if (customPromptEl.value.trim()) {
            // Deselect any style card
            document.querySelectorAll('.hv-style-card').forEach(c => {
                c.classList.remove('selected');
                c.setAttribute('aria-selected', 'false');
            });
            selectedStyleId = null;
            if (uploadedBlob) {
                unlockStep(stepGenerate);
                updateGenerateBtn();
            }
        } else {
            updateGenerateBtn();
        }
    });

    function updateGenerateBtn() {
        const hasImage = !!uploadedBlob;
        const hasStyle = !!selectedStyleId || !!customPromptEl.value.trim();
        generateBtn.disabled = !(hasImage && hasStyle && !isGenerating);
    }

    /* ══════════════════════════════════════════════════════════════
       MASK PREVIEW
    ══════════════════════════════════════════════════════════════ */

    maskPreviewBtn.addEventListener('click', async () => {
        if (!uploadedBlob) return;
        maskPreviewBtn.disabled = true;
        maskPreviewBtn.innerHTML = '<span class="spinner"></span> Generating…';

        const fd = new FormData();
        fd.append('image', uploadedBlob, 'portrait.jpg');

        try {
            const res = await fetch(`${API_URL()}/api/mask-preview`, { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            // Show in a modal-style overlay
            const w = window.open('', '_blank', 'width=700,height=420');
            w.document.write(`
        <html><head><title>Hair Mask Preview</title>
        <style>body{background:#0b0f1a;color:#dde4f0;font-family:sans-serif;padding:20px}
          h2{color:#e8722a;margin-bottom:16px}
          .row{display:flex;gap:16px;flex-wrap:wrap}
          img{width:200px;height:200px;object-fit:cover;border-radius:8px;border:1px solid #333}
          p{font-size:13px;color:#8a96ad;margin-top:8px}
        </style></head><body>
        <h2>Hair Mask Preview</h2>
        <div class="row">
          <div><img src="data:image/png;base64,${data.original}"><p>Original</p></div>
          <div><img src="data:image/png;base64,${data.mask}"><p>Binary mask (white = hair)</p></div>
          <div><img src="data:image/png;base64,${data.overlay}"><p>Overlay (red = area AI will modify)</p></div>
        </div>
        <p style="margin-top:20px">If the red area misses the hair or covers the face, try a better-lit frontal photo.</p>
        </body></html>`);
        } catch (err) {
            showStatus('error', 'ti-alert-circle', `Mask preview failed: ${err.message}`);
        } finally {
            maskPreviewBtn.disabled = false;
            maskPreviewBtn.innerHTML = '<i class="ti ti-eye"></i> Preview hair mask';
        }
    });

    /* ══════════════════════════════════════════════════════════════
       GENERATE
    ══════════════════════════════════════════════════════════════ */

    generateBtn.addEventListener('click', runGenerate);

    async function runGenerate() {
        if (!uploadedBlob) { showStatus('error', 'ti-alert-circle', 'Please upload a photo first.'); return; }
        const style = selectedStyleId;
        const custom = customPromptEl.value.trim();
        if (!style && !custom) { showStatus('error', 'ti-alert-circle', 'Select a hairstyle or enter a custom prompt.'); return; }

        clearStatus();
        isGenerating = true;
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="spinner"></span> Generating…';
        loadingState.style.display = 'block';
        resultSection.style.display = 'none';
        startLoadingMessages();

        const fd = new FormData();
        fd.append('image', uploadedBlob, 'portrait.jpg');
        if (style) fd.append('style_id', style);
        if (custom) fd.append('custom_prompt', custom);

        // Step override
        // (num_steps is handled server-side via the form field)
        fd.append('num_steps', optSteps.value);

        try {
            const res = await fetch(`${API_URL()}/api/visualize`, {
                method: 'POST',
                body: fd,
            });

            const data = await res.json();

            if (!res.ok) {
                let errMsg = data.error || `HTTP ${res.status}`;
                // User-friendly rewrites
                if (errMsg.includes('HF_TOKEN')) errMsg = 'The backend has no HuggingFace token. Add HF_TOKEN to your .env file.';
                if (errMsg.includes('rate limit')) errMsg = 'HuggingFace rate limit reached. Wait a few minutes and try again.';
                if (errMsg.includes('No face')) errMsg = 'No face detected. Try a clearer frontal photo with good lighting.';
                throw new Error(errMsg);
            }

            showResult(data);

        } catch (err) {
            let msg = err.message;
            if (err instanceof TypeError && msg.includes('fetch')) {
                msg = `Cannot reach backend at <code>${API_URL()}</code>. `
                    + 'Make sure <code>python app.py</code> is running in <strong>hairviz-backend/</strong>.';
            }
            showStatus('error', 'ti-alert-triangle', msg);
        } finally {
            stopLoadingMessages();
            isGenerating = false;
            loadingState.style.display = 'none';
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="ti ti-wand"></i> Visualize My Hair';
            updateGenerateBtn();
        }
    }

    /* ══════════════════════════════════════════════════════════════
       SHOW RESULT
    ══════════════════════════════════════════════════════════════ */

    function showResult(data) {
        // Set images
        baBeforeImg.src = `data:image/png;base64,${data.original}`;
        baAfterImg.src = `data:image/png;base64,${data.result}`;

        // Store for download + mask reveal
        currentResultB64 = data.result;
        maskImg.src = `data:image/png;base64,${data.mask}`;
        overlayImg.src = `data:image/png;base64,${data.overlay}`;
        maskSection.style.display = 'none';

        // Metadata strip
        const styleName = data.style_id
            ? findStyleName(data.style_id)
            : 'Custom prompt';
        resultMeta.innerHTML = `
      <span class="hv-meta-item"><i class="ti ti-wand"></i> ${styleName}</span>
      <span class="hv-meta-item"><i class="ti ti-id"></i> Job ${data.job_id}</span>`;

        // Show result section
        resultSection.style.display = 'block';
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        showStatus('success', 'ti-circle-check',
            `Done! Drag the slider to compare before and after.`);

        // Init the slider (wait for images to load)
        Promise.all([
            new Promise(r => { baBeforeImg.onload = r; if (baBeforeImg.complete) r(); }),
            new Promise(r => { baAfterImg.onload = r; if (baAfterImg.complete) r(); }),
        ]).then(initSlider);
    }

    function findStyleName(id) {
        for (const cat of Object.values(hairstylesData)) {
            const found = cat.styles.find(s => s.id === id);
            if (found) return found.name;
        }
        return id;
    }

    /* ══════════════════════════════════════════════════════════════
       BEFORE/AFTER SLIDER
    ══════════════════════════════════════════════════════════════ */

    function initSlider() {
        let dragging = false;

        const setPosition = (clientX) => {
            const rect = baContainer.getBoundingClientRect();
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
            const pct = (x / rect.width) * 100;
            baDivider.style.left = `${pct}%`;
            baContainer.style.setProperty('--ba-pos', `${pct}%`);
        };

        // Set initial position (50%)
        baContainer.style.setProperty('--ba-pos', '50%');
        baDivider.style.left = '50%';

        // Mouse
        baDivider.addEventListener('mousedown', () => { dragging = true; });
        window.addEventListener('mouseup', () => { dragging = false; });
        window.addEventListener('mousemove', e => { if (dragging) setPosition(e.clientX); });

        // Touch
        baDivider.addEventListener('touchstart', e => { dragging = true; e.preventDefault(); }, { passive: false });
        window.addEventListener('touchend', () => { dragging = false; });
        window.addEventListener('touchmove', e => { if (dragging) setPosition(e.touches[0].clientX); }, { passive: true });

        // Keyboard (left/right arrows when focused)
        baContainer.addEventListener('keydown', e => {
            if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
            const rect = baContainer.getBoundingClientRect();
            const cur = parseFloat(baDivider.style.left) || 50;
            const delta = e.key === 'ArrowRight' ? 5 : -5;
            const newPct = Math.max(0, Math.min(100, cur + delta));
            baDivider.style.left = `${newPct}%`;
            baContainer.style.setProperty('--ba-pos', `${newPct}%`);
        });
    }

    /* ══════════════════════════════════════════════════════════════
       RESULT ACTION BUTTONS
    ══════════════════════════════════════════════════════════════ */

    downloadBtn.addEventListener('click', () => {
        if (!currentResultB64) return;
        const a = Object.assign(document.createElement('a'), {
            href: `data:image/png;base64,${currentResultB64}`,
            download: `hairviz-result-${Date.now()}.png`,
        });
        a.click();
    });

    tryAgainBtn.addEventListener('click', () => {
        resultSection.style.display = 'none';
        clearStatus();
        // Scroll to style selection
        stepStyle.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    showMaskBtn.addEventListener('click', () => {
        const hidden = maskSection.style.display === 'none';
        maskSection.style.display = hidden ? 'block' : 'none';
        showMaskBtn.innerHTML = hidden
            ? '<i class="ti ti-eye-off"></i> Hide mask'
            : '<i class="ti ti-eye"></i> Show hair mask';
    });

    /* ══════════════════════════════════════════════════════════════
       BACKEND HEALTH CHECK (silent, on load)
    ══════════════════════════════════════════════════════════════ */

    async function checkBackend() {
        try {
            const res = await fetch(`${API_URL()}/health`, { signal: AbortSignal.timeout(4000) });
            const data = await res.json();
            if (!data.hf_token_set) {
                showStatus('warning', 'ti-alert-triangle',
                    'Backend is running but <strong>HF_TOKEN is not set</strong>. '
                    + 'Add it to <code>hairviz-backend/.env</code> and restart the server.');
            }
            // If AI ready: load catalogue
            await loadHairstyles();
        } catch {
            showStatus('warning', 'ti-server-off',
                'Backend is not reachable at <code>http://localhost:5001</code>. '
                + 'Run <code>python app.py</code> in <strong>hairviz-backend/</strong> to start it.<br>'
                + '<small>Style catalogue will load once the server is running.</small>');
        }
    }

    // Re-check when user changes API URL
    let _checkTimeout = null;
    apiUrlIn.addEventListener('input', () => {
        clearTimeout(_checkTimeout);
        _checkTimeout = setTimeout(async () => {
            catTabs.innerHTML = '<p class="field-hint">Connecting…</p>';
            await loadHairstyles();
        }, 800);
    });

    /* ── Init ──────────────────────────────────────────────────── */
    checkBackend();

})();