/**
 * reddit-converter.js
 * Browser port of the Reddit → JSON Node.js script.
 * Runs entirely client-side — no server needed.
 */

(function () {
    'use strict';

    /* ── DOM refs ──────────────────────────────────────────── */
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const convertBtn = document.getElementById('convert-btn');
    const resetBtn = document.getElementById('reset-btn');
    const statusArea = document.getElementById('status-area');
    const outputSection = document.getElementById('output-section');
    const outputStats = document.getElementById('output-stats');
    const jsonOutput = document.getElementById('json-output');
    const jsonFilename = document.getElementById('json-filename');
    const downloadBtn = document.getElementById('download-btn');
    const copyBtn = document.getElementById('copy-btn');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const dropFilename = document.getElementById('drop-filename');
    const urlInput = document.getElementById('reddit-url');

    /* Options */
    const optMetadata = document.getElementById('opt-metadata');
    const optDeleted = document.getElementById('opt-deleted');
    const optNested = document.getElementById('opt-nested');
    const optScores = document.getElementById('opt-scores');
    const optTimestamps = document.getElementById('opt-timestamps');
    const optFlair = document.getElementById('opt-flair');

    let currentActiveTab = 'url';
    let resultJSON = null;
    let resultFilename = 'output.json';

    /* ── Tab switching ─────────────────────────────────────── */
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            currentActiveTab = tab;
            tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
            tabPanels.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            document.getElementById('panel-' + tab).classList.add('active');
            clearStatus();
        });
    });

    /* ── Drag & drop ───────────────────────────────────────── */
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelection(file);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFileSelection(fileInput.files[0]);
    });

    function handleFileSelection(file) {
        dropFilename.textContent = '📄 ' + file.name;
        dropFilename.style.display = 'inline-block';
        clearStatus();
    }

    /* ── URL live validation ───────────────────────────────── */
    urlInput.addEventListener('input', clearStatus);

    /* ── Utility: status messages ──────────────────────────── */
    function showStatus(type, icon, message) {
        statusArea.innerHTML = `
      <div class="alert alert-${type}" style="margin-bottom:20px;" role="alert">
        <i class="ti ${icon}" aria-hidden="true"></i>
        <span>${message}</span>
      </div>`;
    }

    function clearStatus() { statusArea.innerHTML = ''; }

    function setLoading(on) {
        convertBtn.disabled = on;
        convertBtn.innerHTML = on
            ? '<span class="spinner" aria-hidden="true"></span> Converting…'
            : '<i class="ti ti-transform" aria-hidden="true"></i> Convert to JSON';
    }

    /* ── Main conversion entry ─────────────────────────────── */
    convertBtn.addEventListener('click', async () => {
        clearStatus();
        outputSection.style.display = 'none';
        resultJSON = null;
        resetBtn.style.display = 'none';

        if (currentActiveTab === 'url') {
            await convertFromURL();
        } else {
            await convertFromFile();
        }
    });

    /* ── Convert from URL ──────────────────────────────────── */
    async function convertFromURL() {
        const raw = urlInput.value.trim();
        if (!raw) { showStatus('error', 'ti-alert-circle', 'Please enter a Reddit post URL.'); return; }

        const jsonURL = buildRedditJSONUrl(raw);
        if (!jsonURL) {
            showStatus('error', 'ti-alert-circle', 'That doesn\'t look like a Reddit post URL. It should contain <code>/comments/</code>.');
            return;
        }

        setLoading(true);
        showStatus('info', 'ti-loader', 'Fetching post data from Reddit…');

        try {
            // Reddit allows CORS on .json URLs for public posts
            const res = await fetch(jsonURL, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) throw new Error(`Reddit returned HTTP ${res.status}. The post may be private or removed.`);
            const data = await res.json();
            processRedditData(data, slugFromURL(raw));
        } catch (err) {
            showStatus('error', 'ti-alert-triangle',
                `Could not fetch from Reddit: <strong>${err.message}</strong><br>
         <small>Tip: try the file upload method — open the URL with <code>.json</code> appended, save the file, and upload it here.</small>`);
        } finally {
            setLoading(false);
        }
    }

    function buildRedditJSONUrl(url) {
        try {
            const u = new URL(url);
            if (!u.hostname.includes('reddit.com')) return null;
            if (!u.pathname.includes('/comments/')) return null;
            // Remove trailing slash, strip existing .json, add .json
            let path = u.pathname.replace(/\/$/, '').replace(/\.json$/, '');
            return `https://www.reddit.com${path}.json?limit=500&raw_json=1`;
        } catch {
            return null;
        }
    }

    function slugFromURL(url) {
        try {
            const parts = new URL(url).pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('comments');
            return parts[idx + 1] || 'reddit-post';
        } catch { return 'reddit-post'; }
    }

    /* ── Convert from uploaded file ────────────────────────── */
    async function convertFromFile() {
        const file = fileInput.files[0];
        if (!file) { showStatus('error', 'ti-alert-circle', 'Please select a JSON file first.'); return; }

        setLoading(true);
        showStatus('info', 'ti-loader', 'Reading file…');

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const slug = file.name.replace(/\.json$/i, '') || 'reddit-post';
            processRedditData(data, slug);
        } catch (err) {
            showStatus('error', 'ti-alert-triangle', `Failed to parse the file: <strong>${err.message}</strong>`);
        } finally {
            setLoading(false);
        }
    }

    /* ── Core processing logic ─────────────────────────────── */
    function processRedditData(jsonData, slug) {
        try {
            if (!Array.isArray(jsonData) || jsonData.length < 2) {
                throw new Error('Unexpected JSON structure. Expected a two-element Reddit API array.');
            }

            const postListing = jsonData[0];
            const commentListing = jsonData[1];

            const postChild = postListing?.data?.children?.[0];
            if (!postChild) throw new Error('Could not find post data in the JSON.');

            const postData = postChild.data;

            /* ─ Post object ─ */
            const post = {
                title: postData.title ?? '',
                author: postData.author ?? '[deleted]',
                content: postData.selftext ?? '',
                url: postData.url ?? '',
                subreddit: postData.subreddit ?? '',
                permalink: `https://www.reddit.com${postData.permalink ?? ''}`,
            };

            if (optMetadata.checked) {
                post.id = postData.id;
                post.is_self = postData.is_self;
                post.num_comments = postData.num_comments;
                post.over_18 = postData.over_18;
                post.spoiler = postData.spoiler;
                post.locked = postData.locked;
                post.archived = postData.archived;
            }
            if (optScores.checked) {
                post.score = postData.score;
                post.upvote_ratio = postData.upvote_ratio;
            }
            if (optTimestamps.checked) {
                post.created_utc = postData.created_utc;
                post.created_iso = new Date(postData.created_utc * 1000).toISOString();
            }
            if (optFlair.checked) {
                post.link_flair_text = postData.link_flair_text ?? null;
                post.author_flair_text = postData.author_flair_text ?? null;
            }

            /* ─ Comments ─ */
            const rawComments = commentListing?.data?.children ?? [];
            const comments = optNested.checked
                ? extractNested(rawComments)
                : extractFlat(rawComments);

            /* ─ Final output ─ */
            const finalData = { post, comments };

            const json = JSON.stringify(finalData, null, 2);
            resultJSON = json;
            resultFilename = `${slug}.json`;

            showOutput(finalData, json);
            showStatus('success', 'ti-circle-check',
                `Success! Extracted post + <strong>${countComments(comments)}</strong> comment${countComments(comments) !== 1 ? 's' : ''}.`);

        } catch (err) {
            showStatus('error', 'ti-alert-triangle', `Conversion error: <strong>${err.message}</strong>`);
        }
    }

    /* ─ Flat extraction (matches original Node.js script) ─ */
    function extractFlat(children) {
        return children
            .filter(c => {
                if (c.kind !== 't1') return false;
                const body = c.data?.body ?? '';
                if (!optDeleted.checked && (body === '[deleted]' || body === '[removed]')) return false;
                return true;
            })
            .map(c => buildCommentObject(c.data));
    }

    /* ─ Nested extraction (recursive) ─ */
    function extractNested(children) {
        return children
            .filter(c => {
                if (c.kind !== 't1') return false;
                const body = c.data?.body ?? '';
                if (!optDeleted.checked && (body === '[deleted]' || body === '[removed]')) return false;
                return true;
            })
            .map(c => {
                const obj = buildCommentObject(c.data);
                const replies = c.data?.replies?.data?.children;
                if (Array.isArray(replies) && replies.length) {
                    obj.replies = extractNested(replies);
                } else {
                    obj.replies = [];
                }
                return obj;
            });
    }

    function buildCommentObject(data) {
        const obj = {
            author: data.author ?? '[deleted]',
            body: data.body ?? '',
        };
        if (optScores.checked) obj.score = data.score;
        if (optTimestamps.checked) {
            obj.created_utc = data.created_utc;
            obj.created_iso = new Date(data.created_utc * 1000).toISOString();
        }
        if (optFlair.checked) obj.author_flair_text = data.author_flair_text ?? null;
        if (optMetadata.checked) obj.id = data.id;
        return obj;
    }

    function countComments(comments) {
        if (!Array.isArray(comments)) return 0;
        let n = comments.length;
        comments.forEach(c => { if (c.replies) n += countComments(c.replies); });
        return n;
    }

    /* ── Show output ───────────────────────────────────────── */
    function showOutput(data, json) {
        outputSection.style.display = 'block';
        resetBtn.style.display = 'inline-flex';
        jsonFilename.textContent = resultFilename;

        const totalComments = countComments(data.comments);
        const sizeKB = (new Blob([json]).size / 1024).toFixed(1);

        outputStats.innerHTML = `
      <div class="stat-card">
        <p class="stat-label">Post</p>
        <p class="stat-value accent">1</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Comments</p>
        <p class="stat-value accent">${totalComments}</p>
      </div>
      <div class="stat-card">
        <p class="stat-label">File size</p>
        <p class="stat-value">${sizeKB} <span style="font-size:13px;color:var(--text-3)">KB</span></p>
      </div>
      <div class="stat-card">
        <p class="stat-label">Subreddit</p>
        <p class="stat-value" style="font-size:14px;padding-top:4px;">r/${data.post.subreddit || '—'}</p>
      </div>`;

        jsonOutput.innerHTML = syntaxHighlight(json);
        outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ── Syntax highlighting ───────────────────────────────── */
    function syntaxHighlight(json) {
        const escaped = json
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        return escaped.replace(
            /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
            match => {
                if (/^"/.test(match)) {
                    return match.endsWith(':')
                        ? `<span class="key">${match}</span>`
                        : `<span class="string">${match}</span>`;
                }
                if (/true|false/.test(match)) return `<span class="bool">${match}</span>`;
                if (/null/.test(match)) return `<span class="null">${match}</span>`;
                return `<span class="number">${match}</span>`;
            }
        );
    }

    /* ── Download ──────────────────────────────────────────── */
    downloadBtn.addEventListener('click', () => {
        if (!resultJSON) return;
        const blob = new Blob([resultJSON], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = resultFilename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    /* ── Copy ──────────────────────────────────────────────── */
    copyBtn.addEventListener('click', async () => {
        if (!resultJSON) return;
        try {
            await navigator.clipboard.writeText(resultJSON);
            copyBtn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Copied!';
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="ti ti-copy" aria-hidden="true"></i> Copy JSON';
            }, 2000);
        } catch {
            showStatus('warning', 'ti-alert-circle', 'Clipboard access denied. Use the download button instead.');
        }
    });

    /* ── Reset ─────────────────────────────────────────────── */
    resetBtn.addEventListener('click', () => {
        urlInput.value = '';
        fileInput.value = '';
        dropFilename.style.display = 'none';
        dropFilename.textContent = '';
        outputSection.style.display = 'none';
        resetBtn.style.display = 'none';
        resultJSON = null;
        clearStatus();
    });

})();
