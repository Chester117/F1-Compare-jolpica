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

// 车手最佳时间获取
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

// 导出所有功能
window.F1Utils = {
    TEAM_MAPPING,
    fetchData,
    getSeasons,
    getConstructors,
    getQualifying,
    normalizeTeamName,
    convertTimeString,
    getDriverBestTime,
    compareQualifyingTimes,
    calculateMedian
};
