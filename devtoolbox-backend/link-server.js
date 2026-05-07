/**
 * DevToolbox Backend — server.js
 * Link Analyzer API with BFS Crawling and SEO analysis
 */

'use strict';

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const pLimit = require('p-limit');
const { URL } = require('url');

const app = express();

/* ════════════════════════════════════════════════════════
   MIDDLEWARE
════════════════════════════════════════════════════════ */
app.use(express.json());
app.use(cors());

/* ════════════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════════════ */
const USER_AGENT = 'Mozilla/5.0 (compatible; DevToolbox-LinkChecker/1.0; +https://github.com/mokhhtar)';
const MAX_LINKS_CAP = 500;
const DEFAULT_TIMEOUT = 8000;
const SLOW_THRESHOLD = 3000;
const LONG_URL_LIMIT = 115;

const GENERIC_ANCHORS = new Set([
    'click here', 'here', 'read more', 'learn more', 'more', 'link', 'this',
    'this link', 'this page', 'page', 'website', 'site', 'visit', 'view',
    'download', 'continue', 'go', 'see more', 'find out more', 'more info',
    'details', 'info', 'open', 'check', 'check out', 'see', 'read',
]);

const ISSUE_META = {
    empty_anchor: { label: 'Empty anchor', severity: 'high', color: '#e87c4b' },
    generic_anchor: { label: 'Generic anchor', severity: 'medium', color: '#e8a82a' },
    broken: { label: 'Broken link', severity: 'critical', color: '#e24b4a' },
    redirect: { label: 'Redirect', severity: 'low', color: '#7c9ce8' },
    no_noopener: { label: 'No noopener', severity: 'medium', color: '#e8a82a' },
    nofollow: { label: 'Nofollow', severity: 'info', color: '#888' },
    sponsored: { label: 'Sponsored', severity: 'info', color: '#888' },
    ugc: { label: 'UGC', severity: 'info', color: '#888' },
    slow: { label: 'Slow response', severity: 'low', color: '#7c9ce8' },
    long_url: { label: 'Long URL', severity: 'low', color: '#7c9ce8' },
    not_https: { label: 'Not HTTPS', severity: 'medium', color: '#e8a82a' },
    image_no_alt: { label: 'Image no alt', severity: 'high', color: '#e87c4b' },
    self_link: { label: 'Self-link', severity: 'low', color: '#7c9ce8' },
};

/* ════════════════════════════════════════════════════════
   HELPERS — UTILS
════════════════════════════════════════════════════════ */

