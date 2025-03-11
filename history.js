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

// 获取车手缩写
async function getDriverCode(driverId, year) {
    try {
        const response = await F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/drivers/${driverId}.json`);
        if (response && response.MRData && response.MRData.DriverTable && response.MRData.DriverTable.Drivers.length > 0) {
            const code = response.MRData.DriverTable.Drivers[0].code;
            return code || driverId.substring(0, 3).toUpperCase();
        }
        return driverId.substring(0, 3).toUpperCase();
    } catch (error) {
        console.error(`获取车手${driverId}的缩写失败:`, error);
        return driverId.substring(0, 3).toUpperCase();
    }
}

// 获取车手排名
async function getDriverStanding(year, driverId) {
    try {
        const response = await F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/driverStandings.json`);
        
        if (!response || !response.MRData || !response.MRData.StandingsTable || !response.MRData.StandingsTable.StandingsLists || response.MRData.StandingsTable.StandingsLists.length === 0) {
            return "N/A";
        }
        
        const standings = response.MRData.StandingsTable.StandingsLists[0].DriverStandings;
        const driverStanding = standings.find(standing => standing.Driver.driverId === driverId);
        
        if (driverStanding) {
            return driverStanding.position;
        }
        
        return "N/A";
    } catch (error) {
        console.error(`获取${year}年车手${driverId}排名失败:`, error);
        return "N/A";
    }
}

