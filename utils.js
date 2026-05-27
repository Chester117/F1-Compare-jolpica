// 车队名称映射 - 将不同时期的同一支车队名称映射为统一名称
const TEAM_MAPPING = {
    // Red Bull系列车队
    "AlphaTauri": "Red Bull Junior Team",
    "Alpha Tauri": "Red Bull Junior Team",
    "Toro Rosso": "Red Bull Junior Team",
    "Visa Cash App RB": "Red Bull Junior Team",
    "VCARB": "Red Bull Junior Team",
    "RB": "Red Bull Junior Team",
    "RB F1 Team": "Red Bull Junior Team", 
    
    // Mercedes系列
    "Brawn": "Mercedes",
    "Brawn GP": "Mercedes",
    
    // Alpine/Renault系列
    "Alpine F1 Team": "Alpine/Renault",
    "Alpine": "Alpine/Renault",
    "Renault": "Alpine/Renault",
    
    // Aston Martin系列
    "Racing Point": "Aston Martin",
    "Force India": "Aston Martin",
    
    // Ferrari客户
    "Sauber": "Sauber/Alfa Romeo",
    "Alfa Romeo": "Sauber/Alfa Romeo",
    "Alfa": "Sauber/Alfa Romeo",
    "Kick Sauber": "Sauber/Alfa Romeo",
    "Stake F1 Team Kick Sauber": "Sauber/Alfa Romeo",
    
    // 其他历史车队
    "Lotus F1": "Lotus",
    "Lotus": "Lotus",
    "Team Lotus": "Lotus",
    "Caterham": "Lotus",
    
    "Marussia": "Manor/Marussia",
    "Manor": "Manor/Marussia",
    "Virgin": "Manor/Marussia",
    
    "Haas F1 Team": "Haas",
    "MoneyGram Haas F1 Team": "Haas"
};

// 缓存系统（LRU + TTL）
// 默认 30 分钟 TTL，最多 500 条；可通过 F1Utils.setCacheLimits 调整
const CACHE_DEFAULT_TTL_MS = 30 * 60 * 1000;
const CACHE_DEFAULT_MAX_ENTRIES = 500;
const cache = {
    store: new Map(), // url -> { data, expireAt }
    ttlMs: CACHE_DEFAULT_TTL_MS,
    maxEntries: CACHE_DEFAULT_MAX_ENTRIES,
    get(url) {
        const entry = this.store.get(url);
        if (!entry) return undefined;
        if (entry.expireAt && entry.expireAt < Date.now()) {
            this.store.delete(url);
            return undefined;
        }
        // LRU: 命中后移到末尾
        this.store.delete(url);
        this.store.set(url, entry);
        return entry.data;
    },
    set(url, data) {
        if (this.store.has(url)) this.store.delete(url);
        this.store.set(url, { data, expireAt: this.ttlMs > 0 ? Date.now() + this.ttlMs : 0 });
        while (this.store.size > this.maxEntries) {
            const oldestKey = this.store.keys().next().value;
            if (oldestKey === undefined) break;
            this.store.delete(oldestKey);
        }
    },
    has(url) {
        const entry = this.store.get(url);
        if (!entry) return false;
        if (entry.expireAt && entry.expireAt < Date.now()) {
            this.store.delete(url);
            return false;
        }
        return true;
    },
    size() {
        return this.store.size;
    },
    clear() {
        const count = this.store.size;
        this.store.clear();
        return count;
    }
};

// 进行中的请求去重：同一 URL 并发请求只发一次，所有调用方共享 Promise
const pendingRequests = new Map(); // url -> Promise

// 全局调试开关（默认关闭）。可在控制台执行 F1Utils.setDebug(true) 打开详细日志
if (typeof window !== 'undefined' && typeof window.__F1_DEBUG === 'undefined') {
    window.__F1_DEBUG = false;
}
function debugLog(...args) {
    if (typeof window !== 'undefined' && window.__F1_DEBUG) {
        try { console.log(...args); } catch (e) { /* noop */ }
    }
}

// 请求限制队列
const requestQueue = [];
let isProcessingQueue = false;
// 自适应全局间隔（发生429后提高，逐步衰减）
let BASE_DELAY_BETWEEN_REQUESTS = 500; // 初始两次请求间隔500毫秒
let currentDelayBetweenRequests = BASE_DELAY_BETWEEN_REQUESTS;
const MAX_DELAY_BETWEEN_REQUESTS = 6000; // 上限 6s
const MIN_DELAY_BETWEEN_REQUESTS = 200;  // 下限 200ms
let lastBackoffAt = 0;

