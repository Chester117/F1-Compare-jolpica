
async function fetchData(url){
    try {
        let response = await fetch(url);

        if (!response.ok) {
            return undefined;
        } else {
            let json = await response.json();
            return json;
        }
    } catch (e) {
        return undefined;
    }
}

async function getSeasons(){
    return fetchData("https://ergast.com/api/f1/seasons.json?offset=44&limit=100");
}

async function getConstructors(year){
    return fetchData(`https://ergast.com/api/f1/${year}/constructors.json`);
}

async function getQualifying(year, constructorId){
    return fetchData(`https://ergast.com/api/f1/${year}/constructors/${constructorId}/qualifying.json?limit=60`);
}

// Update constructors list
async function selectOnChange(event){
    const year = event.target.value;
    const selectedConstructor = document.getElementById("constructorList").value;
    let results = await getConstructors(year);
    if(results){
        fillConstructorsList(results, selectedConstructor);
    }
}

// Convert milliseconds to minutes,seconds,milliseconds
function millisecondsToStruct(time){
    const newTime = {};
    newTime.isNegative = time < 0 ? true : false;
    time = Math.abs(time);
    newTime.minutes = Math.floor(time/60000);
    time = time % 60000;
    newTime.seconds = Math.floor(time/1000);
    newTime.milliseconds = Math.floor(time % 1000);
    return newTime;
}

// Convert time string into milliseconds
function convertTimeString(time){
    let milliseconds = 0;
    const tkns = time.split(":");
    if(tkns.length === 2){
        milliseconds += (parseInt(tkns[0]) * 60000);
        const tkns2 = tkns[1].split(".");
        milliseconds += parseInt(tkns2[0]) * 1000;
        milliseconds += parseInt(tkns2[1]);
        return milliseconds
    }else{
        const tkns2 = tkns[0].split(".");
        milliseconds += parseInt(tkns2[0]) * 1000;
        milliseconds += parseInt(tkns2[1]);
        return milliseconds
    }
}

