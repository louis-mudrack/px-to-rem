// Value audit dashboard (runs inside a VS Code webview).
// All labels coming from the workspace (file names, values) go through textContent.

interface Histogram {
    value: number;
    count: number;
    files: number;
}
interface Outlier {
    px: number;
    category: string;
    count: number;
    occurrences: { file: string; line: number }[];
    nearestGrid: number;
}
interface TypeScaleFit {
    name: string;
    ratio: number;
    base: number;
    steps: number[];
    fit: number;
    misfits: number[];
}
interface Report {
    files: number;
    convertible: number;
    kept: number;
    scalable: number;
    score: number;
    histograms: Record<string, Histogram[]>;
    grid: { four: number; eight: number; total: number };
    outliers: Outlier[];
    typeScale?: TypeScaleFit;
    spacingProposal: number[];
    fontSizeProposal: number[];
    radiusProposal: number[];
}
interface TrendPoint {
    date: string;
    convertible: number;
    scalable: number;
    score: number;
}
interface FileRow {
    file: string;
    convertible: number;
    kept: number;
    scalable: number;
}
interface DashboardData {
    report: Report;
    trend: TrendPoint[];
    root: { px: number; source?: string };
    tokens: number;
    files: FileRow[];
    formats: { id: string; label: string }[];
    t: Record<string, string>;
}

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(state: unknown): void; getState(): unknown };

const vscode = acquireVsCodeApi();
const SVG = 'http://www.w3.org/2000/svg';
let data: DashboardData | undefined;
const tableViews = new Set<string>();

