// 初始化状态标志
window.historyTabInitialized = false;

// 根据年份更新车队选择器
async function updateTeamSelector(year) {
    const list = await F1Utils.getConstructors(year);
    if (!list) return;
    
    const historyConstructor = document.getElementById('historyConstructorList');
    if (!historyConstructor) return;
    
    const currentSelection = historyConstructor.value;
    const normalizedCurrentSelection = F1Utils.normalizeTeamName(currentSelection);
    
    // 创建下拉选项
    historyConstructor.innerHTML = list.MRData.ConstructorTable.Constructors.map(team => {
        const normalizedName = F1Utils.normalizeTeamName(team.name);
        const displayName = `${team.name}${normalizedName !== team.name ? ` (${normalizedName})` : ''}`;
        return `<option value="${team.name}" id="${team.constructorId}" data-normalized="${normalizedName}">${displayName}</option>`;
    }).join('');
    
    // 尝试选择之前选中的车队（按标准化名称）
    for (let i = 0; i < historyConstructor.options.length; i++) {
        const option = historyConstructor.options[i];
        if (option.getAttribute('data-normalized') === normalizedCurrentSelection) {
            historyConstructor.selectedIndex = i;
            return;
        }
    }
    
    // 如果没有找到匹配项，默认选择第一个
    if (historyConstructor.options.length > 0) {
        historyConstructor.selectedIndex = 0;
    }
}

// 初始化选择器函数
async function fillYearSelectors() {
    const years = await F1Utils.getSeasons();
    if (!years) return;

    const yearOptions = years.MRData.SeasonTable.Seasons.reverse().map(s => s.season);
    
    const startYearSelect = document.getElementById('startYearList');
    const endYearSelect = document.getElementById('endYearList');
    
    if (!startYearSelect || !endYearSelect) return;
    
    // 填充年份选择器
    const yearOptionsHtml = yearOptions.map(year => 
        `<option value="${year}">${year}</option>`
    ).join('');
    
    startYearSelect.innerHTML = yearOptionsHtml;
    endYearSelect.innerHTML = yearOptionsHtml;
    
    // 默认选择最近两年
    if (yearOptions.length >= 2) {
        endYearSelect.value = yearOptions[0]; // 最新年份
        startYearSelect.value = yearOptions[1]; // 次新年份
    }
    
    // 添加事件监听器以在年份变更时更新车队选择器
    startYearSelect.addEventListener('change', () => updateTeamSelector(startYearSelect.value));
    endYearSelect.addEventListener('change', () => updateTeamSelector(endYearSelect.value));

    // 填充历史标签的车队列表
    await updateTeamSelector(yearOptions[0]);
}

