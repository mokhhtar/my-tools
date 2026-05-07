/**
 * reddit-converter.js
 * Supports: single URL · keyword bulk search · file upload
 * Grooming analysis: product tagging · sentiment hints · Q&A pairs
 */

(function () {
    'use strict';

    /* ═══════════════════════════════════════════════════════
       GROOMING DICTIONARY
       Brand names, product categories, and sentiment signals
       relevant to the shaving / haircare niche.
    ════════════════════════════════════════════════════════ */
    const GROOMING_DICT = {
        razors: [
            'merkur', 'feather', 'astra', 'gillette', 'wilkinson', 'personna', 'derby',
            'vikings blade', 'vikings_blade', 'rockwell', 'parker', 'muhle', 'mühle',
            'henson', 'karve', 'timeless', 'colonial', 'blackland', 'charcoal goods',
            'fatboy', 'futur', 'progress', 'slim', 'superspeed', 'tech', 'old spice razor',
            'dollar shave', 'dsc', 'bic', 'schick', 'hydro', 'mach3', 'fusion', 'proglide',
            'sensor', 'atra', 'trac ii', 'venus', 'safeguard', 'braun', 'philips', 'norelco',
            'panasonic', 'wahl', 'andis', 'remington', 'bevel', 'harry\'s', 'harrys',
            'supply razor', 'grüum', 'gruum', 'bambaw', 'hims razor', 'van der hagen',
        ],
        blades: [
            'double edge', 'de blade', 'safety razor', 'straight razor', 'shavette',
            'cartridge', 'disposable', 'blade', 'feather blade', 'astra blade',
        ],
        shaving_products: [
            'shaving cream', 'shave cream', 'shaving soap', 'shave soap', 'lather',
            'pre-shave', 'pre shave', 'aftershave', 'after shave', 'alum block',
            'styptic', 'witch hazel', 'proraso', 'tabac', 'tobs', 'taylor of old bond',
            'trumpers', 'penhaligons', 'arko', 'palmolive', 'col conk', 'williams mug soap',
            'cremo', 'pacific shaving', 'myrsol', 'speick', 'cella', 'lea', 'razorock',
            'lieutenant blades', 'noble otter', 'stirling', 'barrister and mann', 'b&m',
            'declaration grooming', 'wholly kaw',
        ],
        brushes: [
            'shaving brush', 'badger brush', 'boar brush', 'synthetic brush',
            'silvertip', 'two band', 'knot', 'loft', 'simpson', 'semogue', 'omega',
            'muhle brush', 'yaqi', 'maggard',
        ],
        haircare: [
            'shampoo', 'conditioner', 'hair mask', 'hair oil', 'argan oil', 'coconut oil',
            'castor oil', 'hair serum', 'leave-in', 'dry shampoo', 'clarifying shampoo',
            'sulfate free', 'silicone free', 'co-wash', 'cowash', 'low poo', 'no poo',
            'hair loss', 'alopecia', 'shedding', 'thinning hair', 'receding hairline',
            'minoxidil', 'rogaine', 'finasteride', 'propecia', 'hims', 'keeps', 'foligain',
            'nioxin', 'viviscal', 'nutrafol', 'biotin', 'ketoconazole', 'nizoral',
            'head shoulders', 'head & shoulders', 'selsun', 't/sal', 't/gel',
            'olaplex', 'k18', 'bond repair', 'protein treatment', 'deep conditioning',
            'hard water hair', 'chelating', 'clarify', 'buildup',
        ],
        beard_grooming: [
            'beard oil', 'beard balm', 'beard butter', 'beard wax', 'mustache wax',
            'beard wash', 'beard shampoo', 'beard comb', 'beard brush', 'boar bristle',
            'jojoba', 'grapeseed', 'sweet almond', 'argan beard',
            'stubble', 'goatee', 'soul patch', 'handlebar', 'full beard', 'lumberjack',
        ],
        skincare: [
            'moisturizer', 'spf', 'sunscreen', 'retinol', 'niacinamide', 'hyaluronic acid',
            'vitamin c serum', 'aha', 'bha', 'salicylic', 'glycolic', 'lactic acid',
            'cerave', 'cetaphil', 'la roche-posay', 'la roche posay', 'vanicream',
            'eucerin', 'neutrogena', 'olay', 'stridex', 'paula\'s choice', 'paulas choice',
            'the ordinary', 'inkey list', 'cosrx', 'skincare routine',
        ],
        tools: [
            'trimmer', 'clipper', 'electric shaver', 'foil shaver', 'rotary shaver',
            'epilator', 'dermaplaning', 'derma roller', 'gua sha',
        ],
    };

    const POSITIVE_SIGNALS = [
        'love', 'amazing', 'excellent', 'perfect', 'great', 'best', 'recommend',
        'highly recommend', 'worth it', 'game changer', 'life changing', 'obsessed',
        'fantastic', 'superb', 'outstanding', 'impressive', 'flawless', 'smooth',
        'works great', 'works well', 'no complaints', '5 stars', '10/10',
        'my go-to', 'my goto', 'switched to', 'will never go back',
    ];

    const NEGATIVE_SIGNALS = [
        'terrible', 'horrible', 'worst', 'awful', 'bad', 'poor quality', 'cheap',
        'broke', 'breaking', 'stopped working', 'waste of money', 'overpriced',
        'not worth', 'disappointed', 'regret', 'razor burn', 'irritation',
        'ingrown', 'cuts', 'nicks', 'rash', 'itchy', 'dry', 'brittle',
        'hair loss', 'shedding', 'damage', 'breakage', 'returned it', 'avoid',
        'do not buy', 'stay away', '1 star', '0 stars',
    ];

    /* ═══════════════════════════════════════════════════════
       DOM REFERENCES
    ════════════════════════════════════════════════════════ */
    const $ = id => document.getElementById(id);
    const $$ = sel => document.querySelectorAll(sel);

    const tabBtns = $$('.tab-btn');
    const tabPanels = $$('.tab-panel');
    const convertBtn = $('convert-btn');
    const resetBtn = $('reset-btn');
    const statusArea = $('status-area');
    const outputSection = $('output-section');
    const outputStats = $('output-stats');
    const jsonOutput = $('json-output');
    const jsonFilename = $('json-filename');
    const downloadBtn = $('download-btn');
    const copyBtn = $('copy-btn');
    const dropZone = $('drop-zone');
    const fileInput = $('file-input');
    const dropFilename = $('drop-filename');
    const urlInput = $('reddit-url');
    const postsListWrap = $('posts-list-wrap');
    const postsList = $('posts-list');

    /* Keywords panel */
    const kwInput = $('kw-input');
    const srScopeRadios = $$('[name="sr-scope"]');
    const srInputWrap = $('sr-input-wrap');
    const srInput = $('sr-input');
    const kwLimit = $('kw-limit');
    const kwSort = $('kw-sort');
    const kwTime = $('kw-time');
    const minComments = $('min-comments');
    const minScore = $('min-score');
    const minCommentLen = $('min-comment-len');
    const kwProgress = $('kw-progress');
    const kwProgressBar = $('kw-progress-bar');
    const kwProgressLbl = $('kw-progress-label');
    const kwProgressMsg = $('kw-progress-msg');

    /* Options */
    const opts = {
        metadata: () => $('opt-metadata').checked,
        deleted: () => $('opt-deleted').checked,
        nested: () => $('opt-nested').checked,
        scores: () => $('opt-scores').checked,
        timestamps: () => $('opt-timestamps').checked,
        flair: () => $('opt-flair').checked,
        groomingTags: () => $('opt-grooming-tags').checked,
        sentiment: () => $('opt-sentiment-hints').checked,
        qaPairs: () => $('opt-qa-pairs').checked,
        awards: () => $('opt-awards').checked,
        selfOnly: () => $('opt-selfonly').checked,
        delay: () => $('opt-delay').checked,
    };

    let currentTab = 'url';
    let resultJSON = null;
    let resultFile = 'output.json';
    let abortCtrl = null;

    /* ═══════════════════════════════════════════════════════
       TAB SWITCHING
    ════════════════════════════════════════════════════════ */
    tabBtns.forEach(btn => btn.addEventListener('click', () => {
        currentTab = btn.dataset.tab;
        tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        tabPanels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
        document.getElementById('panel-' + currentTab).classList.add('active');
        clearStatus();
    }));

    /* ═══════════════════════════════════════════════════════
       SUBREDDIT SCOPE RADIO
    ════════════════════════════════════════════════════════ */
    srScopeRadios.forEach(r => r.addEventListener('change', () => {
        const specific = document.querySelector('[name="sr-scope"]:checked').value === 'specific';
        srInputWrap.style.display = specific ? 'block' : 'none';
    }));

    /* ═══════════════════════════════════════════════════════
       QUICK-PICK CHIPS
    ════════════════════════════════════════════════════════ */
    $$('.qp-chip:not(.qp-chip--sub)').forEach(chip => {
        chip.addEventListener('click', () => {
            kwInput.value = chip.dataset.kw;
            kwInput.focus();
            clearStatus();
        });
    });

    $$('.qp-chip--sub').forEach(chip => {
        chip.addEventListener('click', () => {
            // Switch radio to "specific"
            document.querySelector('[name="sr-scope"][value="specific"]').checked = true;
            srInputWrap.style.display = 'block';
            srInput.value = chip.dataset.sr;
            // Highlight selected chip
            $$('.qp-chip--sub').forEach(c => c.classList.remove('qp-active'));
            chip.classList.add('qp-active');
            clearStatus();
        });
    });

    /* ═══════════════════════════════════════════════════════
       FILE DRAG & DROP
    ════════════════════════════════════════════════════════ */
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const f = e.dataTransfer.files[0];
        if (f) { fileInput.files = e.dataTransfer.files; handleFileSelected(f); }
    });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFileSelected(fileInput.files[0]); });

    function handleFileSelected(f) {
        dropFilename.textContent = '📄 ' + f.name;
        dropFilename.style.display = 'inline-block';
        clearStatus();
    }

    /* ═══════════════════════════════════════════════════════
       STATUS HELPERS
    ════════════════════════════════════════════════════════ */
    function showStatus(type, icon, msg) {
        statusArea.innerHTML = `
      <div class="alert alert-${type}" style="margin-bottom:20px;" role="alert">
        <i class="ti ${icon}" aria-hidden="true"></i>
        <span>${msg}</span>
      </div>`;
    }
    function clearStatus() { statusArea.innerHTML = ''; }

    function setLoading(on, label) {
        convertBtn.disabled = on;
        convertBtn.innerHTML = on
            ? `<span class="spinner" aria-hidden="true"></span> ${label || 'Working…'}`
            : '<i class="ti ti-transform" aria-hidden="true"></i> Convert to JSON';
    }

    /* ═══════════════════════════════════════════════════════
       MAIN CONVERT ENTRY
    ════════════════════════════════════════════════════════ */
    convertBtn.addEventListener('click', async () => {
        clearStatus();
        outputSection.style.display = 'none';
        postsListWrap.style.display = 'none';
        resultJSON = null;
        resetBtn.style.display = 'none';
        kwProgress.style.display = 'none';

        if (currentTab === 'url') await convertFromURL();
        else if (currentTab === 'keywords') await convertFromKeywords();
        else await convertFromFile();
    });

    /* ═══════════════════════════════════════════════════════
       MODE 1 — SINGLE URL
    ════════════════════════════════════════════════════════ */
    async function convertFromURL() {
        const raw = urlInput.value.trim();
        if (!raw) { showStatus('error', 'ti-alert-circle', 'Please enter a Reddit post URL.'); return; }

        const apiURL = buildPostJSONUrl(raw);
        if (!apiURL) {
            showStatus('error', 'ti-alert-circle', 'That doesn\'t look like a Reddit post URL — it must contain <code>/comments/</code>.');
            return;
        }

        setLoading(true, 'Fetching post…');
        showStatus('info', 'ti-loader', 'Fetching post data from Reddit…');

        try {
            const data = await fetchJSON(apiURL);
            processRedditData(data, slugFromURL(raw));
        } catch (err) {
            showStatus('error', 'ti-alert-triangle',
                `Could not fetch: <strong>${err.message}</strong><br>
         <small>Tip: try the file upload method — open the post URL with <code>.json</code> appended, save the page, then upload here.</small>`);
        } finally {
            setLoading(false);
        }
    }

    /* ═══════════════════════════════════════════════════════
       MODE 2 — KEYWORD SEARCH (bulk)
    ════════════════════════════════════════════════════════ */
    async function convertFromKeywords() {
        const kw = kwInput.value.trim();
        if (!kw) { showStatus('error', 'ti-alert-circle', 'Please enter a keyword or phrase.'); return; }

        const scope = document.querySelector('[name="sr-scope"]:checked').value;
        const sub = srInput.value.trim().replace(/^r\//, '');
        const limit = parseInt(kwLimit.value, 10);
        const sort = kwSort.value;
        const time = kwTime.value;
        const minC = parseInt(minComments.value, 10) || 0;
        const minS = parseInt(minScore.value, 10) || 0;
        const minCLen = parseInt(minCommentLen.value, 10) || 0;
        const selfOnly = opts.selfOnly();
        const useDelay = opts.delay();

        /* Build search URL */
        let searchURL;
        if (scope === 'specific' && sub) {
            searchURL = `https://www.reddit.com/r/${encodeURIComponent(sub)}/search.json` +
                `?q=${encodeURIComponent(kw)}&restrict_sr=1&sort=${sort}&t=${time}&limit=${limit}&raw_json=1`;
        } else {
            searchURL = `https://www.reddit.com/search.json` +
                `?q=${encodeURIComponent(kw)}&sort=${sort}&t=${time}&limit=${limit}&raw_json=1`;
        }

        setLoading(true, 'Searching…');
        showStatus('info', 'ti-loader', `Searching Reddit for "<strong>${kw}</strong>"…`);

        let searchData;
        try {
            searchData = await fetchJSON(searchURL);
        } catch (err) {
            showStatus('error', 'ti-alert-triangle', `Search failed: <strong>${err.message}</strong>`);
            setLoading(false);
            return;
        }

        /* Extract posts from search results */
        const allPosts = (searchData?.data?.children ?? [])
            .filter(c => c.kind === 't3')
            .map(c => c.data)
            .filter(p => {
                if (p.num_comments < minC) return false;
                if (p.score < minS) return false;
                if (selfOnly && !p.is_self) return false;
                return true;
            });

        if (!allPosts.length) {
            showStatus('warning', 'ti-alert-circle',
                `No posts matched your filters (min ${minC} comments, min score ${minS}${selfOnly ? ', text posts only' : ''}).<br>Try relaxing the quality filters.`);
            setLoading(false);
            return;
        }

        /* Show progress bar */
        kwProgress.style.display = 'block';
        kwProgressBar.style.width = '0%';
        kwProgressLbl.textContent = `0 / ${allPosts.length}`;
        kwProgressMsg.textContent = 'Starting…';

        const results = [];
        const skipped = [];
        const slugBase = kw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40);
        resultFile = `${slugBase}.json`;

        /* Fetch each post's comments */
        for (let i = 0; i < allPosts.length; i++) {
            const p = allPosts[i];
            const pct = Math.round(((i) / allPosts.length) * 100);

            kwProgressBar.style.width = pct + '%';
            kwProgressLbl.textContent = `${i} / ${allPosts.length}`;
            kwProgressMsg.textContent = `Fetching: ${p.title.slice(0, 60)}…`;

            const postURL = `https://www.reddit.com${p.permalink}.json?limit=500&raw_json=1`;

            try {
                if (useDelay && i > 0) await sleep(400);
                const postData = await fetchJSON(postURL);
                const processed = processRedditData(postData, null, { minCommentLen: minCLen });
                if (processed) results.push(processed);
            } catch (err) {
                skipped.push({ title: p.title, reason: err.message });
            }
        }

        kwProgressBar.style.width = '100%';
        kwProgressLbl.textContent = `${results.length} / ${allPosts.length}`;
        kwProgressMsg.textContent = 'Done!';
        setLoading(false);

        if (!results.length) {
            showStatus('error', 'ti-alert-triangle', 'All posts failed to fetch. Reddit may be rate-limiting — try again in a few minutes or use the file upload method.');
            return;
        }

        /* Build final bulk JSON */
        const totalComments = results.reduce((n, r) => n + countComments(r.comments), 0);
        const bulkData = {
            metadata: {
                query: kw,
                subreddit: scope === 'specific' && sub ? sub : 'all',
                sort: sort,
                time_period: time,
                filters: { min_comments: minC, min_score: minS, self_posts_only: selfOnly, min_comment_length: minCLen },
                total_posts: results.length,
                total_comments: totalComments,
                skipped_posts: skipped.length,
                fetched_at_iso: new Date().toISOString(),
            },
            posts: results,
        };
        if (skipped.length) bulkData.metadata.skipped_details = skipped;

        const json = JSON.stringify(bulkData, null, 2);
        resultJSON = json;

        showBulkOutput(bulkData, json, results);
        const skipNote = skipped.length ? ` (<strong>${skipped.length}</strong> failed to fetch)` : '';
        showStatus('success', 'ti-circle-check',
            `Done! Collected <strong>${results.length} posts</strong> and <strong>${totalComments} comments</strong>${skipNote}.`);
    }

    /* ═══════════════════════════════════════════════════════
       MODE 3 — FILE UPLOAD
    ════════════════════════════════════════════════════════ */
    async function convertFromFile() {
        const f = fileInput.files[0];
        if (!f) { showStatus('error', 'ti-alert-circle', 'Please select a JSON file first.'); return; }

        setLoading(true, 'Reading file…');
        showStatus('info', 'ti-loader', 'Parsing file…');

        try {
            const text = await f.text();
            const data = JSON.parse(text);
            processRedditData(data, f.name.replace(/\.json$/i, '') || 'reddit-post');
        } catch (err) {
            showStatus('error', 'ti-alert-triangle', `Failed to parse: <strong>${err.message}</strong>`);
        } finally {
            setLoading(false);
        }
    }

    /* ═══════════════════════════════════════════════════════
       CORE PROCESSING — single post
       Returns the processed object (for bulk mode) OR
       shows output and returns null (for single mode).
    ════════════════════════════════════════════════════════ */
    function processRedditData(jsonData, slug, overrides) {
        overrides = overrides || {};
        try {
            if (!Array.isArray(jsonData) || jsonData.length < 2)
                throw new Error('Unexpected structure — expected a 2-element Reddit API array.');

            const postChild = jsonData[0]?.data?.children?.[0];
            if (!postChild) throw new Error('Could not find post data.');

            const pd = postChild.data;

            /* ── Post object ─────────────────────────────── */
            const post = {
                title: pd.title ?? '',
                author: pd.author ?? '[deleted]',
                content: pd.selftext ?? '',
                url: pd.url ?? '',
                subreddit: pd.subreddit ?? '',
                permalink: `https://www.reddit.com${pd.permalink ?? ''}`,
            };

            if (opts.metadata()) {
                Object.assign(post, {
                    id: pd.id,
                    is_self: pd.is_self,
                    num_comments: pd.num_comments,
                    over_18: pd.over_18,
                    spoiler: pd.spoiler,
                    locked: pd.locked,
                    archived: pd.archived,
                    domain: pd.domain,
                });
            }
            if (opts.scores()) { post.score = pd.score; post.upvote_ratio = pd.upvote_ratio; }
            if (opts.timestamps()) { post.created_utc = pd.created_utc; post.created_iso = toISO(pd.created_utc); }
            if (opts.flair()) { post.link_flair_text = pd.link_flair_text ?? null; post.author_flair_text = pd.author_flair_text ?? null; }
            if (opts.awards()) { post.total_awards_received = pd.total_awards_received ?? 0; }
            if (opts.groomingTags()) post.grooming_tags = extractGroomingTags(pd.title + ' ' + (pd.selftext ?? ''));
            if (opts.sentiment()) post.sentiment = detectSentiment(pd.title + ' ' + (pd.selftext ?? ''));

            /* ── Comments ────────────────────────────────── */
            const rawComments = jsonData[1]?.data?.children ?? [];
            const minLen = overrides.minCommentLen ?? 0;
            const comments = opts.nested()
                ? extractNested(rawComments, minLen)
                : extractFlat(rawComments, minLen);

            const result = { post, comments };

            /* ── Q&A pairs (optional) ──────────────────── */
            if (opts.qaPairs()) {
                const topComment = [...(jsonData[1]?.data?.children ?? [])]
                    .filter(c => {
                        if (c.kind !== 't1') return false;
                        const author = (c.data?.author ?? '').toLowerCase();
                        if (author === 'automoderator' || author.endsWith('bot')) return false;
                        return !isDeletedBody(c.data?.body);
                    })
                    .sort((a, b) => (b.data?.score ?? 0) - (a.data?.score ?? 0))[0];

                if (topComment) {
                    result.qa_pair = {
                        question: pd.title,
                        answer: topComment.data.body,
                        answer_author: topComment.data.author,
                        answer_score: topComment.data.score,
                    };
                }
            }

            /* ── Single-post mode: show output inline ─── */
            if (slug !== null) {
                const json = JSON.stringify(result, null, 2);
                resultJSON = json;
                resultFile = `${slug}.json`;
                jsonFilename.textContent = resultFile;
                showSingleOutput(result, json);
                showStatus('success', 'ti-circle-check',
                    `Extracted post + <strong>${countComments(comments)}</strong> comment${countComments(comments) !== 1 ? 's' : ''}.`);
            }

            return result;

        } catch (err) {
            if (slug !== null) showStatus('error', 'ti-alert-triangle', `Conversion error: <strong>${err.message}</strong>`);
            return null;
        }
    }

    /* ═══════════════════════════════════════════════════════
       COMMENT EXTRACTION
    ════════════════════════════════════════════════════════ */
    function extractFlat(children, minLen) {
        return children
            .filter(c => isValidComment(c, minLen))
            .map(c => buildComment(c.data));
    }

    function extractNested(children, minLen) {
        return children
            .filter(c => isValidComment(c, minLen))
            .map(c => {
                const obj = buildComment(c.data);
                const replies = c.data?.replies?.data?.children;
                obj.replies = (Array.isArray(replies) && replies.length)
                    ? extractNested(replies, minLen) : [];
                return obj;
            });
    }

    function isValidComment(c, minLen) {
        if (c.kind !== 't1') return false;

        const body = c.data?.body ?? '';
        const author = (c.data?.author ?? '').toLowerCase();

        // Exclude AutoModerator and other bot accounts
        if (author === 'automoderator' || author.endsWith('bot')) return false;

        if (!opts.deleted() && isDeletedBody(body)) return false;
        if (body.length < (minLen || 0)) return false;
        return true;
    }

    function buildComment(d) {
        const obj = { author: d.author ?? '[deleted]', body: d.body ?? '' };
        if (opts.scores()) { obj.score = d.score; }
        if (opts.timestamps()) { obj.created_utc = d.created_utc; obj.created_iso = toISO(d.created_utc); }
        if (opts.flair()) { obj.author_flair_text = d.author_flair_text ?? null; }
        if (opts.metadata()) { obj.id = d.id; }
        if (opts.awards()) { obj.total_awards_received = d.total_awards_received ?? 0; }
        if (opts.groomingTags()) obj.grooming_tags = extractGroomingTags(d.body ?? '');
        if (opts.sentiment()) obj.sentiment = detectSentiment(d.body ?? '');
        return obj;
    }

    function isDeletedBody(b) { return b === '[deleted]' || b === '[removed]'; }

    /* ═══════════════════════════════════════════════════════
       GROOMING ANALYSIS
    ════════════════════════════════════════════════════════ */
    function extractGroomingTags(text) {
        const lower = text.toLowerCase();
        const tags = new Set();

        Object.entries(GROOMING_DICT).forEach(([category, terms]) => {
            terms.forEach(term => {
                if (lower.includes(term.toLowerCase())) tags.add(category + ':' + term);
            });
        });

        return [...tags];
    }

    function detectSentiment(text) {
        const lower = text.toLowerCase();
        let pos = 0, neg = 0;

        POSITIVE_SIGNALS.forEach(s => { if (lower.includes(s)) pos++; });
        NEGATIVE_SIGNALS.forEach(s => { if (lower.includes(s)) neg++; });

        if (pos === 0 && neg === 0) return 'neutral';
        if (pos > neg) return 'positive';
        if (neg > pos) return 'negative';
        return 'mixed';
    }

    /* ═══════════════════════════════════════════════════════
       OUTPUT RENDERING — single post
    ════════════════════════════════════════════════════════ */
    function showSingleOutput(data, json) {
        postsListWrap.style.display = 'none';
        resetBtn.style.display = 'inline-flex';
        outputSection.style.display = 'block';
        jsonFilename.textContent = resultFile;

        const n = countComments(data.comments);
        const kb = (new Blob([json]).size / 1024).toFixed(1);

        outputStats.innerHTML = buildStatCards([
            { label: 'Post', value: '1', accent: true },
            { label: 'Comments', value: n, accent: true },
            { label: 'File size', value: `${kb} KB` },
            { label: 'Subreddit', value: `r/${data.post.subreddit || '—'}`, small: true },
        ]);

        jsonOutput.innerHTML = syntaxHighlight(json);
        outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ═══════════════════════════════════════════════════════
       OUTPUT RENDERING — bulk (keywords)
    ════════════════════════════════════════════════════════ */
    function showBulkOutput(data, json, results) {
        resetBtn.style.display = 'inline-flex';
        outputSection.style.display = 'block';
        jsonFilename.textContent = resultFile;

        const totalC = data.metadata.total_comments;
        const kb = (new Blob([json]).size / 1024).toFixed(1);

        outputStats.innerHTML = buildStatCards([
            { label: 'Posts', value: results.length, accent: true },
            { label: 'Comments', value: totalC, accent: true },
            { label: 'File size', value: `${kb} KB` },
            { label: 'Query', value: data.metadata.query.slice(0, 22), small: true },
        ]);

        /* Post list */
        if (results.length) {
            postsListWrap.style.display = 'block';
            postsList.innerHTML = results.map((r, i) => `
        <div class="post-list-item">
          <span class="post-list-num">${i + 1}</span>
          <div class="post-list-body">
            <a href="${r.post.permalink}" target="_blank" rel="noopener" class="post-list-title">
              ${escapeHTML(r.post.title)}
            </a>
            <div class="post-list-meta">
              <span>r/${r.post.subreddit}</span>
              ${r.post.score !== undefined ? `<span>↑ ${r.post.score}</span>` : ''}
              <span>${countComments(r.comments)} comments</span>
              ${r.post.sentiment ? `<span class="sent-badge sent-${r.post.sentiment}">${r.post.sentiment}</span>` : ''}
            </div>
          </div>
        </div>`).join('');
        }

        jsonOutput.innerHTML = syntaxHighlight(json);
        outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ═══════════════════════════════════════════════════════
       HELPERS
    ════════════════════════════════════════════════════════ */
    function buildStatCards(cards) {
        return cards.map(c => `
      <div class="stat-card">
        <p class="stat-label">${c.label}</p>
        <p class="stat-value${c.accent ? ' accent' : ''}${c.small ? ' small' : ''}">${c.value}</p>
      </div>`).join('');
    }

    function buildPostJSONUrl(url) {
        try {
            const u = new URL(url);
            if (!u.hostname.includes('reddit.com')) return null;
            if (!u.pathname.includes('/comments/')) return null;
            let path = u.pathname.replace(/\/$/, '').replace(/\.json$/, '');
            return `https://www.reddit.com${path}.json?limit=500&raw_json=1`;
        } catch { return null; }
    }

    function slugFromURL(url) {
        try {
            const parts = new URL(url).pathname.split('/').filter(Boolean);
            const idx = parts.indexOf('comments');
            return parts[idx + 1] || 'reddit-post';
        } catch { return 'reddit-post'; }
    }

    function toISO(utc) {
        if (!utc) return null;
        return new Date(utc * 1000).toISOString();
    }

    function countComments(comments) {
        if (!Array.isArray(comments)) return 0;
        return comments.reduce((n, c) => n + 1 + countComments(c.replies || []), 0);
    }

    async function fetchJSON(url) {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} from Reddit`);
        return res.json();
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function escapeHTML(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ═══════════════════════════════════════════════════════
       SYNTAX HIGHLIGHTING
    ════════════════════════════════════════════════════════ */
    function syntaxHighlight(json) {
        return escapeHTML(json).replace(
            /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(\.\d+)?([eE][+-]?\d+)?)/g,
            m => {
                if (/^"/.test(m)) return m.endsWith(':') ? `<span class="key">${m}</span>` : `<span class="string">${m}</span>`;
                if (/true|false/.test(m)) return `<span class="bool">${m}</span>`;
                if (/null/.test(m)) return `<span class="null">${m}</span>`;
                return `<span class="number">${m}</span>`;
            }
        );
    }

    /* ═══════════════════════════════════════════════════════
       DOWNLOAD & COPY
    ════════════════════════════════════════════════════════ */
    downloadBtn.addEventListener('click', () => {
        if (!resultJSON) return;
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(new Blob([resultJSON], { type: 'application/json' })),
            download: resultFile,
        });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    copyBtn.addEventListener('click', async () => {
        if (!resultJSON) return;
        try {
            await navigator.clipboard.writeText(resultJSON);
            copyBtn.innerHTML = '<i class="ti ti-check" aria-hidden="true"></i> Copied!';
            setTimeout(() => { copyBtn.innerHTML = '<i class="ti ti-copy" aria-hidden="true"></i> Copy JSON'; }, 2000);
        } catch {
            showStatus('warning', 'ti-alert-circle', 'Clipboard access denied — use the download button instead.');
        }
    });

    /* ═══════════════════════════════════════════════════════
       RESET
    ════════════════════════════════════════════════════════ */
    resetBtn.addEventListener('click', () => {
        urlInput.value = '';
        kwInput.value = '';
        srInput.value = '';
        fileInput.value = '';
        dropFilename.style.display = 'none';
        outputSection.style.display = 'none';
        postsListWrap.style.display = 'none';
        kwProgress.style.display = 'none';
        resetBtn.style.display = 'none';
        resultJSON = null;
        clearStatus();
        $$('.qp-chip--sub').forEach(c => c.classList.remove('qp-active'));
        document.querySelector('[name="sr-scope"][value="all"]').checked = true;
        srInputWrap.style.display = 'none';
    });

})();