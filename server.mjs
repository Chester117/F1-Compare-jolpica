import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const appDir = path.dirname(__filename);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8811);
const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${host}:${port}`;
const dataDir = process.env.DATA_DIR || path.join(appDir, 'data');
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'f1compare-cache.sqlite');
const currentYear = new Date().getFullYear();
const appVersion = 'local-cache-v1';
const upstreamMinDelayMs = Number(process.env.UPSTREAM_MIN_DELAY_MS || 450);
const upstreamMaxAttempts = Number(process.env.UPSTREAM_MAX_ATTEMPTS || 4);

let upstreamFetchTail = Promise.resolve();
let lastUpstreamFetchAt = 0;

await fs.mkdir(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS raw_cache (
    url TEXT PRIMARY KEY,
    status INTEGER NOT NULL DEFAULT 200,
    body TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    stale_until INTEGER NOT NULL DEFAULT 0,
    error TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_raw_cache_expires_at ON raw_cache(expires_at);
  CREATE TABLE IF NOT EXISTS computed_cache (
    cache_key TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    computed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    meta TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_computed_cache_expires_at ON computed_cache(expires_at);
  CREATE TABLE IF NOT EXISTS request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT DEFAULT ''
  );
`);

const statements = {
  rawGet: db.prepare('SELECT body, status, fetched_at, expires_at, stale_until FROM raw_cache WHERE url = ?'),
  rawSet: db.prepare(`
    INSERT INTO raw_cache (url, status, body, fetched_at, expires_at, stale_until, error)
    VALUES (?, ?, ?, ?, ?, ?, '')
    ON CONFLICT(url) DO UPDATE SET
      status = excluded.status,
      body = excluded.body,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      stale_until = excluded.stale_until,
      error = ''
  `),
  rawError: db.prepare('UPDATE raw_cache SET error = ? WHERE url = ?'),
  computedGet: db.prepare('SELECT body, computed_at, expires_at, meta FROM computed_cache WHERE cache_key = ?'),
  computedSet: db.prepare(`
    INSERT INTO computed_cache (cache_key, body, computed_at, expires_at, meta)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      body = excluded.body,
      computed_at = excluded.computed_at,
      expires_at = excluded.expires_at,
      meta = excluded.meta
  `),
  rawStats: db.prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(LENGTH(body)), 0) AS chars FROM raw_cache'),
  computedStats: db.prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(LENGTH(body)), 0) AS chars FROM computed_cache'),
  logInsert: db.prepare('INSERT INTO request_log (at, kind, cache_key, status, message) VALUES (?, ?, ?, ?, ?)'),
};

function logRequest(kind, cacheKey, status, message = '') {
  try {
    statements.logInsert.run(Date.now(), kind, cacheKey.slice(0, 500), status, message.slice(0, 1000));
  } catch (_) {}
}