function createTable(driver1, driver2) {
    const div = document.getElementById("tables");
    div.style.display = "flex";
    div.style.flexDirection = "column";
    div.style.alignItems = "center";
    div.style.width = "100%";
    div.style.margin = "0 auto";
    
    const driverHeader = document.createElement("h1");
    driverHeader.style.fontSize = "2em";
    driverHeader.style.marginBottom = "1em";
    driverHeader.style.textAlign = "center";
    driverHeader.style.fontFamily = "'Source Han Sans SC', sans-serif";
    driverHeader.style.width = "100%";
    driverHeader.textContent = `${driver1.name} vs ${driver2.name}`;
    div.appendChild(driverHeader);
    
    // Create a wrapper div for better control of table and graph layout
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "table-graph-wrapper";
    contentWrapper.style.width = "100%";
    contentWrapper.style.display = "flex";
    contentWrapper.style.flexDirection = "column";
    contentWrapper.style.alignItems = "center";
    div.appendChild(contentWrapper);
    
    const tableContainer = document.createElement("div");
    tableContainer.className = "table-container";
    tableContainer.style.display = "flex";
    tableContainer.style.justifyContent = "center";
    tableContainer.style.marginBottom = "2em";
    tableContainer.style.width = "100%";
    tableContainer.style.overflowX = "auto";
    contentWrapper.appendChild(tableContainer);
    
    const table = document.createElement("table");
    table.style.borderCollapse = "collapse";
    table.style.width = "fit-content";
    table.style.marginBottom = "1em";
    table.style.backgroundColor = "#f5f5f5";
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
        th.appendChild(document.createTextNode(header.text));
        th.className = `row-${index + 1}`;
        th.style.padding = "6px";
        th.style.textAlign = index === 1 ? "left" : "center";
        th.style.width = header.width;
        th.style.whiteSpace = "nowrap";
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

//end of creat table
function newDriver(d) {
    return {
        name: `${d.Driver.givenName} ${d.Driver.familyName}`,
        id: d.Driver.driverId,
        ref: d,
    }
}

function bestTime(driver) {
    let times = {
        Q1: driver.ref.Q1 || null,
        Q2: driver.ref.Q2 || null,
        Q3: driver.ref.Q3 || null
    };
    
    return times;
}

function newTd(text, bold, styleOptions){
    let td = document.createElement("td");
    if(bold){
        let bold = document.createElement("strong");
        let textNode = document.createTextNode(text);
        bold.appendChild(textNode);
        td.appendChild(bold);
    }
    else{
        td.appendChild(document.createTextNode(text));
    }
    if(styleOptions){
        for (let key of Object.keys(styleOptions)) {
            td.style[key] = styleOptions[key];
        }
    }
    
    return td;
}


function displayQualyScore(currentTable){
    const tr = document.createElement("tr");
    currentTable.table.appendChild(tr);

    tr.appendChild(newTd("Qualifying score", true, { textAlign: "left" })); 

    tr.appendChild(newTd("", false));
    tr.appendChild(newTd("", false));


    const tdText = `${currentTable.driver1Better} - ${currentTable.raceCount - currentTable.driver1Better}`
    let tdColour = "#ffc478"
    if (currentTable.driver1Better > (currentTable.raceCount - currentTable.driver1Better)) {
        tdColour = "#85FF78";
    }
    else if (currentTable.driver1Better < (currentTable.raceCount - currentTable.driver1Better)) {
        tdColour = "#FF7878";
    }
    tr.appendChild(newTd(tdText, true, { backgroundColor: tdColour}));
}

function compareDriverTimes(driver1Times, driver2Times) {
    // Find the latest session where both drivers set a time
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

function calculateMedian(numbers) {
    if (numbers.length === 0) return 0;
    
    const sorted = numbers.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////DISPLAY MEDIAN RESULTS////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

function displayMedianResults(currentTable) {
    const calculateAverage = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    
    const summaryData = [
        {
            label: "Average time difference",
            getValue: () => {
                if (currentTable.timeDifferences.length >= 1) {
                    const avgTime = millisecondsToStruct(calculateAverage(currentTable.timeDifferences));
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
                    const medianTime = millisecondsToStruct(calculateMedian(currentTable.timeDifferences));
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
                    const avgPercentage = calculateAverage(currentTable.percentageDifferences);
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
                    const medianPercentage = calculateMedian(currentTable.percentageDifferences);
                    const formattedPercentage = Number(Math.abs(medianPercentage)).toPrecision(3);
                    return {
                        text: `${medianPercentage > 0 ? "+" : "-"}${formattedPercentage}%`
                    };
                }
                return null;
            }
        }
    ];

    summaryData.forEach((data, index) => {
        const tr = document.createElement("tr");
        currentTable.table.appendChild(tr);

        // Label cell
        const labelCell = document.createElement("td");
        labelCell.style.padding = "12px 6px";
        labelCell.style.fontWeight = "bold";
        labelCell.style.textAlign = "left";
        labelCell.colSpan = 2;
        if (index === 0) labelCell.style.borderTop = "4px solid #ddd";
        labelCell.textContent = data.label;
        
        // Add dark gray background for time difference rows
        if (data.label.includes("time difference")) {
            labelCell.style.backgroundColor = "#808080";
            labelCell.style.color = "white";
        }
        
        tr.appendChild(labelCell);
        
        // Value cell
        const valueCell = document.createElement("td");
        valueCell.style.padding = "12px 6px";
        valueCell.style.fontWeight = "bold";
        valueCell.style.textAlign = "center";
        valueCell.colSpan = 5;
        if (index === 0) valueCell.style.borderTop = "4px solid #ddd";
        
        // Add dark gray background for time difference rows
        if (data.label.includes("time difference")) {
            valueCell.style.backgroundColor = "#808080";
            valueCell.style.color = "white";
        }
        
        const result = data.getValue();
        valueCell.textContent = result ? result.text : 'N/A';
        tr.appendChild(valueCell);
    });

    // Add bootstrap confidence interval row
    if (currentTable.percentageDifferences.length >= 2) {
        const ci = bootstrapConfidenceInterval(currentTable.percentageDifferences);
        const tr = document.createElement("tr");
        currentTable.table.appendChild(tr);

        const labelCell = document.createElement("td");
        labelCell.style.padding = "12px 6px";
        labelCell.style.fontWeight = "bold";
        labelCell.style.textAlign = "left";
        labelCell.colSpan = 2;
        labelCell.textContent = "95% CI (Bootstrap)";
        tr.appendChild(labelCell);

        const valueCell = document.createElement("td");
        valueCell.style.padding = "12px 6px";
        valueCell.style.fontWeight = "bold";
        valueCell.style.textAlign = "center";
        valueCell.colSpan = 5;
        const lowerValue = Number(ci.lower).toFixed(3);
        const upperValue = Number(ci.upper).toFixed(3);
        valueCell.textContent = `[${lowerValue}%, ${upperValue}%]`;
        tr.appendChild(valueCell);
    }

    // Add qualifying score
    const qualyScoreTr = document.createElement("tr");
    currentTable.table.appendChild(qualyScoreTr);

    // Label cell
    const labelCell = document.createElement("td");
    labelCell.style.padding = "12px 6px";
    labelCell.style.fontWeight = "bold";
    labelCell.style.textAlign = "left";
    labelCell.colSpan = 2;
    labelCell.textContent = "Qualifying score";
    qualyScoreTr.appendChild(labelCell);

    // Score cell
    const scoreCell = document.createElement("td");
    scoreCell.style.padding = "12px 6px";
    scoreCell.style.textAlign = "center";
    scoreCell.style.fontSize = "1.1em";
    scoreCell.style.fontWeight = "bold";
    scoreCell.colSpan = 5;

    const headers = currentTable.table.getElementsByTagName('th');
    const driver1Name = headers[2].textContent;
    const driver2Name = headers[3].textContent;
    
    const driver1Score = currentTable.driver1Better;
    const driver2Score = currentTable.raceCount - currentTable.driver1Better;
    
    const scoreText = `${driver1Name} ${driver1Score} - ${driver2Score} ${driver2Name}`;
    scoreCell.textContent = scoreText;
    qualyScoreTr.appendChild(scoreCell);

    // Create a dedicated container for the graph
    const graphContainer = document.createElement('div');
    graphContainer.className = 'graph-container';
    currentTable.contentWrapper.appendChild(graphContainer);
    
    // Create the trend graph with deltaPercentages
    QualifyingTrendGraph(
        graphContainer,
        currentTable.deltaPercentages,
        driver1Name,
        driver2Name
    );
}


//////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////  END END END  ///////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////END OF DISPLAY MEDIAN RESULTS END OF//////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////  END END END  ///////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////

// Create all qualifying tables

function createQualifyingTable(results) {
    const div = document.getElementById("tables");
    div.innerHTML = "";
    
    let currentTable = undefined;
    let tableList = [];

    const races = results.MRData.RaceTable.Races;
    for(let i = 0; i < races.length; i++) {
        if (races[i].QualifyingResults.length !== 2) continue;

        races[i].QualifyingResults.sort((a,b) => a.number - b.number);

        let driver1Id = races[i].QualifyingResults[0].Driver.driverId;
        let driver2Id = races[i].QualifyingResults[1].Driver.driverId;

        const driver1 = newDriver(driver1Id < driver2Id ? races[i].QualifyingResults[0] : races[i].QualifyingResults[1]);
        const driver2 = newDriver(driver1Id > driver2Id ? races[i].QualifyingResults[0] : races[i].QualifyingResults[1]);

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
        tr.style.borderBottom = "1px solid #ddd";
        currentTable.table.appendChild(tr);

        // Add all cells with consistent styling
        const cells = [
            { text: races[i].round, align: "center" },
            { text: races[i].raceName, align: "left" }
        ];

        // Add times first
        const d1Times = bestTime(driver1);
        const d2Times = bestTime(driver2);
        const comparison = compareDriverTimes(d1Times, d2Times);

        // Define session colors
        const sessionColors = {
            'Q1': '#ffcdd2',
            'Q2': '#fff9c4',
            'Q3': '#e1bee7'
        };

        cells.push(
            { text: comparison.d1Time || "N/A", align: "center" },
            { text: comparison.d2Time || "N/A", align: "center" }
        );

        if (!comparison.sessionUsed || !comparison.d1Time || !comparison.d2Time) {
            cells.push(
                { text: "No comparable times", align: "center" },
                { text: "N/A", align: "center" },
                { text: "N/A", align: "center" }
            );
        } else {
            currentTable.raceCount++;
            
            const d1TimeMs = convertTimeString(comparison.d1Time);
            const d2TimeMs = convertTimeString(comparison.d2Time);
            const timeDifference = d2TimeMs - d1TimeMs;
            const percentageDifference = (timeDifference / d1TimeMs) * 100;

            currentTable.timeDifferences.push(timeDifference);
            currentTable.percentageDifferences.push(percentageDifference);
            // Store round number along with the delta percentage
            currentTable.deltaPercentages.push([parseInt(races[i].round), percentageDifference]);

            if (timeDifference > 0) {
                currentTable.driver1Better++;
            }

            const time = millisecondsToStruct(timeDifference);
            const tdColor = time.isNegative ? "#FF7878" : "#85FF78";

            cells[0].backgroundColor = tdColor;
            cells[1].backgroundColor = tdColor;

            cells.push(
                { 
                    text: `${time.isNegative ? "-" : "+"}${time.minutes > 0 ? time.minutes+":" : ""}${time.seconds}.${time.milliseconds.toString().padStart(3, '0')}`,
                    align: "center"
                },
                { 
                    text: `${percentageDifference > 0 ? "+" : ""}${percentageDifference.toFixed(3)}%`,
                    align: "center"
                },
                { 
                    text: comparison.sessionUsed || "N/A", 
                    align: "center",
                    backgroundColor: comparison.sessionUsed ? sessionColors[comparison.sessionUsed] : null 
                }
            );
        }

        // Create all cells with consistent styling
        cells.forEach(cellData => {
            const td = document.createElement("td");
            td.textContent = cellData.text;
            td.style.padding = "8px";
            td.style.textAlign = cellData.align;
            if (cellData.backgroundColor) {
                td.style.backgroundColor = cellData.backgroundColor;
            }
            tr.appendChild(td);
        });
    }

    // Display summary statistics for each table
    tableList.forEach(table => {
        displayMedianResults(table);
    });
}

// Add constructors to dropdown list
function fillConstructorsList(list, currentSelect){
    const select = document.getElementById("constructorList");
    select.innerHTML = "";
    list.MRData.ConstructorTable.Constructors.forEach((elm) =>{
        const option = document.createElement("option");
        option.value = elm.name;
        option.innerHTML = elm.name;
        option.id = elm.constructorId;
        select.appendChild(option);
        // Keep current constructor selected if available
        if (elm.name == currentSelect){
            select.value = currentSelect;
        }
    });
}

async function displayResults(){
    const yearList = document.getElementById("seasonList");
    const constructorList = document.getElementById("constructorList");
    
    const options = constructorList.options;
    const constructorId = options[options.selectedIndex].id;
    const year = yearList.value;

    const qualifying = await getQualifying(year, constructorId);
    createQualifyingTable(qualifying);
}

function switchTab(tab) {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    document.getElementById('qualifying-content').style.display = tab === 'qualifying' ? 'block' : 'none';
    document.getElementById('history-content').style.display = tab === 'history' ? 'block' : 'none';
    document.querySelector(`.tab-button[data-tab="${tab}"]`).classList.add('active');
}

async function fillYearSelectors() {
    const years = await getSeasons();
    if (!years) return;

    const yearOptions = years.MRData.SeasonTable.Seasons.reverse().map(s => s.season);
    ['startYearList', 'endYearList'].forEach(id => {
        const select = document.getElementById(id);
        select.innerHTML = yearOptions.map(year => 
            `<option value="${year}">${year}</option>`
        ).join('');
    });

    // Fill constructor list for history tab
    const list = await getConstructors(yearOptions[0]);
    if (list) {
        const historyConstructor = document.getElementById('historyConstructorList');
        historyConstructor.innerHTML = list.MRData.ConstructorTable.Constructors.map(team => 
            `<option value="${team.name}" id="${team.constructorId}">${team.name}</option>`
        ).join('');
    }
}

async function showHistoryResults() {
    const startYear = parseInt(document.getElementById('startYearList').value);
    const endYear = parseInt(document.getElementById('endYearList').value);
    const constructorId = document.getElementById('historyConstructorList').options[
        document.getElementById('historyConstructorList').selectedIndex
    ].id;

    if (startYear > endYear) {
        alert('Start year must be less than or equal to end year');
        return;
    }

    const tableRows = [];
    for(let year = startYear; year <= endYear; year++) {
        const data = await getQualifying(year, constructorId);
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
                if (timeDiff < 0) driver1Wins++;  // Changed condition to match original logic
                totalRaces++;
            }
        });

        if (totalRaces > 0) {
            // Calculate median using the same function as in qualifying comparison
            const medianGap = calculateMedian(timeGaps);
            
            tableRows.push(`
                <tr>
                    <td>${year}</td>
                    <td>${driver1}</td>
                    <td>${driver2}</td>
                    <td>${medianGap.toFixed(3)}%</td>
                    <td>${driver1Wins} - ${totalRaces - driver1Wins}</td>
                </tr>
            `);
        }
    }

    document.getElementById('historyTable').innerHTML = `
        <table class="history-table">
            <tr>
                <th>Year</th>
                <th>Driver 1</th>
                <th>Driver 2</th>
                <th>Median Gap %</th>
                <th>Qualifying Score</th>
            </tr>
            ${tableRows.join('')}
        </table>
    `;
}

