// 初始化状态标志
window.historyTabInitialized = false;
window.yearTabInitialized = false;

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
    
    // 默认选择 2023 - 2025（如可用），否则回退到最近两年
    const has2023 = Array.from(startYearSelect.options).some(o => o.value === '2023');
    const has2025 = Array.from(endYearSelect.options).some(o => o.value === '2025');
    if (has2023 && has2025) {
        startYearSelect.value = '2023';
        endYearSelect.value = '2025';
    } else if (yearOptions.length >= 2) {
        endYearSelect.value = yearOptions[0]; // 最新年份
        startYearSelect.value = yearOptions[1]; // 次新年份
    }
    
    // 添加事件监听器：当开始年份改变时，自动将结束年份设置为开始年份的下一年
    startYearSelect.addEventListener('change', () => {
        const start = parseInt(startYearSelect.value, 10);
        const desiredEnd = (start + 1).toString();
        const endOptions = Array.from(endYearSelect.options).map(o => o.value);
        if (endOptions.includes(desiredEnd)) {
            endYearSelect.value = desiredEnd;
        } else {
            // 找到比开始年份大的最小可用年份
            const greater = endOptions
                .map(v => parseInt(v, 10))
                .filter(v => v > start)
                .sort((a, b) => a - b);
            if (greater.length > 0) {
                endYearSelect.value = greater[0].toString();
            }
            // 如果没有更大的年份，保持现状
        }
        // 同步更新车队列表（以结束年份为基准）
        updateTeamSelector(endYearSelect.value);
    });
    // 结束年份改变时也更新车队列表
    endYearSelect.addEventListener('change', () => updateTeamSelector(endYearSelect.value));

    // 填充历史标签的车队列表
    await updateTeamSelector(endYearSelect.value);
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

// 驱动程序信息缓存
const driverCache = {
    codes: {},    // 存储车手代码: {year: {driverId: code}}
    standings: {} // 存储车手排名: {year: {driverId: position}}
};

// 暴露历史页缓存的汇总与清空函数，便于排查与手动刷新
window.getHistoryCacheSummary = function() {
    const codeYears = Object.keys(driverCache.codes);
    let codeEntries = 0;
    codeYears.forEach(y => {
        codeEntries += Object.keys(driverCache.codes[y] || {}).length;
    });

    const standingYears = Object.keys(driverCache.standings);
    let standingEntries = 0;
    standingYears.forEach(y => {
        standingEntries += Object.keys(driverCache.standings[y] || {}).length;
    });

    const standingsYearCount = Object.keys(standingsCache || {}).length;
    let standingsDriverTotal = 0;
    Object.values(standingsCache || {}).forEach(map => {
        standingsDriverTotal += Object.keys(map || {}).length;
    });

    const teamNameCache = window.teamNameCache || {};
    const teamNameEntries = Object.keys(teamNameCache).length;

    const summary = {
        driverCodes: { years: codeYears.length, entries: codeEntries },
        driverStandingsRefs: { years: standingYears.length, entries: standingEntries },
        standingsCache: { years: standingsYearCount, driverEntries: standingsDriverTotal },
        teamNameCache: { entries: teamNameEntries }
    };
    console.log('[History Cache] Summary', summary);
    return summary;
};

window.clearHistoryCaches = function() {
    const before = window.getHistoryCacheSummary();
    // 清空 driverCache
    driverCache.codes = {};
    driverCache.standings = {};
    // 清空 standingsCache（年度积分/排名）
    for (const y of Object.keys(standingsCache)) delete standingsCache[y];
    // 清空 teamNameCache（车队显示名缓存）
    if (window.teamNameCache) {
        for (const k of Object.keys(window.teamNameCache)) delete window.teamNameCache[k];
    }
    const after = window.getHistoryCacheSummary();
    console.log('[History Cache] Cleared', { before, after });
    return { before, after };
};

// 获取车手缩写
async function getDriverCode(driverId, year) {
    // 检查缓存
    if (driverCache.codes[year] && driverCache.codes[year][driverId]) {
        F1Utils.debug?.(`[History] Using cached driver code for ${driverId} in ${year}`);
        return driverCache.codes[year][driverId];
    }

    try {
        F1Utils.debug?.(`[History] Fetching driver code for driver ${driverId} in ${year}...`);
        const response = await F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/drivers/${driverId}.json`);

        if (response && response.MRData && response.MRData.DriverTable && response.MRData.DriverTable.Drivers.length > 0) {
            const driver = response.MRData.DriverTable.Drivers[0];
            const code = driver.code;
            F1Utils.debug?.(`[History] Driver info: ${driver.givenName} ${driver.familyName}, Code: ${code || 'N/A'}`);

            // 保存到缓存
            if (!driverCache.codes[year]) driverCache.codes[year] = {};
            driverCache.codes[year][driverId] = code || driverId.substring(0, 3).toUpperCase();

            return driverCache.codes[year][driverId];
        }

        F1Utils.debug?.(`[History] No driver data found for ${driverId}`);
        const defaultCode = driverId.substring(0, 3).toUpperCase();

        // 保存默认代码到缓存
        if (!driverCache.codes[year]) driverCache.codes[year] = {};
        driverCache.codes[year][driverId] = defaultCode;

        return defaultCode;
    } catch (error) {
        console.error(`获取车手${driverId}的缩写失败:`, error);
        return driverId.substring(0, 3).toUpperCase();
    }
}

// 存储每年的车手排名数据，避免重复获取
const standingsCache = {};

// 提前加载单年所有车手排名
async function preloadStandingsForYear(year) {
    // 如果已经加载过，直接返回
    if (standingsCache[year]) {
        return standingsCache[year];
    }

    try {
        F1Utils.debug?.(`[History] Preloading driver standings for ${year}...`);
        const response = await F1Utils.fetchData(`https://api.jolpi.ca/ergast/f1/${year}/driverStandings.json`);

        if (!response || !response.MRData || !response.MRData.StandingsTable || 
            !response.MRData.StandingsTable.StandingsLists || 
            response.MRData.StandingsTable.StandingsLists.length === 0) {
            F1Utils.debug?.(`[History] No standings data available for ${year}`);
            standingsCache[year] = {};
            return standingsCache[year];
        }

        const standings = response.MRData.StandingsTable.StandingsLists[0].DriverStandings;
        F1Utils.debug?.(`[History] Found ${standings.length} drivers in the ${year} standings`);

        // 保存所有车手的排名和积分
        standingsCache[year] = {};

        standings.forEach(standing => {
            const driverId = standing.Driver.driverId;
            standingsCache[year][driverId] = {
                position: standing.position,
                // Use parseFloat to preserve half points and any decimals from sprint formats
                points: parseFloat(standing.points)
            };

            // 同时缓存到驱动程序信息缓存
            if (!driverCache.standings[year]) driverCache.standings[year] = {};
            driverCache.standings[year][driverId] = standing.position;
        });

        return standingsCache[year];
    } catch (error) {
        console.error(`获取${year}年车手排名数据失败:`, error);
        standingsCache[year] = {};
        return standingsCache[year];
    }
}

// 获取车手排名
async function getDriverStanding(year, driverId) {
    // 检查缓存
    if (driverCache.standings[year] && driverCache.standings[year][driverId]) {
        return driverCache.standings[year][driverId];
    }

    // 尝试加载或获取该年份的所有排名
    const yearStandings = await preloadStandingsForYear(year);

    if (yearStandings[driverId]) {
        return yearStandings[driverId].position;
    }

    F1Utils.debug?.(`[History] Driver ${driverId} not found in ${year} standings`);
    return "N/A";
}

// 获取车手本赛季积分
async function getDriverPoints(year, driverId) {
    try {
        // 使用预先加载的排名数据
        const yearStandings = await preloadStandingsForYear(year);

        if (yearStandings[driverId]) {
            const points = yearStandings[driverId].points;
            F1Utils.debug?.(`[History] Using cached season points for ${driverId} in ${year}: ${points}`);
            return points;
        }

        F1Utils.debug?.(`[History] No points data found for driver ${driverId} in ${year}`);
        return 0;
    } catch (error) {
        console.error(`获取${year}年车手${driverId}积分失败:`, error);
        return 0;
    }
}

