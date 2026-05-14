// Race comparison tab logic
(function(){
  let raceTabInitialized = false;
  let hasRaceResults = false;
  let isUpdatingRace = false;
  let isDirtyRace = false;
  const lapCache = new Map(); // key: `${year}-${round}-${driverId}` -> {laps: Map(lapNumber->ms), pits: Set(lap numbers), outLaps: Set(lap numbers)}
  // Round-level aggregate cache to minimize API calls
  const roundAggCache = new Map(); // key: `${year}-${round}` -> { lapsByDriver: Map, pitsByDriver: Map, outLapsByDriver: Map, pitLoaded: boolean }

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
      const maxRound = races.length > 0 ? Math.max(...races.map(r => parseInt(r.round, 10))) : 0;
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
    // Exclude the filter flag from cache key to maximize reuse; filtering happens later
    const key = `${year}-${round}-${driverId}`;
    if (lapCache.has(key)) return lapCache.get(key);

    // Use aggregated round endpoints to minimize requests
    const agg = await ensureRoundLaps(year, round);
    let dMap = agg.lapsByDriver.get(driverId) || new Map();

    // Fallback: if aggregated endpoint returned nothing for this driver, try per-driver laps endpoint once
    if (dMap.size === 0) {
      try {
        const perResp = await F1Utils.getRaceLaps(year, round, driverId);
        const prRaces = perResp?.MRData?.RaceTable?.Races || [];
        if (prRaces.length > 0 && Array.isArray(prRaces[0].Laps)) {
          const temp = new Map();
          for (const lap of prRaces[0].Laps) {
            const ln = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
            const timings = lap.Timings || lap.timing || lap.timings || [];
            const t0 = timings[0];
            const timeStr = t0?.time || t0?.Time || t0?.laptime || t0?.lapTime;
            if (Number.isFinite(ln) && timeStr) temp.set(ln, F1Utils.convertTimeString(timeStr));
          }
          if (temp.size > 0) {
            dMap = temp;
            F1Utils.debug?.('[Race] Per-driver laps fallback used', { year, round, driverId, laps: temp.size });
          }
        }
      } catch (e) {
        // swallow and continue; higher level will handle error if needed
        F1Utils.debug?.('[Race] Per-driver laps fallback failed', { year, round, driverId, error: String(e) });
      }
    }

    let pits = new Set();
    let outLaps = new Set();
    if (excludePit) {
      try {
        const aggPit = await ensureRoundPits(year, round);
        pits = aggPit.pitsByDriver.get(driverId) || new Set();
        outLaps = aggPit.outLapsByDriver.get(driverId) || new Set();
      } catch (e) {
        // Graceful degradation on pit-stop fetch failure (e.g., 429): proceed without excluding pits
        F1Utils.debug?.('[Race] Pit stops fetch failed; proceeding without pit filtering', { year, round, driverId, error: String(e) });
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
    const constructorId = constructorSelect.options[constructorSelect.selectedIndex].id;
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

    // Build one table per group
    raceTables.innerHTML = '';
    const groupsInOrder = Array.from(pairGroups.values()).sort((a,b)=>{
      const amin = Math.min(...a.races.map(x=>parseInt(x.round,10)));
      const bmin = Math.min(...b.races.map(x=>parseInt(x.round,10)));
      return amin - bmin;
    });

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

  window.switchTabRace = function(tab) {
    // Update active tab styles
    document.querySelectorAll('.tab-button').forEach(b=>b.classList.remove('active'));
    document.querySelector(`.tab-button[data-tab="${tab}"]`)?.classList.add('active');
    // Show/hide sections
    document.getElementById('qualifying-content').style.display = tab === 'qualifying' ? 'block' : 'none';
    document.getElementById('history-content').style.display = tab === 'history' ? 'block' : 'none';
    document.getElementById('race-content').style.display = tab === 'race' ? 'block' : 'none';
    if (tab === 'race') initRaceTab();
  };

  // Initialize when page loads if race tab is active
  window.addEventListener('load', () => {
    const isActive = document.querySelector('.tab-button[data-tab="race"]').classList.contains('active');
    if (isActive) initRaceTab();
  });
})();