function bootstrapConfidenceInterval(data, confidence = 0.95, iterations = 10000) {
    if (data.length < 2) return { lower: NaN, upper: NaN };
    
    // Function to calculate median of an array
    const calculateMedian = arr => {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
    };
    
    // Function to sample with replacement
    const sample = (arr) => {
        const result = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
            result[i] = arr[Math.floor(Math.random() * arr.length)];
        }
        return result;
    };
    
    // Generate bootstrap samples and calculate medians
    const bootstrapMedians = new Array(iterations);
    for (let i = 0; i < iterations; i++) {
        bootstrapMedians[i] = calculateMedian(sample(data));
    }
    
    // Sort the medians to find percentile-based confidence interval
    bootstrapMedians.sort((a, b) => a - b);
    
    const alpha = 1 - confidence;
    const lowerIndex = Math.floor((alpha / 2) * iterations);
    const upperIndex = Math.floor((1 - alpha / 2) * iterations);
    
    return {
        lower: bootstrapMedians[lowerIndex],
        upper: bootstrapMedians[upperIndex]
    };
}


async function main() {
    // Initialize qualifying tab
    const seasonList = document.getElementById("seasonList");
    seasonList.addEventListener("change", selectOnChange);
    document.getElementById("go").addEventListener("click", displayResults);

    // Get seasons data
    const results = await getSeasons();
    if (results) {
        const seasons = results.MRData.SeasonTable.Seasons.reverse();
        const currentYear = seasons[0].season;

        // Fill constructor list for qualifying tab
        const constructorList = await getConstructors(currentYear);
        if (constructorList) {
            fillConstructorsList(constructorList);
        }

        // Fill season list for qualifying tab
        seasonList.innerHTML = seasons.map(season => 
            `<option value="${season.season}">${season.season}</option>`
        ).join('');

        // Fill year selectors for history tab
        ['startYearList', 'endYearList'].forEach(id => {
            document.getElementById(id).innerHTML = seasons.map(season => 
                `<option value="${season.season}">${season.season}</option>`
            ).join('');
        });

        // Fill constructor list for history tab
        if (constructorList) {
            document.getElementById('historyConstructorList').innerHTML = 
                constructorList.MRData.ConstructorTable.Constructors.map(team => 
                    `<option value="${team.name}" id="${team.constructorId}">${team.name}</option>`
                ).join('');
        }
    }

    // Initialize history tab
    document.getElementById("historyGo").addEventListener("click", showHistoryResults);
}

window.addEventListener("load", () => {
    main();
});

