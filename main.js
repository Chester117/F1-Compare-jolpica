// 页面加载时初始化
window.addEventListener("load", () => {
    main();
    // 绑定清空缓存按钮
    const clearBtn = document.getElementById('clearCacheBtn');
    const statusSpan = document.getElementById('clearCacheStatus');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            try {
                clearBtn.disabled = true;
                clearBtn.textContent = '清空中…';
                const result = F1Utils.flushAllCaches?.();
                // 打印汇总
                const summary = F1Utils.getCacheSummary?.();
                console.log('[Cache] Flush result', result);
                console.log('[Cache] After flush summary', summary);
                if (statusSpan) {
                    statusSpan.style.display = 'inline';
                    statusSpan.textContent = '已清空';
                    setTimeout(() => { statusSpan.style.display = 'none'; }, 2000);
                }
            } catch (e) {
                console.warn('清空缓存失败', e);
            } finally {
                clearBtn.disabled = false;
                clearBtn.textContent = '清空缓存';
            }
        });
    }
    // 绑定“继续获取”按钮
    const resumeBtn = document.getElementById('partialResumeBtn');
    const notice = document.getElementById('partialNotice');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
            try {
                if (typeof window.historyResumeFn === 'function') {
                    // 隐藏提示，再继续
                    if (notice) notice.style.display = 'none';
                    const fn = window.historyResumeFn;
                    // 清空，避免重复点击
                    window.historyResumeFn = null;
                    fn();
                }
            } catch (e) {
                console.warn('恢复历史数据获取失败', e);
            }
        });
    }

    // 为历史页内联“继续获取”按钮绑定事件（使用事件委托，因其是动态渲染的）
    document.addEventListener('click', (ev) => {
        const target = ev.target;
        if (target && target.id === 'historyInlineResumeBtn') {
            try {
                // 避免重复点击
                target.disabled = true;
                target.textContent = '继续中…';
                if (notice) notice.style.display = 'none';
                if (typeof window.historyResumeFn === 'function') {
                    const fn = window.historyResumeFn;
                    window.historyResumeFn = null;
                    fn();
                } else {
                    // 若无恢复函数，恢复按钮恢复可点，提示稍后重试
                    target.disabled = false;
                    target.textContent = '继续获取';
                    console.warn('未找到恢复函数，可能已恢复或页面已刷新。');
                }
            } catch (e) {
                console.warn('内联继续获取失败', e);
                // 恢复按钮状态
                try { target.disabled = false; target.textContent = '继续获取'; } catch(_) {}
            }
        }
    });
});

// 更新车队列表
async function selectOnChange(event) {
    const year = event.target.value;
    const selectedConstructor = document.getElementById("constructorList").value;
    let results = await F1Utils.getConstructors(year);
    if (results) {
        fillConstructorsList(results, selectedConstructor);
    }
}

