// 全局变量用于记录是否已初始化
window.historyTabInitialized = false;

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

// 辅助函数
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

function calculateMedian(numbers) {
    if (numbers.length === 0) return 0;
    
    const sorted = numbers.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
}

// 标准化车队名称
function normalizeTeamName(teamName) {
    return TEAM_MAPPING[teamName] || teamName;
}

// 根据年份更新车队选择器
async function updateTeamSelector(year) {
    const list = await getConstructors(year);
    if (list) {
        const historyConstructor = document.getElementById('historyConstructorList');
        const currentSelection = historyConstructor.value;
        
        if (historyConstructor) {
            // 保存选项，以便我们可以尝试在新的选择器中保持相同的选择
            const normalizedCurrentSelection = normalizeTeamName(currentSelection);
            
            // 创建下拉选项
            historyConstructor.innerHTML = list.MRData.ConstructorTable.Constructors.map(team => {
                const normalizedName = normalizeTeamName(team.name);
                const displayName = `${team.name}${normalizedName !== team.name ? ` (${normalizedName})` : ''}`;
                return `<option value="${team.name}" id="${team.constructorId}" data-normalized="${normalizedName}">${displayName}</option>`;
            }).join('');
            
            // 尝试选择之前选中的车队（按标准化名称）
            let found = false;
            for (let i = 0; i < historyConstructor.options.length; i++) {
                const option = historyConstructor.options[i];
                if (option.getAttribute('data-normalized') === normalizedCurrentSelection) {
                    historyConstructor.selectedIndex = i;
                    found = true;
                    break;
                }
            }
            
            // 如果没有找到匹配项，默认选择第一个
            if (!found && historyConstructor.options.length > 0) {
                historyConstructor.selectedIndex = 0;
            }
        }
    }
}

// 初始化选择器函数
async function fillYearSelectors() {
    const years = await getSeasons();
    if (!years) return;

    const yearOptions = years.MRData.SeasonTable.Seasons.reverse().map(s => s.season);
    
    const startYearSelect = document.getElementById('startYearList');
    const endYearSelect = document.getElementById('endYearList');
    
    if (startYearSelect && endYearSelect) {
        // 填充年份选择器
        startYearSelect.innerHTML = yearOptions.map(year => 
            `<option value="${year}">${year}</option>`
        ).join('');
        
        endYearSelect.innerHTML = yearOptions.map(year => 
            `<option value="${year}">${year}</option>`
        ).join('');
        
        // 默认选择最近两年
        if (yearOptions.length >= 2) {
            endYearSelect.value = yearOptions[0]; // 最新年份
            startYearSelect.value = yearOptions[1]; // 次新年份
        }
        
        // 添加事件监听器以在年份变更时更新车队选择器
        startYearSelect.addEventListener('change', async () => {
            await updateTeamSelector(startYearSelect.value);
        });
        
        endYearSelect.addEventListener('change', async () => {
            await updateTeamSelector(endYearSelect.value);
        });
    }

    // 填充历史标签的车队列表
    await updateTeamSelector(yearOptions[0]);
}

// 获取指定年份范围内所有车队的详细信息
async function getTeamContinuity(startYear, endYear) {
    const teamPresence = {};
    const teamYears = {};
    
    for (let year = startYear; year <= endYear; year++) {
        const data = await getConstructors(year);
        if (!data || !data.MRData.ConstructorTable.Constructors) continue;
        
        data.MRData.ConstructorTable.Constructors.forEach(team => {
            const normalizedName = normalizeTeamName(team.name);
            
            if (!teamPresence[normalizedName]) {
                teamPresence[normalizedName] = {};
                teamYears[normalizedName] = [];
            }
            
            teamPresence[normalizedName][year] = team.constructorId;
            teamYears[normalizedName].push(year);
        });
    }
    
    // 检查连续性
    const discontinuousTeams = {};
    Object.keys(teamYears).forEach(team => {
        const years = teamYears[team].sort((a, b) => a - b);
        
        if (years.length < (endYear - startYear + 1)) {
            // 车队在某些年份缺席
            const missingYears = [];
            for (let year = startYear; year <= endYear; year++) {
                if (!years.includes(year)) {
                    missingYears.push(year);
                }
            }
            
            if (missingYears.length > 0) {
                discontinuousTeams[team] = {
                    presentYears: years,
                    missingYears: missingYears
                };
            }
        }
    });
    
    return {
        teamPresence,
        teamYears,
        discontinuousTeams
    };
}