function jsonResponse(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function textResponse(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
  res.end(text);
}

function isAllowedJolpicaUrl(url) {
  return url.protocol === 'https:' &&
    url.hostname === 'api.jolpi.ca' &&
    url.pathname.startsWith('/ergast/f1/');
}

function ttlForJolpicaUrl(url) {
  const pathName = url.pathname;
  const segments = pathName.split('/').filter(Boolean);
  const season = Number(segments[2]);
  if (pathName.includes('/laps.json') || pathName.includes('/pitstops.json')) return 30 * 24 * 3600 * 1000;
  if (pathName.endsWith('/seasons.json') || pathName.endsWith('/constructors.json')) return 12 * 3600 * 1000;
  if (Number.isFinite(season) && season < currentYear) return 14 * 24 * 3600 * 1000;
  if (pathName.includes('/results.json') || pathName.endsWith('/sprint.json')) return 2 * 3600 * 1000;
  return 6 * 3600 * 1000;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : 0;
}

function shouldRetryUpstream(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isTransientUpstreamMessage(message) {
  return /HTTP (429|5\d\d)\b|HeadersTimeout|Timeout|fetch failed|Upstream request failed/i.test(String(message || ''));
}

async function paceUpstreamFetch() {
  const previous = upstreamFetchTail.catch(() => {});
  let release;
  upstreamFetchTail = new Promise(resolve => {
    release = resolve;
  });
  await previous;
  const wait = Math.max(0, upstreamMinDelayMs - (Date.now() - lastUpstreamFetchAt));
  if (wait) await sleep(wait);
  lastUpstreamFetchAt = Date.now();
  return () => release();
}

async function fetchUpstreamJsonText(urlString) {
  let lastError;
  for (let attempt = 1; attempt <= upstreamMaxAttempts; attempt += 1) {
    const release = await paceUpstreamFetch();
    let response;
    try {
      response = await fetch(urlString, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
    } finally {
      release();
    }
    if (response.ok) return { response, text: await response.text() };
    const message = `HTTP ${response.status} ${response.statusText}`;
    lastError = new Error(message);
    if (!shouldRetryUpstream(response.status) || attempt >= upstreamMaxAttempts) break;
    const backoff = retryAfterMs(response) || Math.min(8000, 900 * (2 ** (attempt - 1)));
    logRequest('raw', urlString, 'retry', `${message}; retry ${attempt}/${upstreamMaxAttempts} in ${backoff}ms`);
    await sleep(backoff);
  }
  throw lastError || new Error('Upstream request failed');
}

async function fetchJsonCached(urlString, { force = false, ttlMs } = {}) {
  const parsed = new URL(urlString);
  if (!isAllowedJolpicaUrl(parsed)) throw new Error(`Blocked upstream URL: ${urlString}`);
  const now = Date.now();
  const ttl = ttlMs || ttlForJolpicaUrl(parsed);
  const cached = statements.rawGet.get(urlString);
  if (!force && cached && cached.expires_at > now) {
    return { data: JSON.parse(cached.body), cache: 'hit', fetchedAt: cached.fetched_at };
  }
  try {
    const { response, text } = await fetchUpstreamJsonText(urlString);
    const fetchedAt = Date.now();
    JSON.parse(text);
    statements.rawSet.run(urlString, response.status, text, fetchedAt, fetchedAt + ttl, fetchedAt + Math.max(ttl, 30 * 24 * 3600 * 1000));
    logRequest('raw', urlString, cached ? 'refresh' : 'miss');
    return { data: JSON.parse(text), cache: cached ? 'refresh' : 'miss', fetchedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (cached) {
      statements.rawError.run(message, urlString);
      logRequest('raw', urlString, 'stale', message);
      return { data: JSON.parse(cached.body), cache: 'stale', fetchedAt: cached.fetched_at, warning: message };
    }
    logRequest('raw', urlString, 'error', message);
    throw err;
  }
}

function jolpicaUrl(parts) {
  return `https://api.jolpi.ca/ergast/f1/${parts}`;
}

function convertTimeString(timeString) {
  if (!timeString || typeof timeString !== 'string') return NaN;
  const parts = timeString.split(':');
  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    return (minutes * 60 + seconds) * 1000;
  }
  const seconds = Number(timeString);
  return seconds * 1000;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return NaN;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function driverCode(driver) {
  return driver?.code || (driver?.familyName || driver?.driverId || '').slice(0, 3).toUpperCase();
}

function driverName(driver) {
  return `${driver?.givenName || ''} ${driver?.familyName || ''}`.trim() || driver?.driverId || 'Driver';
}

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
  rb: ['#386dff', '#d8e2f0', '#72a4ff'],
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
  'South Africa': 'za',
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
  yas_marina: 'ABU',
};

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

function appendAggregateLaps(maps, lapsResp, driverSet) {
  const laps = lapsResp?.MRData?.RaceTable?.Races?.[0]?.Laps || [];
  for (const lap of laps) {
    const lapNumber = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
    if (!Number.isFinite(lapNumber)) continue;
    for (const timing of lap.Timings || []) {
      const driverId = timing.driverId;
      if (!driverSet.has(driverId)) continue;
      const ms = convertTimeString(timing.time);
      if (Number.isFinite(ms)) maps.get(driverId).set(lapNumber, ms);
    }
  }
}

async function loadDriverLapMap(year, round, driverId) {
  const resp = await fetchJsonCached(jolpicaUrl(`${year}/${round}/drivers/${driverId}/laps.json?limit=100`));
  const laps = resp.data?.MRData?.RaceTable?.Races?.[0]?.Laps || [];
  const map = new Map();
  for (const lap of laps) {
    const lapNumber = parseInt(lap.number || lap.LapNumber || lap.lap, 10);
    const timing = (lap.Timings || [])[0];
    const ms = convertTimeString(timing?.time);
    if (Number.isFinite(lapNumber) && Number.isFinite(ms)) map.set(lapNumber, ms);
  }
  return map;
}

async function loadRoundLapMaps(year, round, drivers) {
  const ids = drivers.map(d => d.driverId);
  const driverSet = new Set(ids);
  const maps = new Map(ids.map(id => [id, new Map()]));
  let aggregateOk = false;
  try {
    const first = await fetchJsonCached(jolpicaUrl(`${year}/${round}/laps.json?limit=100&offset=0`));
    appendAggregateLaps(maps, first.data, driverSet);
    const meta = first.data?.MRData || {};
    const total = parseInt(meta.total, 10);
    const limit = parseInt(meta.limit, 10) || 100;
    if (Number.isFinite(total) && limit > 0) {
      for (let offset = limit; offset < total; offset += limit) {
        const page = await fetchJsonCached(jolpicaUrl(`${year}/${round}/laps.json?limit=${limit}&offset=${offset}`));
        appendAggregateLaps(maps, page.data, driverSet);
      }
    }
    aggregateOk = true;
  } catch (err) {
    logRequest('race-progress', `${year}:${round}:aggregate-laps`, 'warn', err instanceof Error ? err.message : String(err));
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
      if (result.status === 'fulfilled') {
        const [id, map] = result.value;
        maps.set(id, map);
      }
    });
  }
  return { maps, aggregateOk, missingFallbacks: missing.length };
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
  const resultsResp = await fetchJsonCached(jolpicaUrl(`${year}/${round}/results.json?limit=100`));
  const resultsRace = resultsResp.data?.MRData?.RaceTable?.Races?.[0];
  const results = resultsRace?.Results || [];
  if (!results.length) throw new Error(`Round ${round} has no race results`);
  const drivers = results.map(res => ({
    driverId: res.Driver.driverId,
    code: driverCode(res.Driver),
    name: driverName(res.Driver),
    result: res,
  }));
  const { maps: lapMaps } = await loadRoundLapMaps(year, round, drivers);
  let pitStops = new Map();
  if (excludePit) {
    try {
      const pitResp = await fetchJsonCached(jolpicaUrl(`${year}/${round}/pitstops.json?limit=2000`));
      pitStops = parsePitStops(pitResp.data);
    } catch (err) {
      logRequest('race-progress', `${year}:${round}:pitstops`, 'warn', err instanceof Error ? err.message : String(err));
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
      totalLaps: lapMaps.get(driver.driverId)?.size || values.length,
    });
  }
  const medians = [...driverPaces.values()].map(item => item.medianMs).filter(Number.isFinite);
  if (!medians.length) throw new Error(`Round ${round} has no usable lap data`);
  const fastestMedian = Math.min(...medians);
  const fieldMedian = median(medians);
  const winnerId = results[0]?.Driver?.driverId;
  const winnerMedian = driverPaces.get(winnerId)?.medianMs || fastestMedian;
  return { round, race: resultsRace || race, drivers, driverPaces, fastestMedian, fieldMedian, winnerMedian };
}