// 退避/抖动相关常量（集中管理，便于调优）
const BACKOFF_DEFAULT_WAIT_MS = 1500;
const BACKOFF_JITTER_MAX_MS = 300;
const BACKOFF_GROWTH_FACTOR = 1.6;
const BACKOFF_GROWTH_ADDEND = 150;
const DELAY_DECAY_FACTOR = 0.9;
const MAX_RETRY_429 = 4;

// 失败请求收集（用于“继续获取”重试）
const failedRequests = new Set();

// 简单事件系统，供 UI 感知错误/限流
if (typeof window !== 'undefined') {
    window.F1RequestEvents = window.F1RequestEvents || {
        _listeners: { error: [], ratelimit: [] },
        on(type, fn) {
            if (!this._listeners[type]) this._listeners[type] = [];
            this._listeners[type].push(fn);
            return () => {
                this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn);
            };
        },
        emit(type, payload) {
            try {
                (this._listeners[type] || []).forEach(fn => {
                    try { fn(payload); } catch (_) {}
                });
            } catch (_) {}
        }
    };
}

// 处理请求队列
async function processQueue() {
    if (isProcessingQueue || requestQueue.length === 0) return;

    isProcessingQueue = true;

    while (requestQueue.length > 0) {
        const { url, resolve, reject, retryCount } = requestQueue.shift();

        try {
            debugLog(`Fetching: ${url} (Attempt: ${retryCount + 1})`);

            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json'
                },
                mode: 'cors'
            });

            if (response.ok) {
                const data = await response.json();
                cache.set(url, data);
                resolve(data);
                // 成功后尝试缓慢衰减全局延迟
                currentDelayBetweenRequests = Math.max(MIN_DELAY_BETWEEN_REQUESTS, Math.floor(currentDelayBetweenRequests * DELAY_DECAY_FACTOR));
            } else if (response.status === 429 && retryCount < MAX_RETRY_429) {
                // 429：读取 Retry-After，指数退避+抖动，并通知 UI
                const ra = parseInt(response.headers.get('Retry-After') || '0', 10);
                const suggested = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
                // 自适应提高全局间隔
                const now = Date.now();
                lastBackoffAt = now;
                if (suggested > 0) {
                    currentDelayBetweenRequests = Math.min(MAX_DELAY_BETWEEN_REQUESTS, Math.max(currentDelayBetweenRequests, suggested));
                } else {
                    currentDelayBetweenRequests = Math.min(MAX_DELAY_BETWEEN_REQUESTS, Math.floor(currentDelayBetweenRequests * BACKOFF_GROWTH_FACTOR + BACKOFF_GROWTH_ADDEND));
                }
                // 抖动
                const jitter = Math.floor(Math.random() * BACKOFF_JITTER_MAX_MS);
                const waitMs = (suggested || BACKOFF_DEFAULT_WAIT_MS) + jitter;
                console.warn(`Rate limited for ${url}, retry later (${retryCount + 1}/${MAX_RETRY_429}). Backoff ${waitMs}ms, global delay=${currentDelayBetweenRequests}ms`);
                if (typeof window !== 'undefined' && window.F1RequestEvents) {
                    window.F1RequestEvents.emit('ratelimit', { url, retryCount, waitMs, globalDelay: currentDelayBetweenRequests });
                }
                requestQueue.push({ url, resolve, reject, retryCount: retryCount + 1 });
                await new Promise(r => setTimeout(r, waitMs));
            } else {
                console.error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
                const err = new Error(`Error fetching ${url}: ${response.status} ${response.statusText}`);
                err.code = response.status === 429 ? 'RATE_LIMIT' : 'HTTP_ERROR';
                err.status = response.status;
                err.url = url;
                failedRequests.add(url);
                if (typeof window !== 'undefined' && window.F1RequestEvents) {
                    window.F1RequestEvents.emit('error', { url, code: err.code, status: err.status });
                }
                reject(err);
            }
        } catch (e) {
            // 这里一般是网络错误或CORS导致的 TypeError: Failed to fetch
            const err = e instanceof Error ? e : new Error(String(e));
            if (!err.code) err.code = 'NETWORK_ERROR';
            err.url = err.url || url;
            console.error(`Exception fetching ${url}:`, err);
            failedRequests.add(url);
            if (typeof window !== 'undefined' && window.F1RequestEvents) {
                window.F1RequestEvents.emit('error', { url, code: err.code || 'NETWORK_ERROR' });
            }
            reject(err);
        }

        // 在处理下一个请求前等待一段时间
        await new Promise(r => setTimeout(r, currentDelayBetweenRequests));
    }

    isProcessingQueue = false;
}