// 创建车手对比表格
function createTable(driver1, driver2) {
    const div = document.getElementById("tables");
    
    // Don't clear the div - we need to keep existing pairings
    if (!div.classList.contains("flex-comparison-container")) {
        div.className = "flex-comparison-container";
    }
    
    // Create a wrapper for this specific driver comparison
    const pairingWrapper = document.createElement("div");
    pairingWrapper.className = "driver-pairing-container";
    div.appendChild(pairingWrapper);
    
    const headerRow = document.createElement("div");
    headerRow.className = "comparison-header-row";
    pairingWrapper.appendChild(headerRow);

    const driverHeader = document.createElement("h1");
    driverHeader.className = "comparison-header";
    driverHeader.textContent = `${driver1.name} vs ${driver2.name}`;
    headerRow.appendChild(driverHeader);

    // Explanations panel (collapsed by default)
    const explainPanel = document.createElement("div");
    explainPanel.className = "explain-panel";
    explainPanel.hidden = true;

    // Shared explanations provider
    if (!window.getQualiParamExplanations) {
        window.getQualiParamExplanations = function getQualiParamExplanations(opts = {}) {
            const excludeCharts = !!opts.excludeCharts;
            const common = `
                <div class="explain-section">
                  <div class="explain-title">统计指标说明</div>
                  <ul class="explain-list">
                    <li><strong>Average time difference</strong>：平均单圈时间差（以毫秒/秒显示），把所有场次的时间差求平均，反映整体谁更快。</li>
                    <li><strong>Median time difference</strong>：中位数时间差，比平均值更不受极端值影响，能代表“典型”差距。</li>
                    <li><strong>Average % difference</strong>：平均百分比差距（%），用时间差占更快者用时的百分比来衡量，便于不同赛道/圈速之间横向比较。</li>
                    <li><strong>Median % difference</strong>：百分比差距的中位数，同样更稳健地反映典型表现。</li>
                    <li><strong>95% CI (Bootstrap)</strong>：基于自助法（Bootstrap）的95%置信区间，表示在重复抽样的意义下，我们有约95%的把握该总体指标会落在此区间内。</li>
                    <li><strong>Qualifying score</strong>：两位车手在同场排位赛中谁更快的计分统计（例如 8-6），更像胜场统计，强调“次数”而非差距大小。</li>
                  </ul>
                </div>
                <div class="explain-section">
                  <div class="explain-subtitle">为什么使用 Bootstrap？</div>
                  <p>排位差距的数据量通常不大、且可能存在偏态/离群值。Bootstrap（自助法）不依赖正态分布假设：通过对现有样本进行有放回的重复重采样，计算每次样本的统计量（如均值/中位数），形成其经验分布，再从该分布的百分位数（通常是2.5%和97.5%）给出<strong>95%置信区间</strong>，从而更稳健地刻画不确定性。</p>
                  <div class="explain-subtitle">Bootstrap 计算过程（简述）</div>
                  <ol class="explain-ol">
                    <li>从原始样本（例如每场的%差距）中<strong>有放回</strong>抽取与样本量相同数量的数据，得到一次“重采样样本”。</li>
                    <li>对该重采样样本计算目标统计量（如均值或中位数）。</li>
                    <li>重复上述步骤很多次（例如1000次），得到统计量的分布。</li>
                    <li>取该分布的2.5%分位数与97.5%分位数作为95%置信区间的下界与上界。</li>
                  </ol>
                  <p><strong>95% CI 的含义</strong>：如果我们在相同条件下无限次重复抽样并每次都计算区间，约95%的这些区间会覆盖真实的总体参数。对当前数据，它给出“合理范围”，不是说参数有95%的概率在区间内。</p>
                </div>`;
            const charts = `
                <div class="explain-section">
                  <div class="explain-title">趋势线（Trend line）指标说明</div>
                  <ul class="explain-list">
                    <li><strong>Slope（斜率，%/race）</strong>：每场比赛平均%差距的变化量。正值=差距向上（第一位更慢/更快取决于定义），负值=差距向下。</li>
                    <li><strong>Change（Δ%）</strong>：该趋势段起点到终点的预测总变化量。</li>
                    <li><strong>R²</strong>：线性趋势对数据的解释度（1=完美线性，0=无线性关系）。</li>
                    <li><strong>Segment span</strong>：该趋势段覆盖的比赛轮次范围（start→end）。</li>
                  </ul>
                </div>`;
            return excludeCharts ? common : (common + charts);
        };
    }

    // Use shared provider for explanations
    explainPanel.innerHTML = window.getQualiParamExplanations({ excludeCharts: false });
    
    // 创建包装器div用于更好地控制表格和图表布局
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "table-graph-wrapper";
    pairingWrapper.appendChild(contentWrapper);

    // Explanation toggle button placed at the very bottom of the pairing block
    const explainBtn = document.createElement("button");
    explainBtn.className = "explain-toggle-btn";
    explainBtn.type = "button";
    explainBtn.textContent = "显示所有指标解释";
    // Build the main content first

    // Toggle behavior
    explainBtn.addEventListener("click", () => {
        const show = explainPanel.hidden;
        explainPanel.hidden = !show;
        explainBtn.textContent = show ? "隐藏指标解释" : "显示所有指标解释";
    });
    
    const tableContainer = document.createElement("div");
    tableContainer.className = "table-container";
    contentWrapper.appendChild(tableContainer);
    
    const table = document.createElement("table");
    table.className = "comparison-table";
    tableContainer.appendChild(table);
    
    const tr = document.createElement("tr");
    table.appendChild(tr);

    const headers = [
        { text: "Round", width: "50px" },
        { text: "Race", width: "200px" },
        { text: driver1.name, width: "140px" },
        { text: driver2.name, width: "140px" },
        { text: "Time Delta", width: "100px" },
        { text: "Delta %", width: "90px" },
        { text: "Session", width: "60px" }
    ];

    headers.forEach((header, index) => {
        let th = document.createElement("th");
        th.textContent = header.text;
        th.className = `row-${index + 1}`;
        th.style.width = header.width;
        th.style.textAlign = index === 1 ? "left" : "center";
        tr.appendChild(th);
    });
    
    // Place explanations panel just above the bottom button so it expands near the user's click
    pairingWrapper.appendChild(explainPanel);
    // Finally, append the bottom-centered toggle button
    pairingWrapper.appendChild(explainBtn);

    return {
        table: table,
        contentWrapper: contentWrapper,
        id: `${driver1.id}-${driver2.id}`,
        driver1Name: driver1.name,
        driver2Name: driver2.name,
        driver1LastName: (driver1.name || '').trim().split(' ').slice(-1)[0] || driver1.name,
        driver2LastName: (driver2.name || '').trim().split(' ').slice(-1)[0] || driver2.name,
        sameRaceCount: 0,
        raceCount: 0,
        // Pure pace计数（基于双方共同到达的最高小节的圈速对比）
        timeDifferences: [],
        percentageDifferences: [],
        deltaPercentages: [],
        driver1Better: 0,
        // True计数（基于官方排位名次 position 更靠前者胜）
        driver1TrueWins: 0,
        trueRaceCount: 0,
    };
}

