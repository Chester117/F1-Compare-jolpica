// 页面加载时初始化
window.addEventListener("load", () => {
    main();
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
    div.innerHTML = "";
    div.className = "flex-comparison-container";
    
    const driverHeader = document.createElement("h1");
    driverHeader.className = "comparison-header";
    driverHeader.textContent = `${driver1.name} vs ${driver2.name}`;
    div.appendChild(driverHeader);
    
    // 创建包装器div用于更好地控制表格和图表布局
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "table-graph-wrapper";
    div.appendChild(contentWrapper);
    
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
    
    return {
        table: table,
        contentWrapper: contentWrapper,
        id: `${driver1.id}${driver2.id}`,
        sameRaceCount: 0,
        raceCount: 0,
        timeDifferences: [],
        percentageDifferences: [],
        deltaPercentages: [],
        driver1Better: 0,
    };
}

// 显示统计结果
function displayMedianResults(currentTable) {
    const summaryData = [
        {
            label: "Average time difference",
            getValue: () => {
                if (currentTable.timeDifferences.length >= 1) {
                    const avgTime = F1Utils.millisecondsToStruct(F1Utils.calculateAverage(currentTable.timeDifferences));
                    const ms = avgTime.milliseconds.toString().padStart(3, '0');
                    return {
                        text: `${avgTime.isNegative ? "-" : "+"}${avgTime.minutes > 0 ? avgTime.minutes + ":" : ""}${avgTime.seconds}.${ms}`
                    };
                }
                return null;
            }
        },
        {
            label: "Median time difference",
            getValue: () => {
                if (currentTable.timeDifferences.length >= 1) {
                    const medianTime = F1Utils.millisecondsToStruct(F1Utils.calculateMedian(currentTable.timeDifferences));
                    const ms = medianTime.milliseconds.toString().padStart(3, '0');
                    return {
                        text: `${medianTime.isNegative ? "-" : "+"}${medianTime.minutes > 0 ? medianTime.minutes + ":" : ""}${medianTime.seconds}.${ms}`
                    };
                }
                return null;
            }
        },
        {
            label: "Average % difference",
            getValue: () => {
                if (currentTable.percentageDifferences.length >= 1) {
                    const avgPercentage = F1Utils.calculateAverage(currentTable.percentageDifferences);
                    const formattedPercentage = Number(Math.abs(avgPercentage)).toPrecision(3);
                    return {
                        text: `${avgPercentage > 0 ? "+" : "-"}${formattedPercentage}%`
                    };
                }
                return null;
            }
        },
        {
            label: "Median % difference",
            getValue: () => {
                if (currentTable.percentageDifferences.length >= 1) {
                    const medianPercentage = F1Utils.calculateMedian(currentTable.percentageDifferences);
                    const formattedPercentage = Number(Math.abs(medianPercentage)).toPrecision(3);
                    return {
                        text: `${medianPercentage > 0 ? "+" : "-"}${formattedPercentage}%`
                    };
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
        valueCell.textContent = result ? result.text : 'N/A';
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

    // 添加排位赛得分
    const qualyScoreTr = document.createElement("tr");
    qualyScoreTr.className = "summary-row";
    currentTable.table.appendChild(qualyScoreTr);

    // 标签单元格
    const labelCell = document.createElement("td");
    labelCell.className = "summary-label";
    labelCell.colSpan = 2;
    labelCell.textContent = "Qualifying score";
    qualyScoreTr.appendChild(labelCell);

    // 分数单元格
    const scoreCell = document.createElement("td");
    scoreCell.className = "summary-value";
    scoreCell.classList.add("quali-score");
    scoreCell.colSpan = 5;

    const headers = currentTable.table.getElementsByTagName('th');
    const driver1Name = headers[2].textContent;
    const driver2Name = headers[3].textContent;
    
    const driver1Score = currentTable.driver1Better;
    const driver2Score = currentTable.raceCount - currentTable.driver1Better;
    
    const scoreText = `${driver1Name} ${driver1Score} - ${driver2Score} ${driver2Name}`;
    scoreCell.textContent = scoreText;
    qualyScoreTr.appendChild(scoreCell);

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
    div.innerHTML = "";
    
    let currentTable = undefined;
    let tableList = [];

    const races = results.MRData.RaceTable.Races;
    for(let i = 0; i < races.length; i++) {
        if (races[i].QualifyingResults.length !== 2) continue;

        races[i].QualifyingResults.sort((a,b) => a.Driver.driverId.localeCompare(b.Driver.driverId));

        const driver1 = F1Utils.newDriver(races[i].QualifyingResults[0]);
        const driver2 = F1Utils.newDriver(races[i].QualifyingResults[1]);

        if(i === 0) {
            currentTable = createTable(driver1, driver2);
            tableList.push(currentTable);
        } else {
            const newTableId = `${driver1.id}${driver2.id}`;
            currentTable = tableList.find(t => t.id === newTableId);
            
            if(!currentTable) {
                currentTable = createTable(driver1, driver2);
                tableList.push(currentTable);
            }
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