// 数据获取函数
async function fetchData(url) {
    // 检查缓存中是否已有数据（单次 get 避免 has/get 之间 TTL 边界 race）
    const cached = cache.get(url);
    if (cached !== undefined) {
        debugLog(`Using cached data for: ${url}`);
        return cached;
    }

    // 同一 URL 已经在请求队列里 → 复用同一个 Promise，避免并发重复请求
    const inflight = pendingRequests.get(url);
    if (inflight) {
        debugLog(`Reusing in-flight request: ${url}`);
        return inflight;
    }

    const promise = new Promise((resolve, reject) => {
        requestQueue.push({ url, resolve, reject, retryCount: 0 });
        if (!isProcessingQueue) {
            processQueue();
        }
    });
    pendingRequests.set(url, promise);
    // 无论成功/失败都从 pending 移除
    const cleanup = () => { pendingRequests.delete(url); };
    promise.then(cleanup, cleanup);
    return promise;
}

// 重试失败的请求（仅针对之前失败过且未缓存成功的 URL）
async function retryFailedRequests() {
    const urls = Array.from(failedRequests);
    if (urls.length === 0) return { retried: 0, settled: [] };
    failedRequests.clear();
    const settled = await Promise.allSettled(urls.map(u => fetchData(u)));
    return { retried: urls.length, settled };
}

function getFailedRequestsCount() {
    return failedRequests.size;
}

function setBaseRateDelay(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return currentDelayBetweenRequests;
    BASE_DELAY_BETWEEN_REQUESTS = Math.max(MIN_DELAY_BETWEEN_REQUESTS, Math.min(ms, MAX_DELAY_BETWEEN_REQUESTS));
    currentDelayBetweenRequests = BASE_DELAY_BETWEEN_REQUESTS;
    return currentDelayBetweenRequests;
}

// 缓存管理函数
function flushFetchCache() {
    const removed = cache.clear();
    console.log('[Cache] Cleared fetch cache entries:', removed);
    return { removed };
}

function getCacheSummary() {
    const fetchCacheSize = cache.size();
    const historySummary = typeof window.getHistoryCacheSummary === 'function' ? window.getHistoryCacheSummary() : {};
    const raceSummary = typeof window.getRaceCacheSummary === 'function' ? window.getRaceCacheSummary() : {};
    const summary = {
        fetchCacheSize,
        history: historySummary,
        race: raceSummary
    };
    console.log('[Cache] Summary', summary);
    return summary;
}

function flushAllCaches() {
    const result = {
        fetch: flushFetchCache(),
        history: null,
        race: null
    };
    if (typeof window.clearHistoryCaches === 'function') {
        result.history = window.clearHistoryCaches();
    }
    if (typeof window.clearRaceCaches === 'function') {
        result.race = window.clearRaceCaches();
    }
    console.log('[Cache] Flushed all caches', result);
    return result;
}

// API endpoint functions
async function getSeasons() {
    return fetchData("https://api.jolpi.ca/ergast/f1/seasons.json?offset=44&limit=100");
}

async function getConstructors(year) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/constructors.json`);
}

async function getQualifying(year, constructorId) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/constructors/${constructorId}/qualifying.json?limit=60`);
}

// 赛历：获取赛季所有分站信息（用于计算当年总场次/轮次）
async function getSeasonSchedule(year) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}.json?limit=100`);
}

// 正赛：获取某赛季某车队在每站的正式比赛结果（用于识别当站的两位车手）
async function getConstructorResults(year, constructorId) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/constructors/${constructorId}/results.json?limit=1000`);
}

// 正赛：获取某站所有车手的正式比赛结果（用于识别全场车手顺序）
async function getRaceResults(year, round) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/results.json?limit=100`);
}

// 正赛：获取某位车手在某站的每圈圈速
async function getRaceLaps(year, round, driverId) {
    // jolpica 单车手单场圈数最多 ~78 圈（Monaco），limit=100 够用且与 API 上限一致
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/drivers/${driverId}/laps.json?limit=100`);
}

// 正赛：获取某位车手在某站的进站信息（用于识别进站圈/出站圈）
async function getDriverPitStops(year, round, driverId) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/drivers/${driverId}/pitstops.json?limit=100`);
}

// 正赛：获取某站冲刺赛成绩（用于补充积分）
async function getSprintResults(year, round) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/sprint.json?limit=1000`);
}