// 查找给定年份和车队的所有车手对
async function findDriverPairs(year, constructorId) {
    try {
        F1Utils.debug?.(`[History] Finding driver pairs for constructor ${constructorId} in ${year}...`);
        const qualifyingData = await F1Utils.getQualifying(year, constructorId);
        if (!qualifyingData || !qualifyingData.MRData || !qualifyingData.MRData.RaceTable || !qualifyingData.MRData.RaceTable.Races) {
            console.error(`获取${year}年车队${constructorId}的排位赛数据失败`);
            return [];
        }

        F1Utils.debug?.(`[History] Qualifying data found for ${year}. Races: ${qualifyingData.MRData.RaceTable.Races.length}`);

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
                    
                    F1Utils.debug?.(`${year}年发现车手组合: ${driver1.name} vs ${driver2.name}, 共同参赛: ${commonRaces.length}场`);
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
    F1Utils.debug?.(`Processing data for driver pair in ${year} for team ${normalizedName} (ID: ${actualConstructorId})`);

    // 预加载该年份的所有车手排名和积分数据 (在此处进行预加载能有效减少API请求)
    await preloadStandingsForYear(year);

    const data = await F1Utils.getQualifying(year, actualConstructorId);
    if (!data?.MRData.RaceTable.Races.length) {
        console.log(`No qualifying data found for ${normalizedName} in ${year}`);
        return null;
    }

    let timeGaps = [];
    // 为历史图表收集逐场百分比差距数据与明细
    const perRaceDeltas = [];
    let driver1Wins = 0;
    let totalRaces = 0;

    const driver1 = driverPair.driver1;
    const driver2 = driverPair.driver2;

    F1Utils.debug?.(`Analyzing driver pairing: ${driver1.name} vs ${driver2.name} in ${year}`);

    // 获取车手代码 (同时获取两个车手代码)
    F1Utils.debug?.(`Fetching driver codes for comparison...`);
    const [driver1Code, driver2Code] = await Promise.all([
        getDriverCode(driver1.id, year),
        getDriverCode(driver2.id, year)
    ]);

    // 预取该队当季每站正赛结果，用于“实际发车位（grid）”比较
    // grid=0（维修通道发车）视为劣于任何正数发车位
    let gridWins1 = 0;
    let gridMeetings = 0;
    let gridByRound = {};
    try {
        const consRes = await F1Utils.getConstructorResults(year, actualConstructorId);
        const races = consRes?.MRData?.RaceTable?.Races || [];
        for (const rr of races) {
            const round = rr.round;
            const results = rr.Results || [];
            const map = {};
            for (const res of results) {
                const did = res.Driver?.driverId;
                let g = parseInt(res.grid, 10);
                if (!Number.isFinite(g)) g = 100;
                if (g === 0) g = 100; // pit lane start worse than any grid
                map[did] = g;
            }
            gridByRound[round] = map;
        }
    } catch (e) {
        // 失败则保留空映射
        gridByRound = {};
    }

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

            // 记录到逐场数组，供历史图表使用
            // 规范化同一配对在跨年份/不同顺序下的符号方向：
            // 以按代码字母序 (c1-c2) 作为“正方向”，若当前顺序为 (c2-c1) 则取相反数
            try {
                const sortedCodes = [driver1Code, driver2Code].slice().sort((a,b)=>a.localeCompare(b));
                const canonicalKey = `${sortedCodes[0]}-${sortedCodes[1]}`;
                const flip = driver1Code !== sortedCodes[0];
                // 对齐用时到 canonical 方向，便于统一显示
                const t1Canon = flip ? comparison.d2Time : comparison.d1Time;
                const t2Canon = flip ? comparison.d1Time : comparison.d2Time;
                perRaceDeltas.push({
                    year,
                    round: parseInt(race.round, 10),
                    raceName: race.raceName,
                    percent: flip ? -percentageDiff : percentageDiff,
                    pairKey: canonicalKey,
                    d1: sortedCodes[0],
                    d2: sortedCodes[1],
                    sessionUsed: comparison.sessionUsed,
                    d1Time: t1Canon,
                    d2Time: t2Canon,
                    d1Q1: d1Times.Q1 || null,
                    d1Q2: d1Times.Q2 || null,
                    d1Q3: d1Times.Q3 || null,
                    d2Q1: d2Times.Q1 || null,
                    d2Q2: d2Times.Q2 || null,
                    d2Q3: d2Times.Q3 || null
                });
            } catch (_) { /* ignore */ }

            // 如果driver1更快
            if (timeDiff > 0) {
                driver1Wins++;
            }
        }

        // 使用实际发车位（grid）进行“排位赛成绩（true）”统计
        try {
            const grids = gridByRound[race.round];
            if (grids && grids[driver1.id] != null && grids[driver2.id] != null) {
                gridMeetings++;
                const g1 = grids[driver1.id];
                const g2 = grids[driver2.id];
                if (g1 < g2) gridWins1++;
            }
        } catch (e) {
            // 忽略grid统计错误，不影响其他指标
        }
    });

    if (totalRaces === 0) return null;

    // 计算中位数
    const medianGap = F1Utils.calculateMedian(timeGaps);

    // 重新计算积分：仅按两位车手共同参加且同队出战的场次累加积分
    // 而不是使用赛季总积分
    let driver1Points = 0;
    let driver2Points = 0;
    // Hoist context variables so they are always defined even if an exception occurs
    // This prevents ReferenceError at return time when recomputation fails and we fallback
    let includedRounds = [];
    let teamAllRounds = [];
    let teamRoundNames = {};
    let teamSeasonPointsGPPlusSprint = 0;
    // expose detailed per-race accounting and sprint preload status
    let perRaceLog = [];
    let sprintPreloadOk = false;
    let sprintRoundsLoaded = [];
    try {
        // 预加载该赛季的所有冲刺赛结果（一次请求，避免逐站请求导致 429/CORS 报错）
        let sprintRoundsMap = new Map(); // round(string) -> SprintResults[]
        try {
            const seasonSprint = await F1Utils.getSeasonSprintResults(year);
            const sprintRaces = seasonSprint?.MRData?.RaceTable?.Races || [];
            const rounds = [];
            for (const sr of sprintRaces) {
                const rd = String(sr?.round);
                const sResults = sr?.SprintResults || [];
                if (rd) {
                    sprintRoundsMap.set(rd, Array.isArray(sResults) ? sResults : []);
                    rounds.push(rd);
                }
            }
            sprintPreloadOk = true;
            sprintRoundsLoaded = rounds.sort((a,b)=>parseInt(a)-parseInt(b));
            console.log('[History Sprint Preload]', { year, sprintRounds: sprintRoundsLoaded });
        } catch (se) {
            console.warn('[History Sprint Preload] Failed to fetch season sprint list, will skip sprint points to avoid per-round requests', { year, error: String(se) });
            sprintRoundsMap = new Map();
            sprintPreloadOk = false;
            sprintRoundsLoaded = [];
        }

        const consResults = await F1Utils.getConstructorResults(year, actualConstructorId);
        const raceList = consResults?.MRData?.RaceTable?.Races || [];
        // 赛季该车队的全部轮次与总积分（GP+Sprint，仅统计当站该队的两位车手）
        teamAllRounds = [];
        teamRoundNames = {};
        teamSeasonPointsGPPlusSprint = 0;
        for (const rr of raceList) {
            const rd = String(rr.round);
            teamAllRounds.push(rd);
            teamRoundNames[rd] = rr.raceName;
            const res = rr.Results || [];
            // GP 积分：该队当站所有车手（通常两位）的积分之和
            let gpSum = 0;
            const presentIds = [];
            for (const ent of res) {
                const p = parseFloat(ent.points || '0') || 0;
                gpSum += p;
                if (ent.Driver?.driverId) presentIds.push(ent.Driver.driverId);
            }
            // Sprint 积分：仅统计当站属于该队的车手（用GP结果里的车手ID集合来筛选）
            let sprSum = 0;
            const sResults = sprintRoundsMap.get(rd) || [];
            if (Array.isArray(sResults) && sResults.length > 0) {
                for (const s of sResults) {
                    const did = s.Driver?.driverId;
                    if (did && presentIds.includes(did)) {
                        sprSum += (parseFloat(s.points || '0') || 0);
                    }
                }
            }
            teamSeasonPointsGPPlusSprint += gpSum + sprSum;
        }
        // 使用构造商正赛结果来确定“共同出战”的轮次（而非依赖排位共同登场）
        includedRounds = [];
        perRaceLog = [];
        for (const rr of raceList) {
            const rd = String(rr.round);
            const res = rr.Results || [];
            const d1Res = res.find(x => x.Driver?.driverId === driver1.id);
            const d2Res = res.find(x => x.Driver?.driverId === driver2.id);
            if (!d1Res || !d2Res) {
                perRaceLog.push({ round: rd, raceName: rr.raceName, used: false, reason: 'Both drivers not present in constructor results' });
                continue; // 必须两人同场出现在该队结果中
            }
            includedRounds.push(rd);
            const p1 = parseFloat(d1Res.points || '0') || 0;
            const p2 = parseFloat(d2Res.points || '0') || 0;
            driver1Points += p1;
            driver2Points += p2;
            // 冲刺赛积分（如当站存在冲刺赛）
            let sprintInfo = { used: false, reason: 'No sprint classification returned for this round (season sprint list)', d1: { points: 0 }, d2: { points: 0 } };
            const sprintListed = sprintRoundsMap.has(rd);
            let sprintResults = sprintListed ? (sprintRoundsMap.get(rd) || []) : [];
            if (!sprintListed) {
                sprintInfo.reason = 'Round not present in season sprint list (no sprint or API did not include it)';
                // 仅当赛季预加载成功但缺该轮次时，才进行逐站回退；
                // 若赛季预加载失败，为避免请求风暴与429，直接跳过冲刺积分。
                if (sprintPreloadOk) {
                    try {
                        const perRoundSprint = await F1Utils.getSprintResults(year, rd);
                        const prRaces = perRoundSprint?.MRData?.RaceTable?.Races || [];
                        const prRes = prRaces[0]?.SprintResults || [];
                        if (Array.isArray(prRes) && prRes.length > 0) {
                            sprintResults = prRes;
                            sprintInfo.reason = 'Season sprint list missing this round; used per-round fallback';
                            sprintInfo.fallback = true;
                        }
                    } catch (fe) {
                        // keep default sprintInfo.reason; no extra logging to avoid noise
                    }
                }
            }
            if (Array.isArray(sprintResults) && sprintResults.length > 0) {
                const s1 = sprintResults.find(x => x.Driver?.driverId === driver1.id);
                const s2 = sprintResults.find(x => x.Driver?.driverId === driver2.id);
                // capture constructor ids from sprint for diagnostics
                const s1Cons = s1?.Constructor?.constructorId || s1?.Constructor?.name || undefined;
                const s2Cons = s2?.Constructor?.constructorId || s2?.Constructor?.name || undefined;
                // points parsing with explicit NaN tracking
                const rawP1 = (s1 && (s1.points ?? s1.Points ?? '')) + '';
                const rawP2 = (s2 && (s2.points ?? s2.Points ?? '')) + '';
                const p1Parsed = rawP1.trim() === '' ? NaN : parseFloat(rawP1);
                const p2Parsed = rawP2.trim() === '' ? NaN : parseFloat(rawP2);
                const sp1 = Number.isFinite(p1Parsed) ? p1Parsed : 0;
                const sp2 = Number.isFinite(p2Parsed) ? p2Parsed : 0;
                // accumulate
                driver1Points += sp1;
                driver2Points += sp2;
                // reason per driver
                let reason1 = '';
                if (!s1) {
                    reason1 = 'Driver not listed in SprintResults for this round';
                } else if (!Number.isFinite(p1Parsed)) {
                    reason1 = 'Sprint entry has no points field (treated as 0)';
                } else if (sp1 === 0) {
                    const pos1 = s1?.positionText || s1?.position || 'N/A';
                    reason1 = `Finished P${pos1} (no sprint points awarded)`;
                }
                let reason2 = '';
                if (!s2) {
                    reason2 = 'Driver not listed in SprintResults for this round';
                } else if (!Number.isFinite(p2Parsed)) {
                    reason2 = 'Sprint entry has no points field (treated as 0)';
                } else if (sp2 === 0) {
                    const pos2 = s2?.positionText || s2?.position || 'N/A';
                    reason2 = `Finished P${pos2} (no sprint points awarded)`;
                }
                sprintInfo = {
                    used: true,
                    listed: true,
                    d1: { id: driver1.id, points: sp1, positionText: s1?.positionText || s1?.position || 'N/A', status: s1?.status || 'N/A', sprintConstructor: s1Cons, reason: reason1 },
                    d2: { id: driver2.id, points: sp2, positionText: s2?.positionText || s2?.position || 'N/A', status: s2?.status || 'N/A', sprintConstructor: s2Cons, reason: reason2 }
                };
            } else {
                sprintInfo = { used: false, listed: sprintListed, reason: sprintListed ? 'No SprintResults array for this round in season sprint data' : sprintInfo.reason, d1: { points: 0, reason: '' }, d2: { points: 0, reason: '' } };
            }

            perRaceLog.push({
                round: rd,
                raceName: rr.raceName,
                used: true,
                d1: { id: driver1.id, points: p1, positionText: d1Res.positionText, status: d1Res.status },
                d2: { id: driver2.id, points: p2, positionText: d2Res.positionText, status: d2Res.status },
                sprint: sprintInfo
            });
        }
        console.log('[History Pair Points Recalc]', {
            year,
            teamId: actualConstructorId,
            teamName: normalizedName,
            driver1: { id: driver1.id, name: driver1.name },
            driver2: { id: driver2.id, name: driver2.name },
            includedRounds,
            perRaceLog,
            totals: { driver1Points, driver2Points, note: 'Grand Prix points + Sprint points (if applicable) within pair-only rounds' }
        });

        // Add a concise explanation on why pair-only totals may be lower than season totals
        try {
            // Excluded GP rounds (within this constructor's season) where both drivers were not present
            const excluded = perRaceLog.filter(r => !r.used).map(r => ({ round: r.round, reason: r.reason, raceName: r.raceName }));
            // Sprint rounds that are not counted because corresponding GP did not have both drivers
            const sprintRoundsAll = Array.from(sprintRoundsMap.keys());
            const sprintIgnored = sprintRoundsAll.filter(rd => !includedRounds.includes(rd));

            // Full season totals from standings (may include rounds outside pair-only scope)
            const [season1, season2] = await Promise.all([
                getDriverPoints(year, driver1.id),
                getDriverPoints(year, driver2.id)
            ]);

            const diff1 = parseFloat((season1 - driver1Points).toFixed(3));
            const diff2 = parseFloat((season2 - driver2Points).toFixed(3));

            console.log('[History Pair Points Explanation]', {
                rule: 'Pair-only: include rounds where both drivers appear in the constructor GP results. Sprint points are added only for those included rounds.',
                year,
                teamId: actualConstructorId,
                includedRounds,
                excludedRounds: excluded,
                sprintIgnoredRounds: sprintIgnored,
                pairOnlyTotals: { driver1: driver1Points, driver2: driver2Points },
                seasonTotals: { driver1: season1, driver2: season2 },
                differences: { driver1: diff1, driver2: diff2 },
                note: 'If a driver raced solo in some GPs (or only one driver appeared in GP while both may have appeared in Sprint), those rounds are excluded by design, so pair-only totals can be lower than full-season totals.'
            });
        } catch (e) {
            console.warn('[History Pair Points Explanation] Failed to compute explanation details', e);
        }
    } catch (e) {
        console.warn('[History Pair Points Recalc] Pair-only recomputation failed, fallback to season totals', {
            year,
            teamId: actualConstructorId,
            teamName: normalizedName,
            driver1: { id: driver1.id, name: driver1.name },
            driver2: { id: driver2.id, name: driver2.name },
            error: String(e)
        });
        // 回退：使用赛季总积分
        driver1Points = await getDriverPoints(year, driver1.id);
        driver2Points = await getDriverPoints(year, driver2.id);
        console.log('[History Pair Points Fallback Totals]', {
            year,
            driver1: { id: driver1.id, name: driver1.name, seasonPoints: driver1Points },
            driver2: { id: driver2.id, name: driver2.name, seasonPoints: driver2Points },
            note: 'Using full-season driver standings points due to recomputation failure.'
        });
    }
    const driver1Standing = await getDriverStanding(year, driver1.id);
    const driver2Standing = await getDriverStanding(year, driver2.id);

    // 计算积分占比
    const totalTeamPoints = driver1Points + driver2Points;
    const driver1Percentage = totalTeamPoints > 0 ? Math.round((driver1Points / totalTeamPoints) * 100) : 0;
    const driver2Percentage = totalTeamPoints > 0 ? Math.round((driver2Points / totalTeamPoints) * 100) : 0;

    // 使用缓存数据获取实际车队名称
    let actualTeamName = normalizedName;
    const teamNameCache = window.teamNameCache || (window.teamNameCache = {});
    const cacheKey = `${year}-${actualConstructorId}`;

    if (teamNameCache[cacheKey]) {
        actualTeamName = teamNameCache[cacheKey];
    } else {
        actualTeamName = await getActualTeamName(year, actualConstructorId);
        teamNameCache[cacheKey] = actualTeamName;
    }

    const teamNameDisplay = actualTeamName !== normalizedName ? 
        `${actualTeamName} (${normalizedName})` : actualTeamName;
    
    // 赛季WDC总积分（与是否同场无关）
    let seasonPoints1 = 0;
    let seasonPoints2 = 0;
    try {
        const sp = await preloadStandingsForYear(year);
        seasonPoints1 = parseFloat(sp?.[driver1.id]?.points ?? '0') || 0;
        seasonPoints2 = parseFloat(sp?.[driver2.id]?.points ?? '0') || 0;
    } catch (e) {
        // 兜底
        seasonPoints1 = await getDriverPoints(year, driver1.id);
        seasonPoints2 = await getDriverPoints(year, driver2.id);
    }
    
    return {
        year,
        teamNameDisplay,
        driver1: driver1.name,
        driver2: driver2.name,
        driver1Id: driver1.id,
        driver2Id: driver2.id,
        driver1Code,
        driver2Code,
        medianGap,
        driver1Wins,
        totalRaces,
        // 真实发车位比较（true qualifying）
        gridWins1,
        gridMeetings,
        driver1Points,
        driver2Points,
        driver1Standing,
        driver2Standing,
        driver1Percentage,
        driver2Percentage,
        seasonPoints1,
        seasonPoints2,
        // 历史图表：逐场%差距
        perRaceDeltas,
        // 附加：用于赛季分拆配对说明的上下文数据
        includedRounds,
        teamAllRounds,
        teamRoundNames,
        teamSeasonPointsGPPlusSprint,
        // 明细：逐站积分与冲刺加载状态
        perRaceLog,
        sprintPreloadOk,
        sprintRoundsLoaded
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

    // 检查范围是否过大
    if (endYear - startYear > 5) {
        const proceed = confirm(`您选择了${endYear - startYear + 1}年的时间范围，这可能会导致大量API请求。\n\n建议选择较小的范围以避免API限制。\n\n是否仍要继续？`);
        if (!proceed) return;
    }

    // 显示加载状态 - 使用现代加载动画
    const historyTable = document.getElementById('historyTable');
    historyTable.innerHTML = `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">加载中...请耐心等待</div>
            <div class="loading-subtitle">正在处理${startYear}至${endYear}年数据</div>
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
    
    // 处理所有年份数据 - 可中断并恢复
    const allPairsResults = [];
    // 监听请求错误，用于在非致命失败（被内部 try/catch 吃掉）时也提示“数据不完整”
    let hadRequestErrors = false;
    let unsubscribeError = null;
    try {
        if (window.F1RequestEvents && typeof window.F1RequestEvents.on === 'function') {
            unsubscribeError = window.F1RequestEvents.on('error', () => { hadRequestErrors = true; });
        }
    } catch(_) {}

    const updateLoadingStatus = (year) => {
        const loadingText = historyTable.querySelector('.loading-subtitle');
        if (loadingText) loadingText.textContent = `正在处理${year}年数据...`;
    };

    const partialRender = () => {
        // 渲染当前已获得的数据，简化：仅渲染表格，不渲染说明块，以确保快速反馈
        const rows = allPairsResults
            .filter(result => result !== null)
            .map(data => {
                const qualiWinner = data.driver1Wins > (data.totalRaces - data.driver1Wins) ? 1 : 
                                  data.driver1Wins < (data.totalRaces - data.driver1Wins) ? 2 : 0;
                const driver1QualiStyle = qualiWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                       qualiWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                const driver2QualiStyle = qualiWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                       qualiWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                const pointsWinner = data.driver1Points > data.driver2Points ? 1 : 
                                  data.driver1Points < data.driver2Points ? 2 : 0;
                const driver1PointsStyle = pointsWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                        pointsWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                const driver2PointsStyle = pointsWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                        pointsWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                const standingWinner = parseInt(data.driver1Standing) < parseInt(data.driver2Standing) ? 1 : 
                                    parseInt(data.driver1Standing) > parseInt(data.driver2Standing) ? 2 : 0;
                const driver1StandingStyle = standingWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                          standingWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                const driver2StandingStyle = standingWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                          standingWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                return `<tr><td>${data.year}</td><td>${data.teamNameDisplay}</td><td>${data.driver1 || "N/A"}</td><td>${data.driver2 || "N/A"}</td><td>${data.medianGap.toFixed(3)}%</td><td><span style="${driver1QualiStyle}">${data.driver1Code}</span> ${data.driver1Wins} - ${data.totalRaces - data.driver1Wins} <span style="${driver2QualiStyle}">${data.driver2Code}</span></td><td><span style="${driver1PointsStyle}">${data.driver1Code}</span> ${data.driver1Points} - ${data.driver2Points} <span style="${driver2PointsStyle}">${data.driver2Code}</span></td><td><span style="font-weight:bold;">${data.driver1Code}</span> ${data.seasonPoints1} - ${data.seasonPoints2} <span style="font-weight:bold;">${data.driver2Code}</span></td><td><span style="${driver1StandingStyle}">${data.driver1Code}</span> ${data.driver1Standing} - ${data.driver2Standing} <span style="${driver2StandingStyle}">${data.driver2Code}</span></td><td>${data.driver1Percentage}% - ${data.driver2Percentage}%</td></tr>`;
            });
        const header = `
            ${teamDiscontinuityWarning}
            <div class="warning-message" style="background-color:#fff3cd;color:#856404;padding:10px;margin:10px 0;border-radius:4px;text-align:center;">
                <strong>数据不完整</strong>：由于网络/CORS/限流等原因，部分赛季/分站未能获取成功。您可以点击右下角或下方的“继续获取”以接着上次位置继续。
                <button id="historyInlineResumeBtn" class="selector" style="margin-left:8px;">继续获取</button>
            </div>`;
        historyTable.innerHTML = `
            ${header}
            <table class="history-table">
                <tr>
                    <th>年份</th>
                    <th>车队</th>
                    <th>车手 1</th>
                    <th>车手 2</th>
                    <th>中位数差距 %</th>
                    <th>排位赛成绩</th>
                    <th>共同参赛积分 (GP+Sprint)</th>
                    <th>赛季总积分 (WDC)</th>
                    <th>车手排名</th>
                    <th>积分占比</th>
                </tr>
                ${rows.join('')}
            </table>`;
    };

    const showPartialNotice = (msg) => {
        const notice = document.getElementById('partialNotice');
        const msgEl = document.getElementById('partialNoticeMsg');
        if (notice) {
            if (msgEl && msg) msgEl.textContent = msg;
            notice.style.display = 'flex';
        }
    };

    const processFromYear = async (startY) => {
        for (let year = startY; year <= endYear; year++) {
            updateLoadingStatus(year);
            const actualConstructorId = mappedConstructorIds[year];
            if (!actualConstructorId) {
                console.warn('[History] Skipping year without mapped constructor for selected team', { year, selectedTeam: normalizedName });
                continue;
            }
            try {
                const driverPairs = await findDriverPairs(year, actualConstructorId);
                for (const pair of driverPairs) {
                    const result = await processDriverPairData(year, actualConstructorId, normalizedName, pair);
                    if (result) allPairsResults.push(result);
                }
            } catch (e) {
                console.warn(`查找${year}年车队${normalizedName}的车手对失败:`, e);
                // 渲染当前已获取数据并提示可继续
                partialRender();
                const reason = e && (e.code === 'RATE_LIMIT' || e.code === 'NETWORK_ERROR' || e.code === 'HTTP_ERROR')
                    ? `原因：${e.code === 'RATE_LIMIT' ? '请求过于频繁(429)' : (e.code === 'NETWORK_ERROR' ? '网络/CORS问题' : 'HTTP错误')}`
                    : '';
                showPartialNotice(`数据不完整：停在 ${year} 年。${reason} 点击“继续获取”将从${year}年继续。`);
                // 暴露恢复函数
                window.historyResumeFn = async () => {
                    try {
                        // 继续从当前年重新尝试
                        await processFromYear(year);
                        // 成功后隐藏提示
                        const notice = document.getElementById('partialNotice');
                        if (notice) notice.style.display = 'none';
                    } catch (err2) {
                        // 若再次失败，仍保留resume入口
                        console.warn('恢复过程中出错', err2);
                        partialRender();
                        showPartialNotice(`继续获取时仍遇到错误。您可以再次点击重试。`);
                    }
                };
                return; // 提前结束，等待用户点击继续
            }
        }
        // 全部完成，继续原有渲染流程（下方已有完整渲染逻辑）
        try {
            // 所有年份成功处理完毕，清除恢复函数并显示“数据已完整”提示（可自动消失）
            window.historyResumeFn = null;
            const notice = document.getElementById('partialNotice');
            if (notice) notice.style.display = 'none';
            if (hadRequestErrors) {
                // 有非致命失败：提示“数据不完整，可继续获取”，并提供重试逻辑
                const historyTableEl = document.getElementById('historyTable');
                const warn = document.createElement('div');
                warn.className = 'loading-text';
                warn.style.cssText = 'text-align:center;background:#fff3cd;color:#856404;padding:8px;border-radius:4px;max-width:1100px;margin:6px auto;';
                warn.innerHTML = '部分数据由于网络/CORS/限流未能获取完整。您可以点击右下角或下方的“继续获取”以补拉失败的数据。 <button id="historyInlineResumeBtn" class="selector" style="margin-left:8px;">继续获取</button>';
                if (historyTableEl) historyTableEl.prepend(warn);
                window.historyResumeFn = async () => {
                    try {
                        // 仅重试失败的 URL，然后整体重渲染，以利用缓存合并数据
                        await F1Utils.retryFailedRequests();
                        if (notice) notice.style.display = 'none';
                        // 重新运行以刷新表格
                        await showHistoryResults();
                    } catch (e) {
                        console.warn('重试失败', e);
                    }
                };
                // 同时展示悬浮提示
                const msg = document.getElementById('partialNoticeMsg');
                if (notice && msg) {
                    msg.textContent = '部分数据获取失败。点击“继续获取”以补拉并刷新结果。';
                    notice.style.display = 'flex';
                }
            } else {
                // 在历史表格上方添加一个成功提示，2.5秒后自动移除
                const ok = document.createElement('div');
                ok.className = 'loading-text';
                ok.style.cssText = 'text-align:center;background:#e8f5e9;color:#1b5e20;padding:8px;border-radius:4px;max-width:1100px;margin:6px auto;';
                ok.textContent = '数据已完整';
                const host = document.getElementById('historyTable');
                if (host) host.prepend(ok);
                setTimeout(() => { try { ok.remove(); } catch(_){} }, 2500);
            }
        } catch(_) {}
    };

    // 开始处理
    await processFromYear(startYear);
    // 取消事件订阅，避免泄漏
    try { if (typeof unsubscribeError === 'function') unsubscribeError(); } catch(_) {}
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
            
            // 确定车手排名领先方
            const standingWinner = parseInt(data.driver1Standing) < parseInt(data.driver2Standing) ? 1 : 
                                parseInt(data.driver1Standing) > parseInt(data.driver2Standing) ? 2 : 0;
            
            const driver1StandingStyle = standingWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                      standingWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            
            const driver2StandingStyle = standingWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                      standingWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
                                      
            return `<tr><td>${data.year}</td><td>${data.teamNameDisplay}</td><td>${data.driver1 || "N/A"}</td><td>${data.driver2 || "N/A"}</td><td>${data.medianGap.toFixed(3)}%</td><td><span style="${driver1QualiStyle}">${data.driver1Code}</span> ${data.driver1Wins} - ${data.totalRaces - data.driver1Wins} <span style="${driver2QualiStyle}">${data.driver2Code}</span></td><td><span style="${driver1PointsStyle}">${data.driver1Code}</span> ${data.driver1Points} - ${data.driver2Points} <span style="${driver2PointsStyle}">${data.driver2Code}</span></td><td><span style="font-weight:bold;">${data.driver1Code}</span> ${data.seasonPoints1} - ${data.seasonPoints2} <span style="font-weight:bold;">${data.driver2Code}</span></td><td><span style="${driver1StandingStyle}">${data.driver1Code}</span> ${data.driver1Standing} - ${data.driver2Standing} <span style="${driver2StandingStyle}">${data.driver2Code}</span></td><td>${data.driver1Percentage}% - ${data.driver2Percentage}%</td></tr>`;
        });

    // 当同一年存在多个队友组合行时，如两行积分相加仍小于当年WDC冠军积分，则输出被排除轮次说明
    // 除了控制台日志外，这里还会构建可见的说明块插入到页面中
    let pairSplitExplainHtml = '';
    try {
        // 按年份分组（所选同一支标准化车队）
        const byYear = new Map();
        for (const r of allPairsResults) {
            if (!r) continue;
            if (!byYear.has(r.year)) byYear.set(r.year, []);
            byYear.get(r.year).push(r);
        }

        for (const [yr, list] of byYear.entries()) {
            if (!Array.isArray(list) || list.length < 2) continue; // 只有多个组合时才检查

            // 计算该年“配对仅计”团队积分总和（各行 driver1+driver2 相加）
            const pairOnlyTeamPoints = list.reduce((sum, it) => sum + (parseFloat(it.driver1Points)||0) + (parseFloat(it.driver2Points)||0), 0);

            // 当年WDC冠军积分
            const std = await preloadStandingsForYear(yr);
            let championPoints = 0;
            let championId = null;
            Object.entries(std || {}).forEach(([did, v]) => {
                if (!championId || parseInt(v.position,10) < parseInt(std[championId].position,10)) {
                    championId = did;
                }
            });
            if (championId) championPoints = parseFloat(std[championId].points)||0;

            if (pairOnlyTeamPoints < championPoints) {
                // 组合同年所有 includedRounds 的并集，与该队赛季全部轮次比对
                const unionIncluded = new Set();
                list.forEach(it => (it.includedRounds||[]).forEach(rd => unionIncluded.add(String(rd))));
                // teamAllRounds/Names 取任意一行
                const any = list[0];
                const allRounds = (any.teamAllRounds||[]).map(String);
                const names = any.teamRoundNames || {};
                const excluded = allRounds.filter(rd => !unionIncluded.has(String(rd)));
                const excludedDetail = excluded.map(rd => ({ round: rd, raceName: names[rd] || 'N/A' }));

                console.log('[History Season Pair Split Explanation]', {
                    year: yr,
                    team: normalizedName,
                    pairRows: list.length,
                    pairOnlyTeamPoints,
                    seasonChampionPoints: championPoints,
                    includedRounds: Array.from(unionIncluded).sort((a,b)=>parseInt(a)-parseInt(b)),
                    teamAllRounds: allRounds.sort((a,b)=>parseInt(a)-parseInt(b)),
                    excludedRounds: excludedDetail,
                    note: '配对仅计的两行积分与当年WDC冠军积分对比，若不足，则列出未计入的该队轮次（原因：当站两位被比较车手未同时为该队出战）。'
                });

                // 构建页面可见的说明块
                const excludedListHtml = excludedDetail.length
                    ? `<ul style="margin:6px 0 0 0; padding-left:18px; text-align:left;">${excludedDetail
                        .map(item => `<li>第 ${item.round} 站：${item.raceName}</li>`)
                        .join('')}</ul>`
                    : `<div style="margin-top:6px;">无被排除的轮次</div>`;

                pairSplitExplainHtml += `
                    <div class="warning-message" style="background-color:#e8f4ff;color:#0b5394;padding:10px;margin:10px 0;border-radius:4px;text-align:center;">
                        <div><strong>说明：</strong>${yr} 年，所选车队的多个队友组合共同参赛积分总和（${pairOnlyTeamPoints}）低于当年车手冠军积分（${championPoints}）。以下轮次未计入（两位被比较车手未同时为该队出战）：</div>
                        ${excludedListHtml}
                    </div>
                `;
            }
        }
    } catch (e) {
        console.warn('[History Season Pair Split Explanation] Failed to compute', e);
    }

    // 针对每一行：如果共同参赛积分与赛季总积分不一致，输出明确的UI说明（含被排除轮次清单）
    let pairMismatchExplainHtml = '';
    try {
        const items = [];
        for (const r of allPairsResults) {
            if (!r) continue;
            const d1Mismatch = Math.abs((r.seasonPoints1 || 0) - (r.driver1Points || 0)) > 1e-6;
            const d2Mismatch = Math.abs((r.seasonPoints2 || 0) - (r.driver2Points || 0)) > 1e-6;
            if (!d1Mismatch && !d2Mismatch) continue;
            const allRounds = (r.teamAllRounds || []).map(String);
            const included = new Set((r.includedRounds || []).map(String));
            const excluded = allRounds.filter(x => !included.has(x));
            const excludedList = excluded.map(rd => `<li>第 ${rd} 站：${(r.teamRoundNames||{})[rd] || 'N/A'}</li>`).join('');
            const exHtml = excluded.length ? `<ul style="margin:6px 0 0 18px; text-align:left;">${excludedList}</ul>` : `<div style="margin-top:6px;">无被排除轮次</div>`;
            // Build per-race accounting details for transparency
            const details = Array.isArray(r.perRaceLog) ? r.perRaceLog.filter(x=>x.used).sort((a,b)=>parseInt(a.round)-parseInt(b.round)) : [];
            const detailHtml = details.length ? `<table style="margin:6px 0; width:100%; max-width:1000px; background:#fff; border:1px solid #eee;">
                    <tr style="background:#f0f7ff;"><th style="padding:4px 6px;">轮次</th><th style="padding:4px 6px;">分站</th><th style="padding:4px 6px;">${r.driver1Code} 积分</th><th style="padding:4px 6px;">${r.driver2Code} 积分</th></tr>
                    ${details.map(d => {
                        const gp1 = (d?.d1?.points ?? 0); const gp2 = (d?.d2?.points ?? 0);
                        const sp1 = (d?.sprint?.used ? (d?.sprint?.d1?.points ?? 0) : 0);
                        const sp2 = (d?.sprint?.used ? (d?.sprint?.d2?.points ?? 0) : 0);
                        const tot1 = (gp1 + sp1).toFixed(1).replace(/\.0$/,'');
                        const tot2 = (gp2 + sp2).toFixed(1).replace(/\.0$/,'');
                        const gp1s = Number(gp1).toFixed(1).replace(/\.0$/,'');
                        const gp2s = Number(gp2).toFixed(1).replace(/\.0$/,'');
                        const sp1s = Number(sp1).toFixed(1).replace(/\.0$/,'');
                        const sp2s = Number(sp2).toFixed(1).replace(/\.0$/,'');
                        const s1Reason = d?.sprint?.d1?.reason ? ` <span style="color:#8a6d3b;">(${d.sprint.d1.reason})</span>` : '';
                        const s2Reason = d?.sprint?.d2?.reason ? ` <span style="color:#8a6d3b;">(${d.sprint.d2.reason})</span>` : '';
                        return `<tr>
                            <td style="text-align:center;padding:4px 6px;">${d.round}</td>
                            <td style="text-align:left;padding:4px 6px;">${d.raceName}</td>
                            <td style="text-align:center;padding:4px 6px;">GP ${gp1s} + Sprint ${sp1s}${s1Reason} = <strong>${tot1}</strong></td>
                            <td style="text-align:center;padding:4px 6px;">GP ${gp2s} + Sprint ${sp2s}${s2Reason} = <strong>${tot2}</strong></td>
                        </tr>`;
                    }).join('')}
                </table>` : '<div style="margin-top:6px;">无逐站明细</div>';
            // If no excluded rounds but totals mismatch, and sprint preload failed, state it explicitly
            const sprintNote = (!excluded.length && (d1Mismatch || d2Mismatch) && r.sprintPreloadOk === false)
                ? `<div style="margin-top:6px;color:#b85e00;">提示：该赛季冲刺赛数据未能加载（可能因速率限制/CORS）。因此本行未计入冲刺积分，导致与赛季总积分不一致。可尝试“清空缓存”后重试。</div>`
                : '';
            const rowHtml = `
                <li style="margin:6px 0; text-align:left;">
                    <strong>${r.year}</strong> 年 <strong>${r.teamNameDisplay}</strong>：
                    <span style="font-weight:bold;">${r.driver1Code}</span> 共同参赛积分 ${r.driver1Points} vs 赛季总积分 ${r.seasonPoints1}${d1Mismatch ? '（不一致）' : '（一致）'}；
                    <span style="font-weight:bold; margin-left:8px;">${r.driver2Code}</span> 共同参赛积分 ${r.driver2Points} vs 赛季总积分 ${r.seasonPoints2}${d2Mismatch ? '（不一致）' : '（一致）'}。
                    <div style="margin-top:4px;">原因：共同参赛积分仅统计两位被比较车手<strong>同时为该队出战</strong>的分站（GP+Sprint）。以下分站未计入：</div>
                    ${exHtml}
                    <div style="margin-top:6px;">逐站计分明细（GP+Sprint）：</div>
                    ${detailHtml}
                    ${sprintNote}
                </li>`;
            items.push(rowHtml);
        }
        if (items.length) {
            pairMismatchExplainHtml = `
                <div class="warning-message" style="background-color:#fff6e5;color:#6a4d00;padding:10px;margin:10px 0;border-radius:4px;text-align:center;">
                    <div><strong>积分差异说明：</strong>下列组合的“共同参赛积分”与其赛季WDC总积分不一致。原因与被排除的分站如下：</div>
                    <ul style="list-style:disc; margin:8px auto 0 auto; max-width:1000px; text-align:left;">${items.join('')}</ul>
                </div>`;
        }
    } catch (e) {
        console.warn('[History Pair Mismatch Explanation] Failed to build UI block', e);
    }

    // 进一步：当同一年存在多个配对行时，统计每位车手在该队的“配对仅计”积分总和，并与其WDC赛季积分对比，给出原因说明
    let perDriverYearExplainHtml = '';
    try {
        const byYear = new Map();
        for (const r of allPairsResults) {
            if (!r) continue;
            if (!byYear.has(r.year)) byYear.set(r.year, []);
            byYear.get(r.year).push(r);
        }
        const blocks = [];
        for (const [yr, list] of byYear.entries()) {
            if (list.length < 2) continue; // 仅当年有多个组合时触发
            // 聚合每位车手
            const agg = new Map(); // driverId -> { code, pairOnlySum, seasonPoints, names: Set, rows: [], includedUnion: Set, sprintOkAll }
            for (const row of list) {
                const upd = (id, code, pts, season) => {
                    if (!agg.has(id)) agg.set(id, { code, pairOnlySum: 0, seasonPoints: season, names: new Set(), rows: [], includedUnion: new Set(), sprintOkAll: true });
                    const obj = agg.get(id);
                    obj.pairOnlySum += (pts || 0);
                    obj.rows.push(row);
                    (row.includedRounds||[]).forEach(rd => obj.includedUnion.add(String(rd)));
                    obj.sprintOkAll = obj.sprintOkAll && (row.sprintPreloadOk !== false);
                };
                upd(row.driver1Id, row.driver1Code, row.driver1Points, row.seasonPoints1);
                upd(row.driver2Id, row.driver2Code, row.driver2Points, row.seasonPoints2);
            }
            const entries = Array.from(agg.entries()).map(([did, v]) => {
                const diff = Number((v.seasonPoints - v.pairOnlySum).toFixed(3));
                const unionRounds = Array.from(v.includedUnion).sort((a,b)=>parseInt(a)-parseInt(b));
                // Note: 若 union 覆盖了该队全部轮次且仍不等，通常是该车手在其它车队也获得了积分（WDC统计为全年）。
                const any = list[0];
                const allRounds = (any.teamAllRounds||[]).map(String).sort((a,b)=>parseInt(a)-parseInt(b));
                const missingTeamRounds = allRounds.filter(x => !v.includedUnion.has(String(x)));
                let reason = '';
                if (missingTeamRounds.length === 0 && Math.abs(diff) > 1e-6 && !v.sprintOkAll) {
                    reason = '该年冲刺赛数据未加载成功，导致配对仅计未包含冲刺积分。';
                } else if (missingTeamRounds.length === 0 && Math.abs(diff) > 1e-6) {
                    reason = '差异来自该车手在其它车队/场次获得的积分（WDC为全年总分），当前页面仅统计所选车队内与队友共同参赛的场次（GP+Sprint）。';
                } else if (missingTeamRounds.length > 0) {
                    reason = '部分该队轮次未被计入（两位比较对象未同时为该队出战），详见上方“被排除轮次”。';
                }
                return `<li>车手 ${v.code}：共同参赛积分合计 ${v.pairOnlySum}，赛季总积分 ${v.seasonPoints}，差值 ${diff}${reason ? `。原因：${reason}` : ''}</li>`;
            });
            if (entries.length) {
                blocks.push(`
                    <div class="warning-message" style="background-color:#eef9f0;color:#1b5e20;padding:10px;margin:10px 0;border-radius:4px;text-align:center;">
                        <div><strong>${yr} 年同队多组合校验：</strong>将同一车手在该队的多行“共同参赛积分”相加，与其WDC赛季积分对比：</div>
                        <ul style="list-style:disc; margin:8px auto 0 auto; max-width:1000px; text-align:left;">${entries.join('')}</ul>
                    </div>
                `);
            }
        }
        perDriverYearExplainHtml = blocks.join('');
    } catch (e) {
        console.warn('[History Per-Driver Year Explanation] Failed', e);
    }

    // 显示结果或无数据消息
    if (tableRows.length > 0) {
        // 在最终渲染前准备历史图表需要的数据
        let allDeltas = [];
        let pairKeys = new Set();
        for (const r of allPairsResults) {
            if (!r || !Array.isArray(r.perRaceDeltas)) continue;
            r.perRaceDeltas.forEach(p => {
                allDeltas.push(p);
                pairKeys.add(p.pairKey);
            });
        }
        // 若存在跨多配对的“持续在场”车手，则将其固定为正方向（Driver A）
        let persistentCode = null;
        try {
            if (pairKeys.size > 1) {
                const keys = Array.from(pairKeys);
                const first = keys[0].split('-');
                const appearsInAll = (code) => keys.every(k => k.split('-').includes(code));
                const candidates = first.filter(c => appearsInAll(c));
                if (candidates.length === 1) persistentCode = candidates[0];
            }
        } catch (e) { /* ignore */ }
        if (persistentCode) {
            allDeltas = allDeltas.map(p => {
                if (p.d1 === persistentCode) return p;
                if (p.d2 === persistentCode) {
                    const flipped = { ...p };
                    flipped.percent = -p.percent;
                    // 确保 d1 为持续车手，交换用时
                    flipped.d1 = p.d2;
                    flipped.d2 = p.d1;
                    const t1 = p.d1Time, t2 = p.d2Time;
                    flipped.d1Time = t2; flipped.d2Time = t1;
                    return flipped;
                }
                return p;
            });
        }
        // 按时间顺序排序（年升序，轮次升序）
        allDeltas.sort((a,b)=> (a.year - b.year) || (a.round - b.round));
        // 构建图表点 [序号, 百分比]
        const historyChartPoints = allDeltas.map((p, idx) => [idx + 1, p.percent]);

        // 选择图表的两侧名称：若只有一个配对，用其姓名；否则使用通用文案
        let chartD1Name = 'Driver A';
        let chartD2Name = 'Driver B';
        if (persistentCode) {
            // 使用持续车手名称作为 Driver A
            const codeToName = new Map();
            for (const r of allPairsResults) {
                if (!r) continue;
                codeToName.set(r.driver1Code, r.driver1 || r.driver1Code);
                codeToName.set(r.driver2Code, r.driver2 || r.driver2Code);
            }
            chartD1Name = codeToName.get(persistentCode) || persistentCode;
            chartD2Name = '对手';
        } else if (pairKeys.size === 1) {
            // 使用 canonical 方向（按代码字母序）对应的姓名，确保正负含义与轴标签一致
            const onlyKey = Array.from(pairKeys)[0];
            const [codeA, codeB] = onlyKey.split('-');
            const codeToName = new Map();
            for (const r of allPairsResults) {
                if (!r) continue;
                codeToName.set(r.driver1Code, r.driver1 || r.driver1Code);
                codeToName.set(r.driver2Code, r.driver2 || r.driver2Code);
            }
            chartD1Name = codeToName.get(codeA) || codeA || 'Driver A';
            chartD2Name = codeToName.get(codeB) || codeB || 'Driver B';
        } else {
            // 混合配对，提示用户符号解释仅对相同配对一致
            chartD1Name = 'Mixed pairs – left faster';
            chartD2Name = 'Mixed pairs – right faster';
        }

        // Explanation wrapper: centered and collapsible (default visible)
        const explainWrapped = (pairMismatchExplainHtml || pairSplitExplainHtml || perDriverYearExplainHtml)
            ? `
            <div id="pointsExplainWrapper" style="max-width:1100px;margin:0 auto 10px auto;text-align:center;">
                <button id="togglePointsExplainBtn" class="selector" style="margin-bottom:8px;display:inline-block;">折叠/展开 积分差异说明</button>
                <div id="pointsExplainContent" style="margin:0 auto;">
                    ${pairMismatchExplainHtml || ''}
                    ${pairSplitExplainHtml || ''}
                    ${perDriverYearExplainHtml || ''}
                </div>
            </div>`
            : '';

        historyTable.innerHTML = `
            ${teamDiscontinuityWarning}
            ${explainWrapped}
            <table class="history-table">
                <tr>
                    <th>年份</th>
                    <th>车队</th>
                    <th>车手 1</th>
                    <th>车手 2</th>
                    <th>中位数差距 %</th>
                    <th>排位赛成绩</th>
                    <th>共同参赛积分 (GP+Sprint)</th>
                    <th>赛季总积分 (WDC)</th>
                    <th>车手排名</th>
                    <th>积分占比</th>
                </tr>
                ${tableRows.join('')}
            </table>
            <div class="graph-container" id="historyGraphContainer"></div>
            <div class="graph-details" id="historyGraphDetails" style="max-width:1700px;margin:10px auto 0 auto;">
                ${persistentCode ? `<div style="text-align:center;margin:6px 0 2px 0;color:#333;">当前固定方向：<strong>Driver A = ${chartD1Name}</strong>，<strong>Driver B = 对手</strong>；图中正值表示 <strong>${chartD1Name}</strong> 更快。</div>` : ''}
                <div style="text-align:center;">
                    <button id="toggleDetailTableBtn" class="selector" style="margin-bottom:10px;">显示明细表</button>
                </div>
                <div id="detailTableWrapper" style="display:none; margin:0 auto; overflow-x:auto;">
                    <table class="history-table" id="detailPointsTable" style="min-width:1600px;">
                        <thead>
                            <tr>
                                <th>年份</th>
                                <th>年内第几场</th>
                                <th>Race</th>
                                <th>比赛名称</th>
                                <th>车手 1</th>
                                <th>车手 2</th>
                                <th>${chartD1Name}</th>
                                <th>${chartD2Name}</th>
                                <th>Delta %</th>
                                <th>Session</th>
                                <th>
                                    选择
                                    <button id="detailSelectAllBtn" class="selector" style="margin-left:6px;">全选</button>
                                    <span class="help-hint" title="取消勾选将从图表中移除该点；超阈值点会以徽标提示，可手动重新纳入">?</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody id="detailPointsTbody"></tbody>
                    </table>
                    <div id="singlePairSummary" style="display:none;text-align:center;margin:12px auto;max-width:900px;"></div>
                </div>
            </div>
        `;

        // 渲染图表（与排位赛对比同一套组件）
        try {
            const graphDiv = document.getElementById('historyGraphContainer');
            if (graphDiv && Array.isArray(historyChartPoints) && historyChartPoints.length) {
                const controller = QualifyingTrendGraph(graphDiv, historyChartPoints, chartD1Name, chartD2Name);
                if (pairKeys.size > 1) {
                    // 附加说明（非必需），提醒混合配对的正负符号含义
                    const note = document.createElement('div');
                    note.className = 'loading-subtitle';
                    note.style.textAlign = 'center';
                    note.style.marginTop = '6px';
                    note.textContent = '提示：多配对混合展示时，正负号仅在同一配对内含义一致；跨配对比较主要关注数值大小和趋势。';
                    graphDiv.parentNode && graphDiv.parentNode.appendChild(note);
                }
                // Toggle for explanation wrapper
                const toggleExplainBtn = document.getElementById('togglePointsExplainBtn');
                if (toggleExplainBtn) {
                    toggleExplainBtn.addEventListener('click', () => {
                        const c = document.getElementById('pointsExplainContent');
                        if (!c) return;
                        const hidden = c.style.display === 'none';
                        c.style.display = hidden ? 'block' : 'none';
                    });
                }

                // Detail table wiring
                const toggleDetailBtn = document.getElementById('toggleDetailTableBtn');
                const wrapper = document.getElementById('detailTableWrapper');
                const tbody = document.getElementById('detailPointsTbody');
                const summaryBox = document.getElementById('singlePairSummary');

                // allDeltas augmented with global sequence number for mapping to chart X
                const combined = allDeltas.map((p, idx) => ({ ...p, seq: idx + 1 }));

                // Precompute per-year race index (1..M for each year in chronological order)
                const yearIndexMap = new Map(); // year -> current idx
                function getYearIdx(year) {
                    const y = Number(year);
                    const cur = yearIndexMap.get(y) || 0;
                    const next = cur + 1;
                    yearIndexMap.set(y, next);
                    return next;
                }

                // 建立代码到姓名的映射
                const codeToNameMap = new Map();
                for (const r of allPairsResults) {
                    if (!r) continue;
                    codeToNameMap.set(r.driver1Code, r.driver1 || r.driver1Code);
                    codeToNameMap.set(r.driver2Code, r.driver2 || r.driver2Code);
                }

                function renderDetailRows() {
                    if (!tbody) return;
                    // reset per-year indexes before rendering
                    yearIndexMap.clear();
                    // Alternate background by year group (white / light gray)
                    let lastYear = null;
                    let yearToggle = false; // false: white, true: gray

                    const sessionBg = { Q1: '#ffcdd2', Q2: '#fff9c4', Q3: '#e1bee7' };
                    const fasterColor = '#3CB371';

                    const rowsHtml = combined.map(p => {
                        const pctStr = `${p.percent >= 0 ? '+' : (p.percent < 0 ? '-' : '')}${Math.abs(p.percent).toFixed(3)}%`;
                        // detect year change to toggle background
                        if (lastYear === null || p.year !== lastYear) {
                            if (lastYear !== null) yearToggle = !yearToggle;
                            lastYear = p.year;
                        }
                        const bg = yearToggle ? '#f7f7f7' : '#ffffff';

                        const yIdx = getYearIdx(p.year);

                        // Determine faster driver based on sign (canonical direction)
                        const d1Faster = p.percent > 0;
                        const d2Faster = p.percent < 0;
                        const d1TimeHtml = p.d1Time ? `${p.d1Time}` : 'N/A';
                        const d2TimeHtml = p.d2Time ? `${p.d2Time}` : 'N/A';
                        const sess = p.sessionUsed || 'N/A';
                        const sessBg = sessionBg[sess] || 'transparent';
                        const name1 = codeToNameMap.get(p.d1) || p.d1;
                        const name2 = codeToNameMap.get(p.d2) || p.d2;
                        const td1Extra = d1Faster ? 'background:#dff5e1;font-weight:700;color:#000;' : '';
                        const td2Extra = d2Faster ? 'background:#dff5e1;font-weight:700;color:#000;' : '';

                        return `<tr data-seq="${p.seq}" data-pair="${p.pairKey}" style="background:${bg};">
                            <td>${p.year}</td>
                            <td>R${String(yIdx).padStart(2,'0')}</td>
                            <td>${p.seq}</td>
                            <td>${p.raceName}</td>
                            <td style="text-align:left;">${name1}</td>
                            <td style="text-align:left;">${name2}</td>
                            <td style="text-align:center;${td1Extra}">${d1TimeHtml ? `<strong style='color:#000;'>${d1TimeHtml}</strong>` : 'N/A'}</td>
                            <td style="text-align:center;${td2Extra}">${d2TimeHtml ? `<strong style='color:#000;'>${d2TimeHtml}</strong>` : 'N/A'}</td>
                            <td style="text-align:center;">${pctStr}</td>
                            <td style="text-align:center;background:${sessBg};font-weight:600;">${sess}</td>
                            <td style="text-align:center;"><label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" class="point-toggle" data-seq="${p.seq}" checked> 包含</label> <span class="threshold-badge" style="display:none;color:#b85e00;">(阈值过滤)</span></td>
                        </tr>`;
                    }).join('');

                    tbody.innerHTML = rowsHtml;
                    applyThresholdToRows();
                }

                function getManualExcludedSet() {
                    const set = new Set();
                    const inputs = tbody.querySelectorAll('input.point-toggle');
                    inputs.forEach(inp => { if (!inp.checked) set.add(parseInt(inp.getAttribute('data-seq'), 10)); });
                    return set;
                }

                function updateChartExclusions() {
                    const excluded = Array.from(getManualExcludedSet());
                    // Compute manual included: rows that are checked even if over threshold
                    const threshold = controller.getThreshold?.() || 0;
                    const included = [];
                    const inputs = tbody.querySelectorAll('input.point-toggle');
                    inputs.forEach(inp => {
                        const seq = parseInt(inp.getAttribute('data-seq'), 10);
                        const item = combined.find(x => x.seq === seq);
                        if (!item) return;
                        const over = threshold && Math.abs(item.percent) > threshold;
                        if (inp.checked && over) included.push(seq);
                    });
                    controller.setExcluded(excluded);
                    controller.setIncluded?.(included);
                    updateSummary();
                }

                function applyThresholdToRows() {
                    const threshold = controller.getThreshold?.() || 0;
                    const manualIncluded = new Set(controller.getIncluded?.() || []);
                    const inputs = tbody.querySelectorAll('input.point-toggle');
                    if (threshold === 0) {
                        // No Filter：全部可选且默认勾选
                        inputs.forEach(inp => {
                            const tr = inp.closest('tr');
                            const badge = tr.querySelector('.threshold-badge');
                            inp.disabled = false;
                            inp.checked = true;
                            if (badge) badge.style.display = 'none';
                        });
                        controller.setExcluded([]);
                        controller.setIncluded?.([]);
                        updateSummary();
                        return;
                    }
                    inputs.forEach(inp => {
                        const tr = inp.closest('tr');
                        const seq = parseInt(inp.getAttribute('data-seq'), 10);
                        const item = combined.find(x => x.seq === seq);
                        if (!item) return;
                        const over = threshold && Math.abs(item.percent) > threshold;
                        const badge = tr.querySelector('.threshold-badge');
                        // 不禁用，显示徽标并根据是否手动包含来决定是否勾选
                        inp.disabled = false;
                        if (over) {
                            if (badge) badge.style.display = 'inline';
                            inp.checked = manualIncluded.has(seq);
                        } else {
                            if (badge) badge.style.display = 'none';
                            // 非超阈值默认跟随是否被手动排除
                            // 若已在手动排除集合里，后续 updateChartExclusions 会设置
                        }
                    });
                    updateChartExclusions();
                }

                function updateSummary() {
                    if (!summaryBox) return;
                    const threshold = controller.getThreshold?.() || 0;
                    const manualExcluded = new Set(controller.getExcluded?.() || []);
                    const manualIncluded = new Set(controller.getIncluded?.() || []);
                    const active = combined.filter(p => {
                        if (manualExcluded.has(p.seq)) return false;
                        const over = threshold && Math.abs(p.percent) > threshold;
                        if (over) return manualIncluded.has(p.seq);
                        return true;
                    });
                    const keys = new Set(active.map(p => p.pairKey));
                    if (keys.size !== 1 || active.length === 0) {
                        summaryBox.style.display = 'none';
                        summaryBox.innerHTML = '';
                        return;
                    }
                    const onlyKey = Array.from(keys)[0];
                    const winsA = active.filter(p => p.percent > 0).length;
                    const winsB = active.filter(p => p.percent < 0).length;
                    const codeA = onlyKey.split('-')[0];
                    const codeB = onlyKey.split('-')[1];
                    const median = F1Utils.calculateMedian(active.map(p => p.percent));
                    const sign = median > 0 ? '+' : (median < 0 ? '-' : '');
                    let pairPointsA = 0, pairPointsB = 0, seasonA = 0, seasonB = 0;
                    for (const row of allPairsResults) {
                        if (!row) continue;
                        const rowKey = [row.driver1Code, row.driver2Code].slice().sort((a,b)=>a.localeCompare(b)).join('-');
                        if (rowKey !== onlyKey) continue;
                        if (row.driver1Code === codeA) {
                            pairPointsA += (row.driver1Points || 0);
                            pairPointsB += (row.driver2Points || 0);
                            seasonA += (row.seasonPoints1 || 0);
                            seasonB += (row.seasonPoints2 || 0);
                        } else {
                            pairPointsA += (row.driver2Points || 0);
                            pairPointsB += (row.driver1Points || 0);
                            seasonA += (row.seasonPoints2 || 0);
                            seasonB += (row.seasonPoints1 || 0);
                        }
                    }
                    summaryBox.innerHTML = `
                        <div class="warning-message" style="background:#eef5ff;color:#0d3b66;padding:10px;border-radius:6px;">
                            <div style="font-weight:bold;margin-bottom:6px;">当前仅包含单一车手组合（${codeA} vs ${codeB}）的总结：</div>
                            <div>头对头胜负（按每场%差距正负）：<strong>${codeA}</strong> ${winsA} - ${winsB} <strong>${codeB}</strong></div>
                            <div>中位数差距 %：<strong>${sign}${Math.abs(median).toFixed(3)}%</strong></div>
                            <div>共同参赛积分 (GP+Sprint) 合计：<strong>${codeA}</strong> ${pairPointsA} - ${pairPointsB} <strong>${codeB}</strong></div>
                            <div>赛季总积分 (WDC) 合计：<strong>${codeA}</strong> ${seasonA} - ${seasonB} <strong>${codeB}</strong></div>
                        </div>`;
                    summaryBox.style.display = 'block';
                }

                if (toggleDetailBtn && wrapper) {
                    toggleDetailBtn.addEventListener('click', () => {
                        const show = wrapper.style.display === 'none';
                        wrapper.style.display = show ? 'block' : 'none';
                        toggleDetailBtn.textContent = show ? '隐藏明细表' : '显示明细表';
                    });
                }

                renderDetailRows();
                if (tbody) {
                    tbody.addEventListener('change', (ev) => {
                        const t = ev.target;
                        if (t && t.classList.contains('point-toggle')) {
                            updateChartExclusions();
                        }
                    });
                }
                controller.onThresholdChange?.(() => {
                    applyThresholdToRows();
                });
                updateSummary();

                // Select all button behavior
                const selAllBtn = document.getElementById('detailSelectAllBtn');
                if (selAllBtn) {
                    selAllBtn.addEventListener('click', () => {
                        // Remove all filters: threshold=0, clear exclusions/inclusions, tick all boxes
                        controller.setThreshold?.(0);
                        const boxes = Array.from(tbody.querySelectorAll('input.point-toggle'));
                        boxes.forEach(b => { b.checked = true; b.disabled = false; });
                        controller.setExcluded([]);
                        controller.setIncluded?.([]);
                        updateSummary();
                    });
                }
            } else if (graphDiv) {
                graphDiv.innerHTML = '<div class="loading-text" style="text-align:center;">暂无可绘制的逐场百分比数据</div>';
            }
        } catch (e) {
            console.warn('[History] Render history trend graph failed', e);
        }
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
        .history-table th,
        .history-table td {
            padding: 8px 10px;
            text-align: center;
            white-space: nowrap;
        }
        
        .history-table td:nth-child(3),
        .history-table td:nth-child(4) {
            text-align: left;
        }
    `;
    document.head.appendChild(styleElement);
}

