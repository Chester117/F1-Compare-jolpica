// Full-race lap time distribution tab.
// Renders a lightweight SVG violin + scatter chart for all classified drivers.
(function() {
    let initialized = false;
    let currentSchedule = [];

    const DRIVER_COLORS = [
        '#25d0bd', '#ff273a', '#3f6bff', '#f0c84b', '#7f87ff',
        '#ff9a3d', '#ff87c5', '#30b7d8', '#c5aa27', '#d0d7df',
        '#ea6d45', '#f7bf45', '#00d294', '#8c96a6', '#ffb347',
        '#00a5ef', '#6f737d', '#d67522', '#50c878', '#27b4d8'
    ];

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
        return F1Utils.escapeHtml(value);
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

    function renderDistribution({ year, raceName, drivers, filter }) {
        const host = document.getElementById('lapDistChart');
        if (!host) return;

        const prepared = drivers.map(driver => {
            const raw = driver.laps.map(l => l.ms).filter(Number.isFinite);
            const best = Math.min(...raw);
            const factor = filter === 'none' ? null : parseFloat(filter);
            const kept = driver.laps.filter(l => !factor || l.ms <= best * factor);
            const keptValues = kept.map(l => l.ms);
            const q35 = percentile(keptValues, 0.35);
            const q72 = percentile(keptValues, 0.72);
            return {
                ...driver,
                best,
                kept,
                keptValues,
                q35,
                q72
            };
        }).filter(d => d.keptValues.length >= 2);

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

        const margin = { top: 76, right: 34, bottom: 88, left: 86 };
        const slot = 76;
        const plotW = Math.max(1050, prepared.length * slot);
        const plotH = 560;
        const width = margin.left + plotW + margin.right;
        const height = margin.top + plotH + margin.bottom;
        const xAt = i => margin.left + slot / 2 + i * slot;
        const yAt = ms => margin.top + (max - ms) / (max - min) * plotH;

        const ticks = [];
        const approxStep = (max - min) / 6;
        const step = Math.max(500, Math.round(approxStep / 500) * 500);
        for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);

        const grid = ticks.map(v => {
            const y = yAt(v);
            return `<line class="lap-grid-line" x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(margin.left + plotW).toFixed(1)}" y2="${y.toFixed(1)}"></line>
                    <text class="lap-axis-label" x="${margin.left - 14}" y="${(y + 5).toFixed(1)}" text-anchor="end">${msToLabel(v)}</text>`;
        }).join('');

        const driverNodes = prepared.map((driver, i) => {
            const x = xAt(i);
            const violin = buildDensityPath(driver.keptValues, x, yAt, Math.min(26, slot * 0.34), min, max);
            const color = driver.color;
            const median = percentile(driver.keptValues, 0.5);
            const points = driver.kept.map(lap => {
                const band = lap.ms <= driver.q35 ? 'fast' : (lap.ms <= driver.q72 ? 'regular' : 'slow');
                const cx = x + seededJitter(i, lap.lap) * Math.min(30, slot * 0.43);
                const cy = yAt(lap.ms);
                return `<circle class="lap-point lap-point-${band}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.6">
                    <title>${escapeAttr(driver.name)} Lap ${lap.lap}: ${msToLabel(lap.ms)}</title>
                </circle>`;
            }).join('');
            return `<g class="lap-driver-group">
                <path class="lap-violin" d="${violin}" style="--driver-color:${color}"></path>
                <line class="lap-driver-spine" x1="${x.toFixed(1)}" y1="${yAt(Math.min(...driver.keptValues)).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yAt(Math.max(...driver.keptValues)).toFixed(1)}"></line>
                <line class="lap-driver-median" x1="${(x - 23).toFixed(1)}" y1="${yAt(median).toFixed(1)}" x2="${(x + 23).toFixed(1)}" y2="${yAt(median).toFixed(1)}"></line>
                ${points}
                <text class="lap-driver-code" x="${x.toFixed(1)}" y="${(height - 48).toFixed(1)}" text-anchor="middle">${escapeAttr(driver.code)}</text>
            </g>`;
        }).join('');

        const legendX = width - 196;
        const legendY = height - 122;
        const svg = `<svg class="lap-dist-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttr(raceName)} lap time distribution">
            <rect class="lap-chart-bg" x="0" y="0" width="${width}" height="${height}" rx="8"></rect>
            <text class="lap-chart-title" x="${width / 2}" y="32" text-anchor="middle">${escapeAttr(year)} ${escapeAttr(raceName)} - Race</text>
            <text class="lap-chart-subtitle" x="${width / 2}" y="58" text-anchor="middle">Lap Time Distribution</text>
            <g class="lap-grid">${grid}</g>
            <text class="lap-y-title" transform="translate(28 ${height / 2}) rotate(-90)" text-anchor="middle">Lap Time (min:sec)</text>
            ${driverNodes}
            <line class="lap-axis-base" x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}"></line>
            <text class="lap-x-title" x="${width / 2}" y="${height - 14}" text-anchor="middle">Driver</text>
            <g class="lap-legend" transform="translate(${legendX} ${legendY})">
                <rect width="154" height="92" rx="8"></rect>
                <circle class="lap-point-slow" cx="18" cy="24" r="5"></circle><text x="36" y="29">慢圈</text>
                <circle class="lap-point-regular" cx="18" cy="48" r="5"></circle><text x="36" y="53">常规</text>
                <circle class="lap-point-fast" cx="18" cy="72" r="5"></circle><text x="36" y="77">快圈</text>
            </g>
        </svg>`;

        host.innerHTML = `<div class="lap-dist-scroll">${svg}</div>`;

        const rawCount = drivers.reduce((sum, d) => sum + d.laps.length, 0);
        const keptCount = prepared.reduce((sum, d) => sum + d.kept.length, 0);
        const filterText = filter === 'none' ? '显示全部圈' : `过滤慢于个人最快圈 ${(parseFloat(filter) * 100).toFixed(0)}% 的异常圈`;
        setStatus(`${prepared.length} 位车手，${keptCount}/${rawCount} 个圈速点。${filterText}。Jolpica/Ergast 不提供轮胎配方，所以点颜色表示相对圈速分段。`, 'ready');
    }

    async function generateLapDistribution() {
        const year = document.getElementById('lapDistSeasonList')?.value;
        const round = document.getElementById('lapDistRaceList')?.value;
        const filter = document.getElementById('lapDistFilter')?.value || '1.15';
        if (!year || !round) return;
        const race = currentSchedule.find(r => String(r.round) === String(round));
        const raceName = race?.raceName || `Round ${round}`;
        setStatus('正在获取全场车手圈速，这会按车手请求每圈数据...', 'loading');
        setLoading('正在生成圈速分布图...');
        try {
            const data = await loadDriverLapData(year, round);
            renderDistribution({ year, raceName: data.raceName || raceName, drivers: data.drivers, filter });
        } catch (err) {
            console.warn('[Lap Distribution] failed', err);
            setStatus(err?.message || String(err), 'error');
            setLoading('暂时无法生成该场比赛的圈速图。');
        }
    }

    async function initLapDistributionTab() {
        if (initialized) return;
        initialized = true;
        const seasonSel = document.getElementById('lapDistSeasonList');
        const raceSel = document.getElementById('lapDistRaceList');
        const filterSel = document.getElementById('lapDistFilter');
        const goBtn = document.getElementById('lapDistGo');
        if (!seasonSel || !raceSel || !goBtn) return;
        seasonSel.addEventListener('change', async () => {
            setStatus('');
            await fillRaceSelector(seasonSel.value);
        });
        filterSel?.addEventListener('change', () => setStatus('筛选条件已更新，点击生成圈速图刷新。', 'info'));
        goBtn.addEventListener('click', generateLapDistribution);
        setStatus('正在加载赛季和分站...', 'loading');
        await fillSeasonSelector();
        setStatus('选择比赛后点击生成圈速图。', 'info');
    }

    window.initLapDistributionTabFromSwitch = initLapDistributionTab;
})();