// 赛季冲刺赛清单：一次性获取该赛季所有冲刺站（用于避免逐站请求导致的429/CORS问题）
async function getSeasonSprintResults(year) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/sprint.json?limit=1000`);
}

// 正赛（聚合）：获取某站所有车手的每圈圈速（单次请求，减少API压力）
async function getRoundLaps(year, round) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/laps.json?limit=2000`);
}

// 正赛（聚合）：获取某站所有车手的进站信息（单次请求，减少API压力）
async function getRoundPitStops(year, round) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/pitstops.json?limit=2000`);
}

// 标准化车队名称
function normalizeTeamName(teamName) {
    return TEAM_MAPPING[teamName] || teamName;
}

// 在 innerHTML 拼接前转义文本字段（来自 API 的车手/车队/分站名等）
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setCacheLimits({ ttlMs, maxEntries } = {}) {
    if (Number.isFinite(ttlMs) && ttlMs >= 0) cache.ttlMs = ttlMs;
    if (Number.isFinite(maxEntries) && maxEntries > 0) cache.maxEntries = Math.floor(maxEntries);
    return { ttlMs: cache.ttlMs, maxEntries: cache.maxEntries, size: cache.size() };
}

// 时间处理函数
function millisecondsToStruct(time) {
    const isNegative = time < 0;
    time = Math.abs(time);
    const minutes = Math.floor(time/60000);
    time = time % 60000;
    const seconds = Math.floor(time/1000);
    const milliseconds = Math.floor(time % 1000);
    return { isNegative, minutes, seconds, milliseconds };
}

// 将时间字符串转换为毫秒
// 支持 "M:SS.sss" 或 "SS.sss"；输入非法时返回 NaN（调用方按需处理）
function convertTimeString(time) {
    if (typeof time !== 'string' || !time) return NaN;
    const tkns = time.split(":");
    let milliseconds = 0;

    if (tkns.length === 2) {
        // Format: MM:SS.sss
        const min = parseInt(tkns[0], 10);
        const tkns2 = tkns[1].split(".");
        if (tkns2.length !== 2) return NaN;
        const sec = parseInt(tkns2[0], 10);
        const ms = parseInt(tkns2[1], 10);
        if (!Number.isFinite(min) || !Number.isFinite(sec) || !Number.isFinite(ms)) return NaN;
        milliseconds = min * 60000 + sec * 1000 + ms;
    } else if (tkns.length === 1) {
        // Format: SS.sss
        const tkns2 = tkns[0].split(".");
        if (tkns2.length !== 2) return NaN;
        const sec = parseInt(tkns2[0], 10);
        const ms = parseInt(tkns2[1], 10);
        if (!Number.isFinite(sec) || !Number.isFinite(ms)) return NaN;
        milliseconds = sec * 1000 + ms;
    } else {
        return NaN;
    }

    return milliseconds;
}

// 车手相关函数
function newDriver(d) {
    return {
        name: `${d.Driver.givenName} ${d.Driver.familyName}`,
        id: d.Driver.driverId,
        ref: d,
    };
}

// 获取车手最佳时间
function getDriverBestTime(driver) {
    debugLog('Driver qualifying data:', driver);
    const times = {
        Q1: driver.Q1 || null,
        Q2: driver.Q2 || null,
        Q3: driver.Q3 || null
    };
    debugLog('Driver best times:', times);
    return times;
}

// 比较两个车手的排位赛时间
function compareQualifyingTimes(driver1Times, driver2Times) {
    let sessionUsed = null;
    let d1Time = null;
    let d2Time = null;

    if (driver1Times.Q3 && driver2Times.Q3) {
        sessionUsed = "Q3";
        d1Time = driver1Times.Q3;
        d2Time = driver2Times.Q3;
    } else if (driver1Times.Q2 && driver2Times.Q2) {
        sessionUsed = "Q2";
        d1Time = driver1Times.Q2;
        d2Time = driver2Times.Q2;
    } else if (driver1Times.Q1 && driver2Times.Q1) {
        sessionUsed = "Q1";
        d1Time = driver1Times.Q1;
        d2Time = driver2Times.Q1;
    }

    return { sessionUsed, d1Time, d2Time };
}

// 创建表格单元格
function newTd(text, bold, styleOptions) {
    let td = document.createElement("td");
    if (bold) {
        let boldElem = document.createElement("strong");
        boldElem.textContent = text;
        td.appendChild(boldElem);
    } else {
        td.textContent = text;
    }
    
    if (styleOptions) {
        Object.assign(td.style, styleOptions);
    }
    
    return td;
}

// 统计分析函数
function calculateMedian(numbers) {
    if (!numbers || numbers.length === 0) return 0;

    // 拷贝后再排序，避免修改调用方的原数组
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
}

// 计算平均值
function calculateAverage(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Bootstrap置信区间计算
// 内部针对每次重采样使用 O(n) 的快速中位数，避免 10000 次重排导致的明显卡顿
function bootstrapConfidenceInterval(data, confidence = 0.95, iterations = 5000) {
    if (!data || data.length < 2) return { lower: NaN, upper: NaN };

    // 过滤非有限值，避免 NaN 进入 quickselect 导致死循环
    const cleaned = [];
    for (const v of data) if (Number.isFinite(v)) cleaned.push(v);
    if (cleaned.length < 2) return { lower: NaN, upper: NaN };
    data = cleaned;
    const n = data.length;
    // 复用 buffer，减少 GC 压力
    const buf = new Float64Array(n);

    // 基于 quickselect 的中位数：O(n)，原地操作 buf
    const quickselect = (arr, k, left, right) => {
        while (left < right) {
            // 三数取中作为枢轴，提高对已排序输入的鲁棒性
            const mid = (left + right) >> 1;
            if (arr[left] > arr[right]) { const t = arr[left]; arr[left] = arr[right]; arr[right] = t; }
            if (arr[mid]  > arr[right]) { const t = arr[mid];  arr[mid]  = arr[right]; arr[right] = t; }
            if (arr[left] > arr[mid])   { const t = arr[left]; arr[left] = arr[mid];   arr[mid]   = t; }
            const pivot = arr[mid];
            let i = left, j = right;
            while (i <= j) {
                while (arr[i] < pivot) i++;
                while (arr[j] > pivot) j--;
                if (i <= j) {
                    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
                    i++; j--;
                }
            }
            if (k <= j) right = j;
            else if (k >= i) left = i;
            else return arr[k];
        }
        return arr[left];
    };
    const fastMedian = () => {
        const mid = n >> 1;
        if ((n & 1) === 1) return quickselect(buf, mid, 0, n - 1);
        const hi = quickselect(buf, mid, 0, n - 1);
        const lo = quickselect(buf, mid - 1, 0, n - 1);
        return (hi + lo) / 2;
    };

    const bootstrapMedians = new Float64Array(iterations);
    for (let i = 0; i < iterations; i++) {
        for (let j = 0; j < n; j++) {
            buf[j] = data[(Math.random() * n) | 0];
        }
        bootstrapMedians[i] = fastMedian();
    }

    // Float64Array 没有自定义 sort，但默认数值排序就是我们要的
    bootstrapMedians.sort();

    const alpha = 1 - confidence;
    const lowerIndex = Math.floor((alpha / 2) * iterations);
    const upperIndex = Math.min(iterations - 1, Math.floor((1 - alpha / 2) * iterations));

    return {
        lower: bootstrapMedians[lowerIndex],
        upper: bootstrapMedians[upperIndex]
    };
}

// 导出所有功能
window.F1Utils = {
    // 常量
    TEAM_MAPPING,
    
    // API和数据获取
    fetchData,
    flushFetchCache,
    getCacheSummary,
    flushAllCaches,
    retryFailedRequests,
    getFailedRequestsCount,
    setBaseRateDelay,
    getSeasons,
    getConstructors,
    getQualifying,
    getConstructorResults,
    getRaceResults,
    getRaceLaps,
    getDriverPitStops,
    getSprintResults,
    getSeasonSprintResults,
    getSeasonSchedule,
    getRoundLaps,
    getRoundPitStops,
    
    // 车队处理
    normalizeTeamName,
    escapeHtml,
    setCacheLimits,
    
    // 时间处理
    millisecondsToStruct,
    convertTimeString,
    
    // 车手相关
    newDriver,
    getDriverBestTime,
    compareQualifyingTimes,
    
    // UI 元素
    newTd,
    
    // 统计分析
    calculateMedian,
    calculateAverage,
    bootstrapConfidenceInterval
};

// 暴露调试工具
window.F1Utils.setDebug = function (enabled) {
    window.__F1_DEBUG = !!enabled;
    console.log('[Debug] __F1_DEBUG =', window.__F1_DEBUG);
    return window.__F1_DEBUG;
};
window.F1Utils.debug = debugLog;