function roundSnapshotCacheKey(year, round, threshold, excludePit) {
  return `${appVersion}:round-pace:${year}:${round}:${threshold}:${excludePit ? 'exclude-pit' : 'include-pit'}`;
}

function serializeRoundSnapshot(snapshot) {
  return {
    ...snapshot,
    driverPaces: [...snapshot.driverPaces.entries()],
  };
}

function restoreRoundSnapshot(serialized) {
  return {
    ...serialized,
    driverPaces: new Map(serialized.driverPaces || []),
  };
}

async function roundPaceSnapshotCached(year, race, threshold, excludePit) {
  const round = String(race.round);
  const cacheKey = roundSnapshotCacheKey(year, round, threshold, excludePit);
  const now = Date.now();
  const cached = statements.computedGet.get(cacheKey);
  if (cached && cached.expires_at > now) {
    logRequest('round-pace', cacheKey, 'hit');
    return restoreRoundSnapshot(JSON.parse(cached.body));
  }
  try {
    const snapshot = await roundPaceSnapshot(year, race, threshold, excludePit);
    const ttl = computedTtlForYear(year);
    statements.computedSet.run(
      cacheKey,
      JSON.stringify(serializeRoundSnapshot(snapshot)),
      now,
      now + ttl,
      JSON.stringify({ year, round, drivers: snapshot.driverPaces.size })
    );
    logRequest('round-pace', cacheKey, cached ? 'refresh' : 'miss');
    return snapshot;
  } catch (err) {
    if (cached) {
      const message = err instanceof Error ? err.message : String(err);
      logRequest('round-pace', cacheKey, 'stale', message);
      return restoreRoundSnapshot(JSON.parse(cached.body));
    }
    throw err;
  }
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
      driver: res.Driver,
    })));
  }
  return map;
}