// 获取指定年份范围内所有车队的详细信息
async function getTeamContinuity(startYear, endYear) {
    const teamPresence = {};
    const teamYears = {};
    
    for (let year = startYear; year <= endYear; year++) {
        const data = await F1Utils.getConstructors(year);
        if (!data || !data.MRData.ConstructorTable.Constructors) continue;
        
        data.MRData.ConstructorTable.Constructors.forEach(team => {
            const normalizedName = F1Utils.normalizeTeamName(team.name);
            
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

// 获取指定年份和ID的实际车队名称
async function getActualTeamName(year, constructorId) {
    const data = await F1Utils.getConstructors(year);
    if (data && data.MRData.ConstructorTable.Constructors) {
        const team = data.MRData.ConstructorTable.Constructors.find(t => t.constructorId === constructorId);
        if (team) {
            return team.name;
        }
    }
    return constructorId;
}

// 获取车手本赛季积分
async function getDriverPoints(year, driverId) {
    try {
        console.log(`尝试获取${year}年车手${driverId}的积分...`);
        const response = await F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/driverStandings.json`);
        
        if (!response) {
            console.error(`获取${year}年积分数据失败: API返回为空`);
            return 0;
        }
        
        if (!response.MRData || !response.MRData.StandingsTable) {
            console.error(`获取${year}年积分数据失败: 数据格式不正确`, response);
            return 0;
        }
        
        if (!response.MRData.StandingsTable.StandingsLists || 
            response.MRData.StandingsTable.StandingsLists.length === 0) {
            console.error(`获取${year}年积分数据失败: StandingsLists为空`);
            return 0;
        }
        
        const standings = response.MRData.StandingsTable.StandingsLists[0].DriverStandings;
        console.log(`${year}年共有${standings.length}名车手有积分记录`);
        
        let driverStanding = standings.find(standing => standing.Driver.driverId === driverId);
        
        if (!driverStanding) {
            console.error(`${year}年找不到车手${driverId}的积分记录`);
            // 输出所有可用的车手ID，帮助调试
            console.log('可用车手ID:', standings.map(s => s.Driver.driverId).join(', '));
            return 0;
        }
        
        const points = parseInt(driverStanding.points);
        console.log(`${year}年车手${driverId}的积分: ${points}`);
        return points;
    } catch (error) {
        console.error(`获取${year}年车手${driverId}积分失败:`, error);
        return 0;
    }
}

// 查找给定年份和车队的所有车手对
async function findDriverPairs(year, constructorId) {
    try {
        const qualifyingData = await F1Utils.getQualifying(year, constructorId);
        if (!qualifyingData || !qualifyingData.MRData || !qualifyingData.MRData.RaceTable || !qualifyingData.MRData.RaceTable.Races) {
            console.error(`获取${year}年车队${constructorId}的排位赛数据失败`);
            return [];
        }

        // 收集该赛季所有车手
        const allDrivers = new Set();
        const driverInfo = {};
        
        qualifyingData.MRData.RaceTable.Races.forEach(race => {
            if (!race.QualifyingResults) return;
            
            race.QualifyingResults.forEach(result => {
                const driverId = result.Driver.driverId;
                allDrivers.add(driverId);
                
                if (!driverInfo[driverId]) {
                    driverInfo[driverId] = {
                        id: driverId,
                        name: `${result.Driver.givenName} ${result.Driver.familyName}`,
                        races: []
                    };
                }
                
                driverInfo[driverId].races.push(race.round);
            });
        });
        
        // 找出所有可能的车手配对
        const driverList = Array.from(allDrivers);
        const driverPairs = [];
        
        // 确定哪些车手同时参加了哪些比赛
        for (let i = 0; i < driverList.length; i++) {
            for (let j = i + 1; j < driverList.length; j++) {
                const driver1 = driverInfo[driverList[i]];
                const driver2 = driverInfo[driverList[j]];
                
                // 找出两位车手共同参加的比赛
                const commonRaces = driver1.races.filter(race => driver2.races.includes(race));
                
                if (commonRaces.length > 0) {
                    driverPairs.push({
                        driver1,
                        driver2,
                        commonRaces
                    });
                    
                    console.log(`${year}年发现车手组合: ${driver1.name} vs ${driver2.name}, 共同参赛: ${commonRaces.length}场`);
                }
            }
        }
        
        return driverPairs;
    } catch (error) {
        console.error(`查找${year}年车队${constructorId}的车手对失败:`, error);
        return [];
    }
}

// 处理单年度单车手对数据
async function processDriverPairData(year, actualConstructorId, normalizedName, driverPair) {
    const data = await F1Utils.getQualifying(year, actualConstructorId);
    if (!data?.MRData.RaceTable.Races.length) return null;

    let timeGaps = [];
    let driver1Wins = 0;
    let totalRaces = 0;
    
    const driver1 = driverPair.driver1;
    const driver2 = driverPair.driver2;
    
    // 处理每场比赛数据
    data.MRData.RaceTable.Races.forEach(race => {
        // 检查这两位车手是否都参加了这场比赛
        if (!driverPair.commonRaces.includes(race.round)) return;
        
        const driver1Result = race.QualifyingResults.find(r => r.Driver.driverId === driver1.id);
        const driver2Result = race.QualifyingResults.find(r => r.Driver.driverId === driver2.id);
        
        if (!driver1Result || !driver2Result) return;

        const d1Times = F1Utils.getDriverBestTime(driver1Result);
        const d2Times = F1Utils.getDriverBestTime(driver2Result);
        
        const comparison = F1Utils.compareQualifyingTimes(d1Times, d2Times);
        
        if (comparison.sessionUsed && comparison.d1Time && comparison.d2Time) {
            totalRaces++;
            
            const d1TimeMs = F1Utils.convertTimeString(comparison.d1Time);
            const d2TimeMs = F1Utils.convertTimeString(comparison.d2Time);
            const timeDiff = d2TimeMs - d1TimeMs;  // 正值意味着driver1更快
            const percentageDiff = (timeDiff / d1TimeMs) * 100;
            
            timeGaps.push(percentageDiff);
            
            // 如果driver1更快
            if (timeDiff > 0) {
                driver1Wins++;
            }
        }
    });

    if (totalRaces === 0) return null;
    
    // 计算中位数
    const medianGap = F1Utils.calculateMedian(timeGaps);
    
    // 获取实际车队名称
    const actualTeamName = await getActualTeamName(year, actualConstructorId);
    const teamNameDisplay = actualTeamName !== normalizedName ? 
        `${actualTeamName} (${normalizedName})` : actualTeamName;
        
    // 设置车手单元格的样式
    let driver1Style = '';
    let driver2Style = '';
    
    if (driver1Wins > (totalRaces - driver1Wins)) {
        driver1Style = 'style="background-color: rgba(133, 255, 120, 0.6);"';
        driver2Style = 'style="background-color: rgba(255, 120, 120, 0.6);"';
    } else if (driver1Wins < (totalRaces - driver1Wins)) {
        driver1Style = 'style="background-color: rgba(255, 120, 120, 0.6);"';
        driver2Style = 'style="background-color: rgba(133, 255, 120, 0.6);"';
    }
    
    // 获取车手积分
    const driver1Points = await getDriverPoints(year, driver1.id);
    const driver2Points = await getDriverPoints(year, driver2.id);
    
    // 设置积分单元格的样式
    let pointsStyle = '';
    if (driver1Points > driver2Points) {
        pointsStyle = 'style="background-color: rgba(133, 255, 120, 0.4);"';
    } else if (driver1Points < driver2Points) {
        pointsStyle = 'style="background-color: rgba(255, 120, 120, 0.4);"';
    }
    
    return {
        year,
        teamNameDisplay,
        driver1: driver1.name,
        driver2: driver2.name,
        medianGap,
        driver1Wins,
        totalRaces,
        driver1Style,
        driver2Style,
        driver1Points,
        driver2Points,
        pointsStyle
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
    const normalizedName = selectedOption.getAttribute('data-normalized') || F1Utils.normalizeTeamName(constructorName);

    if (startYear > endYear) {
        alert('起始年份必须小于或等于结束年份');
        return;
    }

    // 显示加载状态 - 使用现代加载动画
    const historyTable = document.getElementById('historyTable');
    historyTable.innerHTML = `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">加载中...</div>
        </div>
    `;

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

    // 找出所有相关的构造函数ID
    let mappedConstructorIds = {}; 
    for (let year = startYear; year <= endYear; year++) {
        if (continuityInfo.teamPresence[normalizedName] && 
            continuityInfo.teamPresence[normalizedName][year]) {
            mappedConstructorIds[year] = continuityInfo.teamPresence[normalizedName][year];
        }
    }
    
    // 处理所有年份数据
    const allPairsDataPromises = [];
    
    for (let year = startYear; year <= endYear; year++) {
        const actualConstructorId = mappedConstructorIds[year] || constructorId;
        if (!actualConstructorId) continue;
        
        // 为每一年找出所有车手对
        const driverPairs = await findDriverPairs(year, actualConstructorId);
        
        // 为每个车手对处理数据
        driverPairs.forEach(pair => {
            allPairsDataPromises.push(
                processDriverPairData(year, actualConstructorId, normalizedName, pair)
            );
        });
    }
    
    // 等待所有年份和车手对的数据处理完成
    const allPairsResults = await Promise.all(allPairsDataPromises);
    const tableRows = allPairsResults
        .filter(result => result !== null)
        .map(data => `
            <tr>
                <td>${data.year}</td>
                <td>${data.teamNameDisplay}</td>
                <td ${data.driver1Style}>${data.driver1 || "N/A"}</td>
                <td ${data.driver2Style}>${data.driver2 || "N/A"}</td>
                <td>${data.medianGap.toFixed(3)}%</td>
                <td>${data.driver1Wins} - ${data.totalRaces - data.driver1Wins}</td>
                <td ${data.pointsStyle}>${data.driver1Points} - ${data.driver2Points}</td>
            </tr>
        `);

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
                    <th>赛季积分</th>
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

// 初始化历史标签
function initHistoryTab() {
    if (!window.historyTabInitialized) {
        // 添加Go按钮事件监听
        const historyGoButton = document.getElementById("historyGo");
        if (historyGoButton) {
            // 移除之前的事件监听器以避免重复
            historyGoButton.removeEventListener("click", showHistoryResults);
            historyGoButton.addEventListener("click", showHistoryResults);
        }
        
        // 填充年份和车队选择器
        fillYearSelectors();
        
        window.historyTabInitialized = true;
    }
}

// Tab切换函数
window.switchTabHistory = function(tab) {
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

// 初始化逻辑
document.addEventListener('DOMContentLoaded', function() {
    // 检查是否应初始化历史标签
    const isHistoryTabActive = document.querySelector('.tab-button[data-tab="history"]').classList.contains('active');
    
    if (isHistoryTabActive) {
        initHistoryTab();
    }
});

// 为确保 history 页面按钮始终有效，在窗口加载时也初始化
window.addEventListener('load', function() {
    // 检查我们是否在历史标签
    const isHistoryTabVisible = document.getElementById('history-content').style.display === 'block';
    
    if (isHistoryTabVisible) {
        initHistoryTab();
    }
});