// 获取车手本赛季积分
async function getDriverPoints(year, driverId, commonRaceRounds = null) {
    try {
        console.log(`尝试获取${year}年车手${driverId}的积分...`);
        const response = await F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/driverStandings.json`);
        
        if (!response) {
            console.error(`获取${year}年积分数据失败: API返回为空`);
            return { total: 0, filtered: 0 };
        }
        
        // 获取车手年度总积分
        let totalPoints = 0;
        if (response.MRData && 
            response.MRData.StandingsTable && 
            response.MRData.StandingsTable.StandingsLists && 
            response.MRData.StandingsTable.StandingsLists.length > 0) {
            
            const standings = response.MRData.StandingsTable.StandingsLists[0].DriverStandings;
            const driverStanding = standings.find(standing => standing.Driver.driverId === driverId);
            
            if (driverStanding) {
                totalPoints = parseInt(driverStanding.points);
                console.log(`${year}年车手${driverId}的年度总积分: ${totalPoints}`);
            }
        }
        
        // 如果没有指定共同比赛轮次，返回年度总积分
        if (!commonRaceRounds || commonRaceRounds.length === 0) {
            return { total: totalPoints, filtered: totalPoints };
        }
        
        // 获取指定轮次的积分
        let filteredPoints = 0;
        const raceResults = await Promise.all(
            commonRaceRounds.map(round => 
                F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/results.json`)
            )
        );
        
        // 主要比赛积分
        for (const result of raceResults) {
            if (result && result.MRData && result.MRData.RaceTable && result.MRData.RaceTable.Races) {
                for (const race of result.MRData.RaceTable.Races) {
                    const driverResult = race.Results.find(r => r.Driver.driverId === driverId);
                    if (driverResult && driverResult.points) {
                        filteredPoints += parseFloat(driverResult.points);
                    }
                }
            }
        }
        
        // 冲刺赛积分
        const sprintResults = await Promise.all(
            commonRaceRounds.map(round => 
                F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/${round}/sprint.json`)
            )
        );
        
        for (const result of sprintResults) {
            if (result && result.MRData && result.MRData.RaceTable && result.MRData.RaceTable.Races) {
                for (const race of result.MRData.RaceTable.Races) {
                    if (!race.SprintResults) continue;
                    const driverResult = race.SprintResults.find(r => r.Driver.driverId === driverId);
                    if (driverResult && driverResult.points) {
                        filteredPoints += parseFloat(driverResult.points);
                    }
                }
            }
        }
        
        console.log(`${year}年车手${driverId}在指定${commonRaceRounds.length}个轮次中的积分: ${filteredPoints}`);
        return { total: totalPoints, filtered: Math.round(filteredPoints) };
        
    } catch (error) {
        console.error(`获取${year}年车手${driverId}积分失败:`, error);
        return { total: 0, filtered: 0 };
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
    
    // 获取车手代码
    const driver1Code = await getDriverCode(driver1.id, year);
    const driver2Code = await getDriverCode(driver2.id, year);
    
    // 获取这两位车手共同参加的轮次
    const commonRaceRounds = driverPair.commonRaces;
    
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
    
    // 获取车手积分和排名
    const driver1Points = await getDriverPoints(year, driver1.id, commonRaceRounds);
    const driver2Points = await getDriverPoints(year, driver2.id, commonRaceRounds);
    
    // 获取车手排名
    const driver1Standing = await getDriverStanding(year, driver1.id);
    const driver2Standing = await getDriverStanding(year, driver2.id);
    
    // 计算积分占比
    const totalTeamPoints = driver1Points.filtered + driver2Points.filtered;
    const driver1Percentage = totalTeamPoints > 0 ? Math.round((driver1Points.filtered / totalTeamPoints) * 100) : 0;
    const driver2Percentage = totalTeamPoints > 0 ? Math.round((driver2Points.filtered / totalTeamPoints) * 100) : 0;
    
    // 确定是否需要积分说明工具提示
    const needsPointsTooltip = driver1Points.total !== driver1Points.filtered || 
                              driver2Points.total !== driver2Points.filtered;
    
    const pointsTooltip = needsPointsTooltip ? 
        `该积分仅计算了${driver1Code}与${driver2Code}共同参赛的${commonRaceRounds.length}个轮次` : '';
    
    // 获取实际车队名称
    const actualTeamName = await getActualTeamName(year, actualConstructorId);
    const teamNameDisplay = actualTeamName !== normalizedName ? 
        `${actualTeamName} (${normalizedName})` : actualTeamName;
    
    return {
        year,
        teamNameDisplay,
        driver1: driver1.name,
        driver2: driver2.name,
        driver1Code,
        driver2Code,
        medianGap,
        driver1Wins,
        totalRaces,
        driver1Points: driver1Points.filtered,
        driver2Points: driver2Points.filtered,
        driver1TotalPoints: driver1Points.total,
        driver2TotalPoints: driver2Points.total,
        driver1Standing,
        driver2Standing,
        driver1Percentage,
        driver2Percentage,
        needsPointsTooltip,
        pointsTooltip,
        commonRaceCount: commonRaceRounds.length
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
        .map(data => {
            // 确定排位赛领先方的样式
            const qualiWinner = data.driver1Wins > (data.totalRaces - data.driver1Wins) ? 1 : 
                              data.driver1Wins < (data.totalRaces - data.driver1Wins) ? 2 : 0;
            
            const driver1QualiStyle = qualiWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                   qualiWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            
            const driver2QualiStyle = qualiWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                   qualiWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            
            // 确定积分领先方的样式
            const pointsWinner = data.driver1Points > data.driver2Points ? 1 : 
                              data.driver1Points < data.driver2Points ? 2 : 0;
            
            const driver1PointsStyle = pointsWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                    pointsWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            
            const driver2PointsStyle = pointsWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                    pointsWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            
            // 积分工具提示
            const pointsTooltip = data.needsPointsTooltip ? 
                `title="${data.pointsTooltip}" style="cursor: help; text-decoration: underline dotted;"` : '';
            
            // 确定车手排名领先方
            const standingWinner = parseInt(data.driver1Standing) < parseInt(data.driver2Standing) ? 1 : 
                                parseInt(data.driver1Standing) > parseInt(data.driver2Standing) ? 2 : 0;
            
            const driver1StandingStyle = standingWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                      standingWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            
            const driver2StandingStyle = standingWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                      standingWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                                      
            return `
                <tr>
                    <td>${data.year}</td>
                    <td>${data.teamNameDisplay}</td>
                    <td>${data.driver1 || "N/A"}</td>
                    <td>${data.driver2 || "N/A"}</td>
                    <td>${data.medianGap.toFixed(3)}%</td>
                    <td>
                        <span style="${driver1QualiStyle}">${data.driver1Code}</span> 
                        ${data.driver1Wins} - ${data.totalRaces - data.driver1Wins} 
                        <span style="${driver2QualiStyle}">${data.driver2Code}</span>
                    </td>
                    <td ${pointsTooltip}>
                        <span style="${driver1PointsStyle}">${data.driver1Code}</span> 
                        ${data.driver1Points} - ${data.driver2Points} 
                        <span style="${driver2PointsStyle}">${data.driver2Code}</span>
                        ${data.needsPointsTooltip ? '<sup>*</sup>' : ''}
                    </td>
                    <td>
                        <span style="${driver1StandingStyle}">${data.driver1Code}</span> 
                        ${data.driver1Standing} - ${data.driver2Standing} 
                        <span style="${driver2StandingStyle}">${data.driver2Code}</span>
                    </td>
                    <td>${data.driver1Percentage}% - ${data.driver2Percentage}%</td>
                </tr>
            `;
        });

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
                    <th>车手排名</th>
                    <th>积分占比</th>
                </tr>
                ${tableRows.join('')}
            </table>
            ${allPairsResults.some(r => r && r.needsPointsTooltip) ? 
                '<div class="tooltip-note"><sup>*</sup> 积分仅计算了两位车手共同参赛的轮次</div>' : ''}
        `;
    } else {
        historyTable.innerHTML = `
            ${teamDiscontinuityWarning}
            <div style="text-align: center; padding: 20px;">未找到符合条件的数据</div>
        `;
    }
}

// 在history.js中添加自定义CSS样式
function addCustomStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        .tooltip-note {
            font-size: 0.9em;
            color: #666;
            margin-top: 10px;
            text-align: center;
        }
        
        .history-table th,
        .history-table td {
            padding: 8px 10px;
            text-align: center;
        }
        
        .history-table td:nth-child(3),
        .history-table td:nth-child(4) {
            text-align: left;
        }
    `;
    document.head.appendChild(styleElement);
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
        
        // 添加自定义CSS样式
        addCustomStyles();
        
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