function t(key: string, ...args: (string | number)[]): string {
    const template = data?.t[key] ?? key;
    return template.replace(/\{(\d+)\}/g, (m, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
    }
    return node;
}

const fmt = (n: number, digits = 2) => {
    const s = n.toFixed(digits).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
};
const compact = (n: number) => (n >= 1000 ? `${fmt(n / 1000, 1)}K` : String(Math.round(n)));
const percent = (n: number) => `${Math.round(n * 100)}%`;

// Tooltip -------------------------------------------------------------------

const tooltip = el('div', 'tooltip');
tooltip.setAttribute('role', 'status');
document.body.appendChild(tooltip);

function showTooltip(anchor: Element, lines: { strong: string; text: string }[]): void {
    tooltip.replaceChildren();
    for (const line of lines) {
        const row = el('div', 'tooltip-row');
        row.appendChild(el('strong', undefined, line.strong));
        row.appendChild(el('span', undefined, ` ${line.text}`));
        tooltip.appendChild(row);
    }
    const rect = anchor.getBoundingClientRect();
    tooltip.style.display = 'block';
    const left = Math.min(window.innerWidth - tooltip.offsetWidth - 8, Math.max(8, rect.left + rect.width / 2 - tooltip.offsetWidth / 2));
    const top = rect.top - tooltip.offsetHeight - 8 < 0 ? rect.bottom + 8 : rect.top - tooltip.offsetHeight - 8;
    tooltip.style.left = `${left + window.scrollX}px`;
    tooltip.style.top = `${top + window.scrollY}px`;
}

function hideTooltip(): void {
    tooltip.style.display = 'none';
}

function interactive(target: SVGElement, label: string, lines: () => { strong: string; text: string }[]): void {
    target.setAttribute('tabindex', '0');
    target.setAttribute('aria-label', label);
    target.addEventListener('pointerenter', () => {
        target.classList.add('hover');
        showTooltip(target, lines());
    });
    target.addEventListener('pointerleave', () => {
        target.classList.remove('hover');
        hideTooltip();
    });
    target.addEventListener('focus', () => {
        target.classList.add('hover');
        showTooltip(target, lines());
    });
    target.addEventListener('blur', () => {
        target.classList.remove('hover');
        hideTooltip();
    });
}

// Building blocks -------------------------------------------------------------

function card(id: string, title: string, subtitle?: string, table?: () => HTMLElement): { root: HTMLElement; body: HTMLElement } {
    const root = el('section', 'card');
    const head = el('div', 'card-head');
    const titles = el('div');
    titles.appendChild(el('h2', undefined, title));
    if (subtitle) {
        titles.appendChild(el('p', 'subtitle', subtitle));
    }
    head.appendChild(titles);
    const body = el('div', 'card-body');
    if (table) {
        const toggle = el('button', 'link', tableViews.has(id) ? t('Show chart') : t('Show table'));
        toggle.addEventListener('click', () => {
            if (tableViews.has(id)) {
                tableViews.delete(id);
            } else {
                tableViews.add(id);
            }
            render();
        });
        head.appendChild(toggle);
    }
    root.appendChild(head);
    root.appendChild(body);
    if (table && tableViews.has(id)) {
        body.appendChild(table());
    }
    return { root, body };
}

function table(headers: string[], rows: (string | number | HTMLElement)[][], numeric: boolean[] = []): HTMLElement {
    const tableEl = el('table');
    const thead = el('thead');
    const tr = el('tr');
    headers.forEach((h, i) => {
        const th = el('th', numeric[i] ? 'num' : undefined, h);
        th.scope = 'col';
        tr.appendChild(th);
    });
    thead.appendChild(tr);
    tableEl.appendChild(thead);
    const tbody = el('tbody');
    for (const row of rows) {
        const r = el('tr');
        row.forEach((cell, i) => {
            const td = el('td', numeric[i] ? 'num' : undefined);
            if (cell instanceof HTMLElement) {
                td.appendChild(cell);
            } else {
                td.textContent = String(cell);
            }
            r.appendChild(td);
        });
        tbody.appendChild(r);
    }
    tableEl.appendChild(tbody);
    return tableEl;
}

function fileLink(file: string, line?: number): HTMLElement {
    const a = el('button', 'link', line !== undefined ? `${file}:${line + 1}` : file);
    a.addEventListener('click', () => vscode.postMessage({ type: 'open', file, line }));
    return a;
}

/** Chart width that matches the card the chart will sit in (cards use a 360px-min auto-fit grid). */
function chartWidth(): number {
    const available = Math.max(320, document.body.clientWidth - 48);
    const columns = Math.max(1, Math.floor((available + 16) / (360 + 16)));
    return Math.max(280, (available - (columns - 1) * 16) / columns - 34);
}

function niceMax(max: number): number {
    if (max <= 5) {
        return Math.max(1, Math.ceil(max));
    }
    const pow = Math.pow(10, Math.floor(Math.log10(max)));
    for (const m of [1, 2, 2.5, 5, 10]) {
        if (m * pow >= max) {
            return m * pow;
        }
    }
    return 10 * pow;
}

/** Path for a column with a 4px rounded data end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Charts ---------------------------------------------------------------------

function histogram(category: string, bins: Histogram[]): HTMLElement {
    const shown = bins.length > 60 ? [...bins].sort((a, b) => b.count - a.count).slice(0, 60).sort((a, b) => a.value - b.value) : bins;
    const onGrid = (v: number) => (v < 8 ? Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 && Math.round(v) % 2 === 0 : Math.abs(v / 4 - Math.round(v / 4)) < 1e-6);
    const id = `hist-${category}`;
    const subtitle = bins.length > shown.length ? t('{0} most used of {1} values', shown.length, bins.length) : t('{0} distinct values', bins.length);
    const { root, body } = card(id, t(`category.${category}`), subtitle, () =>
        table(
            [t('Value'), t('Uses'), t('Files'), t('On the 4px grid')],
            bins.map(b => [`${fmt(b.value)}px`, b.count, b.files, onGrid(b.value) ? t('yes') : t('no')]),
            [true, true, true, false],
        ),
    );
    if (tableViews.has(id)) {
        return root;
    }
    const legend = el('div', 'legend');
    for (const [cls, label] of [
        ['swatch accent', t('Off the 4px grid')],
        ['swatch muted', t('On the 4px grid')],
    ]) {
        const item = el('span', 'legend-item');
        item.appendChild(el('span', cls));
        item.appendChild(document.createTextNode(label));
        legend.appendChild(item);
    }
    body.appendChild(legend);

    const width = chartWidth();
    const height = 180;
    const pad = { top: 12, right: 8, bottom: 28, left: 36 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const max = niceMax(Math.max(...shown.map(b => b.count)));
    const slot = plotW / shown.length;
    const barW = Math.max(2, Math.min(24, slot - 2));
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img', 'aria-label': t('Distribution of {0} values', t(`category.${category}`)) });

    for (const tick of [0, max / 2, max]) {
        const y = pad.top + plotH - (tick / max) * plotH;
        chart.appendChild(svg('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y, class: tick === 0 ? 'axis' : 'grid' }));
        const label = svg('text', { x: pad.left - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' });
        label.textContent = compact(tick);
        chart.appendChild(label);
    }

    const top3 = new Set([...shown].sort((a, b) => b.count - a.count).slice(0, 3).map(b => b.value));
    shown.forEach((bin, i) => {
        const x = pad.left + i * slot + (slot - barW) / 2;
        const h = Math.max(1, (bin.count / max) * plotH);
        const y = pad.top + plotH - h;
        const group = svg('g', { class: 'mark' });
        group.appendChild(svg('path', { d: columnPath(x, y, barW, h), class: onGrid(bin.value) ? 'fill-muted' : 'fill-accent' }));
        const hit = svg('rect', { x: pad.left + i * slot, y: pad.top, width: Math.max(slot, 1), height: plotH, class: 'hit' });
        group.appendChild(hit);
        interactive(hit, `${fmt(bin.value)}px: ${bin.count}`, () => [
            { strong: `${fmt(bin.value)}px`, text: '' },
            { strong: String(bin.count), text: t('uses in {0} files', bin.files) },
            { strong: '', text: onGrid(bin.value) ? t('On the 4px grid') : t('Off the 4px grid') },
        ]);
        chart.appendChild(group);
        if (i === 0 || i === shown.length - 1 || top3.has(bin.value)) {
            const label = svg('text', { x: x + barW / 2, y: height - 10, class: 'tick', 'text-anchor': 'middle' });
            label.textContent = fmt(bin.value);
            chart.appendChild(label);
        }
    });
    body.appendChild(chart);
    return root;
}

function trendChart(points: TrendPoint[]): HTMLElement {
    const id = 'trend';
    const { root, body } = card(id, t('Migration progress'), t('Share of lengths that scale with the user font size'), () =>
        table(
            [t('Date'), t('Scalable'), t('px left')],
            points.map(p => [p.date, percent(p.score), p.convertible]),
            [false, true, true],
        ),
    );
    if (tableViews.has(id)) {
        return root;
    }
    const width = chartWidth();
    const height = 180;
    const pad = { top: 16, right: 48, bottom: 28, left: 40 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const xs = (i: number) => pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const ys = (v: number) => pad.top + plotH - v * plotH;
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', role: 'img', 'aria-label': t('Migration progress') });
    for (const tick of [0, 0.5, 1]) {
        chart.appendChild(svg('line', { x1: pad.left, x2: width - pad.right, y1: ys(tick), y2: ys(tick), class: tick === 0 ? 'axis' : 'grid' }));
        const label = svg('text', { x: pad.left - 6, y: ys(tick) + 4, class: 'tick', 'text-anchor': 'end' });
        label.textContent = percent(tick);
        chart.appendChild(label);
    }
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i)},${ys(p.score)}`).join('');
    chart.appendChild(svg('path', { d: `${line}L${xs(points.length - 1)},${ys(0)}L${xs(0)},${ys(0)}Z`, class: 'area' }));
    chart.appendChild(svg('path', { d: line, class: 'line' }));
    const last = points[points.length - 1];
    chart.appendChild(svg('circle', { cx: xs(points.length - 1), cy: ys(last.score), r: 5, class: 'dot' }));
    const endLabel = svg('text', { x: xs(points.length - 1) + 10, y: ys(last.score) + 4, class: 'value' });
    endLabel.textContent = percent(last.score);
    chart.appendChild(endLabel);
    for (const [i, p] of [[0, points[0]], [points.length - 1, last]] as [number, TrendPoint][]) {
        const label = svg('text', { x: xs(i), y: height - 8, class: 'tick', 'text-anchor': i === 0 ? 'start' : 'end' });
        label.textContent = p.date;
        chart.appendChild(label);
    }
    // Crosshair: the whole plot is the hit target, snapping to the nearest date.
    const cross = svg('line', { y1: pad.top, y2: pad.top + plotH, class: 'crosshair' });
    cross.style.display = 'none';
    chart.appendChild(cross);
    const hit = svg('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, class: 'hit' });
    hit.setAttribute('tabindex', '0');
    hit.setAttribute('aria-label', t('Migration progress'));
    const at = (clientX: number) => {
        const box = chart.getBoundingClientRect();
        const x = ((clientX - box.left) / box.width) * width;
        let best = 0;
        points.forEach((_, i) => {
            if (Math.abs(xs(i) - x) < Math.abs(xs(best) - x)) {
                best = i;
            }
        });
        return best;
    };
    const show = (i: number) => {
        cross.setAttribute('x1', String(xs(i)));
        cross.setAttribute('x2', String(xs(i)));
        cross.style.display = '';
        const p = points[i];
        showTooltip(cross, [
            { strong: percent(p.score), text: t('scalable') },
            { strong: String(p.convertible), text: t('px left') },
            { strong: '', text: p.date },
        ]);
    };
    hit.addEventListener('pointermove', e => show(at(e.clientX)));
    hit.addEventListener('focus', () => show(points.length - 1));
    const hide = () => {
        cross.style.display = 'none';
        hideTooltip();
    };
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    chart.appendChild(hit);
    body.appendChild(chart);
    return root;
}

function meter(label: string, value: number, detail: string): HTMLElement {
    const wrap = el('div', 'meter');
    const head = el('div', 'meter-head');
    head.appendChild(el('span', undefined, label));
    head.appendChild(el('strong', undefined, percent(value)));
    wrap.appendChild(head);
    const track = el('div', 'meter-track');
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(Math.round(value * 100)));
    track.setAttribute('aria-label', label);
    const fill = el('div', 'meter-fill');
    fill.style.width = `${Math.max(0, Math.min(100, value * 100))}%`;
    track.appendChild(fill);
    wrap.appendChild(track);
    wrap.appendChild(el('p', 'subtitle', detail));
    return wrap;
}

function tile(label: string, value: string, detail?: string): HTMLElement {
    const node = el('div', 'tile');
    node.appendChild(el('div', 'tile-label', label));
    node.appendChild(el('div', 'tile-value', value));
    if (detail) {
        node.appendChild(el('div', 'tile-detail', detail));
    }
    return node;
}

function chips(values: number[]): HTMLElement {
    const list = el('div', 'chips');
    for (const v of values) {
        list.appendChild(el('span', 'chip', `${fmt(v)}px`));
    }
    return list;
}

// Page -------------------------------------------------------------------------

function render(): void {
    const app = document.getElementById('app')!;
    if (!data) {
        app.replaceChildren(el('p', 'subtitle', t('Scanning workspace…')));
        return;
    }
    const { report } = data;
    const page = el('div', 'page');

    const header = el('header', 'page-head');
    const h1 = el('h1', undefined, t('Value audit'));
    header.appendChild(h1);
    const actions = el('div', 'actions');
    const refresh = el('button', 'secondary', t('Refresh'));
    refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    const convert = el('button', undefined, t('Convert workspace…'));
    convert.addEventListener('click', () => vscode.postMessage({ type: 'convertWorkspace' }));
    actions.append(refresh, convert);
    header.appendChild(actions);
    page.appendChild(header);

    // KPI row: the one hero figure plus supporting tiles.
    const kpis = el('div', 'kpis');
    const hero = el('div', 'hero');
    hero.appendChild(el('div', 'hero-value', percent(report.score)));
    hero.appendChild(el('div', 'tile-label', t('of lengths scale with the user font size')));
    kpis.appendChild(hero);
    const tiles = el('div', 'tiles');
    tiles.append(
        tile(t('px left'), compact(report.convertible), t('in {0} files', data.files.filter(f => f.convertible).length)),
        tile(t('Kept on purpose'), compact(report.kept), t('borders, hairlines, opt-outs')),
        tile(t('Scalable values'), compact(report.scalable)),
        tile(t('Root font size'), `${fmt(data.root.px)}px`, data.root.source),
        tile(t('Design tokens'), compact(data.tokens)),
    );
    kpis.appendChild(tiles);
    page.appendChild(kpis);

    const grid = el('div', 'grid');
    if (data.trend.length >= 2) {
        grid.appendChild(trendChart(data.trend));
    }

    const gridCard = card('grid', t('Grid adherence'), t('{0} spacing and size values', report.grid.total));
    gridCard.body.append(
        meter(t('On a 4px grid'), report.grid.four, t('Values divisible by 4 (2 below 8px).')),
        meter(t('On an 8px grid'), report.grid.eight, t('Values divisible by 8.')),
    );
    grid.appendChild(gridCard.root);

    if (report.typeScale) {
        const ts = report.typeScale;
        const tsCard = card('typescale', t('Type scale'), t('Closest match: {0} ({1}) from {2}px — {3} of sizes fit', ts.name, fmt(ts.ratio, 3), fmt(ts.base), percent(ts.fit)));
        tsCard.body.appendChild(chips(ts.steps));
        if (ts.misfits.length) {
            tsCard.body.appendChild(el('p', 'subtitle', t('Off the scale: {0}', ts.misfits.map(v => `${fmt(v)}px`).join(', '))));
        }
        grid.appendChild(tsCard.root);
    }
    page.appendChild(grid);

    const order = ['spacing', 'size', 'font-size', 'radius', 'line-height', 'letter-spacing', 'border', 'breakpoint', 'other'];
    const multiples = el('div', 'grid');
    for (const category of order) {
        const bins = report.histograms[category];
        if (bins && bins.length) {
            multiples.appendChild(histogram(category, bins));
        }
    }
    if (multiples.childElementCount) {
        page.appendChild(el('h2', 'section-title', t('Values in use')));
        page.appendChild(multiples);
    }

    if (report.outliers.length) {
        const outCard = card('outliers', t('Off-grid values'), t('Candidates for snapping to your scale'));
        outCard.body.appendChild(
            table(
                [t('Value'), t('Category'), t('Uses'), t('Nearest on grid'), t('Where')],
                report.outliers.map(o => {
                    const where = el('div', 'where');
                    o.occurrences.slice(0, 3).forEach(occ => where.appendChild(fileLink(occ.file, occ.line)));
                    if (o.occurrences.length > 3) {
                        where.appendChild(el('span', 'subtitle', t('+{0} more', o.occurrences.length - 3)));
                    }
                    return [`${fmt(o.px)}px`, t(`category.${o.category}`), o.count, `${fmt(o.nearestGrid)}px`, where];
                }),
                [true, false, true, true, false],
            ),
        );
        page.appendChild(outCard.root);
    }

    const tokenCard = card('tokens', t('Proposed design tokens'), t('Derived from the values your code already uses'));
    const proposals: [string, number[]][] = [
        [t('category.spacing'), report.spacingProposal],
        [t('category.font-size'), report.fontSizeProposal],
        [t('category.radius'), report.radiusProposal],
    ];
    for (const [label, values] of proposals) {
        if (values.length) {
            tokenCard.body.appendChild(el('h3', undefined, label));
            tokenCard.body.appendChild(chips(values));
        }
    }
    const form = el('div', 'actions');
    const select = el('select');
    select.setAttribute('aria-label', t('Token file format'));
    for (const f of data.formats) {
        const option = el('option', undefined, f.label);
        option.value = f.id;
        select.appendChild(option);
    }
    const generate = el('button', undefined, t('Generate token file'));
    generate.addEventListener('click', () => vscode.postMessage({ type: 'generateTokens', format: select.value }));
    form.append(select, generate);
    tokenCard.body.appendChild(form);
    page.appendChild(tokenCard.root);

    const withPx = data.files.filter(f => f.convertible > 0);
    if (withPx.length) {
        const filesCard = card('files', t('Files with px values'), t('Most px values first'));
        filesCard.body.appendChild(
            table(
                [t('File'), t('px left'), t('Kept'), t('Scalable')],
                withPx.map(f => [fileLink(f.file), f.convertible, f.kept, f.scalable]),
                [false, true, true, true],
            ),
        );
        page.appendChild(filesCard.root);
    }

    app.replaceChildren(page);
}

window.addEventListener('message', event => {
    const message = event.data as { type: string; data?: DashboardData };
    if (message.type === 'data' && message.data) {
        data = message.data;
        render();
    }
});

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
new ResizeObserver(() => {
    if (resizeTimer) {
        clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(render, 150);
}).observe(document.body);

render();
vscode.postMessage({ type: 'ready' });
