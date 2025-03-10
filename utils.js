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
            return await response.json();
        }
    } catch (e) {
        console.error(`Exception fetching ${url}:`, e);
        return undefined;
    }
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
