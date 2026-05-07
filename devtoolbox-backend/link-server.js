/**
 * DevToolbox Backend — server.js
 * Link Analyzer API v1.3.0
 * Pure BFS Crawler with Image Discovery
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
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_LINKS_CAP = 2000; 
const DEFAULT_TIMEOUT = 10000;
const SLOW_THRESHOLD = 3000;

const ISSUE_META = {
    empty_anchor: { label: 'Empty anchor', severity: 'high', color: '#e87c4b' },
    generic_anchor: { label: 'Generic anchor', severity: 'medium', color: '#e8a82a' },
    broken: { label: 'Broken link', severity: 'critical', color: '#e24b4a' },
    redirect: { label: 'Redirect', severity: 'low', color: '#7c9ce8' },
    no_noopener: { label: 'No noopener', severity: 'medium', color: '#e8a82a' },
    slow: { label: 'Slow response', severity: 'low', color: '#7c9ce8' },
    not_https: { label: 'Not HTTPS', severity: 'medium', color: '#e8a82a' },
    image_no_alt: { label: 'Image no alt', severity: 'high', color: '#e87c4b' },
};

/* ════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════ */

function normalizeUrl(input) {
    let url = input.trim();
    if (!url.match(/^[a-zA-Z]+:\/\//)) url = 'https://' + url;
    try { return new URL(url).href; } catch { return null; }
}

async function checkLinkStatus(url, referer) {
    const headers = { 'User-Agent': USER_AGENT, 'Referer': referer };
    const start = Date.now();
    try {
        const res = await axios.head(url, { timeout: DEFAULT_TIMEOUT, headers, validateStatus: () => true });
        return { statusCode: res.status, responseTime: Date.now() - start, finalUrl: res.request?.res?.responseUrl || null };
    } catch {
        try {
            const res = await axios.get(url, { timeout: DEFAULT_TIMEOUT, headers, validateStatus: () => true, responseType: 'stream' });
            res.data?.destroy();
            return { statusCode: res.status, responseTime: Date.now() - start, finalUrl: res.request?.res?.responseUrl || null };
        } catch (err) {
            return { statusCode: err.response?.status || 'Error', responseTime: Date.now() - start, error: err.message };
        }
    }
}

function extractLinks($, targetUrl, baseHostname, includeImages) {
    const links = [];

    // Extract <a> tags
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href')?.trim();
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;

        try {
            const abs = new URL(href, targetUrl).href;
            const linkHost = new URL(abs).hostname;
            const type = linkHost.replace(/^www\./, '') === baseHostname ? 'internal' : 'external';
            
            const $img = $(el).find('img').first();
            let text = $(el).text().trim();
            if (!text && $img.length) text = $img.attr('alt')?.trim() || '[Image Link]';

            links.push({
                url: abs,
                text: text || '',
                type,
                rel: $(el).attr('rel') || null,
                target: $(el).attr('target') || null,
                isImage: $img.length > 0,
                imageAlt: $img.length ? $img.attr('alt') : null
            });
        } catch {}
    });

    // Extract <img> tags if requested
    if (includeImages) {
        $('img[src]').each((_, el) => {
            const src = $(el).attr('src')?.trim();
            if (!src || src.startsWith('data:')) return;
            try {
                const abs = new URL(src, targetUrl).href;
                links.push({
                    url: abs,
                    text: '[Image Asset]',
                    type: 'image',
                    isImage: true,
                    imageAlt: $(el).attr('alt') || null
                });
            } catch {}
        });
    }

    return links;
}