async function buildRaceProgressPayload(params) {
  const year = String(params.get('year') || currentYear);
  const constructorId = String(params.get('constructorId') || '').trim();
  if (!constructorId) throw new Error('constructorId is required');
  const teamName = String(params.get('teamName') || constructorId);
  const threshold = String(params.get('threshold') || '1.15');
  const baselineStrategy = String(params.get('baseline') || 'fastestMedian');
  const excludePit = params.get('excludePit') !== 'false';
  const [scheduleResp, constructorResp, sprintResp] = await Promise.all([
    fetchJsonCached(jolpicaUrl(`${year}.json?limit=100`)),
    fetchJsonCached(jolpicaUrl(`${year}/constructors/${constructorId}/results.json?limit=1000`)),
    fetchJsonCached(jolpicaUrl(`${year}/sprint.json?limit=1000`)).catch(() => ({ data: null })),
  ]);
  const schedule = scheduleResp.data?.MRData?.RaceTable?.Races || [];
  const teamByRound = teamRaceMap(constructorResp.data);
  const sprintSet = new Set((sprintResp.data?.MRData?.RaceTable?.Races || []).map(r => String(r.round)));
  const selectedRaces = schedule.filter(race => teamByRound.has(String(race.round)));
  const palette = TEAM_PALETTES[constructorId] || ['#1fae91', '#cbdc28', '#24a7c4', '#d77a22'];
  const driverMap = new Map();
  const raceRows = [];
  const skipped = [];
  for (const race of selectedRaces) {
    try {
      const snapshot = await roundPaceSnapshotCached(year, race, threshold, excludePit);
      const baseline = baselineStrategy === 'fieldMedian'
        ? snapshot.fieldMedian
        : baselineStrategy === 'winnerMedian'
          ? snapshot.winnerMedian
          : snapshot.fastestMedian;
      if (!Number.isFinite(baseline) || baseline <= 0) throw new Error('Invalid baseline');
      const medianLineValue = ((snapshot.fieldMedian - baseline) / baseline) * 100;
      const teamDrivers = teamByRound.get(String(race.round)) || [];
      raceRows.push({
        round: String(race.round),
        code: raceCode(race),
        flag: flagUrl(race),
        raceName: race.raceName,
        isSprint: sprintSet.has(String(race.round)),
        medianLineValue,
      });
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
              totalLaps: 0,
            })),
          });
        }
        const pace = snapshot.driverPaces.get(driver.driverId);
        const delta = pace ? ((pace.medianMs - baseline) / baseline) * 100 : NaN;
        driverMap.get(driver.driverId).points.push({
          value: delta,
          raceName: race.raceName,
          medianMs: pace?.medianMs || NaN,
          lapsUsed: pace?.lapsUsed || 0,
          totalLaps: pace?.totalLaps || 0,
        });
      }
      for (const [driverId, driver] of driverMap.entries()) {
        if (!(teamDrivers || []).some(item => item.driverId === driverId) && driver.points.length < raceRows.length) {
          driver.points.push({ value: NaN, raceName: race.raceName, medianMs: NaN, lapsUsed: 0, totalLaps: 0 });
        }
      }
    } catch (err) {
      skipped.push({ round: String(race.round), raceName: race.raceName, error: err instanceof Error ? err.message : String(err) });
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
    fieldMedian: '0% = field median race pace in each Grand Prix',
  }[baselineStrategy] || '0% = fastest driver median race pace';
  return {
    year,
    teamName,
    constructorId,
    baselineLabel,
    races: raceRows,
    medianLine: raceRows.map(row => ({ value: row.medianLineValue })),
    drivers,
    skipped,
    generatedAt: new Date().toISOString(),
    generatedBy: 'HomeMacServer SQLite cache',
  };
}

function computedTtlForYear(year) {
  const numeric = Number(year);
  return Number.isFinite(numeric) && numeric < currentYear ? 14 * 24 * 3600 * 1000 : 60 * 60 * 1000;
}