// 显示统计结果
function displayMedianResults(currentTable) {
    const fasterNote = (value) => {
        if (value > 0) return `(${currentTable.driver1LastName} Faster)`;
        if (value < 0) return `(${currentTable.driver2LastName} Faster)`;
        return '(Even)';
    };
    const wrapCenteredWithNote = (centerText, noteText) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'summary-value-content';
        const left = document.createElement('span');
        left.className = 'val-left';
        const center = document.createElement('span');
        center.className = 'val-center';
        center.textContent = centerText;
        const note = document.createElement('span');
        note.className = 'val-note';
        note.textContent = noteText;
        wrapper.appendChild(left);
        wrapper.appendChild(center);
        wrapper.appendChild(note);
        return wrapper;
    };
    const summaryData = [
        {
            label: "Average time difference",
            getValue: () => {
                if (currentTable.timeDifferences.length >= 1) {
                    const avgRaw = F1Utils.calculateAverage(currentTable.timeDifferences);
                    const sign = avgRaw > 0 ? '+' : (avgRaw < 0 ? '-' : '');
                    const avgTime = F1Utils.millisecondsToStruct(Math.abs(avgRaw));
                    const ms = avgTime.milliseconds.toString().padStart(3, '0');
                    const baseText = `${avgTime.minutes > 0 ? avgTime.minutes + ":" : ""}${avgTime.seconds}.${ms}`;
                    const centerText = `${sign}${baseText}s`;
                    const noteText = fasterNote(avgRaw);
                    return { node: wrapCenteredWithNote(centerText, noteText) };
                }
                return null;
            }
        },
        {
            label: "Median time difference",
            getValue: () => {
                if (currentTable.timeDifferences.length >= 1) {
                    const medRaw = F1Utils.calculateMedian(currentTable.timeDifferences);
                    const sign = medRaw > 0 ? '+' : (medRaw < 0 ? '-' : '');
                    const medianTime = F1Utils.millisecondsToStruct(Math.abs(medRaw));
                    const ms = medianTime.milliseconds.toString().padStart(3, '0');
                    const baseText = `${medianTime.minutes > 0 ? medianTime.minutes + ":" : ""}${medianTime.seconds}.${ms}`;
                    const centerText = `${sign}${baseText}s`;
                    const noteText = fasterNote(medRaw);
                    return { node: wrapCenteredWithNote(centerText, noteText) };
                }
                return null;
            }
        },
        {
            label: "Average % difference",
            getValue: () => {
                if (currentTable.percentageDifferences.length >= 1) {
                    const avgPercentage = F1Utils.calculateAverage(currentTable.percentageDifferences);
                    const sign = avgPercentage > 0 ? '+' : (avgPercentage < 0 ? '-' : '');
                    const formattedPercentage = Number(Math.abs(avgPercentage)).toFixed(3);
                    const centerText = `${sign}${formattedPercentage}%`;
                    const noteText = fasterNote(avgPercentage);
                    return { node: wrapCenteredWithNote(centerText, noteText) };
                }
                return null;
            }
        },
        {
            label: "Median % difference",
            getValue: () => {
                if (currentTable.percentageDifferences.length >= 1) {
                    const medianPercentage = F1Utils.calculateMedian(currentTable.percentageDifferences);
                    const sign = medianPercentage > 0 ? '+' : (medianPercentage < 0 ? '-' : '');
                    const formattedPercentage = Number(Math.abs(medianPercentage)).toFixed(3);
                    const centerText = `${sign}${formattedPercentage}%`;
                    const noteText = fasterNote(medianPercentage);
                    return { node: wrapCenteredWithNote(centerText, noteText) };
                }
                return null;
            }
        }
    ];

    // Create summary rows
    summaryData.forEach((data, index) => {
        const tr = document.createElement("tr");
        tr.className = "summary-row";
        currentTable.table.appendChild(tr);

        // 标签单元格
        const labelCell = document.createElement("td");
        labelCell.className = "summary-label";
        labelCell.colSpan = 2;
        if (index === 0) labelCell.classList.add("top-border");
        labelCell.textContent = data.label;
        
        // 为时间差异行添加深灰色背景
        if (data.label.includes("time difference")) {
            labelCell.classList.add("time-difference");
        }
        
        tr.appendChild(labelCell);
        
        // 值单元格
        const valueCell = document.createElement("td");
        valueCell.className = "summary-value";
        valueCell.colSpan = 5;
        if (index === 0) valueCell.classList.add("top-border");
        
        // 为时间差异行添加深灰色背景
        if (data.label.includes("time difference")) {
            valueCell.classList.add("time-difference");
        }
        
        const result = data.getValue();
        if (!result) {
            valueCell.textContent = 'N/A';
        } else if (result.node) {
            valueCell.appendChild(result.node);
        } else if (result.text) {
            // Fallback for any legacy callers
            valueCell.textContent = result.text;
        } else {
            valueCell.textContent = 'N/A';
        }
        tr.appendChild(valueCell);
    });

    // 添加bootstrap置信区间行
    if (currentTable.percentageDifferences.length >= 2) {
        const ci = F1Utils.bootstrapConfidenceInterval(currentTable.percentageDifferences);
        const tr = document.createElement("tr");
        tr.className = "summary-row";
        currentTable.table.appendChild(tr);

        const labelCell = document.createElement("td");
        labelCell.className = "summary-label";
        labelCell.colSpan = 2;
        labelCell.textContent = "95% CI (Bootstrap)";
        tr.appendChild(labelCell);

        const valueCell = document.createElement("td");
        valueCell.className = "summary-value";
        valueCell.colSpan = 5;
        const lowerValue = Number(ci.lower).toFixed(3);
        const upperValue = Number(ci.upper).toFixed(3);
        valueCell.textContent = `[${lowerValue}%, ${upperValue}%]`;
        tr.appendChild(valueCell);
    }

    // 添加排位赛得分 (pure pace)
    const headers = currentTable.table.getElementsByTagName('th');
    const driver1Name = headers[2].textContent;
    const driver2Name = headers[3].textContent;

    const qualyScorePureTr = document.createElement("tr");
    qualyScorePureTr.className = "summary-row";
    currentTable.table.appendChild(qualyScorePureTr);

    const labelCellPure = document.createElement("td");
    labelCellPure.className = "summary-label";
    labelCellPure.colSpan = 2;
    labelCellPure.textContent = "Qualifying score (pure pace)";
    qualyScorePureTr.appendChild(labelCellPure);

    const scoreCellPure = document.createElement("td");
    scoreCellPure.className = "summary-value";
    scoreCellPure.classList.add("quali-score");
    scoreCellPure.colSpan = 5;
    const driver1ScorePure = currentTable.driver1Better;
    const driver2ScorePure = currentTable.raceCount - currentTable.driver1Better;
    scoreCellPure.textContent = `${driver1Name} ${driver1ScorePure} - ${driver2ScorePure} ${driver2Name}`;
    qualyScorePureTr.appendChild(scoreCellPure);

    // 添加排位赛得分 (true)
    const qualyScoreTrueTr = document.createElement("tr");
    qualyScoreTrueTr.className = "summary-row";
    currentTable.table.appendChild(qualyScoreTrueTr);

    const labelCellTrue = document.createElement("td");
    labelCellTrue.className = "summary-label";
    labelCellTrue.colSpan = 2;
    labelCellTrue.textContent = "Qualifying score (true)";
    qualyScoreTrueTr.appendChild(labelCellTrue);

    const scoreCellTrue = document.createElement("td");
    scoreCellTrue.className = "summary-value";
    scoreCellTrue.classList.add("quali-score");
    scoreCellTrue.colSpan = 5;
    const driver1ScoreTrue = currentTable.driver1TrueWins;
    const driver2ScoreTrue = currentTable.trueRaceCount - currentTable.driver1TrueWins;
    scoreCellTrue.textContent = `${driver1Name} ${driver1ScoreTrue} - ${driver2ScoreTrue} ${driver2Name}`;
    qualyScoreTrueTr.appendChild(scoreCellTrue);

    // 创建专用的图表容器
    const graphContainer = document.createElement('div');
    graphContainer.className = 'graph-container';
    currentTable.contentWrapper.appendChild(graphContainer);
    
    // 使用deltaPercentages创建趋势图
    QualifyingTrendGraph(
        graphContainer,
        currentTable.deltaPercentages,
        driver1Name,
        driver2Name
    );
}