// ------------------ 年份对比（单年全队） ------------------
async function fillSingleYearSelector() {
    try {
        const years = await F1Utils.getSeasons();
        const select = document.getElementById('yearOnlyList');
        if (!years || !select) return;
        const list = years.MRData.SeasonTable.Seasons.reverse().map(s => s.season);
        select.innerHTML = list.map(y => `<option value="${y}">${y}</option>`).join('');
        // 默认选择 2025（如果存在），否则选最新年
        if (list.includes('2025')) {
            select.value = '2025';
        } else if (list.length) {
            select.value = list[0];
        }
    } catch (e) {
        console.warn('[Year Tab] Fill year selector failed', e);
    }
}

async function showYearResults() {
    const yearSel = document.getElementById('yearOnlyList');
    const tableDiv = document.getElementById('yearTable');
    if (!yearSel || !tableDiv) return;
    const year = parseInt(yearSel.value, 10);

    tableDiv.innerHTML = `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">年份对比：加载 ${year} 年所有车队数据...</div>
        </div>
    `;

    try {
        // 预加载该年份的排名与积分缓存
        await preloadStandingsForYear(year);
        const consRes = await F1Utils.getConstructors(year);
        const constructors = consRes?.MRData?.ConstructorTable?.Constructors || [];

        const rows = [];

        for (const c of constructors) {
            const constructorId = c.constructorId;
            const normalizedName = F1Utils.normalizeTeamName(c.name);
            try {
                const pairs = await findDriverPairs(year, constructorId);
                // 改为：列出该队所有不同的队友组合，每个组合一行
                for (const p of pairs) {
                    const r = await processDriverPairData(year, constructorId, normalizedName, p);
                    if (r) rows.push(r);
                }
            } catch (e) {
                console.warn(`[Year Tab] Process team ${c.name} failed`, e);
            }
        }

        if (!rows.length) {
            tableDiv.innerHTML = `<div style="text-align:center;padding:20px;">未找到${year}年的数据</div>`;
            return;
        }

        // 默认不排序，展示原始顺序；提供点击表头排序
        const bodyRowsHtml = rows.map(data => {
            const gridWins2 = Math.max(0, (data.gridMeetings || 0) - (data.gridWins1 || 0));
            const gridWinner = (data.gridWins1 || 0) > gridWins2 ? 1 : ((data.gridWins1 || 0) < gridWins2 ? 2 : 0);
            const driver1QualiStyle = gridWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                    gridWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            const driver2QualiStyle = gridWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                    gridWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            const pointsWinner = data.driver1Points > data.driver2Points ? 1 : 
                                 data.driver1Points < data.driver2Points ? 2 : 0;
            const driver1PointsStyle = pointsWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                       pointsWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            const driver2PointsStyle = pointsWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                       pointsWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            const standingWinner = parseInt(data.driver1Standing) < parseInt(data.driver2Standing) ? 1 : 
                                   parseInt(data.driver1Standing) > parseInt(data.driver2Standing) ? 2 : 0;
            const driver1StandingStyle = standingWinner === 1 ? 'color: #3CB371; font-weight: bold;' : 
                                          standingWinner === 2 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            const driver2StandingStyle = standingWinner === 2 ? 'color: #3CB371; font-weight: bold;' : 
                                          standingWinner === 1 ? 'color: #FF6B6B; font-weight: bold;' : 'font-weight: bold;';
            const s1 = parseInt(data.driver1Standing);
            const s2 = parseInt(data.driver2Standing);
            const standingDiff = (Number.isFinite(s1) && Number.isFinite(s2)) ? Math.abs(s1 - s2) : 0;
            const ratioDiff = Math.abs((data.driver1Percentage || 0) - (data.driver2Percentage || 0));
            const gridDiff = Math.abs((data.gridWins1 || 0) - gridWins2);
            const pairPtsDiff = Math.abs((data.driver1Points || 0) - (data.driver2Points || 0));
            const seasonPtsDiff = Math.abs((data.seasonPoints1 || 0) - (data.seasonPoints2 || 0));
            return `<tr>
                <td data-num="${data.year}">${data.year}</td>
                <td>${data.teamNameDisplay}</td>
                <td>${data.driver1 || 'N/A'}</td>
                <td>${data.driver2 || 'N/A'}</td>
                <td data-num="${Math.abs(data.medianGap)}">${data.medianGap.toFixed(3)}%</td>
                <td data-num="${gridDiff}"><span style="${driver1QualiStyle}">${data.driver1Code}</span> ${data.gridWins1 || 0} - ${gridWins2} <span style="${driver2QualiStyle}">${data.driver2Code}</span></td>
                <td data-num="${pairPtsDiff}"><span style="${driver1PointsStyle}">${data.driver1Code}</span> ${data.driver1Points} - ${data.driver2Points} <span style="${driver2PointsStyle}">${data.driver2Code}</span></td>
                <td data-num="${seasonPtsDiff}"><span style="font-weight:bold;">${data.driver1Code}</span> ${data.seasonPoints1} - ${data.seasonPoints2} <span style="font-weight:bold;">${data.driver2Code}</span></td>
                <td data-num="${standingDiff}"><span style="${driver1StandingStyle}">${data.driver1Code}</span> ${data.driver1Standing} - ${data.driver2Standing} <span style="${driver2StandingStyle}">${data.driver2Code}</span></td>
                <td data-num="${ratioDiff}">${data.driver1Percentage}% - ${data.driver2Percentage}%</td>
            </tr>`;
        }).join('');

        tableDiv.innerHTML = `
            <div class="wide-scroll">
                <table class="history-table" id="yearCompareTable">
                    <thead>
                        <tr>
                            <th data-key="year" data-type="num">年份</th>
                            <th data-key="team" data-type="str">车队</th>
                            <th data-key="d1" data-type="str">车手 1</th>
                            <th data-key="d2" data-type="str">车手 2</th>
                            <th data-key="median" data-type="num">中位数差距 %</th>
                            <th>排位赛成绩</th>
                            <th data-key="pairPts" data-type="num">共同参赛积分 (GP+Sprint)</th>
                            <th data-key="seasonPts" data-type="num">赛季总积分 (WDC)</th>
                            <th data-key="standing" data-type="num">车手排名</th>
                            <th data-key="ratio" data-type="num">积分占比</th>
                        </tr>
                    </thead>
                    <tbody>${bodyRowsHtml}</tbody>
                </table>
            </div>
            <div class="flex-container" style="justify-content:center; gap:8px; margin: 8px 0 4px 0;">
                <button class="selector" id="yearExplainToggle">显示参数说明</button>
            </div>
            <div id="yearExplainPanel" class="explain-panel" style="display:none; max-width: 1200px; margin: 0 auto 20px auto;"></div>
        `;

        // 简易排序：点击表头按该列 data-num 或文本排序，重复点击切换升降序
        const table = document.getElementById('yearCompareTable');
        const thead = table.querySelector('thead');
        let sortState = { idx: -1, asc: true };
        thead.addEventListener('click', (ev) => {
            const th = ev.target.closest('th');
            if (!th) return;
            const idx = Array.from(th.parentNode.children).indexOf(th);
            const type = th.getAttribute('data-type') || 'str';
            sortState.asc = sortState.idx === idx ? !sortState.asc : true;
            sortState.idx = idx;
            const rowsArr = Array.from(table.querySelectorAll('tbody tr'));
            rowsArr.sort((a, b) => {
                const ta = a.children[idx];
                const tb = b.children[idx];
                const va = ta.getAttribute('data-num');
                const vb = tb.getAttribute('data-num');
                let A = va != null ? parseFloat(va) : (type === 'num' ? parseFloat(ta.textContent.replace(/[^\d.-]/g,'') || '0') : ta.textContent.trim());
                let B = vb != null ? parseFloat(vb) : (type === 'num' ? parseFloat(tb.textContent.replace(/[^\d.-]/g,'') || '0') : tb.textContent.trim());
                if (type === 'str') return sortState.asc ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
                const diff = (A || 0) - (B || 0);
                return sortState.asc ? diff : -diff;
            });
            const tbody = table.querySelector('tbody');
            tbody.innerHTML = '';
            rowsArr.forEach(r => tbody.appendChild(r));
        });

        // Wire up explanation toggle below the table, reusing Qualifying explanations (no charts)
        try {
            const toggleBtn = document.getElementById('yearExplainToggle');
            const panel = document.getElementById('yearExplainPanel');
            if (toggleBtn && panel) {
                toggleBtn.addEventListener('click', () => {
                    const willShow = panel.style.display === 'none' || panel.style.display === '';
                    if (willShow) {
                        const html = (window.getQualiParamExplanations ? window.getQualiParamExplanations({ excludeCharts: true }) : '<div style="text-align:center;color:#666;">参数说明暂不可用</div>');
                        panel.innerHTML = html;
                        panel.style.display = 'block';
                        toggleBtn.textContent = '隐藏参数说明';
                    } else {
                        panel.style.display = 'none';
                        toggleBtn.textContent = '显示参数说明';
                    }
                });
            }
        } catch (e) {
            console.warn('[Year Tab] Explanation toggle init failed', e);
        }
    } catch (e) {
        console.warn('[Year Tab] showYearResults failed', e);
        tableDiv.innerHTML = `<div style="text-align:center;padding:20px;">加载失败，请重试</div>`;
    }
}

function initYearTab() {
    if (window.yearTabInitialized) return;
    fillSingleYearSelector();
    const btn = document.getElementById('yearGo');
    if (btn) {
        btn.removeEventListener('click', showYearResults);
        btn.addEventListener('click', showYearResults);
    }
    window.yearTabInitialized = true;
}

window.switchTabYear = function(tab) {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-button[data-tab="${tab}"]`).classList.add('active');
    document.getElementById('qualifying-content').style.display = tab === 'qualifying' ? 'block' : 'none';
    document.getElementById('history-content').style.display = tab === 'history' ? 'block' : 'none';
    document.getElementById('race-content').style.display = tab === 'race' ? 'block' : 'none';
    document.getElementById('year-content').style.display = tab === 'year' ? 'block' : 'none';
    if (tab === 'year') initYearTab();
};

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