async function handleRaceProgress(req, res, url) {
  const params = url.searchParams;
  const year = String(params.get('year') || currentYear);
  const constructorId = String(params.get('constructorId') || '');
  const threshold = String(params.get('threshold') || '1.15');
  const baseline = String(params.get('baseline') || 'fastestMedian');
  const excludePit = params.get('excludePit') !== 'false';
  const force = params.get('force') === '1';
  const cacheKey = [
    appVersion,
    'race-progress',
    year,
    constructorId,
    threshold,
    baseline,
    excludePit ? 'excludePit' : 'allLaps',
  ].join(':');
  const now = Date.now();
  const cached = statements.computedGet.get(cacheKey);
  if (!force && cached && cached.expires_at > now) {
    logRequest('computed', cacheKey, 'hit');
    return jsonResponse(res, 200, { cache: 'hit', payload: JSON.parse(cached.body), meta: JSON.parse(cached.meta || '{}') });
  }
  let payload;
  try {
    payload = await buildRaceProgressPayload(params);
  } catch (err) {
    if (cached) {
      const message = err instanceof Error ? err.message : String(err);
      logRequest('computed', cacheKey, 'stale', message);
      return jsonResponse(res, 200, {
        cache: 'stale',
        payload: JSON.parse(cached.body),
        meta: JSON.parse(cached.meta || '{}'),
        warning: message,
      });
    }
    throw err;
  }
  const transientSkipped = (payload.skipped || []).filter(item => isTransientUpstreamMessage(item.error));
  if (transientSkipped.length) {
    const message = `${transientSkipped.length} race(s) skipped due to transient upstream errors`;
    logRequest('computed', cacheKey, cached ? 'stale' : 'partial', message);
    if (cached) {
      return jsonResponse(res, 200, {
        cache: 'stale',
        payload: JSON.parse(cached.body),
        meta: JSON.parse(cached.meta || '{}'),
        warning: message,
      });
    }
    return jsonResponse(res, 200, {
      cache: 'partial',
      payload,
      meta: {
        year,
        constructorId,
        races: payload.races.length,
        drivers: payload.drivers.length,
        skipped: payload.skipped.length,
      },
      warning: message,
    });
  }
  const body = JSON.stringify(payload);
  const meta = {
    year,
    constructorId,
    races: payload.races.length,
    drivers: payload.drivers.length,
    skipped: payload.skipped.length,
  };
  statements.computedSet.run(cacheKey, body, now, now + computedTtlForYear(year), JSON.stringify(meta));
  logRequest('computed', cacheKey, cached ? 'refresh' : 'miss');
  return jsonResponse(res, 200, { cache: cached ? 'refresh' : 'miss', payload, meta });
}

async function serveStatic(req, res, url) {
  const rawPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const normalized = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(appDir, normalized);
  if (!filePath.startsWith(appDir)) return textResponse(res, 403, 'Forbidden');
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return textResponse(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[ext] || 'application/octet-stream';
    const stream = fsSync.createReadStream(filePath);
    res.writeHead(200, {
      'content-type': contentType,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    stream.pipe(res);
  } catch (_) {
    textResponse(res, 404, 'Not found');
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
  try {
    if (url.pathname === '/api/health') {
      return jsonResponse(res, 200, {
        ok: true,
        app: 'F1 Compare Local',
        version: appVersion,
        publicBaseUrl,
        dbPath,
        rawCache: statements.rawStats.get(),
        computedCache: statements.computedStats.get(),
      });
    }
    if (url.pathname === '/api/cache/summary') {
      return jsonResponse(res, 200, {
        rawCache: statements.rawStats.get(),
        computedCache: statements.computedStats.get(),
      });
    }
    if (url.pathname === '/api/proxy') {
      const upstream = url.searchParams.get('url') || '';
      const parsed = new URL(upstream);
      if (!isAllowedJolpicaUrl(parsed)) return jsonResponse(res, 400, { error: 'Unsupported upstream URL' });
      const force = url.searchParams.get('force') === '1';
      const result = await fetchJsonCached(parsed.toString(), { force });
      res.setHeader('x-f1compare-cache', result.cache);
      return jsonResponse(res, 200, result.data, { 'x-f1compare-cache': result.cache });
    }
    if (url.pathname === '/api/race-progress') {
      return await handleRaceProgress(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[F1CompareLocal]', req.method, url.pathname, message);
    return jsonResponse(res, 500, { error: message });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res);
});

server.listen(port, host, () => {
  console.log(`F1 Compare Local listening on http://${host}:${port}`);
  console.log(`Database: ${dbPath}`);
});