// 显示历史结果函数
async function showHistoryResults() {
    const startYear = parseInt(document.getElementById('startYearList').value);
    const endYear = parseInt(document.getElementById('endYearList').value);
    const constructorSelect = document.getElementById('historyConstructorList');
    
    if (!constructorSelect) {
        console.error("找不到 historyConstructorList 元素");
        return;
    }
    
    const selectedOption = constructorSelect.options[constructorSelect.selectedIndex];
    const constructorId = selectedOption.id;
    const constructorName = selectedOption.value;
    const normalizedName = selectedOption.getAttribute('data-normalized') || normalizeTeamName(constructorName);

    if (startYear > endYear) {
        alert('起始年份必须小于或等于结束年份');
        return;
    }

    // 显示加载状态
    const historyTable = document.getElementById('historyTable');
    historyTable.innerHTML = '<div style="text-align: center; padding: 20px;">加载中...</div>';

    // 获取车队连续性信息
    const continuityInfo = await getTeamContinuity(startYear, endYear);
    
    // 检查所选车队是否在某些年份缺席
    let teamDiscontinuityWarning = '';
    if (continuityInfo.discontinuousTeams[normalizedName]) {
        const info = continuityInfo.discontinuousTeams[normalizedName];
        const missingYearsStr = info.missingYears.join(', ');
        teamDiscontinuityWarning = `
            <div class="warning-message" style="background-color: #fff3cd; color: #856404; padding: 10px; margin: 10px 0; border-radius: 4px; text-align: center;">
                注意：所选车队 "${normalizedName}" 在以下年份缺席：${missingYearsStr}
            </div>
        `;
    }

    const tableRows = [];
    let mappedConstructorIds = {}; // 存储每年对应的实际构造函数ID
    
    // 找出所有相关的构造函数ID
    for (let year = startYear; year <= endYear; year++) {
        if (continuityInfo.teamPresence[normalizedName] && 
            continuityInfo.teamPresence[normalizedName][year]) {
            mappedConstructorIds[year] = continuityInfo.teamPresence[normalizedName][year];
        }
    }
    
    for (let year = startYear; year <= endYear; year++) {
        // 使用映射的ID或原始ID
        const actualConstructorId = mappedConstructorIds[year] || constructorId;
        
        // 跳过车队不存在的年份
        if (!actualConstructorId) continue;
        
        const data = await getQualifying(year, actualConstructorId);
        if (!data?.MRData.RaceTable.Races.length) continue;

        let timeGaps = [];
        let driver1Wins = 0;
        let totalRaces = 0;
        
        const firstRace = data.MRData.RaceTable.Races.find(r => r.QualifyingResults.length === 2);
        if (!firstRace) continue;

        const driver1 = `${firstRace.QualifyingResults[0].Driver.givenName} ${firstRace.QualifyingResults[0].Driver.familyName}`;
        const driver2 = `${firstRace.QualifyingResults[1].Driver.givenName} ${firstRace.QualifyingResults[1].Driver.familyName}`;

        data.MRData.RaceTable.Races.forEach(race => {
            if (race.QualifyingResults.length !== 2) return;

            const d1Times = {
                Q1: race.QualifyingResults[0].Q1 || null,
                Q2: race.QualifyingResults[0].Q2 || null,
                Q3: race.QualifyingResults[0].Q3 || null
            };
            const d2Times = {
                Q1: race.QualifyingResults[1].Q1 || null,
                Q2: race.QualifyingResults[1].Q2 || null,
                Q3: race.QualifyingResults[1].Q3 || null
            };

            let sessionTime = null;
            if (d1Times.Q3 && d2Times.Q3) {
                sessionTime = { t1: d1Times.Q3, t2: d2Times.Q3 };
            } else if (d1Times.Q2 && d2Times.Q2) {
                sessionTime = { t1: d1Times.Q2, t2: d2Times.Q2 };
            } else if (d1Times.Q1 && d2Times.Q1) {
                sessionTime = { t1: d1Times.Q1, t2: d2Times.Q1 };
            }

            if (sessionTime) {
                const t1Ms = convertTimeString(sessionTime.t1);
                const t2Ms = convertTimeString(sessionTime.t2);
                const timeDiff = t2Ms - t1Ms;
                const percentageDiff = (timeDiff / t1Ms) * 100;
                
                timeGaps.push(percentageDiff);
                if (timeDiff < 0) driver1Wins++;
                totalRaces++;
            }
        });

        if (totalRaces > 0) {
            // 计算中位数
            const medianGap = calculateMedian(timeGaps);
            
            // 为每一行添加不同的背景色来区分
            let rowClass = '';
            if (driver1Wins > (totalRaces - driver1Wins)) {
                rowClass = 'style="background-color: rgba(133, 255, 120, 0.3);"';
            } else if (driver1Wins < (totalRaces - driver1Wins)) {
                rowClass = 'style="background-color: rgba(255, 120, 120, 0.3);"';
            }
            
            // 添加实际车队名称（如果与标准化名称不同）
            const actualTeamName = await getActualTeamName(year, actualConstructorId);
            const teamNameDisplay = actualTeamName !== normalizedName ? 
                `${actualTeamName} (${normalizedName})` : actualTeamName;
            
            tableRows.push(`
                <tr ${rowClass}>
                    <td>${year}</td>
                    <td>${teamNameDisplay}</td>
                    <td>${driver1}</td>
                    <td>${driver2}</td>
                    <td>${medianGap.toFixed(3)}%</td>
                    <td>${driver1Wins} - ${totalRaces - driver1Wins}</td>
                </tr>
            `);
        }
    }

    // 显示结果或无数据消息
    if (tableRows.length > 0) {
        historyTable.innerHTML = `
            ${teamDiscontinuityWarning}
            <table class="history-table">
                <tr>
                    <th>年份</th>
                    <th>车队</th>
                    <th>车手 1</th>
                    <th>车手 2</th>
                    <th>中位数差距 %</th>
                    <th>排位赛成绩</th>
                </tr>
                ${tableRows.join('')}
            </table>
        `;
    } else {
        historyTable.innerHTML = `
            ${teamDiscontinuityWarning}
            <div style="text-align: center; padding: 20px;">未找到符合条件的数据</div>
        `;
    }
}

