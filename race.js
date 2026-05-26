// Race comparison tab logic
(function(){
  let raceTabInitialized = false;
  let hasRaceResults = false;
  let isUpdatingRace = false;
  let isDirtyRace = false;
  const lapCache = new Map(); // key: `${year}-${round}-${driverId}` -> {laps: Map(lapNumber->ms), pits: Set(lap numbers), outLaps: Set(lap numbers)}
  // Round-level aggregate cache to minimize API calls
  const roundAggCache = new Map(); // key: `${year}-${round}` -> { lapsByDriver: Map, pitsByDriver: Map, outLapsByDriver: Map, pitLoaded: boolean }

  // 点云图：本次渲染创建的 Highcharts 实例，重渲染前统一销毁，避免泄漏
  const raceChartInstances = [];
  function destroyAllRaceCharts() {
    while (raceChartInstances.length) {
      const c = raceChartInstances.pop();
      try { c && c.destroy && c.destroy(); } catch (_) {}
    }
  }

  // 简单最小二乘线性拟合，返回 { slope, intercept } 用于点云上的趋势线
  function linearFit(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    const mx = sx / n, my = sy / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx;
      num += dx * (ys[i] - my);
      den += dx * dx;
    }
    if (den === 0) return { slope: 0, intercept: my };
    const slope = num / den;
    return { slope, intercept: my - slope * mx };
  }

  function msToLabel(ms) {
    const abs = Math.abs(ms);
    const m = Math.floor(abs / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    const mm = m > 0 ? `${m}:` : '';
    const ss = m > 0 ? String(s).padStart(2, '0') : String(s);
    const msPart = String(abs % 1000).padStart(3, '0');
    return `${mm}${ss}.${msPart}`;
  }

  // 渲染单场圈速点云图
  // host: 容器 div
  // ctx: { year, round, raceName, d1Name, d2Name, d1Data, d2Data, usedSet, excludePit, threshold }
  function renderRaceScatter(host, ctx) {
    if (host.dataset.rendered === '1') return; // 懒渲染：只在首次展开时创建
    if (typeof window.__waitHighchartsReady !== 'function') {
      host.innerHTML = '<div class="loading-text" style="padding:20px;text-align:center;">图表库未就绪</div>';
      return;
    }
    host.innerHTML = '<div class="loading-text" style="padding:20px;text-align:center;">图表加载中…</div>';

    window.__waitHighchartsReady(() => {
      const { d1Data, d2Data, usedSet, excludePit, threshold, d1Name, d2Name } = ctx;
      // D1/D2 颜色（与 QualifyingTrendGraph 风格一致）
      const COLOR_D1 = '#1e90ff';
      const COLOR_D2 = '#ff6b6b';

      // 构建散点数据
      const d1Used = [], d1Excluded = [];
      const d2Used = [], d2Excluded = [];

      const lapTimeToPoint = (lap, ms, isUsed, reasonExcl) => {
        const point = { x: lap, y: ms, custom: { reason: reasonExcl } };
        return point;
      };

      const allLaps = new Set([...d1Data.lapsMap.keys(), ...d2Data.lapsMap.keys()]);
      // 取每个 driver 的最快圈，用于在 tooltip 解释阈值
      let best1 = Infinity, best2 = Infinity;
      for (const n of allLaps) {
        const t1 = d1Data.lapsMap.get(n);
        const t2 = d2Data.lapsMap.get(n);
        if (Number.isFinite(t1) && t1 < best1) best1 = t1;
        if (Number.isFinite(t2) && t2 < best2) best2 = t2;
      }
      const threshFactor = (typeof threshold === 'string' && threshold !== 'none') ? parseFloat(threshold) : null;

      for (const lap of [...allLaps].sort((a, b) => a - b)) {
        const t1 = d1Data.lapsMap.get(lap);
        const t2 = d2Data.lapsMap.get(lap);
        if (Number.isFinite(t1)) {
          const pitExcl = excludePit && (d1Data.pits.has(lap) || d1Data.outLaps.has(lap));
          const overThresh = threshFactor && Number.isFinite(best1) && t1 > best1 * threshFactor;
          if (usedSet.has(lap) && !pitExcl && !overThresh) {
            d1Used.push({ x: lap, y: t1 });
          } else {
            const reason = pitExcl ? '进站/出站圈' : (overThresh ? `超过 ${(threshFactor*100).toFixed(0)}% 阈值` : '另一位车手缺失该圈');
            d1Excluded.push({ x: lap, y: t1, custom: { reason } });
          }
        }
        if (Number.isFinite(t2)) {
          const pitExcl = excludePit && (d2Data.pits.has(lap) || d2Data.outLaps.has(lap));
          const overThresh = threshFactor && Number.isFinite(best2) && t2 > best2 * threshFactor;
          if (usedSet.has(lap) && !pitExcl && !overThresh) {
            d2Used.push({ x: lap, y: t2 });
          } else {
            const reason = pitExcl ? '进站/出站圈' : (overThresh ? `超过 ${(threshFactor*100).toFixed(0)}% 阈值` : '另一位车手缺失该圈');
            d2Excluded.push({ x: lap, y: t2, custom: { reason } });
          }
        }
      }

      // 线性拟合（仅入选圈）
      const fit1 = linearFit(d1Used.map(p => p.x), d1Used.map(p => p.y));
      const fit2 = linearFit(d2Used.map(p => p.x), d2Used.map(p => p.y));
      const minLap = Math.min(...allLaps);
      const maxLap = Math.max(...allLaps);
      const trendLine = (fit) => fit ? [[minLap, fit.intercept + fit.slope * minLap], [maxLap, fit.intercept + fit.slope * maxLap]] : [];

      const series = [
        {
          name: `${d1Name}`,
          type: 'scatter',
          data: d1Used,
          color: COLOR_D1,
          marker: { radius: 4, symbol: 'circle' }
        },
        {
          name: `${d2Name}`,
          type: 'scatter',
          data: d2Used,
          color: COLOR_D2,
          marker: { radius: 4, symbol: 'circle' }
        },
        {
          name: `${d1Name} (排除)`,
          type: 'scatter',
          data: d1Excluded,
          color: COLOR_D1,
          marker: { radius: 3, symbol: 'circle', fillOpacity: 0.25, lineWidth: 0 },
          opacity: 0.4,
          visible: true
        },
        {
          name: `${d2Name} (排除)`,
          type: 'scatter',
          data: d2Excluded,
          color: COLOR_D2,
          marker: { radius: 3, symbol: 'circle', fillOpacity: 0.25, lineWidth: 0 },
          opacity: 0.4,
          visible: true
        }
      ];

      if (fit1) {
        const dSlope1 = (fit1.slope / 1000).toFixed(4); // 秒/圈
        series.push({
          name: `${d1Name} 趋势 (${dSlope1 >= 0 ? '+' : ''}${dSlope1} s/圈)`,
          type: 'line',
          data: trendLine(fit1),
          color: COLOR_D1,
          dashStyle: 'Solid',
          lineWidth: 2,
          marker: { enabled: false },
          enableMouseTracking: false
        });
      }
      if (fit2) {
        const dSlope2 = (fit2.slope / 1000).toFixed(4);
        series.push({
          name: `${d2Name} 趋势 (${dSlope2 >= 0 ? '+' : ''}${dSlope2} s/圈)`,
          type: 'line',
          data: trendLine(fit2),
          color: COLOR_D2,
          dashStyle: 'Solid',
          lineWidth: 2,
          marker: { enabled: false },
          enableMouseTracking: false
        });
      }

      host.innerHTML = '';
      const chart = Highcharts.chart(host, {
        chart: { type: 'scatter', height: 360 },
        title: { text: `${ctx.raceName} — 圈速点云`, style: { fontSize: '14px' } },
        xAxis: {
          title: { text: '圈数' },
          allowDecimals: false
        },
        yAxis: {
          title: { text: '圈速' },
          labels: { formatter: function() { return msToLabel(this.value); } }
        },
        tooltip: {
          formatter: function() {
            const t = msToLabel(this.y);
            const reason = this.point?.custom?.reason;
            const tail = reason ? `<br/><span style="color:#999;">${reason}</span>` : '';
            return `<b>${this.series.name}</b><br/>Lap ${this.x}: ${t}${tail}`;
          }
        },
        legend: { itemStyle: { fontSize: '12px' } },
        credits: { enabled: false },
        plotOptions: {
          scatter: { marker: { states: { hover: { lineWidth: 1 } } } },
          line: { lineWidth: 2 }
        },
        series
      });
      raceChartInstances.push(chart);
      host.dataset.rendered = '1';
    }, () => {
      host.innerHTML = '<div class="loading-text" style="padding:20px;text-align:center;color:#b85e00;">图表库加载失败</div>';
    });
  }

  // 暴露比赛页缓存的汇总与清空函数，便于统一清理
  window.getRaceCacheSummary = function() {
    const summary = { lapCacheEntries: lapCache.size, roundAggEntries: roundAggCache.size };
    console.log('[Race Cache] Summary', summary);
    return summary;
  };
  window.clearRaceCaches = function() {
    const beforeLap = lapCache.size;
    const beforeRound = roundAggCache.size;
    lapCache.clear();
    roundAggCache.clear();
    const res = { removedLapEntries: beforeLap, removedRoundEntries: beforeRound, remainingLapEntries: lapCache.size, remainingRoundEntries: roundAggCache.size };
    console.log('[Race Cache] Cleared', res);
    return res;
  };

  function getRaceGoBtn() {
    return document.getElementById('raceGo');
  }

  function setRaceGoLabel(state) {
    const btn = getRaceGoBtn();
    if (!btn) return;
    if (state === 'updating') {
      btn.textContent = '更新中…';
      btn.disabled = true;
      return;
    }
    btn.disabled = false;
    if (hasRaceResults) {
      btn.textContent = '刷新';
    } else {
      btn.textContent = 'Go';
    }
  }

  function markRaceDirty() {
    isDirtyRace = true;
    if (hasRaceResults) setRaceGoLabel('refresh');
  }

  async function fillRaceSelectors() {
    const seasonSel = document.getElementById('raceSeasonList');
    const constructorSel = document.getElementById('raceConstructorList');
    const startRoundSel = document.getElementById('raceStartRound');
    const endRoundSel = document.getElementById('raceEndRound');
    if (!seasonSel || !constructorSel) return;

    const seasonsResp = await F1Utils.getSeasons();
    if (!seasonsResp) return;
    const seasons = seasonsResp.MRData.SeasonTable.Seasons.reverse();
    seasonSel.innerHTML = seasons.map(s => `<option value="${s.season}">${s.season}</option>`).join('');

    // Default year to 2025 if available, otherwise use latest
    const has2025 = seasons.some(s => String(s.season) === '2025');
    const defaultYear = has2025 ? '2025' : (seasons[0]?.season);
    if (defaultYear) seasonSel.value = defaultYear;

    const constructorsResp = await F1Utils.getConstructors(defaultYear);
    if (constructorsResp) {
      const constructors = constructorsResp.MRData.ConstructorTable.Constructors;
      constructorSel.innerHTML = constructors.map(c => `<option value="${c.name}" id="${c.constructorId}">${c.name}</option>`).join('');
    }

    // Populate round selectors for the chosen year
    await populateRoundSelectors(defaultYear, startRoundSel, endRoundSel);

    seasonSel.addEventListener('change', async () => {
      const year = seasonSel.value;
      const res = await F1Utils.getConstructors(year);
      if (!res) return;
      const constructors = res.MRData.ConstructorTable.Constructors;
      const prev = constructorSel.value;
      constructorSel.innerHTML = constructors.map(c => `<option value="${c.name}" id="${c.constructorId}">${c.name}</option>`).join('');
      // try keep same team by name
      const opt = Array.from(constructorSel.options).find(o => o.value === prev);
      if (opt) constructorSel.value = prev;

      // update rounds for this year
      await populateRoundSelectors(year, startRoundSel, endRoundSel);
      // mark dirty if results already shown
      if (document.querySelector('#raceTables table')) markRaceDirty();
    });

    // constructor change should mark dirty
    constructorSel?.addEventListener('change', () => {
      if (document.querySelector('#raceTables table')) markRaceDirty();
    });

    // Keep end >= start and re-render if a table exists
    startRoundSel?.addEventListener('change', () => {
      if (!startRoundSel || !endRoundSel) return;
      const s = parseInt(startRoundSel.value, 10);
      let e = parseInt(endRoundSel.value, 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
        endRoundSel.value = String(s);
      }
      if (document.querySelector('#raceTables table')) markRaceDirty();
    });
    endRoundSel?.addEventListener('change', () => {
      if (!startRoundSel || !endRoundSel) return;
      const s = parseInt(startRoundSel.value, 10);
      const e = parseInt(endRoundSel.value, 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
        // if user sets end < start, snap start down to end
        startRoundSel.value = String(e);
      }
      if (document.querySelector('#raceTables table')) markRaceDirty();
    });
  }

  async function populateRoundSelectors(year, startRoundSel, endRoundSel) {
    if (!startRoundSel || !endRoundSel) return;
    try {
      const schedule = await F1Utils.getSeasonSchedule(year);
      const races = schedule?.MRData?.RaceTable?.Races || [];
      // 用 reduce 替代扩展运算符，避免大赛季时栈溢出
      const maxRound = races.reduce((m, r) => {
        const v = parseInt(r.round, 10);
        return Number.isFinite(v) && v > m ? v : m;
      }, 0);
      const optionsHtml = Array.from({ length: maxRound }, (_, i) => `<option value="${i+1}">${i+1}</option>`).join('');
      startRoundSel.innerHTML = optionsHtml;
      endRoundSel.innerHTML = optionsHtml;
      // defaults: full season 1..max
      if (maxRound > 0) {
        startRoundSel.value = '1';
        endRoundSel.value = String(maxRound);
      }
    } catch (e) {
      console.warn('Failed to populate round selectors for year', year, e);
    }
  }

  async function ensureRoundLaps(year, round) {
    const k = `${year}-${round}`;
    let agg = roundAggCache.get(k);
    if (agg && agg.lapsByDriver) return agg;
    if (!agg) {
      agg = { lapsByDriver: new Map(), pitsByDriver: new Map(), outLapsByDriver: new Map(), pitLoaded: false };
      roundAggCache.set(k, agg);
    }
    const lapsResp = await F1Utils.getRoundLaps(year, round);
    const races = lapsResp?.MRData?.RaceTable?.Races || [];
    if (races.length > 0) {
      // Some proxies may return different casings/fields; normalize robustly
      const lapsArr = Array.isArray(races[0].Laps) ? races[0].Laps : (Array.isArray(races[0].laps) ? races[0].laps : []);
      for (const lap of lapsArr) {
        const lapNum = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
        const timings = lap.Timings || lap.timing || lap.timings || [];
        for (const t of timings) {
          const did = t.driverId || t.Driver?.driverId || t.driver || t.DriverId || t.code || t.Code;
          const timeStr = t.time || t.Time || t.laptime || t.lapTime;
          if (!did || !timeStr) continue;
          let dMap = agg.lapsByDriver.get(did);
          if (!dMap) {
            dMap = new Map();
            agg.lapsByDriver.set(did, dMap);
          }
          if (Number.isFinite(lapNum)) dMap.set(lapNum, F1Utils.convertTimeString(timeStr));
        }
      }
    }
    // Light debug to aid diagnosis without spamming console by default
    F1Utils.debug?.('[Race] ensureRoundLaps parsed drivers', {
      year, round, drivers: Array.from(agg.lapsByDriver.keys()).length
    });
    return agg;
  }

  async function ensureRoundPits(year, round) {
    const k = `${year}-${round}`;
    let agg = roundAggCache.get(k);
    if (!agg) {
      agg = { lapsByDriver: new Map(), pitsByDriver: new Map(), outLapsByDriver: new Map(), pitLoaded: false };
      roundAggCache.set(k, agg);
    }
    if (agg.pitLoaded) return agg;
    const pitsResp = await F1Utils.getRoundPitStops(year, round);
    const pitStops = pitsResp?.MRData?.RaceTable?.Races?.[0]?.PitStops || [];
    for (const ps of pitStops) {
      const did = ps.Driver?.driverId || ps.driverId || ps.driver || ps.DriverId;
      const ln = parseInt(ps.lap || ps.Lap || ps.lapNumber, 10);
      if (!did || Number.isNaN(ln)) continue;
      let setIn = agg.pitsByDriver.get(did);
      let setOut = agg.outLapsByDriver.get(did);
      if (!setIn) { setIn = new Set(); agg.pitsByDriver.set(did, setIn); }
      if (!setOut) { setOut = new Set(); agg.outLapsByDriver.set(did, setOut); }
      setIn.add(ln);
      setOut.add(ln + 1);
    }
    agg.pitLoaded = true;
    return agg;
  }

  async function getDriverRaceData(year, round, driverId, excludePit) {
    // Cache key 不含 excludePit，缓存按需复用；pit 过滤只影响后续业务逻辑
    const key = `${year}-${round}-${driverId}`;
    if (lapCache.has(key)) return lapCache.get(key);

    // 主路径：per-driver /drivers/{id}/laps.json
    // 原因：jolpica 的聚合端点 /laps.json 把每页 timing 数硬性限制在 100
    // 一站 56 圈 × 20 车手 = ~1030 条，单页只能拿到前 5 圈，全部车手数据被截断。
    // per-driver 一页能装下整场比赛的圈数（最长 Monaco 78 圈 < 100），所以一次请求就够。
    const dMap = new Map();
    try {
      const perResp = await F1Utils.getRaceLaps(year, round, driverId);
      const laps = perResp?.MRData?.RaceTable?.Races?.[0]?.Laps;
      if (Array.isArray(laps)) {
        for (const lap of laps) {
          const ln = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
          const t0 = (lap.Timings || lap.timing || lap.timings || [])[0];
          const ts = t0?.time || t0?.Time || t0?.laptime || t0?.lapTime;
          if (Number.isFinite(ln) && ts) {
            const ms = F1Utils.convertTimeString(ts);
            if (Number.isFinite(ms)) dMap.set(ln, ms);
          }
        }
      }
      F1Utils.debug?.('[Race] per-driver laps loaded', { year, round, driverId, laps: dMap.size });
    } catch (e) {
      F1Utils.debug?.('[Race] per-driver laps failed', { year, round, driverId, error: String(e) });
      throw e; // 让上层显示"请求失败"行
    }

    // pit/out 圈：同样走 per-driver 端点
    let pits = new Set();
    let outLaps = new Set();
    if (excludePit) {
      try {
        const presp = await F1Utils.getDriverPitStops(year, round, driverId);
        const stops = presp?.MRData?.RaceTable?.Races?.[0]?.PitStops || [];
        for (const stop of stops) {
          const ln = parseInt(stop.lap || stop.Lap || stop.lapNumber, 10);
          if (Number.isFinite(ln)) {
            pits.add(ln);
            outLaps.add(ln + 1);
          }
        }
        F1Utils.debug?.('[Race] per-driver pitstops loaded', { year, round, driverId, stops: pits.size });
      } catch (e) {
        // pit 数据失败不阻断主流程
        F1Utils.debug?.('[Race] per-driver pitstops failed; proceeding without pit filter', { year, round, driverId, error: String(e) });
        pits = new Set();
        outLaps = new Set();
      }
    }

    const obj = { lapsMap: dMap, pits, outLaps };
    lapCache.set(key, obj);
    return obj;
  }

  function buildTableHeader(table, driver1Name, driver2Name) {
    const tr = document.createElement('tr');
    table.appendChild(tr);
    const headers = [
      { text: 'Round', width: '60px' },
      { text: 'Race', width: '220px' },
      { text: `${driver1Name} Median`, width: '140px' },
      { text: `${driver2Name} Median`, width: '140px' },
      { text: 'Time Delta', width: '120px' },
      { text: 'Delta %', width: '90px' },
      { text: 'Laps Used', width: '90px' }
    ];
    headers.forEach((h, idx) => {
      const th = document.createElement('th');
      th.textContent = h.text;
      th.style.width = h.width;
      th.style.textAlign = 'center';
      tr.appendChild(th);
    });
  }

  function formatMs(ms) {
    const sign = ms > 0 ? '+' : (ms < 0 ? '-' : '');
    const abs = Math.abs(ms);
    const m = Math.floor(abs / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    const mm = m > 0 ? `${m}:` : '';
    const ss = m > 0 ? String(s).padStart(2, '0') : String(s);
    const msPart = String(abs % 1000).padStart(3, '0');
    return `${sign}${mm}${ss}.${msPart}`;
  }
  function msToLapString(ms) {
    const abs = Math.abs(ms);
    const m = Math.floor(abs / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    const mm = m > 0 ? `${m}:` : '';
    const ss = m > 0 ? String(s).padStart(2, '0') : String(s);
    const msPart = String(abs % 1000).padStart(3, '0');
    return `${mm}${ss}.${msPart}`;
  }

  async function showRaceResults(opts = { refresh: false }) {
    const raceTables = document.getElementById('raceTables');
    const year = document.getElementById('raceSeasonList').value;
    const constructorSelect = document.getElementById('raceConstructorList');
    const selectedConstructorOpt = constructorSelect?.options?.[constructorSelect.selectedIndex];
    if (!selectedConstructorOpt) {
      raceTables.innerHTML = '<div class="loading-text">请先选择车队</div>';
      return;
    }
    const constructorId = selectedConstructorOpt.id;
    const thresholdSel = document.getElementById('raceThreshold').value;
    const excludePit = document.getElementById('raceExcludePit').checked;
    const startRoundSel = document.getElementById('raceStartRound');
    const endRoundSel = document.getElementById('raceEndRound');
    const startRound = parseInt(startRoundSel?.value || '1', 10);
    const endRound = parseInt(endRoundSel?.value || '999', 10);

    // Global run summary
    console.log('[Race Compare] Run summary', {
      year,
      constructorId,
      constructorName: constructorSelect.value,
      startRound,
      endRound,
      threshold: thresholdSel,
      excludePit
    });

    if (opts && opts.refresh) {
      raceTables.innerHTML = '<div class="loading-text">更新中…</div>';
    } else {
      raceTables.innerHTML = '<div class="loading-text">加载中…（可能需要几秒钟获取圈速数据）</div>';
    }

    // Get all races for this constructor
    const results = await F1Utils.getConstructorResults(year, constructorId);
    let races = results?.MRData?.RaceTable?.Races || [];
    if (races.length === 0) {
      raceTables.innerHTML = '<div class="loading-text">未找到该赛季该车队的比赛结果</div>';
      return;
    }

    // Filter by selected round range
    races = races.filter(r => {
      const rd = parseInt(r.round, 10);
      return (!Number.isFinite(startRound) || rd >= startRound) && (!Number.isFinite(endRound) || rd <= endRound);
    });

    // Group selected races by teammate pair
    const pairGroups = new Map(); // key: sortedId1|sortedId2 -> {id1,id2,name1,name2,races: []}
    for (const r of races) {
      if (!r.Results || r.Results.length < 2) continue;
      // Use the first two constructor finishers as the teammate pair for this round
      const sortedResults = r.Results.slice(0, 2);
      const d1 = sortedResults[0].Driver;
      const d2 = sortedResults[1].Driver;
      const ids = [d1.driverId, d2.driverId].sort();
      const key = ids.join('|');
      if (!pairGroups.has(key)) {
        // preserve the display order as encountered first time
        pairGroups.set(key, {
          id1: d1.driverId,
          id2: d2.driverId,
          name1: `${d1.givenName} ${d1.familyName}`,
          name2: `${d2.givenName} ${d2.familyName}`,
          races: []
        });
      }
      const grp = pairGroups.get(key);
      grp.races.push(r);
    }

    // Log grouping summary
    try {
      const summary = Array.from(pairGroups.values()).map(g => ({
        driver1: { id: g.id1, name: g.name1 },
        driver2: { id: g.id2, name: g.name2 },
        rounds: g.races.map(rr => rr.round),
        raceNames: g.races.map(rr => rr.raceName)
      }));
      console.log('[Race Compare] Teammate groups in selection', summary);
    } catch(e) { /* noop */ }

    // Build one table per group（先销毁上一轮的 Highcharts 实例避免泄漏）
    destroyAllRaceCharts();
    raceTables.innerHTML = '';
    const minRound = (races) => races.reduce((m, x) => {
      const v = parseInt(x.round, 10);
      return Number.isFinite(v) && v < m ? v : m;
    }, Infinity);
    const groupsInOrder = Array.from(pairGroups.values()).sort((a,b) => minRound(a.races) - minRound(b.races));

    for (const grp of groupsInOrder) {
      const table = document.createElement('table');
      table.className = 'comparison-table';
      raceTables.appendChild(table);
      buildTableHeader(table, grp.name1, grp.name2);

      for (const r of grp.races) {
        const entry1 = r.Results.find(x => x.Driver.driverId === grp.id1);
        const entry2 = r.Results.find(x => x.Driver.driverId === grp.id2);
        if (!entry1 || !entry2) continue;
        const d1 = entry1.Driver;
        const d2 = entry2.Driver;
        const round = r.round;

        let d1Data, d2Data;
        try {
          [d1Data, d2Data] = await Promise.all([
            getDriverRaceData(year, round, d1.driverId, excludePit),
            getDriverRaceData(year, round, d2.driverId, excludePit)
          ]);
        } catch (e) {
          const tr = document.createElement('tr');
          table.appendChild(tr);
          // round
          const tdRound = document.createElement('td');
          tdRound.style.textAlign = 'center';
          tdRound.textContent = r.round;
          tr.appendChild(tdRound);
          // race name
          const tdRace = document.createElement('td');
          tdRace.style.textAlign = 'center';
          tdRace.textContent = r.raceName;
          tr.appendChild(tdRace);
          // error cells
          const cols = [
            '-', '-',
            '请求过多（429）或网络失败，未能加载该站圈速',
            '-', '0'
          ];
          for (const c of cols) {
            const td = document.createElement('td');
            td.style.textAlign = 'center';
            td.textContent = c;
            tr.appendChild(td);
          }
          console.warn('[Race Compare] Skipped round due to fetch failure/rate limit', { year, round, raceName: r.raceName, error: String(e) });
          continue;
        }

        // Build overlapping lap set
        const d1LapNums = new Set(d1Data.lapsMap.keys());
        const d2LapNums = new Set(d2Data.lapsMap.keys());
        const overlap = [];
        d1LapNums.forEach(n => { if (d2LapNums.has(n)) overlap.push(n); });

        // Exclude pit in/out laps
        const cleanLapNums = overlap.filter(n => {
          if (excludePit) {
            if (d1Data.pits.has(n) || d1Data.outLaps.has(n)) return false;
            if (d2Data.pits.has(n) || d2Data.outLaps.has(n)) return false;
          }
          return true;
        }).sort((a,b)=>a-b);

        // Threshold filtering
        let usedLapNums = cleanLapNums;
        if (thresholdSel !== 'none') {
          const factor = parseFloat(thresholdSel);
          if (!Number.isNaN(factor) && cleanLapNums.length) {
            // baselines = each driver's fastest lap within clean laps
            let best1 = Infinity, best2 = Infinity;
            for (const n of cleanLapNums) {
              const t1 = d1Data.lapsMap.get(n);
              const t2 = d2Data.lapsMap.get(n);
              if (t1 < best1) best1 = t1;
              if (t2 < best2) best2 = t2;
            }
            if (!Number.isFinite(best1) || !Number.isFinite(best2)) {
              // If baselines could not be determined, skip threshold filtering
              usedLapNums = cleanLapNums;
            } else {
              usedLapNums = cleanLapNums.filter(n => {
                const t1 = d1Data.lapsMap.get(n);
                const t2 = d2Data.lapsMap.get(n);
                return Number.isFinite(t1) && Number.isFinite(t2) && t1 <= best1 * factor && t2 <= best2 * factor;
              });
            }
          }
        }

        const perLapDeltas = [];
        const d1Times = [];
        const d2Times = [];
        for (const n of usedLapNums) {
          const t1 = d1Data.lapsMap.get(n);
          const t2 = d2Data.lapsMap.get(n);
          perLapDeltas.push(t2 - t1);
          d1Times.push(t1);
          d2Times.push(t2);
        }

        const tr = document.createElement('tr');
        table.appendChild(tr);

        // Round and race name
        const tdRound = document.createElement('td');
        tdRound.style.textAlign = 'center';
        tdRound.textContent = r.round;
        tr.appendChild(tdRound);

        const tdRace = document.createElement('td');
        tdRace.style.textAlign = 'center';
        tdRace.textContent = r.raceName;
        tr.appendChild(tdRace);

        if (perLapDeltas.length === 0) {
          // No comparable laps
          const cells = ['N/A','N/A','No comparable laps','N/A','0'];
          for (const c of cells) {
            const td = document.createElement('td');
            td.style.textAlign = 'center';
            td.textContent = c;
            tr.appendChild(td);
          }
          continue;
        }

        const medD1 = F1Utils.calculateMedian(d1Times);
        const medD2 = F1Utils.calculateMedian(d2Times);
        const medDelta = F1Utils.calculateMedian(perLapDeltas);
        const pctDelta = (medDelta / medD1) * 100;

        // Console transparency: log detailed data used for this race
        try {
          const usedData = usedLapNums.map(n => ({
            lap: n,
            d1: d1Data.lapsMap.get(n),
            d2: d2Data.lapsMap.get(n),
            delta: (d2Data.lapsMap.get(n) - d1Data.lapsMap.get(n))
          }));
          console.log('[Race Compare] Data', {
            year,
            round,
            raceName: r.raceName,
            driver1: { id: d1.driverId, name: `${d1.givenName} ${d1.familyName}` },
            driver2: { id: d2.driverId, name: `${d2.givenName} ${d2.familyName}` },
            excludePit,
            threshold: thresholdSel,
            overlapLapNums: Array.from(new Set([...d1LapNums].filter(x => d2LapNums.has(x)))).sort((a,b)=>a-b),
            cleanLapNums: Array.from(new Set([...cleanLapNums])).sort((a,b)=>a-b),
            usedLapNums,
            usedData,
            medians: { d1: medD1, d2: medD2 },
            deltas: { medDelta, pctDelta }
          });
        } catch (e) {
          console.warn('Log used data failed', e);
        }

        const tdD1 = document.createElement('td');
        tdD1.style.textAlign = 'center';
        tdD1.textContent = msToLapString(medD1);
        tr.appendChild(tdD1);

        const tdD2 = document.createElement('td');
        tdD2.style.textAlign = 'center';
        tdD2.textContent = msToLapString(medD2);
        tr.appendChild(tdD2);

        const tdDelta = document.createElement('td');
        tdDelta.style.textAlign = 'center';
        tdDelta.textContent = `${formatMs(medDelta)}`;
        tr.appendChild(tdDelta);

        const tdPct = document.createElement('td');
        tdPct.style.textAlign = 'center';
        const sign = pctDelta > 0 ? '+' : (pctDelta < 0 ? '-' : '');
        tdPct.textContent = `${sign}${Math.abs(pctDelta).toFixed(3)}%`;
        tr.appendChild(tdPct);

        const tdCount = document.createElement('td');
        tdCount.style.textAlign = 'center';
        tdCount.textContent = String(perLapDeltas.length);
        tr.appendChild(tdCount);

        // 在该比赛行下方插入一行用于折叠展开圈速点云图
        const chartTr = document.createElement('tr');
        chartTr.className = 'race-scatter-row';
        table.appendChild(chartTr);
        const chartTd = document.createElement('td');
        chartTd.colSpan = 7;
        chartTd.style.padding = '4px 8px';
        chartTr.appendChild(chartTd);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'race-scatter-toggle selector';
        toggleBtn.type = 'button';
        toggleBtn.textContent = '显示圈速点云图';
        chartTd.appendChild(toggleBtn);

        const chartHost = document.createElement('div');
        chartHost.className = 'race-scatter-host';
        chartHost.style.display = 'none';
        chartTd.appendChild(chartHost);

        const usedSet = new Set(usedLapNums);
        const scatterCtx = {
          year, round, raceName: r.raceName,
          d1Name: `${d1.givenName} ${d1.familyName}`,
          d2Name: `${d2.givenName} ${d2.familyName}`,
          d1Data, d2Data,
          usedSet, excludePit, threshold: thresholdSel
        };

        toggleBtn.addEventListener('click', () => {
          const opening = chartHost.style.display === 'none';
          chartHost.style.display = opening ? 'block' : 'none';
          toggleBtn.textContent = opening ? '隐藏圈速点云图' : '显示圈速点云图';
          if (opening) renderRaceScatter(chartHost, scatterCtx);
        });
      }
    }
  }

  function initRaceTab() {
    if (raceTabInitialized) return;
    fillRaceSelectors();
    const goBtn = document.getElementById('raceGo');
    if (goBtn) {
      goBtn.addEventListener('click', async () => {
        if (isUpdatingRace) return;
        isUpdatingRace = true;
        // set UI to updating
        setRaceGoLabel('updating');
        const raceTables = document.getElementById('raceTables');
        raceTables.innerHTML = '<div class="loading-text">更新中…</div>';
        try {
          await showRaceResults({ refresh: hasRaceResults });
          hasRaceResults = true;
          isDirtyRace = false;
        } finally {
          isUpdatingRace = false;
          setRaceGoLabel(hasRaceResults ? 'refresh' : 'go');
        }
      });
    }
    // re-run when filters change if already loaded
    const thresholdSel = document.getElementById('raceThreshold');
    const excludePit = document.getElementById('raceExcludePit');
    thresholdSel?.addEventListener('change', () => {
      if (document.querySelector('#raceTables table')) markRaceDirty();
    });
    excludePit?.addEventListener('change', () => {
      if (document.querySelector('#raceTables table')) markRaceDirty();
    });
    raceTabInitialized = true;
  }

  // 暴露初始化函数给 index.html 中统一的 switchTab 调用
  window.initRaceTabFromSwitch = initRaceTab;

  // Initialize when page loads if race tab is active
  window.addEventListener('load', () => {
    const isActive = document.querySelector('.tab-button[data-tab="race"]').classList.contains('active');
    if (isActive) initRaceTab();
  });
})();
