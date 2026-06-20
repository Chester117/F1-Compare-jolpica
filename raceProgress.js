// Season-level race pace evolution chart.
// Uses per-race driver median lap pace relative to a race benchmark.
(function() {
    let initialized = false;
    const roundPaceCache = new Map();

    const DRIVER_PALETTE = [
        '#1fae91', '#cbdc28', '#24a7c4', '#d77a22', '#9b8af0',
        '#c62847', '#a0a6ae', '#f0b13d', '#30c4a8', '#e06f95'
    ];

    const TEAM_PALETTES = {
        mclaren: ['#25aeca', '#d17a22', '#b8a83a'],
        ferrari: ['#d61f33', '#f0b13d', '#7c1f2c'],
        mercedes: ['#35c8bd', '#a6adb7', '#0b8f85'],
        red_bull: ['#2d67d8', '#ffcf34', '#9ba6c2'],
        aston_martin: ['#16866f', '#c9dd2f', '#8bb8a8'],
        alpine: ['#4d86d9', '#f178b6', '#8ca2c7'],
        williams: ['#2196d9', '#8ea7bd', '#1b5f9d'],
        haas: ['#b8bdc6', '#d93a3a', '#5d6572'],
        sauber: ['#2ecf73', '#161a20', '#a5adb8'],
        rb: ['#386dff', '#d8e2f0', '#72a4ff']
    };

    const COUNTRY_TO_FLAG = {
        Australia: 'au',
        Bahrain: 'bh',
        'Saudi Arabia': 'sa',
        China: 'cn',
        Japan: 'jp',
        USA: 'us',
        'United States': 'us',
        Italy: 'it',
        Monaco: 'mc',
        Canada: 'ca',
        Spain: 'es',
        Austria: 'at',
        UK: 'gb',
        'United Kingdom': 'gb',
        Hungary: 'hu',
        Belgium: 'be',
        Netherlands: 'nl',
        Azerbaijan: 'az',
        Singapore: 'sg',
        Mexico: 'mx',
        Brazil: 'br',
        Qatar: 'qa',
        UAE: 'ae',
        'United Arab Emirates': 'ae',
        France: 'fr',
        Germany: 'de',
        Portugal: 'pt',
        Russia: 'ru',
        Turkey: 'tr',
        Malaysia: 'my',
        India: 'in',
        Korea: 'kr',
        Argentina: 'ar',
        Morocco: 'ma',
        Sweden: 'se',
        Switzerland: 'ch',
        'South Africa': 'za'
    };

    const ROUND_CODE = {
        albert_park: 'MEL',
        bahrain: 'BAH',
        jeddah: 'JED',
        shanghai: 'SHA',
        suzuka: 'SUZ',
        miami: 'MIA',
        imola: 'IMO',
        monaco: 'MON',
        villeneuve: 'CAN',
        catalunya: 'BAR',
        red_bull_ring: 'SPI',
        silverstone: 'SIL',
        hungaroring: 'BUD',
        spa: 'SPA',
        zandvoort: 'ZAN',
        monza: 'ITA',
        baku: 'BAK',
        marina_bay: 'SIN',
        americas: 'AUS',
        rodriguez: 'MEX',
        interlagos: 'SAO',
        vegas: 'LV',
        losail: 'DOH',
        yas_marina: 'ABU'
    };

    function esc(value) {
        return F1Utils.escapeHtml(String(value ?? ''));
    }

    function stableId(parts) {
        return parts.map(part => String(part ?? '')).join('|');
    }

    function setStatus(text, mode = 'info') {
        const node = document.getElementById('raceProgressMeta');
        if (!node) return;
        node.className = `race-progress-meta ${mode}`;
        node.textContent = text || '';
    }

    function setLoading(text) {
        const host = document.getElementById('raceProgressChart');
        if (host) {
            host.innerHTML = `<div class="race-progress-empty">${esc(text)}</div>`;
        }
    }

    function ensureOption(select, value, label, attrs = {}) {
        if (!select || value == null) return;
        let option = Array.from(select.options || []).find(item => item.value === String(value));
        if (!option) {
            option = document.createElement('option');
            option.value = String(value);
            option.textContent = label || String(value);
            select.appendChild(option);
        }
        Object.entries(attrs).forEach(([key, attrValue]) => {
            option.dataset[key] = attrValue;
        });
        select.value = String(value);
    }

    function driverCode(driver) {
        return driver?.code || (driver?.familyName || driver?.driverId || '').slice(0, 3).toUpperCase();
    }

    function driverName(driver) {
        return `${driver?.givenName || ''} ${driver?.familyName || ''}`.trim() || driver?.driverId || 'Driver';
    }

    function teamPalette(constructorId) {
        return TEAM_PALETTES[constructorId] || DRIVER_PALETTE;
    }

    function median(values) {
        return F1Utils.calculateMedian(values.filter(Number.isFinite));
    }

    function formatPct(value) {
        if (!Number.isFinite(value)) return 'N/A';
        return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    }

    function raceCode(race) {
        const circuitId = race?.Circuit?.circuitId;
        if (ROUND_CODE[circuitId]) return ROUND_CODE[circuitId];
        const locality = race?.Circuit?.Location?.locality || race?.raceName || 'RACE';
        return String(locality).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || `R${race?.round || ''}`;
    }

    function flagUrl(race) {
        const country = race?.Circuit?.Location?.country || '';
        const code = COUNTRY_TO_FLAG[country];
        return code ? `https://flagcdn.com/w40/${code}.png` : '';
    }

    async function fillSeasonSelector() {
        const seasonSel = document.getElementById('raceProgressSeasonList');
        if (!seasonSel) return;
        const seasonsResp = await F1Utils.getSeasons();
        const seasons = seasonsResp?.MRData?.SeasonTable?.Seasons || [];
        seasonSel.innerHTML = seasons
            .slice()
            .sort((a, b) => parseInt(b.season, 10) - parseInt(a.season, 10))
            .map(s => `<option value="${esc(s.season)}">${esc(s.season)}</option>`)
            .join('');
        await fillConstructorSelector(seasonSel.value);
    }

    async function fillConstructorSelector(year) {
        const constructorSel = document.getElementById('raceProgressConstructorList');
        if (!constructorSel || !year) return;
        constructorSel.innerHTML = '<option>加载车队中...</option>';
        const constructorsResp = await F1Utils.getConstructors(year);
        const constructors = constructorsResp?.MRData?.ConstructorTable?.Constructors || [];
        constructorSel.innerHTML = constructors
            .map(c => `<option value="${esc(c.constructorId)}" data-name="${esc(c.name)}">${esc(c.name)}</option>`)
            .join('');
    }

    async function loadSchedule(year) {
        const scheduleResp = await F1Utils.getSeasonSchedule(year);
        return scheduleResp?.MRData?.RaceTable?.Races || [];
    }

    async function sprintRounds(year) {
        try {
            const resp = await F1Utils.getSeasonSprintResults(year);
            const races = resp?.MRData?.RaceTable?.Races || [];
            return new Set(races.map(r => String(r.round)));
        } catch (_) {
            return new Set();
        }
    }

    function canUseLocalRaceProgressApi() {
        if (typeof window === 'undefined') return false;
        const hostname = window.location.hostname || '';
        return hostname !== 'chester117.github.io' && !hostname.endsWith('.github.io');
    }

    async function tryBuildRaceProgressFromLocalApi({ year, constructorId, teamName, threshold, baselineStrategy, excludePit }) {
        if (!canUseLocalRaceProgressApi()) return null;
        const params = new URLSearchParams({
            year,
            constructorId,
            teamName,
            threshold,
            baseline: baselineStrategy,
            excludePit: String(excludePit)
        });
        const response = await fetch(`/api/race-progress?${params.toString()}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(180000)
        });
        if (!response.ok) {
            throw new Error(`Local race progress API failed: ${response.status}`);
        }
        const body = await response.json();
        if (!body?.payload?.races) {
            throw new Error('Local race progress API returned an invalid payload');
        }
        return body;
    }

    function parsePitStops(pitResp) {
        const byDriver = new Map();
        const stops = pitResp?.MRData?.RaceTable?.Races?.[0]?.PitStops || [];
        for (const stop of stops) {
            const driverId = stop.driverId;
            const lap = parseInt(stop.lap || stop.Lap || stop.lapNumber, 10);
            if (!driverId || !Number.isFinite(lap)) continue;
            if (!byDriver.has(driverId)) byDriver.set(driverId, { pits: new Set(), outLaps: new Set() });
            const item = byDriver.get(driverId);
            item.pits.add(lap);
            item.outLaps.add(lap + 1);
        }
        return byDriver;
    }

    function appendAggregateLaps(maps, lapsResp, driverSet) {
        const laps = lapsResp?.MRData?.RaceTable?.Races?.[0]?.Laps || [];
        for (const lap of laps) {
            const lapNumber = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
            if (!Number.isFinite(lapNumber)) continue;
            for (const timing of lap.Timings || []) {
                const driverId = timing.driverId;
                if (!driverSet.has(driverId)) continue;
                const ms = F1Utils.convertTimeString(timing.time);
                if (Number.isFinite(ms)) maps.get(driverId).set(lapNumber, ms);
            }
        }
    }

    function parseAggregateLaps(lapsResp, driverIds) {
        const maps = new Map(driverIds.map(id => [id, new Map()]));
        appendAggregateLaps(maps, lapsResp, new Set(driverIds));
        return maps;
    }

    function lapPageUrl(year, round, limit, offset) {
        return `https://api.jolpi.ca/ergast/f1/${year}/${round}/laps.json?limit=${limit}&offset=${offset}`;
    }

    async function loadDriverLapMap(year, round, driverId) {
        const resp = await F1Utils.getRaceLaps(year, round, driverId);
        const laps = resp?.MRData?.RaceTable?.Races?.[0]?.Laps || [];
        const map = new Map();
        for (const lap of laps) {
            const lapNumber = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
            const timing = (lap.Timings || [])[0];
            const ms = F1Utils.convertTimeString(timing?.time);
            if (Number.isFinite(lapNumber) && Number.isFinite(ms)) map.set(lapNumber, ms);
        }
        return map;
    }

    async function loadRoundLapMaps(year, round, drivers) {
        const ids = drivers.map(d => d.driverId);
        let maps = new Map(ids.map(id => [id, new Map()]));
        try {
            const driverSet = new Set(ids);
            const aggregate = await F1Utils.getRoundLaps(year, round);
            maps = parseAggregateLaps(aggregate, ids);
            const meta = aggregate?.MRData || {};
            const total = parseInt(meta.total, 10);
            const limit = parseInt(meta.limit, 10);
            const firstOffset = parseInt(meta.offset, 10) || 0;
            if (Number.isFinite(total) && Number.isFinite(limit) && limit > 0) {
                for (let offset = firstOffset + limit; offset < total; offset += limit) {
                    const page = await F1Utils.fetchData(lapPageUrl(year, round, limit, offset));
                    appendAggregateLaps(maps, page, driverSet);
                }
            }
        } catch (e) {
            console.warn('[Race Progress] aggregate laps failed, falling back per driver', e);
        }
        const expectedLapsByDriver = new Map(drivers.map(driver => {
            const laps = parseInt(driver.result?.laps, 10);
            return [driver.driverId, Number.isFinite(laps) ? laps : 0];
        }));
        const missing = ids.filter(id => {
            const size = maps.get(id)?.size || 0;
            const expected = expectedLapsByDriver.get(id) || 0;
            if (expected <= 0) return size < 2;
            return size < Math.max(2, Math.floor(expected * 0.65));
        });
        if (missing.length) {
            const settled = await Promise.allSettled(missing.map(async id => [id, await loadDriverLapMap(year, round, id)]));
            settled.forEach(result => {
                if (result.status !== 'fulfilled') return;
                const [id, map] = result.value;
                maps.set(id, map);
            });
        }
        return maps;
    }

    function validLapValues(lapMap, pitData, threshold) {
        const raw = [...(lapMap || new Map()).entries()]
            .filter(([, ms]) => Number.isFinite(ms))
            .sort((a, b) => a[0] - b[0]);
        if (!raw.length) return [];
        const pitFiltered = raw.filter(([lap]) => !pitData || (!pitData.pits.has(lap) && !pitData.outLaps.has(lap)));
        const base = pitFiltered.length ? pitFiltered : raw;
        if (threshold === 'none') return base.map(([, ms]) => ms);
        const factor = parseFloat(threshold);
        if (!Number.isFinite(factor)) return base.map(([, ms]) => ms);
        const best = Math.min(...base.map(([, ms]) => ms));
        return base.filter(([, ms]) => ms <= best * factor).map(([, ms]) => ms);
    }

    async function roundPaceSnapshot(year, race, threshold, excludePit) {
        const round = String(race.round);
        const key = stableId([year, round, threshold, excludePit ? 'pit' : 'all']);
        if (roundPaceCache.has(key)) return roundPaceCache.get(key);

        const resultsResp = await F1Utils.getRaceResults(year, round);
        const resultsRace = resultsResp?.MRData?.RaceTable?.Races?.[0];
        const results = resultsRace?.Results || [];
        if (!results.length) throw new Error(`Round ${round} has no race results`);

        const drivers = results.map(res => ({
            driverId: res.Driver.driverId,
            code: driverCode(res.Driver),
            name: driverName(res.Driver),
            result: res
        }));
        const lapMaps = await loadRoundLapMaps(year, round, drivers);
        let pitStops = new Map();
        if (excludePit) {
            try {
                pitStops = parsePitStops(await F1Utils.getRoundPitStops(year, round));
            } catch (e) {
                console.warn('[Race Progress] pit stops unavailable', { year, round, e });
            }
        }

        const driverPaces = new Map();
        for (const driver of drivers) {
            const values = validLapValues(lapMaps.get(driver.driverId), pitStops.get(driver.driverId), threshold);
            if (values.length < 2) continue;
            driverPaces.set(driver.driverId, {
                ...driver,
                medianMs: median(values),
                lapsUsed: values.length,
                totalLaps: lapMaps.get(driver.driverId)?.size || values.length
            });
        }

        const medians = [...driverPaces.values()].map(item => item.medianMs).filter(Number.isFinite);
        if (!medians.length) throw new Error(`Round ${round} has no usable lap data`);
        const fastestMedian = Math.min(...medians);
        const fieldMedian = median(medians);
        const winnerId = results[0]?.Driver?.driverId;
        const winnerMedian = driverPaces.get(winnerId)?.medianMs || fastestMedian;

        const snapshot = {
            round,
            race: resultsRace || race,
            drivers,
            driverPaces,
            fastestMedian,
            fieldMedian,
            winnerMedian
        };
        roundPaceCache.set(key, snapshot);
        return snapshot;
    }

    function teamRaceMap(constructorResults) {
        const map = new Map();
        const races = constructorResults?.MRData?.RaceTable?.Races || [];
        for (const race of races) {
            const results = race.Results || [];
            if (!results.length) continue;
            map.set(String(race.round), results.map(res => ({
                driverId: res.Driver.driverId,
                code: driverCode(res.Driver),
                name: driverName(res.Driver),
                driver: res.Driver
            })));
        }
        return map;
    }

    function smoothPath(points) {
        if (!points.length) return '';
        if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
        let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];
            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;
            d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
        }
        return d;
    }

    function lineSegments(points) {
        const segments = [];
        let current = [];
        for (const point of points) {
            if (point && Number.isFinite(point.value)) {
                current.push(point);
            } else if (current.length) {
                segments.push(current);
                current = [];
            }
        }
        if (current.length) segments.push(current);
        return segments;
    }

    function renderChart(payload) {
        const host = document.getElementById('raceProgressChart');
        if (!host) return;
        if (!payload.races.length) {
            host.innerHTML = '<div class="race-progress-empty">没有足够的正赛圈速数据可绘制。</div>';
            return;
        }

        const width = 1200;
        const height = 700;
        const margin = { top: 112, right: 190, bottom: 152, left: 92 };
        const plotW = width - margin.left - margin.right;
        const plotH = height - margin.top - margin.bottom;
        const axisY = margin.top + plotH;
        const allValues = [
            ...payload.medianLine.map(p => p.value),
            ...payload.drivers.flatMap(driver => driver.points.map(point => point.value))
        ].filter(Number.isFinite);
        const maxValue = Math.max(1, ...allValues);
        const minValue = Math.min(0, ...allValues);
        const yMax = Math.ceil(maxValue + 0.35);
        const yMin = Math.min(0, Math.floor(minValue - 0.35));
        const yRange = Math.max(1, yMax - yMin);
        const yTicks = [];
        const tickStep = yMax <= 4 ? 1 : 2;
        for (let v = yMin; v <= yMax + 0.001; v += tickStep) yTicks.push(v);
        if (!yTicks.some(v => Math.abs(v) < 0.001)) yTicks.push(0);
        if (!yTicks.includes(yMax)) yTicks.push(yMax);
        yTicks.sort((a, b) => a - b);
        const xAt = index => margin.left + (payload.races.length === 1 ? plotW / 2 : (plotW * index / (payload.races.length - 1)));
        const yAt = value => margin.top + ((yMax - (value || 0)) / yRange) * plotH;

        const grid = yTicks.map(v => {
            const y = yAt(v);
            return `<line class="rpe-grid" x1="${margin.left}" y1="${y.toFixed(1)}" x2="${margin.left + plotW}" y2="${y.toFixed(1)}"></line>
                <text class="rpe-y-label" x="${margin.left - 17}" y="${(y + 5).toFixed(1)}" text-anchor="end">${v >= 0 ? '+' : ''}${v.toFixed(0)}%</text>`;
        }).join('');

        const xAxis = payload.races.map((race, index) => {
            const x = xAt(index);
            const flagY = axisY + 48;
            const sprintY = axisY + 77;
            const flag = race.flag ? `<image class="rpe-flag" href="${esc(race.flag)}" x="${(x - 13).toFixed(1)}" y="${flagY.toFixed(1)}" width="26" height="17"></image>` : '';
            const sprint = race.isSprint ? `<text class="rpe-sprint" x="${x.toFixed(1)}" y="${sprintY.toFixed(1)}" text-anchor="middle">SPRINT</text>` : '';
            return `<g>
                <text class="rpe-race-code" x="${x.toFixed(1)}" y="${(axisY + 31).toFixed(1)}" text-anchor="middle">${esc(race.code)}</text>
                ${flag}
                ${sprint}
            </g>`;
        }).join('');

        const medianPoints = payload.medianLine.map((point, index) => ({ ...point, x: xAt(index), y: yAt(point.value) }));
        const medianSegments = lineSegments(medianPoints)
            .map(points => `<path class="rpe-median-line" d="${smoothPath(points)}"></path>
                ${points.map(point => `<circle class="rpe-median-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4"></circle>`).join('')}`)
            .join('');

        const driverLines = payload.drivers.map(driver => {
            const points = driver.points.map((point, index) => {
                if (!Number.isFinite(point.value)) return null;
                return { ...point, x: xAt(index), y: yAt(point.value) };
            });
            const segments = lineSegments(points);
            const paths = segments.map(segment => `<path class="rpe-driver-line" d="${smoothPath(segment)}" style="--line-color:${driver.color}"></path>`).join('');
            const dots = points
                .filter(Boolean)
                .map(point => `<circle class="rpe-driver-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="6" style="--line-color:${driver.color}">
                    <title>${esc(driver.name)} · ${esc(point.raceName)} · ${formatPct(point.value)} · ${point.lapsUsed}/${point.totalLaps} laps</title>
                </circle>`)
                .join('');
            const visiblePoints = points.filter(Boolean);
            const last = visiblePoints[visiblePoints.length - 1];
            const labelY = last ? Math.max(margin.top + 20, Math.min(axisY - 18, last.y)) : 0;
            const label = last ? `<g class="rpe-end-label" style="--line-color:${driver.color}">
                    <line x1="${(last.x + 13).toFixed(1)}" y1="${last.y.toFixed(1)}" x2="${(margin.left + plotW + 42).toFixed(1)}" y2="${labelY.toFixed(1)}"></line>
                    <circle cx="${(margin.left + plotW + 56).toFixed(1)}" cy="${labelY.toFixed(1)}" r="18"></circle>
                    <text x="${(margin.left + plotW + 92).toFixed(1)}" y="${(labelY + 6).toFixed(1)}">${esc(driver.code)}</text>
                </g>` : '';
            return `${paths}${dots}${label}`;
        }).join('');

        const calloutCandidates = payload.drivers.flatMap((driver, driverIndex) => {
            const candidates = driver.points
                .map((point, index) => ({ ...point, index, driver, driverIndex }))
                .filter(point => Number.isFinite(point.value));
            if (!candidates.length) return [];
            const byMax = candidates.slice().sort((a, b) => b.value - a.value)[0];
            const latest = candidates[candidates.length - 1];
            const chosen = byMax && latest && byMax.index !== latest.index ? [byMax, latest] : [byMax || latest];
            return chosen.slice(0, 2);
        });
        const calloutSlots = new Map();
        const placedCalloutBoxes = [];
        const callouts = calloutCandidates.map(point => {
            const x = xAt(point.index);
            const y = yAt(point.value);
            const rightSide = point.index > payload.races.length * 0.56;
            const slotKey = `${point.index}-${rightSide ? 'right' : 'left'}`;
            const slot = calloutSlots.get(slotKey) || 0;
            calloutSlots.set(slotKey, slot + 1);
            const labelW = 112;
            const dx = rightSide ? -130 : 18;
            const baseDy = rightSide ? -28 : -24;
            const dy = baseDy + (slot * 31) + ((point.driverIndex % 2) * 4);
            const labelX = Math.max(margin.left + 4, Math.min(margin.left + plotW - labelW - 4, x + dx));
            let labelY = Math.max(margin.top + 8, Math.min(axisY - 38, y + dy));
            const overlapsPlaced = yPos => placedCalloutBoxes.some(box => (
                labelX < box.x + box.w + 8 &&
                labelX + labelW + 8 > box.x &&
                yPos < box.y + box.h + 5 &&
                yPos + 26 + 5 > box.y
            ));
            let guard = 0;
            while (overlapsPlaced(labelY) && labelY < axisY - 38 && guard < 12) {
                labelY = Math.min(axisY - 38, labelY + 31);
                guard += 1;
            }
            while (overlapsPlaced(labelY) && labelY > margin.top + 8 && guard < 24) {
                labelY = Math.max(margin.top + 8, labelY - 31);
                guard += 1;
            }
            placedCalloutBoxes.push({ x: labelX, y: labelY, w: labelW, h: 26 });
            return `<g class="rpe-callout">
                <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${labelX.toFixed(1)}" y2="${(labelY + 12).toFixed(1)}"></line>
                <rect x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" width="${labelW}" height="26" rx="4"></rect>
                <text x="${(labelX + 8).toFixed(1)}" y="${(labelY + 17).toFixed(1)}">${esc(point.driver.code)} ${point.lapsUsed}/${point.totalLaps} laps</text>
            </g>`;
        }).join('');

        const benchmarkText = payload.baselineLabel;
        const subtitle = `${payload.teamName} · ${payload.year} Season`;
        const svg = `<svg class="race-progress-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(payload.teamName)} ${esc(payload.year)} Race Pace Evolution">
            <rect class="rpe-bg" x="0" y="0" width="${width}" height="${height}" rx="0"></rect>
            <text class="rpe-kicker" x="${margin.left}" y="38">RACE PACE DELTA (%)</text>
            <text class="rpe-brand" x="${width - 92}" y="38" text-anchor="end">* F1COMPARE</text>
            <text class="rpe-title" x="${margin.left}" y="83">Race Pace Evolution</text>
            <text class="rpe-subtitle" x="${margin.left}" y="109">${esc(subtitle)}</text>
            <text class="rpe-y-title" transform="translate(30 ${margin.top + plotH / 2}) rotate(-90)" text-anchor="middle">RACE PACE DELTA (%)</text>
            ${grid}
            <line class="rpe-axis" x1="${margin.left}" y1="${axisY}" x2="${margin.left + plotW}" y2="${axisY}"></line>
            ${medianSegments}
            ${driverLines}
            ${callouts}
            ${xAxis}
            <g class="rpe-legend">
                <circle cx="${width / 2 - 92}" cy="${height - 32}" r="5"></circle>
                <text x="${width / 2 - 74}" y="${height - 27}">MEDIAN RACE PACE</text>
            </g>
            <text class="rpe-footnote" x="${margin.left}" y="${height - 18}">${esc(benchmarkText)}</text>
        </svg>`;

        host.innerHTML = `<div class="race-progress-card">${svg}</div>`;
    }

    async function buildRaceProgress() {
        const year = document.getElementById('raceProgressSeasonList')?.value;
        const constructorSel = document.getElementById('raceProgressConstructorList');
        const constructorId = constructorSel?.value;
        const teamName = constructorSel?.selectedOptions?.[0]?.dataset?.name || constructorSel?.selectedOptions?.[0]?.textContent || constructorId;
        const threshold = document.getElementById('raceProgressThreshold')?.value || '1.15';
        const baselineStrategy = document.getElementById('raceProgressBaseline')?.value || 'fastestMedian';
        const excludePit = document.getElementById('raceProgressExcludePit')?.checked !== false;
        if (!year || !constructorId) return;

        setStatus('正在加载赛历、正赛结果和圈速数据。首次生成会比较慢，之后会走本地缓存。', 'loading');
        setLoading('正在生成 Race Pace Evolution...');

        try {
            const localResult = await tryBuildRaceProgressFromLocalApi({
                year,
                constructorId,
                teamName,
                threshold,
                baselineStrategy,
                excludePit
            });
            if (localResult) {
                renderChart(localResult.payload);
                const latestRace = localResult.payload.races[localResult.payload.races.length - 1];
                const points = localResult.payload.drivers.reduce((sum, driver) => sum + driver.points.filter(point => Number.isFinite(point.value)).length, 0);
                const skippedText = localResult.payload.skipped?.length ? `跳过 ${localResult.payload.skipped.length} 站，详见服务端日志。` : '';
                const latestText = latestRace ? `最新纳入：${latestRace.raceName} / ${latestRace.code}。` : '';
                setStatus(`完成：${localResult.payload.races.length} 场比赛，${localResult.payload.drivers.length} 位车手，${points} 个车手走势点。${latestText}${skippedText}缓存：${localResult.cache}。`, 'ready');
                return;
            }
        } catch (err) {
            console.warn('[Race Progress] local API failed, falling back to browser calculation', err);
            setStatus('本地缓存 API 暂不可用，正在回退到浏览器端计算。', 'loading');
        }

        const [schedule, constructorResults, sprintSet] = await Promise.all([
            loadSchedule(year),
            F1Utils.getConstructorResults(year, constructorId),
            sprintRounds(year)
        ]);
        const teamByRound = teamRaceMap(constructorResults);
        const selectedRaces = schedule.filter(race => teamByRound.has(String(race.round)));
        const palette = teamPalette(constructorId);
        const driverMap = new Map();
        const raceRows = [];

        for (let i = 0; i < selectedRaces.length; i++) {
            const race = selectedRaces[i];
            setStatus(`正在处理 ${race.round}/${selectedRaces.length}: ${race.raceName}`, 'loading');
            try {
                const snapshot = await roundPaceSnapshot(year, race, threshold, excludePit);
                const baseline = baselineStrategy === 'fieldMedian'
                    ? snapshot.fieldMedian
                    : baselineStrategy === 'winnerMedian'
                        ? snapshot.winnerMedian
                        : snapshot.fastestMedian;
                if (!Number.isFinite(baseline) || baseline <= 0) continue;
                const medianLineValue = ((snapshot.fieldMedian - baseline) / baseline) * 100;
                const teamDrivers = teamByRound.get(String(race.round)) || [];
                const racePoint = {
                    round: String(race.round),
                    code: raceCode(race),
                    flag: flagUrl(race),
                    raceName: race.raceName,
                    isSprint: sprintSet.has(String(race.round)),
                    medianLineValue
                };
                raceRows.push(racePoint);
                for (const driver of teamDrivers) {
                    if (!driverMap.has(driver.driverId)) {
                        driverMap.set(driver.driverId, {
                            id: driver.driverId,
                            code: driver.code,
                            name: driver.name,
                            color: palette[driverMap.size % palette.length],
                            points: Array.from({ length: Math.max(0, raceRows.length - 1) }, () => ({
                                value: NaN,
                                raceName: '',
                                medianMs: NaN,
                                lapsUsed: 0,
                                totalLaps: 0
                            }))
                        });
                    }
                    const pace = snapshot.driverPaces.get(driver.driverId);
                    const delta = pace ? ((pace.medianMs - baseline) / baseline) * 100 : NaN;
                    driverMap.get(driver.driverId).points.push({
                        value: delta,
                        raceName: race.raceName,
                        medianMs: pace?.medianMs || NaN,
                        lapsUsed: pace?.lapsUsed || 0,
                        totalLaps: pace?.totalLaps || 0
                    });
                }
                for (const [driverId, driver] of driverMap.entries()) {
                    if (!(teamDrivers || []).some(item => item.driverId === driverId) && driver.points.length < raceRows.length) {
                        driver.points.push({ value: NaN, raceName: race.raceName, medianMs: NaN, lapsUsed: 0, totalLaps: 0 });
                    }
                }
            } catch (e) {
                console.warn('[Race Progress] round skipped', race.round, e);
            }
        }

        const drivers = [...driverMap.values()]
            .map(driver => {
                while (driver.points.length < raceRows.length) {
                    driver.points.push({ value: NaN, raceName: '', medianMs: NaN, lapsUsed: 0, totalLaps: 0 });
                }
                return driver;
            })
            .filter(driver => driver.points.some(point => Number.isFinite(point.value)));

        const baselineLabel = {
            fastestMedian: '0% = fastest driver median race pace in each Grand Prix',
            winnerMedian: '0% = race winner median race pace in each Grand Prix',
            fieldMedian: '0% = field median race pace in each Grand Prix'
        }[baselineStrategy] || '0% = fastest driver median race pace';

        renderChart({
            year,
            teamName,
            constructorId,
            baselineLabel,
            races: raceRows,
            medianLine: raceRows.map(row => ({ value: row.medianLineValue })),
            drivers
        });
        const points = drivers.reduce((sum, driver) => sum + driver.points.filter(point => Number.isFinite(point.value)).length, 0);
        const latestRace = raceRows[raceRows.length - 1];
        const latestText = latestRace ? `最新纳入：${latestRace.raceName} / ${latestRace.code}。` : '';
        setStatus(`完成：${raceRows.length} 场比赛，${drivers.length} 位车手，${points} 个车手走势点。${latestText}`, 'ready');
    }

    function downloadSvg() {
        const svg = document.querySelector('#raceProgressChart .race-progress-svg');
        if (!svg) {
            setStatus('先生成走势图后再下载 SVG。', 'info');
            return;
        }
        const source = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const year = document.getElementById('raceProgressSeasonList')?.value || 'season';
        const team = document.getElementById('raceProgressConstructorList')?.selectedOptions?.[0]?.dataset?.name || 'team';
        const link = document.createElement('a');
        link.href = url;
        link.download = `race-pace-evolution-${year}-${team.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.svg`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 250);
        setStatus('SVG 已生成下载。', 'ready');
    }

    async function initRaceProgressTab() {
        if (initialized) return;
        const seasonSel = document.getElementById('raceProgressSeasonList');
        const goBtn = document.getElementById('raceProgressGo');
        const downloadBtn = document.getElementById('raceProgressDownloadSvg');
        if (!seasonSel || !goBtn) return;
        initialized = true;

        seasonSel.addEventListener('change', async () => {
            setStatus('正在加载该赛季车队...', 'loading');
            setLoading('年份已切换，选择车队后重新生成。');
            await fillConstructorSelector(seasonSel.value);
            setStatus('选择车队后点击生成走势图。', 'info');
        });
        goBtn.addEventListener('click', () => {
            goBtn.disabled = true;
            goBtn.textContent = '生成中...';
            buildRaceProgress()
                .catch(err => {
                    console.warn('[Race Progress] failed', err);
                    setStatus(err?.message || String(err), 'error');
                    setLoading('暂时无法生成该车队的正赛走势。');
                })
                .finally(() => {
                    goBtn.disabled = false;
                    goBtn.textContent = '生成走势图';
                });
        });
        downloadBtn?.addEventListener('click', downloadSvg);

        setStatus('正在加载赛季...', 'loading');
        await fillSeasonSelector();
        setStatus('选择年份和车队后点击生成走势图。', 'info');
    }

    window.setRaceProgressContext = async function({ year, constructorId, teamName, threshold, baseline, excludePit } = {}) {
        ensureOption(document.getElementById('raceProgressSeasonList'), year, year);
        ensureOption(
            document.getElementById('raceProgressConstructorList'),
            constructorId,
            teamName || constructorId,
            { name: teamName || constructorId }
        );
        ensureOption(
            document.getElementById('raceProgressThreshold'),
            threshold || '1.15',
            threshold === 'none' ? 'No Filter' : `${Math.round(Number(threshold || 1.15) * 100)}%`
        );
        const baselineSel = document.getElementById('raceProgressBaseline');
        if (baselineSel && baseline) baselineSel.value = baseline;
        const excludePitInput = document.getElementById('raceProgressExcludePit');
        if (excludePitInput) excludePitInput.checked = excludePit !== false;
    };

    window.generateRaceProgressView = buildRaceProgress;
    window.getRaceProgressCacheSummary = function() {
        return { roundPaceCacheEntries: roundPaceCache.size };
    };
    window.clearRaceProgressCaches = function() {
        const entries = roundPaceCache.size;
        roundPaceCache.clear();
        return { removedRoundPaceEntries: entries };
    };
    window.initRaceProgressTabFromSwitch = initRaceProgressTab;
})();