// 获取指定年份和ID的实际车队名称
async function getActualTeamName(year, constructorId) {
    const data = await getConstructors(year);
    if (data && data.MRData.ConstructorTable.Constructors) {
        const team = data.MRData.ConstructorTable.Constructors.find(t => t.constructorId === constructorId);
        if (team) {
            return team.name;
        }
    }
    return constructorId;
}

// 初始化历史标签
function initHistoryTab() {
    if (!window.historyTabInitialized) {
        console.log("初始化历史标签...");
        
        // 添加Go按钮事件监听
        const historyGoButton = document.getElementById("historyGo");
        if (historyGoButton) {
            // 移除之前的事件监听器以避免重复
            historyGoButton.removeEventListener("click", showHistoryResults);
            historyGoButton.addEventListener("click", showHistoryResults);
        } else {
            console.error("找不到 historyGo 按钮");
        }
        
        // 填充年份和车队选择器
        fillYearSelectors();
        
        window.historyTabInitialized = true;
    }
}

// Tab切换函数
window.switchTabHistory = function(tab) {
    console.log(`切换到标签: ${tab}`);
    
    // 更新活动标签样式
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    document.querySelector(`.tab-button[data-tab="${tab}"]`).classList.add('active');
    
    // 显示/隐藏相应内容
    document.getElementById('qualifying-content').style.display = tab === 'qualifying' ? 'block' : 'none';
    document.getElementById('history-content').style.display = tab === 'history' ? 'block' : 'none';
    
    // 如果切换到历史标签，初始化它
    if (tab === 'history') {
        initHistoryTab();
    }
};

// 当DOM加载完成后执行
document.addEventListener('DOMContentLoaded', function() {
    console.log("历史模块DOM加载完成");
    
    // 检查URL或其他逻辑以确定是否应初始化历史标签
    const isHistoryTabActive = document.querySelector('.tab-button[data-tab="history"]').classList.contains('active');
    
    if (isHistoryTabActive) {
        initHistoryTab();
    }
});

// 为确保 history 页面按钮始终有效，在窗口加载时也初始化
window.addEventListener('load', function() {
    console.log("历史模块窗口加载完成");
    
    // 检查我们是否在历史标签
    const isHistoryTabVisible = document.getElementById('history-content').style.display === 'block';
    
    if (isHistoryTabVisible) {
        initHistoryTab();
    }
});