/** Normalize URL: add https:// if protocol is missing */
function normalizeUrl(input) {
    let url = input.trim();
    if (!url.match(/^[a-zA-Z]+:\/\//)) {
        url = 'https://' + url;
    }
    try {
        const u = new URL(url);
        if (!u.pathname) u.pathname = '/';
        return u.href;
    } catch {
        return null;
    }
}

async function checkLink(url, { timeout = DEFAULT_TIMEOUT, followRedirects = true, referer = '' } = {}) {
    const maxRedirects = followRedirects ? 5 : 0;
    const headers = { 
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': referer
    };
    const start = Date.now();

    const attempt = async (method, extra = {}) => {
        return axios({
            method,
            url,
            timeout,
            maxRedirects,
            validateStatus: () => true,
            headers,
            ...extra,
        });
    };

    try {
        const res = await attempt('head');
        const elapsed = Date.now() - start;
        const finalUrl = res.request?.res?.responseUrl || res.config?.url || url;
        return {
            statusCode: res.status,
            responseTime: elapsed,
            finalUrl: finalUrl !== url ? finalUrl : null,
        };
    } catch {
        try {
            const res = await attempt('get', { responseType: 'stream' });
            try { res.data?.destroy(); } catch { /* noop */ }
            const elapsed = Date.now() - start;
            const finalUrl = res.request?.res?.responseUrl || url;
            return {
                statusCode: res.status,
                responseTime: elapsed,
                finalUrl: finalUrl !== url ? finalUrl : null,
            };
        } catch (err) {
            return {
                statusCode: err.response?.status ?? 'Error',
                responseTime: Date.now() - start,
                finalUrl: null,
                error: err.code || err.message,
            };
        }
    }
}

function parseRel(relAttr) {
    if (!relAttr) return [];
    return relAttr.toLowerCase().split(/\s+/).filter(Boolean);
}

function detectIssues(link, pageUrl) {
    const issues = [];
    const text = (link.text || '').trim().toLowerCase();
    const rels = parseRel(link.rel);
    const sc = link.statusCode;

    if (!text && !(link.isImage && link.imageAlt)) issues.push('empty_anchor');
    if (text && GENERIC_ANCHORS.has(text)) issues.push('generic_anchor');
    if (typeof sc === 'number' && sc >= 400) issues.push('broken');
    if (typeof sc === 'number' && sc >= 300 && sc < 400) issues.push('redirect');
    if (link.target === '_blank' && !rels.includes('noopener') && !rels.includes('noreferrer')) issues.push('no_noopener');
    if (rels.includes('nofollow')) issues.push('nofollow');
    if (rels.includes('sponsored')) issues.push('sponsored');
    if (rels.includes('ugc')) issues.push('ugc');
    if (typeof link.responseTime === 'number' && link.responseTime > SLOW_THRESHOLD) issues.push('slow');
    if (link.url.length > LONG_URL_LIMIT) issues.push('long_url');
    if (link.url.startsWith('http://')) issues.push('not_https');
    if (link.isImage && !link.imageAlt) issues.push('image_no_alt');

    try {
        const target = new URL(link.url);
        const base = new URL(pageUrl);
        if (target.hostname === base.hostname && target.pathname === base.pathname && !target.hash) {
            issues.push('self_link');
        }
    } catch { }

    return issues;
}

function extractPageMeta($, targetUrl) {
    return {
        title: $('title').first().text().trim() || null,
        description: $('meta[name="description"]').attr('content')?.trim() || null,
        canonical: $('link[rel="canonical"]').attr('href')?.trim() || null,
        robotsMeta: $('meta[name="robots"]').attr('content')?.trim() || null,
        h1Count: $('h1').length,
        h2Count: $('h2').length,
        pageUrl: targetUrl,
    };
}

function extractLinks($, targetUrl, baseHostname) {
    const links = [];
    $('a[href]').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href')?.trim();
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return;

        let absoluteUrl;
        try { absoluteUrl = new URL(href, targetUrl).href; } catch { return; }

        const $img = $el.find('img').first();
        const isImage = $img.length > 0;
        const imageAlt = isImage ? ($img.attr('alt')?.trim() || '') : null;
        let text = $el.text().trim();
        if (!text && isImage) text = imageAlt || '';

        const linkHostname = new URL(absoluteUrl).hostname;
        const type = linkHostname === baseHostname ? 'internal' : 'external';

        links.push({
            url: absoluteUrl,
            text: text || '',
            type,
            rel: $el.attr('rel')?.trim() || null,
            target: $el.attr('target') || null,
            isImage,
            imageAlt,
        });
    });
    return links;
}

function buildSummary(links) {
    const summary = {
        total: links.length, internal: 0, external: 0,
        broken: 0, redirects: 0, nofollow: 0, totalIssues: 0,
        statusGroups: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, 'error': 0 },
        avgResponseTime: null,
    };
    let timeSum = 0, timeCount = 0;
    for (const l of links) {
        if (l.type === 'internal') summary.internal++; else summary.external++;
        const sc = l.statusCode;
        if (typeof sc === 'number') {
            if (sc >= 200 && sc < 300) summary.statusGroups['2xx']++;
            else if (sc >= 300 && sc < 400) { summary.statusGroups['3xx']++; summary.redirects++; }
            else if (sc >= 400 && sc < 500) { summary.statusGroups['4xx']++; summary.broken++; }
            else if (sc >= 500) { summary.statusGroups['5xx']++; summary.broken++; }
        } else summary.statusGroups['error']++;
        if (typeof l.responseTime === 'number') { timeSum += l.responseTime; timeCount++; }
        if ((l.issues || []).length) summary.totalIssues++;
        if ((l.issues || []).includes('nofollow')) summary.nofollow++;
    }
    if (timeCount > 0) summary.avgResponseTime = Math.round(timeSum / timeCount);
    return summary;
}

