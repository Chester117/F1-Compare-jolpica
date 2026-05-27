// Full-race lap time distribution tab.
// Renders an interactive SVG violin/box plot for all classified drivers.
(function() {
    let initialized = false;
    let currentSchedule = [];
    let lastLoaded = null;
    let viewMode = 'violin';

    const DRIVER_COLORS = [
        '#25d0bd', '#ff273a', '#3f6bff', '#f0c84b', '#7f87ff',
        '#ff9a3d', '#ff87c5', '#30b7d8', '#c5aa27', '#d0d7df',
        '#ea6d45', '#f7bf45', '#00d294', '#8c96a6', '#ffb347',
        '#00a5ef', '#6f737d', '#d67522', '#50c878', '#27b4d8'
    ];

    const BAND_LABELS = {
        fast: '快圈',
        regular: '常规',
        slow: '慢圈'
    };

    function msToLabel(ms) {
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const cs = Math.floor((ms % 1000) / 10);
        return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
    }

    function shortDriverCode(driver) {
        return driver.code || (driver.familyName || driver.driverId || '').slice(0, 3).toUpperCase();
    }

    function escapeAttr(value) {
        return F1Utils.escapeHtml(String(value ?? ''));
    }

    function percentile(values, p) {
        if (!values.length) return NaN;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    }

    function seededJitter(driverIndex, lap) {
        const raw = Math.sin((driverIndex + 1) * 91.7 + lap * 17.31) * 10000;
        return raw - Math.floor(raw) - 0.5;
    }

    function buildTicks(min, max, count = 6) {
        const ticks = [];
        const seen = new Set();
        for (let i = 0; i < count; i++) {
            const raw = min + (max - min) * (i / Math.max(1, count - 1));
            const rounded = Math.round(raw / 500) * 500;
            if (!seen.has(rounded)) {
                ticks.push(rounded);
                seen.add(rounded);
            }
        }
        return ticks;
    }

    function buildDensityPath(values, x, yScale, maxWidth, globalMin, globalMax) {
        if (!values.length) return '';
        const steps = 92;
        const span = Math.max(1, globalMax - globalMin);
        const bandwidth = Math.max(260, span / 24);
        const samples = [];
        let maxDensity = 0;

        for (let i = 0; i <= steps; i++) {
            const yValue = globalMin + (span * i / steps);
            let density = 0;
            for (const v of values) {
                const z = (yValue - v) / bandwidth;
                density += Math.exp(-0.5 * z * z);
            }
            density /= Math.max(1, values.length);
            if (density > maxDensity) maxDensity = density;
            samples.push({ yValue, density });
        }

        const right = samples.map(s => {
            const w = maxDensity > 0 ? (s.density / maxDensity) * maxWidth : 0;
            return [x + w, yScale(s.yValue)];
        });
        const left = samples.slice().reverse().map(s => {
            const w = maxDensity > 0 ? (s.density / maxDensity) * maxWidth : 0;
            return [x - w, yScale(s.yValue)];
        });
        const points = right.concat(left);
        return points.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
    }

    async function fillSeasonSelector() {
        const seasonSel = document.getElementById('lapDistSeasonList');
        if (!seasonSel) return;
        const seasonsResp = await F1Utils.getSeasons();
        const seasons = seasonsResp?.MRData?.SeasonTable?.Seasons || [];
        seasonSel.innerHTML = seasons
            .slice()
            .sort((a, b) => parseInt(b.season, 10) - parseInt(a.season, 10))
            .map(s => `<option value="${escapeAttr(s.season)}">${escapeAttr(s.season)}</option>`)
            .join('');
        await fillRaceSelector(seasonSel.value);
    }

    async function fillRaceSelector(year) {
        const raceSel = document.getElementById('lapDistRaceList');
        if (!raceSel || !year) return;
        raceSel.innerHTML = '<option>加载比赛中...</option>';
        const schedule = await F1Utils.getSeasonSchedule(year);
        currentSchedule = schedule?.MRData?.RaceTable?.Races || [];
        raceSel.innerHTML = currentSchedule.map(r => {
            const label = `${r.round}. ${r.raceName}`;
            return `<option value="${escapeAttr(r.round)}">${escapeAttr(label)}</option>`;
        }).join('');
    }

    function setStatus(text, mode = 'info') {
        const meta = document.getElementById('lapDistMeta');
        if (!meta) return;
        meta.className = `lap-dist-meta ${mode}`;
        meta.textContent = text || '';
    }

    function setLoading(text) {
        const host = document.getElementById('lapDistChart');
        if (host) {
            host.innerHTML = `<div class="lap-dist-empty">${F1Utils.escapeHtml(text)}</div>`;
        }
    }

    function clearLoadedChart(message) {
        lastLoaded = null;
        const host = document.getElementById('lapDistChart');
        if (host) {
            host.innerHTML = `<div class="lap-dist-empty">${F1Utils.escapeHtml(message || '选择年份和比赛后生成全场车手圈速分布。')}</div>`;
        }
    }

    function getControlState() {
        return {
            filter: document.getElementById('lapDistFilter')?.value || '1.15',
            mode: viewMode,
            showPoints: document.getElementById('lapDistShowPoints')?.checked !== false,
            showMedian: document.getElementById('lapDistShowMedian')?.checked !== false,
            showLegend: document.getElementById('lapDistShowLegend')?.checked !== false
        };
    }

    function updateModeButton() {
        const button = document.getElementById('lapDistModeToggle');
        if (!button) return;
        button.dataset.mode = viewMode;
        button.textContent = viewMode === 'violin' ? '切换 Box Plot' : '切换 Violin';
        button.title = viewMode === 'violin'
            ? '当前为 Violin 分布图，点击切换到 Box and Whisker Plot。'
            : '当前为 Box and Whisker Plot，点击切换到 Violin 分布图。';
    }

    async function loadDriverLapData(year, round) {
        const resultsResp = await F1Utils.getRaceResults(year, round);
        const race = resultsResp?.MRData?.RaceTable?.Races?.[0];
        const results = race?.Results || [];
        if (!results.length) {
            throw new Error('该分站暂无正赛结果，无法生成圈速分布。');
        }

        const drivers = results.map((res, index) => ({
            index,
            id: res.Driver.driverId,
            code: shortDriverCode(res.Driver),
            name: `${res.Driver.givenName} ${res.Driver.familyName}`,
            color: DRIVER_COLORS[index % DRIVER_COLORS.length]
        }));

        const settled = await Promise.allSettled(drivers.map(async driver => {
            const resp = await F1Utils.getRaceLaps(year, round, driver.id);
            const laps = resp?.MRData?.RaceTable?.Races?.[0]?.Laps || [];
            const times = [];
            for (const lap of laps) {
                const lapNumber = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
                const timing = (lap.Timings || [])[0];
                const ms = F1Utils.convertTimeString(timing?.time);
                if (Number.isFinite(lapNumber) && Number.isFinite(ms)) {
                    times.push({ lap: lapNumber, ms });
                }
            }
            return { ...driver, laps: times };
        }));

        return {
            raceName: race.raceName,
            drivers: settled
                .map((res, idx) => res.status === 'fulfilled' ? res.value : { ...drivers[idx], laps: [], error: String(res.reason) })
                .filter(d => d.laps.length > 0)
        };
    }

    function prepareDrivers(drivers, filter) {
        return drivers.map(driver => {
            const raw = driver.laps.map(l => l.ms).filter(Number.isFinite);
            const best = Math.min(...raw);
            const factor = filter === 'none' ? null : parseFloat(filter);
            const kept = driver.laps.filter(l => Number.isFinite(l.ms) && (!factor || l.ms <= best * factor));
            const keptValues = kept.map(l => l.ms);
            const q1 = percentile(keptValues, 0.25);
            const median = percentile(keptValues, 0.5);
            const q3 = percentile(keptValues, 0.75);
            const q35 = percentile(keptValues, 0.35);
            const q72 = percentile(keptValues, 0.72);
            return {
                ...driver,
                best,
                kept,
                keptValues,
                min: Math.min(...keptValues),
                max: Math.max(...keptValues),
                q1,
                median,
                q3,
                q35,
                q72
            };
        }).filter(d => d.keptValues.length >= 2);
    }

    function renderPointNodes(driver, driverIndex, x, slot, yAt) {
        return driver.kept.map(lap => {
            const band = lap.ms <= driver.q35 ? 'fast' : (lap.ms <= driver.q72 ? 'regular' : 'slow');
            const cx = x + seededJitter(driverIndex, lap.lap) * Math.min(30, slot * 0.43);
            const cy = yAt(lap.ms);
            const tip = `${driver.name}\nLap ${lap.lap}: ${msToLabel(lap.ms)}\n${BAND_LABELS[band]}`;
            return `<circle class="lap-point lap-point-${band}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.55" tabindex="0" data-tip="${escapeAttr(tip)}" data-driver="${escapeAttr(driver.id)}"></circle>`;
        }).join('');
    }

    function renderViolinNode(driver, i, x, yAt, min, max, slot, height, showPoints, showMedian) {
        const violin = buildDensityPath(driver.keptValues, x, yAt, Math.min(26, slot * 0.34), min, max);
        const tip = `${driver.name}\n圈数: ${driver.kept.length}\n最快: ${msToLabel(driver.best)}\n中位: ${msToLabel(driver.median)}`;
        const points = showPoints ? renderPointNodes(driver, i, x, slot, yAt) : '';
        const median = showMedian
            ? `<line class="lap-driver-median" x1="${(x - 23).toFixed(1)}" y1="${yAt(driver.median).toFixed(1)}" x2="${(x + 23).toFixed(1)}" y2="${yAt(driver.median).toFixed(1)}"></line>`
            : '';
        return `<g class="lap-driver-group" data-driver="${escapeAttr(driver.id)}">
            <rect class="lap-driver-hit" x="${(x - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height.toFixed(1)}" tabindex="0" data-tip="${escapeAttr(tip)}"></rect>
            <path class="lap-violin" d="${violin}" style="--driver-color:${driver.color}"></path>
            <line class="lap-driver-spine" x1="${x.toFixed(1)}" y1="${yAt(driver.min).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yAt(driver.max).toFixed(1)}"></line>
            ${median}
            ${points}
            <text class="lap-driver-code" x="${x.toFixed(1)}" y="${(height - 48).toFixed(1)}" text-anchor="middle">${escapeAttr(driver.code)}</text>
        </g>`;
    }

    function renderBoxNode(driver, i, x, yAt, slot, height, showPoints, showMedian) {
        const boxWidth = Math.min(38, slot * 0.48);
        const top = yAt(driver.q3);
        const bottom = yAt(driver.q1);
        const tip = `${driver.name}\n圈数: ${driver.kept.length}\n最快: ${msToLabel(driver.best)}\nQ1: ${msToLabel(driver.q1)}\n中位: ${msToLabel(driver.median)}\nQ3: ${msToLabel(driver.q3)}`;
        const points = showPoints ? renderPointNodes(driver, i, x, slot, yAt) : '';
        const median = showMedian
            ? `<line class="lap-box-median" x1="${(x - boxWidth / 2).toFixed(1)}" y1="${yAt(driver.median).toFixed(1)}" x2="${(x + boxWidth / 2).toFixed(1)}" y2="${yAt(driver.median).toFixed(1)}"></line>`
            : '';
        return `<g class="lap-driver-group lap-box-group" data-driver="${escapeAttr(driver.id)}" style="--driver-color:${driver.color}">
            <rect class="lap-driver-hit" x="${(x - slot / 2).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${height.toFixed(1)}" tabindex="0" data-tip="${escapeAttr(tip)}"></rect>
            <line class="lap-box-whisker" x1="${x.toFixed(1)}" y1="${yAt(driver.max).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yAt(driver.min).toFixed(1)}"></line>
            <line class="lap-box-cap" x1="${(x - boxWidth * 0.35).toFixed(1)}" y1="${yAt(driver.max).toFixed(1)}" x2="${(x + boxWidth * 0.35).toFixed(1)}" y2="${yAt(driver.max).toFixed(1)}"></line>
            <line class="lap-box-cap" x1="${(x - boxWidth * 0.35).toFixed(1)}" y1="${yAt(driver.min).toFixed(1)}" x2="${(x + boxWidth * 0.35).toFixed(1)}" y2="${yAt(driver.min).toFixed(1)}"></line>
            <rect class="lap-box-rect" x="${(x - boxWidth / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${boxWidth.toFixed(1)}" height="${Math.max(2, bottom - top).toFixed(1)}"></rect>
            ${median}
            ${points}
            <text class="lap-driver-code" x="${x.toFixed(1)}" y="${(height - 48).toFixed(1)}" text-anchor="middle">${escapeAttr(driver.code)}</text>
        </g>`;
    }

    function bindChartInteractions(host) {
        const tooltip = host.querySelector('.lap-dist-tooltip');
        const readout = host.querySelector('.lap-dist-readout');
        const groups = Array.from(host.querySelectorAll('.lap-driver-group'));
        if (!tooltip) return;

        function moveTooltip(event, targetNode = null) {
            const rect = host.getBoundingClientRect();
            const anchor = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
                ? { x: event.clientX, y: event.clientY }
                : (() => {
                    const box = (targetNode || event.target).getBoundingClientRect();
                    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
                })();
            const maxLeft = Math.max(12, rect.width - 210);
            const maxTop = Math.max(12, rect.height - 88);
            const left = Math.min(maxLeft, Math.max(12, anchor.x - rect.left + 14));
            const top = Math.min(maxTop, Math.max(12, anchor.y - rect.top + 14));
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        }

        function clearHover() {
            tooltip.classList.remove('visible');
            groups.forEach(group => group.classList.remove('is-muted', 'is-hovered'));
            if (readout) readout.textContent = '悬停任一车手或圈速点查看细节';
        }

        host.querySelectorAll('[data-tip]').forEach(node => {
            node.addEventListener('mouseenter', event => {
                const group = node.closest('.lap-driver-group');
                groups.forEach(item => {
                    item.classList.toggle('is-muted', item !== group);
                    item.classList.toggle('is-hovered', item === group);
                });
                tooltip.textContent = node.dataset.tip || '';
                tooltip.classList.add('visible');
                if (readout) readout.textContent = (node.dataset.tip || '').replace(/\n/g, ' / ');
                moveTooltip(event);
            });
            node.addEventListener('mousemove', moveTooltip);
            node.addEventListener('mouseleave', clearHover);
            node.addEventListener('focus', event => {
                tooltip.textContent = node.dataset.tip || '';
                tooltip.classList.add('visible');
                if (readout) readout.textContent = (node.dataset.tip || '').replace(/\n/g, ' / ');
                moveTooltip(event, node);
            });
            node.addEventListener('blur', clearHover);
        });
    }

    function renderDistribution({ year, raceName, drivers, filter, mode, showPoints, showMedian, showLegend }) {
        const host = document.getElementById('lapDistChart');
        if (!host) return;

        const prepared = prepareDrivers(drivers, filter);
        if (!prepared.length) {
            host.innerHTML = '<div class="lap-dist-empty">没有足够的圈速数据可绘制。</div>';
            return;
        }

        const allValues = prepared.flatMap(d => d.keptValues);
        let min = percentile(allValues, 0.01);
        let max = percentile(allValues, 0.99);
        const spanPad = Math.max(700, (max - min) * 0.13);
        min = Math.floor((min - spanPad) / 500) * 500;
        max = Math.ceil((max + spanPad) / 500) * 500;

        const margin = { top: 88, right: 52, bottom: 96, left: 126 };
        const slot = 76;
        const plotW = Math.max(1050, prepared.length * slot);
        const plotH = 560;
        const width = margin.left + plotW + margin.right;
        const height = margin.top + plotH + margin.bottom;
        const xAt = i => margin.left + slot / 2 + i * slot;
        const yAt = ms => margin.top + (max - ms) / (max - min) * plotH;

        const grid = buildTicks(min, max, 6).map(v => {
            const y = yAt(v);
            return `<line class="lap-grid-line" x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(margin.left + plotW).toFixed(1)}" y2="${y.toFixed(1)}"></line>
                    <text class="lap-axis-label" x="${margin.left - 18}" y="${(y + 5).toFixed(1)}" text-anchor="end">${msToLabel(v)}</text>`;
        }).join('');

        const driverNodes = prepared.map((driver, i) => {
            const x = xAt(i);
            if (mode === 'box') {
                return renderBoxNode(driver, i, x, yAt, slot, height, showPoints, showMedian);
            }
            return renderViolinNode(driver, i, x, yAt, min, max, slot, height, showPoints, showMedian);
        }).join('');

        const svg = `<svg class="lap-dist-svg lap-dist-svg-${escapeAttr(mode)}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(raceName)} lap time distribution">
            <rect class="lap-chart-bg" x="0" y="0" width="${width}" height="${height}" rx="8"></rect>
            <text class="lap-chart-title" x="${width / 2}" y="34" text-anchor="middle">${escapeAttr(year)} ${escapeAttr(raceName)} - Race</text>
            <text class="lap-chart-subtitle" x="${width / 2}" y="61" text-anchor="middle">${mode === 'box' ? 'Box and Whisker Plot' : 'Lap Time Distribution'}</text>
            <g class="lap-grid">${grid}</g>
            <text class="lap-y-title" transform="translate(38 ${height / 2}) rotate(-90)" text-anchor="middle">Lap Time (min:sec)</text>
            ${driverNodes}
            <line class="lap-axis-base" x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}"></line>
            <text class="lap-x-title" x="${width / 2}" y="${height - 16}" text-anchor="middle">Driver</text>
        </svg>`;

        const legendMarkup = showLegend ? `<div class="lap-dist-legend" aria-label="圈速分段图例">
            <span><i class="lap-dot lap-dot-fast"></i>快圈</span>
            <span><i class="lap-dot lap-dot-regular"></i>常规</span>
            <span><i class="lap-dot lap-dot-slow"></i>慢圈</span>
            <em>颜色为个人圈速分段，非轮胎配方</em>
        </div>` : '';
        host.innerHTML = `<div class="lap-dist-reviewbar">
                ${legendMarkup}
                <div class="lap-dist-readout">悬停任一车手或圈速点查看细节</div>
            </div>
            <div class="lap-dist-scroll">${svg}</div>
            <div class="lap-dist-tooltip" role="status"></div>`;
        bindChartInteractions(host);

        const rawCount = drivers.reduce((sum, d) => sum + d.laps.length, 0);
        const keptCount = prepared.reduce((sum, d) => sum + d.kept.length, 0);
        const filterText = filter === 'none' ? '显示全部圈' : `过滤慢于个人最快圈 ${(parseFloat(filter) * 100).toFixed(0)}% 的异常圈`;
        const modeText = mode === 'box' ? 'Box and Whisker Plot' : 'Violin 分布图';
        setStatus(`${prepared.length} 位车手，${keptCount}/${rawCount} 个圈速点，当前为 ${modeText}。${filterText}。`, 'ready');
    }

    function rerenderLoadedChart() {
        if (!lastLoaded) {
            setStatus('选择比赛并生成后，筛选比例和图表工具会实时更新。', 'info');
            return;
        }
        renderDistribution({
            ...lastLoaded,
            ...getControlState()
        });
    }

    async function generateLapDistribution() {
        const year = document.getElementById('lapDistSeasonList')?.value;
        const round = document.getElementById('lapDistRaceList')?.value;
        if (!year || !round) return;
        const race = currentSchedule.find(r => String(r.round) === String(round));
        const raceName = race?.raceName || `Round ${round}`;
        setStatus('正在获取全场车手圈速，这会按车手请求每圈数据...', 'loading');
        setLoading('正在生成圈速分布图...');
        try {
            const data = await loadDriverLapData(year, round);
            lastLoaded = {
                year,
                round,
                raceName: data.raceName || raceName,
                drivers: data.drivers
            };
            rerenderLoadedChart();
        } catch (err) {
            console.warn('[Lap Distribution] failed', err);
            lastLoaded = null;
            setStatus(err?.message || String(err), 'error');
            setLoading('暂时无法生成该场比赛的圈速图。');
        }
    }

    function resetChartView() {
        const scroller = document.querySelector('#lapDistChart .lap-dist-scroll');
        if (scroller) {
            scroller.scrollTo({ left: 0, behavior: 'smooth' });
            setStatus('视图已重置到第一位车手。', 'ready');
        } else {
            setStatus('先生成圈速图后再重置视图。', 'info');
        }
    }

    function downloadCurrentSvg() {
        const svg = document.querySelector('#lapDistChart .lap-dist-svg');
        if (!svg) {
            setStatus('先生成圈速图后再下载 SVG。', 'info');
            return;
        }
        const source = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const year = document.getElementById('lapDistSeasonList')?.value || 'season';
        const round = document.getElementById('lapDistRaceList')?.value || 'round';
        link.href = url;
        link.download = `lap-time-distribution-${year}-round-${round}-${viewMode}.svg`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 250);
        setStatus('SVG 已生成下载。', 'ready');
    }

    async function initLapDistributionTab() {
        if (initialized) return;
        initialized = true;
        const seasonSel = document.getElementById('lapDistSeasonList');
        const raceSel = document.getElementById('lapDistRaceList');
        const filterSel = document.getElementById('lapDistFilter');
        const goBtn = document.getElementById('lapDistGo');
        const modeBtn = document.getElementById('lapDistModeToggle');
        const resetBtn = document.getElementById('lapDistResetView');
        const downloadBtn = document.getElementById('lapDistDownloadSvg');
        const optionInputs = [
            document.getElementById('lapDistShowPoints'),
            document.getElementById('lapDistShowMedian'),
            document.getElementById('lapDistShowLegend')
        ].filter(Boolean);
        if (!seasonSel || !raceSel || !goBtn) return;

        updateModeButton();
        seasonSel.addEventListener('change', async () => {
            setStatus('正在加载分站列表...', 'loading');
            clearLoadedChart('年份已切换，选择比赛后重新生成圈速图。');
            await fillRaceSelector(seasonSel.value);
            setStatus('选择比赛后点击生成圈速图。', 'info');
        });
        raceSel.addEventListener('change', () => {
            clearLoadedChart('比赛已切换，点击生成圈速图。');
            setStatus('比赛已切换，点击生成圈速图。', 'info');
        });
        filterSel?.addEventListener('change', rerenderLoadedChart);
        optionInputs.forEach(input => input.addEventListener('change', rerenderLoadedChart));
        modeBtn?.addEventListener('click', () => {
            viewMode = viewMode === 'violin' ? 'box' : 'violin';
            updateModeButton();
            rerenderLoadedChart();
        });
        resetBtn?.addEventListener('click', resetChartView);
        downloadBtn?.addEventListener('click', downloadCurrentSvg);
        goBtn.addEventListener('click', generateLapDistribution);

        setStatus('正在加载赛季和分站...', 'loading');
        await fillSeasonSelector();
        setStatus('选择比赛后点击生成圈速图。', 'info');
    }

    window.initLapDistributionTabFromSwitch = initLapDistributionTab;
})();
