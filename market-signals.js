/**
 * Market Signals renderer & unified newsletter form handler.
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

    function bindNewsletterForms() {
        const forms = document.querySelectorAll('#newsletter-form, [data-newsletter-form]');
        forms.forEach(function (form) {
            if (form.getAttribute('data-newsletter-bound') === 'true') return;
            form.setAttribute('data-newsletter-bound', 'true');

            form.addEventListener('submit', async function (e) {
                e.preventDefault();
                const submitBtn = form.querySelector('button[type="submit"]');
                const feedbackEl = form.querySelector('[data-newsletter-feedback], #newsletter-feedback');
                const nameInput = form.querySelector('input[name="name"]');
                const emailInput = form.querySelector('input[name="email"]');
                const nameVal = nameInput && nameInput.value ? nameInput.value.trim() : '';
                const emailVal = emailInput && emailInput.value ? emailInput.value.trim() : '';
                const sourceVal = form.getAttribute('data-source') || 'market-signals-newsletter';

                if (!emailVal) return;

                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<span>Subscribing...</span>';
                }
                if (feedbackEl) {
                    feedbackEl.className = 'hidden pt-2 text-xs font-body leading-relaxed';
                    feedbackEl.textContent = '';
                }

                try {
                    const res = await fetch('/api/newsletter', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: nameVal,
                            email: emailVal,
                            source: sourceVal
                        })
                    });
                    const data = await res.json();

                    if (!res.ok || !data.success) {
                        throw new Error(data.error || data.message || 'Could not complete your subscription. Please try again.');
                    }

                    form.innerHTML =
                        '<div class="py-6 px-4 text-center space-y-3">' +
                            '<span class="material-symbols-outlined text-4xl text-primary">mark_email_read</span>' +
                            '<h4 class="font-headline font-bold text-xl text-on-background">' +
                                (data.already_subscribed ? "You're Already Subscribed" : "Subscription Confirmed") +
                            '</h4>' +
                            '<p class="font-body text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">' +
                                escapeHtml(data.message || 'Thank you for subscribing to Ocean Falls Market Signals & Investor Communications. Check your inbox to confirm your subscription.') +
                            '</p>' +
                        '</div>';
                } catch (err) {
                    if (feedbackEl) {
                        feedbackEl.className = 'pt-2 text-xs font-body leading-relaxed text-error font-semibold';
                        feedbackEl.textContent = err.message || 'Unable to subscribe right now. Please try again shortly.';
                    }
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<span>Subscribe to Updates</span><span class="material-symbols-outlined text-sm">mail</span>';
                    }
                }
            });
        });
    }

    async function init() {
        bindNewsletterForms();

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
        renderSignalCard: renderSignalCard,
        bindNewsletterForms: bindNewsletterForms
    };

    if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', init);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