/* ════════════════════════════════════════════════════════
   MAIN ROUTE
════════════════════════════════════════════════════════ */
app.post('/api/analyze', async (req, res) => {
    const { url: rawUrl, maxLinks = 100, concurrency = 5, includeImages = false, includeExternal = true, includeInternal = true, checkStatus = true } = req.body;

    const startUrl = normalizeUrl(rawUrl);
    if (!startUrl) return res.status(400).json({ error: 'Invalid URL.' });

    const getBaseHost = (h) => h.replace(/^www\./, '');
    const baseHostname = getBaseHost(new URL(startUrl).hostname);
    const cappedMax = Math.min(parseInt(maxLinks) || 100, MAX_LINKS_CAP);
    const limit = pLimit(Math.min(parseInt(concurrency) || 5, 20));

    // BFS State
    const discoveredLinks = new Map(); // Unique links
    const visitedPages = new Set();
    const queue = [startUrl];
    let pageMeta = null;

    console.log(`Starting BFS Crawl for: ${startUrl} (Max: ${cappedMax}, Images: ${includeImages})`);

    while (queue.length > 0 && discoveredLinks.size < cappedMax) {
        const currentUrl = queue.shift();
        if (visitedPages.has(currentUrl)) continue;
        visitedPages.add(currentUrl);

        try {
            const resp = await axios.get(currentUrl, { 
                timeout: 10000, 
                headers: { 'User-Agent': USER_AGENT },
                validateStatus: (s) => s < 400 
            });

            if (!resp.headers['content-type']?.includes('text/html')) continue;

            const $ = cheerio.load(resp.data);
            if (currentUrl === startUrl) {
                pageMeta = {
                    title: $('title').text().trim(),
                    description: $('meta[name="description"]').attr('content'),
                    h1Count: $('h1').length,
                    h2Count: $('h2').length,
                    pageUrl: startUrl
                };
            }

            const found = extractLinks($, currentUrl, baseHostname, includeImages);

            for (const link of found) {
                if (discoveredLinks.size >= cappedMax) break;

                if (!discoveredLinks.has(link.url)) {
                    // Filter results
                    if (link.type === 'internal' && !includeInternal) { /* keep for crawling but don't add to results? No, usually user wants to see them if they are pages. */ }
                    
                    // Deciding which to keep in results
                    const shouldKeep = (link.type === 'internal' && includeInternal) || 
                                     (link.type === 'external' && includeExternal) ||
                                     (link.type === 'image' && includeImages);
                    
                    if (shouldKeep) discoveredLinks.set(link.url, link);

                    // BFS Expansion: only crawl internal pages
                    if (link.type === 'internal' && !visitedPages.has(link.url)) {
                        // Skip obvious non-html files
                        if (!link.url.match(/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|exe)$/i)) {
                            queue.push(link.url);
                        }
                    }
                }
            }
        } catch (err) {
            console.error(`Crawl Error [${currentUrl}]: ${err.message}`);
        }
    }

    const linksArray = Array.from(discoveredLinks.values());

    // Status Check
    if (checkStatus && linksArray.length > 0) {
        await Promise.all(linksArray.map(l => limit(async () => {
            const status = await checkLinkStatus(l.url, startUrl);
            Object.assign(l, status);
        })));
    }

    // Issue Detection
    linksArray.forEach(l => {
        l.issues = [];
        if (!l.text && !l.imageAlt) l.issues.push('empty_anchor');
        if (typeof l.statusCode === 'number' && l.statusCode >= 400) l.issues.push('broken');
        if (typeof l.statusCode === 'number' && l.statusCode >= 300 && l.statusCode < 400) l.issues.push('redirect');
        if (l.responseTime > SLOW_THRESHOLD) l.issues.push('slow');
        if (l.url.startsWith('http://')) l.issues.push('not_https');
        if (l.isImage && !l.imageAlt) l.issues.push('image_no_alt');
    });

    // Summary
    const summary = {
        total: linksArray.length,
        internal: linksArray.filter(l => l.type === 'internal').length,
        external: linksArray.filter(l => l.type === 'external').length,
        images: linksArray.filter(l => l.type === 'image').length,
        broken: linksArray.filter(l => typeof l.statusCode === 'number' && l.statusCode >= 400).length,
        redirects: linksArray.filter(l => typeof l.statusCode === 'number' && l.statusCode >= 300 && l.statusCode < 400).length,
        totalIssues: linksArray.filter(l => l.issues.length > 0).length,
        avgResponseTime: Math.round(linksArray.reduce((acc, l) => acc + (l.responseTime || 0), 0) / linksArray.length) || 0
    };

    res.json({ meta: pageMeta, summary, links: linksArray, issueMeta: ISSUE_META });
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const PORT = 3000;
app.listen(PORT, () => console.log(`Link Server v1.3.0 running on port ${PORT}`));