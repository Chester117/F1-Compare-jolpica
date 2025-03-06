async function getSeasons(){
    return fetchData("https://api.jolpi.ca/ergast/f1/seasons.json?offset=44&limit=100");
}

async function getConstructors(year){
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/constructors.json`);
}

async function getQualifying(year, constructorId){
    return fetchData(`https://api.jolpi.ca/ergast/f1/${year}/constructors/${constructorId}/qualifying.json?limit=60`);
}

async function fetchData(url){
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

// Calculate median of array
function calculateMedian(numbers) {
    if (numbers.length === 0) return 0;
    
    const sorted = numbers.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
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
                if (timeDiff < 0) driver1Wins++;
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

function initHistoryTab() {
    // Initialize history tab
    document.getElementById("historyGo").addEventListener("click", showHistoryResults);
    
    // Fill year and constructor selectors
    fillYearSelectors();
}

// Initialize when DOM content is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the history tab based on URL or other logic
    initHistoryTab();
});

// Make switchTab function available globally to handle tab switching
window.switchTabHistory = function(tab) {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active');
    });
    
    document.getElementById('qualifying-content').style.display = tab === 'qualifying' ? 'block' : 'none';
    document.getElementById('history-content').style.display = tab === 'history' ? 'block' : 'none';
    document.querySelector(`.tab-button[data-tab="${tab}"]`).classList.add('active');
};
