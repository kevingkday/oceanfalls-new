/**
 * Market Signals renderer.
 * A weekly updater may write either `signals` or `articles`, and may use
 * the briefing fields or common article fields (title, summary, source, link).
 */
(function (root) {
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function firstText() {
        for (let i = 0; i < arguments.length; i++) {
            const value = arguments[i];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }

    function safeUrl(url) {
        if (!url || typeof url !== 'string') return '';
        try {
            const parsed = new URL(url, typeof location !== 'undefined' ? location.origin : 'https://oceanfalls.com');
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
        } catch (err) {
            return '';
        }
        return '';
    }

    function extractItems(data) {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== 'object') return [];
        if (Array.isArray(data.signals)) return data.signals;
        if (Array.isArray(data.articles)) return data.articles;
        return [];
    }

    function updatedLabel(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
        return firstText(data.lastUpdated, data.updated, data.updatedAt, data.last_updated);
    }

    function normalizeSignal(item) {
        if (!item || typeof item !== 'object') return null;
        const headline = firstText(item.headline, item.title, item.name);
        const theFact = firstText(item.theFact, item.fact, item.summary, item.description, item.excerpt, item.body, item.content);
        const oceanFallsAngle = firstText(item.oceanFallsAngle, item.angle, item.implication, item.takeaway);
        if (!headline && !theFact) return null;
        return {
            theme: firstText(item.theme, item.category, item.tag, item.section) || 'Market Signal',
            dateDisplay: firstText(item.dateDisplay, item.displayDate, item.date, item.published),
            outlet: firstText(item.outlet, item.source, item.publication, item.publisher),
            headline: headline,
            theFact: theFact,
            oceanFallsAngle: oceanFallsAngle,
            url: safeUrl(firstText(item.url, item.link, item.href))
        };
    }

    function emptyState(message) {
        return (
            '<div class="col-span-full bg-surface-container-low border border-outline-variant/20 p-12 text-center">' +
                '<p class="font-headline font-bold text-lg text-on-background mb-3">Briefings unavailable</p>' +
                '<p class="font-body text-sm text-on-surface-variant leading-relaxed max-w-lg mx-auto">' + escapeHtml(message) + '</p>' +
            '</div>'
        );
    }

    function renderSignalCard(signal) {
        const meta = [signal.dateDisplay, signal.outlet].filter(Boolean).map(escapeHtml).join(' | ');
        const headline = escapeHtml(signal.headline);
        const headlineHtml = signal.url
            ? '<a href="' + signal.url + '" target="_blank" rel="noopener noreferrer" class="hover:text-primary transition-colors">' + headline + '</a>'
            : headline;
        const factBlock = signal.theFact
            ? '<div class="mb-6">' +
                '<p class="font-label font-semibold text-[10px] uppercase tracking-widest text-secondary mb-2">The Fact</p>' +
                '<p class="font-body text-sm leading-relaxed text-on-surface-variant">' + escapeHtml(signal.theFact) + '</p>' +
              '</div>'
            : '';
        const angleBlock = signal.oceanFallsAngle
            ? '<div class="border-l-2 border-primary bg-surface-container-low/60 px-5 py-4 mb-6">' +
                '<p class="font-label font-semibold text-[10px] uppercase tracking-widest text-primary mb-2">Ocean Falls Angle</p>' +
                '<p class="font-body text-sm leading-relaxed text-on-background">' + escapeHtml(signal.oceanFallsAngle) + '</p>' +
              '</div>'
            : '';
        const verify = signal.url
            ? '<div class="mt-auto pt-4 border-t border-outline-variant/15">' +
                '<a href="' + signal.url + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 font-label font-semibold text-xs uppercase tracking-widest text-primary hover:text-on-background transition-colors">' +
                    'Verify Source' +
                    '<span class="material-symbols-outlined text-sm" aria-hidden="true">open_in_new</span>' +
                '</a>' +
              '</div>'
            : '';

        return (
            '<article class="bg-surface-container-lowest border border-outline-variant/20 p-8 flex flex-col h-full">' +
                '<div class="flex flex-wrap items-center gap-x-4 gap-y-2 mb-5">' +
                    '<span class="inline-block bg-primary/10 text-primary border border-primary/20 px-3 py-1 font-label font-semibold text-[10px] uppercase tracking-wider">' + escapeHtml(signal.theme) + '</span>' +
                    (meta ? '<span class="font-label text-[11px] uppercase tracking-wide text-secondary">' + meta + '</span>' : '') +
                '</div>' +
                '<h4 class="font-headline font-bold text-xl tracking-tight text-on-background mb-5 leading-snug">' + headlineHtml + '</h4>' +
                factBlock +
                angleBlock +
                verify +
            '</article>'
        );
    }

    function renderInto(grid, items, failed) {
        grid.removeAttribute('aria-busy');
        if (failed) {
            grid.innerHTML = emptyState('Market briefings could not be loaded. Refresh the page, or return after the next weekly update.');
            return;
        }
        if (!items.length) {
            grid.innerHTML = emptyState('No market signals have been published yet.');
            return;
        }
        grid.innerHTML = items.map(renderSignalCard).join('');
    }

    async function init() {
        const grids = document.querySelectorAll('[data-market-signals]');
        if (!grids.length) return;

        let payload = null;
        let failed = false;
        try {
            const response = await fetch('/news.json', { cache: 'no-cache' });
            if (!response.ok) throw new Error('news.json request failed');
            payload = await response.json();
        } catch (err) {
            failed = true;
        }

        const items = failed ? [] : extractItems(payload).map(normalizeSignal).filter(Boolean);
        const updated = updatedLabel(payload);

        grids.forEach(function (grid) {
            const targetId = grid.getAttribute('data-updated-target');
            const updatedEl = targetId ? document.getElementById(targetId) : null;
            if (updatedEl) {
                updatedEl.textContent = updated ? ('Updated: ' + updated) : 'Updated: —';
            }
            renderInto(grid, items, failed);
        });
    }

    root.OceanFallsMarketSignals = {
        escapeHtml: escapeHtml,
        extractItems: extractItems,
        normalizeSignal: normalizeSignal,
        updatedLabel: updatedLabel,
        renderSignalCard: renderSignalCard
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', init);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