// 创建所有排位赛表格
function createQualifyingTable(results) {
    const div = document.getElementById("tables");
    div.innerHTML = ""; // Clear existing content before creating new tables
    
    let currentTable = undefined;
    let tableList = [];
    let processedPairings = new Set(); // Track which driver pairings we've already processed

    const races = results.MRData.RaceTable.Races;
    for(let i = 0; i < races.length; i++) {
        if (races[i].QualifyingResults.length !== 2) continue;

        races[i].QualifyingResults.sort((a,b) => a.Driver.driverId.localeCompare(b.Driver.driverId));

        const driver1 = F1Utils.newDriver(races[i].QualifyingResults[0]);
        const driver2 = F1Utils.newDriver(races[i].QualifyingResults[1]);

        // Create a unique identifier for this driver pairing
        const pairingId = `${driver1.id}-${driver2.id}`;
        
        // Check if we've already processed this pairing
        if (!processedPairings.has(pairingId)) {
            currentTable = createTable(driver1, driver2);
            tableList.push(currentTable);
            processedPairings.add(pairingId);
        } else {
            // Find the existing table for this pairing
            currentTable = tableList.find(t => t.id === pairingId);
        }
        
        const tr = document.createElement("tr");
        tr.className = "race-row";
        currentTable.table.appendChild(tr);

        // 定义阶段颜色
        const sessionColors = {
            'Q1': '#ffcdd2',
            'Q2': '#fff9c4',
            'Q3': '#e1bee7'
        };

        // 获取比较数据
        const d1Times = F1Utils.getDriverBestTime(driver1.ref);
        const d2Times = F1Utils.getDriverBestTime(driver2.ref);
        const comparison = F1Utils.compareQualifyingTimes(d1Times, d2Times);

        // 添加基础单元格
        addCell(tr, races[i].round, "center");
        addCell(tr, races[i].raceName, "left");
        addCell(tr, comparison.d1Time || "N/A", "center");
        addCell(tr, comparison.d2Time || "N/A", "center");

        // 统计 true 排位胜负（基于官方 position 名次）
        const pos1 = parseInt(driver1.ref?.position, 10);
        const pos2 = parseInt(driver2.ref?.position, 10);
        if (Number.isFinite(pos1) && Number.isFinite(pos2)) {
            currentTable.trueRaceCount++;
            if (pos1 < pos2) currentTable.driver1TrueWins++;
        }

        if (!comparison.sessionUsed || !comparison.d1Time || !comparison.d2Time) {
            addCell(tr, "No comparable times", "center");
            addCell(tr, "N/A", "center");
            addCell(tr, "N/A", "center");
        } else {
            currentTable.raceCount++;
            
            const d1TimeMs = F1Utils.convertTimeString(comparison.d1Time);
            const d2TimeMs = F1Utils.convertTimeString(comparison.d2Time);
            const timeDifference = d2TimeMs - d1TimeMs;
            const percentageDifference = (timeDifference / d1TimeMs) * 100;

            currentTable.timeDifferences.push(timeDifference);
            currentTable.percentageDifferences.push(percentageDifference);
            // 存储轮次编号和delta百分比
            currentTable.deltaPercentages.push([parseInt(races[i].round), percentageDifference]);

            if (timeDifference > 0) {
                currentTable.driver1Better++;
            }

            const time = F1Utils.millisecondsToStruct(timeDifference);
            const tdColor = time.isNegative ? "#FF7878" : "#85FF78";

            // 为前两个单元格设置背景色
            tr.cells[0].style.backgroundColor = tdColor;
            tr.cells[1].style.backgroundColor = tdColor;

            // 添加时间差、百分比差和赛段单元格
            const timeText = `${time.isNegative ? "-" : "+"}${time.minutes > 0 ? time.minutes+":" : ""}${time.seconds}.${time.milliseconds.toString().padStart(3, '0')}`;
            addCell(tr, timeText, "center");
            addCell(tr, `${percentageDifference > 0 ? "+" : ""}${percentageDifference.toFixed(3)}%`, "center");
            
            const sessionCell = addCell(tr, comparison.sessionUsed || "N/A", "center");
            if (comparison.sessionUsed) {
                sessionCell.style.backgroundColor = sessionColors[comparison.sessionUsed];
            }
        }
    }

    // 为每个表格显示汇总统计
    tableList.forEach(table => {
        displayMedianResults(table);
    });
}

