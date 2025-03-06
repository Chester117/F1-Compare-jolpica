// 车队名称映射 - 将不同时期的同一支车队名称映射为统一名称
const TEAM_MAPPING = {
    // Red Bull系列车队
    "AlphaTauri": "Red Bull Junior Team",
    "Alpha Tauri": "Red Bull Junior Team",
    "Toro Rosso": "Red Bull Junior Team",
    "Visa Cash App RB": "Red Bull Junior Team",
    "VCARB": "Red Bull Junior Team",
    "RB": "Red Bull Junior Team",
    
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

// API测试函数
async function testJolpicaApi() {
    console.log("Testing Jolpica API...");
    
    try {
        const response = await fetch("https://jolpica-f1.com/api/2023/constructors.json");
        if (!response.ok) {
            console.error("API test failed:", response.statusText);
            return false;
        } else {
            const data = await response.json();
            console.log("API test successful:", data);
            return true;
        }
    } catch (e) {
        console.error("API test exception:", e);
        return false;
    }
}

// 数据获取函数
async function fetchData(url) {
    try {
        let response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            },
            mode: 'cors'
        });

        if (!response.ok) {
            console.error(`Error fetching ${url}: ${response.statusText}`);
            return undefined;
        } else {
            let json = await response.json();
            return json;
        }
    } catch (e) {
        console.error(`Exception fetching ${url}:`, e);
        return undefined;
    }
}

async function getSeasons() {
    return fetchData("https://api.jolpi.ca/ergast/f1/seasons.json?offset=44&limit=100");
}

async function getConstructors(year) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/constructors.json`);
}

async function getQualifying(year, constructorId) {
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/constructors/${constructorId}/qualifying.json?limit=60`);
}

// 标准化车队名称
function normalizeTeamName(teamName) {
    return TEAM_MAPPING[teamName] || teamName;
}

// 时间处理函数
// 将毫秒转换为结构化时间对象
function millisecondsToStruct(time) {
    const newTime = {};
    newTime.isNegative = time < 0 ? true : false;
    time = Math.abs(time);
    newTime.minutes = Math.floor(time/60000);
    time = time % 60000;
    newTime.seconds = Math.floor(time/1000);
    newTime.milliseconds = Math.floor(time % 1000);
    return newTime;
}

// 将时间字符串转换为毫秒
function convertTimeString(time) {
    let milliseconds = 0;
    const tkns = time.split(":");
    if (tkns.length === 2) {
        milliseconds += (parseInt(tkns[0]) * 60000);
        const tkns2 = tkns[1].split(".");
        milliseconds += parseInt(tkns2[0]) * 1000;
        milliseconds += parseInt(tkns2[1]);
        return milliseconds;
    } else {
        const tkns2 = tkns[0].split(".");
        milliseconds += parseInt(tkns2[0]) * 1000;
        milliseconds += parseInt(tkns2[1]);
        return milliseconds;
    }
}

// 车手相关函数
// 创建新车手对象
function newDriver(d) {
    return {
        name: `${d.Driver.givenName} ${d.Driver.familyName}`,
        id: d.Driver.driverId,
        ref: d,
    };
}

// 获取车手最佳时间
function getDriverBestTime(driver) {
    return {
        Q1: driver.Q1 || null,
        Q2: driver.Q2 || null,
        Q3: driver.Q3 || null
    };
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

    return {
        sessionUsed,
        d1Time,
        d2Time
    };
}

// 创建表格单元格
function newTd(text, bold, styleOptions) {
    let td = document.createElement("td");
    if (bold) {
        let bold = document.createElement("strong");
        let textNode = document.createTextNode(text);
        bold.appendChild(textNode);
        td.appendChild(bold);
    }
    else {
        td.appendChild(document.createTextNode(text));
    }
    if (styleOptions) {
        for (let key of Object.keys(styleOptions)) {
            td.style[key] = styleOptions[key];
        }
    }
    
    return td;
}

// 统计分析函数
// 计算中位数
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
    
    // 函数计算数组的中位数
    const calculateMedian = arr => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
    };
    
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
        bootstrapMedians[i] = calculateMedian(sample(data));
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
    testJolpicaApi,
    fetchData,
    getSeasons,
    getConstructors,
    getQualifying,
    
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