/* ════════════════════════════════════════════════════════
   ROUTES
════════════════════════════════════════════════════════ */
app.get('/health', (_, res) => {
    res.json({ status: 'ok', version: '1.1.0', tool: 'DevToolbox Backend' });
});

app.post('/api/analyze', async (req, res) => {
    const {
        url: rawUrl, checkStatus = true, maxLinks = 100,
        concurrency = 5, followRedirects = true,
        includeExternal = true, includeInternal = true,
        depth = 0 // New param for BFS crawling
    } = req.body;

    const targetUrl = normalizeUrl(rawUrl);
    if (!targetUrl) return res.status(400).json({ error: 'Invalid URL. Please include http:// or https://' });

    const baseUrlObj = new URL(targetUrl);
    const baseHostname = baseUrlObj.hostname;
    const cappedMax = Math.min(parseInt(maxLinks, 10) || 100, MAX_LINKS_CAP);
    const cappedCon = Math.min(parseInt(concurrency, 10) || 5, 15);
    const cappedDepth = Math.min(parseInt(depth, 10) || 0, 3); // Max depth 3 for safety

    /* ── BFS Crawling Logic ── */
    const visited = new Set();
    const queue = [{ url: targetUrl, d: 0 }];
    const allExtractedLinks = new Map(); // Use Map to store unique links with context
    let pageMeta = null;

    while (queue.length > 0 && allExtractedLinks.size < cappedMax) {
        const { url: currentUrl, d: currentDepth } = queue.shift();
        if (visited.has(currentUrl)) continue;
        visited.add(currentUrl);

        try {
            const resp = await axios.get(currentUrl, {
                timeout: 10000,
                headers: { 
                    'User-Agent': USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml'
                },
                validateStatus: () => true,
            });

            if (resp.status >= 400) continue;
            const contentType = resp.headers['content-type'] || '';
            if (!contentType.includes('text/html')) continue;

            const $ = cheerio.load(resp.data);
            
            // Set meta only for the initial page
            if (currentUrl === targetUrl) {
                pageMeta = extractPageMeta($, targetUrl);
            }

            const pageLinks = extractLinks($, currentUrl, baseHostname);

            for (const link of pageLinks) {
                if (allExtractedLinks.size >= cappedMax) break;
                
                // Add to results
                if (!allExtractedLinks.has(link.url)) {
                    // Filter by type
                    if (link.type === 'internal' && !includeInternal) continue;
                    if (link.type === 'external' && !includeExternal) continue;
                    allExtractedLinks.set(link.url, link);
                }

                // If it's an internal link and we haven't reached depth limit, add to queue
                if (currentDepth < cappedDepth && link.type === 'internal' && !visited.has(link.url)) {
                    queue.push({ url: link.url, d: currentDepth + 1 });
                }
            }
        } catch (err) {
            console.error(`Error crawling ${currentUrl}: ${err.message}`);
        }
    }

    let finalLinks = Array.from(allExtractedLinks.values());

    /* ── Status check (concurrent) ── */
    if (checkStatus && finalLinks.length > 0) {
        const limit = pLimit(cappedCon);
        await Promise.all(finalLinks.map(link =>
            limit(async () => {
                const result = await checkLink(link.url, { followRedirects, referer: targetUrl });
                link.statusCode = result.statusCode;
                link.responseTime = result.responseTime;
                link.finalUrl = result.finalUrl;
                link.error = result.error || null;
            })
        ));
    }

    finalLinks.forEach(link => { link.issues = detectIssues(link, targetUrl); });
    const summary = buildSummary(finalLinks);

    res.json({
        meta: pageMeta || { pageUrl: targetUrl, title: 'Analysis Complete' },
        summary: { ...summary, truncated: finalLinks.length >= cappedMax, maxLinks: cappedMax },
        issueMeta: ISSUE_META,
        links: finalLinks,
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n  DevToolbox Backend running on port ${PORT}\n`);
});