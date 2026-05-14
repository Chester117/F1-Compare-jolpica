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

// 缓存系统
const cache = {
    data: {},
    get(url) {
        return this.data[url];
    },
    set(url, data) {
        this.data[url] = data;
    },
    has(url) {
        return Object.prototype.hasOwnProperty.call(this.data, url);
    },
    size() {
        return Object.keys(this.data).length;
    },
    clear() {
        const count = this.size();
        this.data = {};
        return count;
    }
};

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
                currentDelayBetweenRequests = Math.max(MIN_DELAY_BETWEEN_REQUESTS, Math.floor(currentDelayBetweenRequests * 0.9));
            } else if (response.status === 429 && retryCount < 4) {
                // 429：读取 Retry-After，指数退避+抖动，并通知 UI
                const ra = parseInt(response.headers.get('Retry-After') || '0', 10);
                const suggested = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 0;
                // 自适应提高全局间隔
                const now = Date.now();
                lastBackoffAt = now;
                if (suggested > 0) {
                    currentDelayBetweenRequests = Math.min(MAX_DELAY_BETWEEN_REQUESTS, Math.max(currentDelayBetweenRequests, suggested));
                } else {
                    currentDelayBetweenRequests = Math.min(MAX_DELAY_BETWEEN_REQUESTS, Math.floor(currentDelayBetweenRequests * 1.6 + 150));
                }
                // 抖动
                const jitter = Math.floor(Math.random() * 300);
                const waitMs = (suggested || 1500) + jitter;
                console.warn(`Rate limited for ${url}, retry later (${retryCount + 1}/4). Backoff ${waitMs}ms, global delay=${currentDelayBetweenRequests}ms`);
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
    // 检查缓存中是否已有数据
    if (cache.has(url)) {
        debugLog(`Using cached data for: ${url}`);
        return cache.get(url);
    }

    // 创建新的请求并添加到队列
    return new Promise((resolve, reject) => {
        requestQueue.push({ url, resolve, reject, retryCount: 0 });

        // 开始处理队列（如果尚未处理）
        if (!isProcessingQueue) {
            processQueue();
        }
    });
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

// 正赛：获取某位车手在某站的每圈圈速
async function getRaceLaps(year, round, driverId) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/drivers/${driverId}/laps.json?limit=2000`);
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
function convertTimeString(time) {
    const tkns = time.split(":");
    let milliseconds = 0;
    
    if (tkns.length === 2) {
        // Format: MM:SS.sss
        milliseconds = parseInt(tkns[0]) * 60000;
        const tkns2 = tkns[1].split(".");
        milliseconds += parseInt(tkns2[0]) * 1000 + parseInt(tkns2[1]);
    } else {
        // Format: SS.sss
        const tkns2 = tkns[0].split(".");
        milliseconds = parseInt(tkns2[0]) * 1000 + parseInt(tkns2[1]);
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
    if (numbers.length === 0) return 0;
    
    const sorted = numbers.sort((a, b) => a - b);
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
function bootstrapConfidenceInterval(data, confidence = 0.95, iterations = 10000) {
    if (data.length < 2) return { lower: NaN, upper: NaN };
    
    // 有放回抽样函数
    const sample = (arr) => {
        const result = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
            result[i] = arr[Math.floor(Math.random() * arr.length)];
        }
        return result;
    };
    
    // 生成bootstrap样本并计算中位数
    const bootstrapMedians = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
        const sampleData = sample(data);
        bootstrapMedians[i] = calculateMedian(sampleData);
    }
    
    // 排序中位数，找到基于百分位的置信区间
    bootstrapMedians.sort((a, b) => a - b);
    
    const alpha = 1 - confidence;
    const lowerIndex = Math.floor((alpha / 2) * iterations);
    const upperIndex = Math.floor((1 - alpha / 2) * iterations);
    
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
    getRaceLaps,
    getDriverPitStops,
    getSprintResults,
    getSeasonSprintResults,
    getSeasonSchedule,
    getRoundLaps,
    getRoundPitStops,
    
    // 车队处理
    normalizeTeamName,
    
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