// 辅助函数：添加表格单元格
function addCell(row, text, align) {
    const td = document.createElement("td");
    td.textContent = text;
    td.style.textAlign = align;
    row.appendChild(td);
    return td;
}

// 添加车队到下拉列表
function fillConstructorsList(list, currentSelect) {
    const select = document.getElementById("constructorList");
    select.innerHTML = "";
    list.MRData.ConstructorTable.Constructors.forEach((elm) => {
        const option = document.createElement("option");
        option.value = elm.name;
        option.innerHTML = elm.name;
        option.id = elm.constructorId;
        select.appendChild(option);
        // 如果可用，保持当前车队选中
        if (elm.name == currentSelect) {
            select.value = currentSelect;
        }
    });
}

async function displayResults() {
    const yearList = document.getElementById("seasonList");
    const constructorList = document.getElementById("constructorList");
    
    const options = constructorList.options;
    const constructorId = options[options.selectedIndex].id;
    const year = yearList.value;

    const qualifying = await F1Utils.getQualifying(year, constructorId);
    createQualifyingTable(qualifying);
}

async function main() {
    // 初始化排位赛标签
    const seasonList = document.getElementById("seasonList");
    seasonList.addEventListener("change", selectOnChange);
    document.getElementById("go").addEventListener("click", displayResults);

    // 获取赛季数据
    const results = await F1Utils.getSeasons();
    
    if (results) {
        const seasons = results.MRData.SeasonTable.Seasons.reverse();
        const currentYear = seasons[0].season;

        // 填充排位赛标签的车队列表
        const constructorList = await F1Utils.getConstructors(currentYear);
        
        if (constructorList) {
            fillConstructorsList(constructorList);
        } else {
            console.error("无法获取车队列表");
        }

        // 填充排位赛标签的赛季列表
        seasonList.innerHTML = seasons.map(season => 
            `<option value="${season.season}">${season.season}</option>`
        ).join('');
    } else {
        console.error("无法获取赛季数据");
    }
}
