// 全局共享：等待 Highcharts CDN 加载完成的守卫。
// 多个图表实例（排位赛/历史/正赛点云）共用同一个 polling，避免重复定时器。
// 用法：window.__waitHighchartsReady(onReady [, onTimeout])
if (typeof window !== 'undefined' && typeof window.__waitHighchartsReady !== 'function') {
    window.__applyF1HighchartsTheme = function() {
        if (window.__F1HighchartsThemeApplied || typeof Highcharts === 'undefined') return;
        window.__F1HighchartsThemeApplied = true;
        Highcharts.setOptions({
            colors: ['#ff3d4f', '#00d294', '#20b8ff', '#ffc247', '#9da7ff', '#ff8a3d'],
            chart: {
                backgroundColor: '#0f141d',
                plotBackgroundColor: 'rgba(255,255,255,0.025)',
                plotBorderColor: 'rgba(255,255,255,0.1)',
                borderRadius: 8,
                style: {
                    fontFamily: 'Noto Sans SC, Source Han Sans SC, Microsoft YaHei, Segoe UI, sans-serif'
                }
            },
            title: {
                style: {
                    color: '#f3f7ff',
                    fontWeight: '800'
                }
            },
            subtitle: {
                style: {
                    color: '#98a4b7'
                }
            },
            xAxis: {
                gridLineColor: 'rgba(255,255,255,0.07)',
                lineColor: 'rgba(255,255,255,0.18)',
                tickColor: 'rgba(255,255,255,0.18)',
                labels: { style: { color: '#b9c6d8' } },
                title: { style: { color: '#d8e2f0', fontWeight: '700' } }
            },
            yAxis: {
                gridLineColor: 'rgba(255,255,255,0.08)',
                lineColor: 'rgba(255,255,255,0.18)',
                tickColor: 'rgba(255,255,255,0.18)',
                labels: { style: { color: '#b9c6d8' } },
                title: { style: { color: '#d8e2f0', fontWeight: '700' } }
            },
            legend: {
                itemStyle: { color: '#d8e2f0', fontWeight: '700' },
                itemHoverStyle: { color: '#ffffff' },
                itemHiddenStyle: { color: '#6f7a8e' }
            },
            tooltip: {
                backgroundColor: 'rgba(8, 10, 14, 0.96)',
                borderColor: '#ff3d4f',
                borderRadius: 6,
                style: { color: '#ffffff' }
            },
            accessibility: { enabled: false },
            credits: { enabled: false }
        });
    };
    window.__waitHighchartsReady = function(onReady, onTimeout) {
        if (typeof Highcharts !== 'undefined') {
            window.__applyF1HighchartsTheme();
            try { onReady(); } catch (e) { console.warn(e); }
            return;
        }
        const waiters = (window.__F1HighchartsWaiters = window.__F1HighchartsWaiters || []);
        waiters.push({ onReady, onTimeout });
        if (window.__F1HighchartsPoller) return;
        let tries = 0;
        const maxTries = 200; // ~20s
        window.__F1HighchartsPoller = setInterval(() => {
            tries++;
            if (typeof Highcharts !== 'undefined') {
                clearInterval(window.__F1HighchartsPoller);
                window.__F1HighchartsPoller = null;
                window.__applyF1HighchartsTheme();
                const list = window.__F1HighchartsWaiters || [];
                window.__F1HighchartsWaiters = [];
                list.forEach(w => { try { w.onReady(); } catch (e) { console.warn(e); } });
            } else if (tries >= maxTries) {
                clearInterval(window.__F1HighchartsPoller);
                window.__F1HighchartsPoller = null;
                console.error('[F1] Highcharts failed to load after 20s');
                const list = window.__F1HighchartsWaiters || [];
                window.__F1HighchartsWaiters = [];
                list.forEach(w => { if (typeof w.onTimeout === 'function') { try { w.onTimeout(); } catch (e) { console.warn(e); } } });
            }
        }, 100);
    };
}

function QualifyingTrendGraph(container, data, driver1Name, driver2Name) {
    // Base state
    const state = {
        filteredData: [...data],
        // Manual exclusions from external UI (identified by x value, i.e., sequence number)
        manualExcluded: new Set(),
        // Manual inclusions to override threshold filtering
        manualIncluded: new Set(),
        currentSegments: 1,
        activeThreshold: 2,
        trendOnlyGraph: null,
        mainChart: null,
        trendChart: null,
        isZeroLineRed: true,
        showTrendInMain: true,
        showDataPointsInTrend: false,
        driver1LastName: driver1Name.split(' ').pop(),
        driver2LastName: driver2Name.split(' ').pop()
    };

    // Helper functions
    function createButton(text, onClick) {
        const button = document.createElement('button');
        button.textContent = text;
        button.className = 'chart-control-button';
        button.addEventListener('click', onClick);
        return button;
    }

    function createSelect(options, onChange) {
        const select = document.createElement('select');
        select.className = 'chart-control-select';
        options.forEach(({ value, text }) => {
            const option = document.createElement('option');
            option.value = value;
            option.text = text;
            select.appendChild(option);
        });
        select.addEventListener('change', onChange);
        return select;
    }

    // Chart creation and update functions
    function getChartConfig(chartData, trends, yMin, yMax, isTrendOnly = false) {
        return {
            chart: {
                type: 'line',
                height: '400px',
                events: {
                    load: function() {
                        const containerId = `export-${Date.now()}`;
                        const exportContainer = document.createElement('div');
                        exportContainer.id = containerId;
                        this.container.parentNode.appendChild(exportContainer);
                        
                        const exportButton = createButton('Download High-Res Image', () => {
                            this.exportChart({
                                type: 'image/png',
                                filename: 'qualifying-comparison',
                                scale: 3,
                                width: 3600,
                                sourceWidth: 3600,
                                sourceHeight: 2400
                            });
                        });
                        exportContainer.appendChild(exportButton);
                    }
                }
            },
            title: { 
                text: isTrendOnly ? 'Trend Line' : 'Qualifying Gap Trend',
                style: { fontSize: '18px', fontWeight: 'bold' }
            },
            xAxis: {
                title: { text: 'Race Number', style: { fontSize: '14px' } },
                allowDecimals: false,
                labels: { style: { fontSize: '12px' } }
            },
            yAxis: {
                title: { text: 'Delta %', style: { fontSize: '14px' } },
                min: yMin,
                max: yMax,
                labels: { format: '{value:.1f}%', style: { fontSize: '12px' } },
                plotLines: [{
                    color: '#ff3d4f',
                    width: 2,
                    value: 0,
                    zIndex: 2
                }],
                plotBands: [
                    {
                        from: 0,
                        to: yMax,
                        color: 'rgba(0, 0, 0, 0)',
                        label: {
                            text: `${state.driver1LastName} is Faster`,
                            align: 'left',
                            x: 10,
                            style: { color: '#9fb0c6', fontSize: '12px', fontWeight: '700' }
                        }
                    },
                    {
                        from: yMin,
                        to: 0,
                        color: 'rgba(0, 0, 0, 0)',
                        label: {
                            text: `${state.driver2LastName} is Faster`,
                            align: 'left',
                            x: 10,
                            style: { color: '#9fb0c6', fontSize: '12px', fontWeight: '700' }
                        }
                    }
                ]
            },
            tooltip: {
                formatter: function() {
                    return `Race ${this.x}<br/>${this.series.name}: ${Number(this.y).toFixed(3)}%`;
                },
                style: { fontSize: '12px' }
            },
            legend: {
                enabled: state.currentSegments > 1 || !isTrendOnly,
                itemStyle: { fontSize: '12px' }
            },
            series: createSeries(chartData, trends, isTrendOnly),
            credits: { enabled: false }
        };
    }

    function createSeries(data, trends, isTrendOnly) {
        if (isTrendOnly) {
            return [
                ...(state.showDataPointsInTrend ? [{
                    name: 'Data Points',
                    data: data,
                    color: 'rgba(32, 184, 255, 0.28)',
                    marker: { enabled: true, radius: 3 },
                    lineWidth: 1,
                    connectNulls: false,
                    enableMouseTracking: false
                }] : []),
                ...trends.map(trend => ({
                    ...trend,
                    lineWidth: 4
                }))
            ];
        }
    
        return [
            {
                name: 'Qualifying Gap',
                data: data,
                color: '#ff3d4f',
                marker: { enabled: true, radius: 4.5, lineWidth: 1, lineColor: '#fff5f6' },
                connectNulls: false
            },
            ...(state.showTrendInMain ? trends : [])
        ];
    }

    function calculateTrends(data) {
        if (data.length < 2) return [];

        // Sort data by round number
        data.sort((a, b) => a[0] - b[0]);
        
        // Calculate points per segment
        const totalPoints = data.length;
        const pointsPerSegment = Math.ceil(totalPoints / state.currentSegments);
        
        const colors = ['#00d294', '#20b8ff', '#ffc247', '#9da7ff', '#ff8a3d', '#ff6fb0', '#70e0ff', '#b9c6d8'];
        const segments = [];

        for (let i = 0; i < state.currentSegments; i++) {
            const start = i * pointsPerSegment;
            const end = Math.min(start + pointsPerSegment, totalPoints);
            
            // Include one point before and after the segment (if they exist)
            const segmentStart = Math.max(0, start - (i > 0 ? 1 : 0));
            const segmentEnd = Math.min(totalPoints, end + (i < state.currentSegments - 1 ? 1 : 0));
            const segmentData = data.slice(segmentStart, segmentEnd);
            
            if (segmentData.length > 1) {
                // Calculate linear regression
                const xValues = segmentData.map(d => d[0]);
                const yValues = segmentData.map(d => d[1]);
                const xMean = xValues.reduce((a, b) => a + b, 0) / xValues.length;
                const yMean = yValues.reduce((a, b) => a + b, 0) / yValues.length;
                
                let numerator = 0;
                let denominator = 0;
                let ssTot = 0;
                let ssRes = 0; // will compute after slope/intercept
                for (let j = 0; j < xValues.length; j++) {
                    numerator += (xValues[j] - xMean) * (yValues[j] - yMean);
                    denominator += Math.pow(xValues[j] - xMean, 2);
                    ssTot += Math.pow(yValues[j] - yMean, 2);
                }
                
                const slope = numerator / denominator;
                const intercept = yMean - slope * xMean;
                
                // Generate trend line points
                const trendData = [];
                const firstX = xValues[0];
                const lastX = xValues[xValues.length - 1];
                
                // Create points for each actual round in the segment
                for (let x = firstX; x <= lastX; x++) {
                    if (xValues.includes(x)) {
                        const y = slope * x + intercept;
                        trendData.push([x, Number(y.toFixed(3))]);
                    }
                }
                // Compute residuals and R^2
                for (let j = 0; j < xValues.length; j++) {
                    const yHat = slope * xValues[j] + intercept;
                    ssRes += Math.pow(yValues[j] - yHat, 2);
                }
                const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 1;
                const startY = slope * firstX + intercept;
                const endY = slope * lastX + intercept;
                const delta = endY - startY;
                
                segments.push({
                    name: `Trend ${state.currentSegments > 1 ? (i + 1) : ''}`,
                    data: trendData,
                    dashStyle: 'solid',
                    color: colors[i % colors.length],
                    lineWidth: 4,
                    marker: { enabled: false },
                    custom: {
                        slope,
                        intercept,
                        r2,
                        startX: firstX,
                        endX: lastX,
                        startY,
                        endY,
                        delta
                    }
                });
            }
        }
        
        return segments;
    }

    // UI Controls
    function createControls() {
        const controlRow = document.createElement('div');
        controlRow.className = 'chart-controls';
        
        // Segments control
        const segmentControl = document.createElement('div');
        segmentControl.className = 'control-group';
        
        const segmentLabel = document.createElement('label');
        segmentLabel.textContent = 'Trend Line Segments:';
        segmentControl.appendChild(segmentLabel);
        
        const segmentSelect = createSelect(
            [1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ value: n, text: n })),
            e => {
                state.currentSegments = parseInt(e.target.value);
                updateCharts();
            }
        );
        segmentControl.appendChild(segmentSelect);
        controlRow.appendChild(segmentControl);
    
        // Filter control
        const filterControl = document.createElement('div');
        filterControl.className = 'control-group';
        
        const filterLabel = document.createElement('label');
        filterLabel.textContent = 'Filter Extreme Value:';
        filterControl.appendChild(filterLabel);
        
        const filterSelect = createSelect(
            [
                { value: 0, text: 'No Filter' },
                ...([1, 1.5, 2, 3, 5].map(n => ({ value: n, text: `>${n}%` })))
            ],
            e => handleFilterChange(parseFloat(e.target.value))
        );
        filterControl.appendChild(filterSelect);
        controlRow.appendChild(filterControl);
    
        // Buttons
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'button-group';
        
        const buttons = [
            createButton('Zero Line', toggleZeroLine),
            createButton('Trend', toggleTrend),
            createButton('Separate Trend', toggleSeparateTrend)
        ];
        // Set initial visual states to match defaults
        buttons[0].classList.add('active-button'); // zero line red by default
        if (state.showTrendInMain) {
            buttons[1].classList.add('active-button');
        }
        buttons.forEach(button => buttonGroup.appendChild(button));
        controlRow.appendChild(buttonGroup);
        
        container.appendChild(controlRow);
    }

    // 委托给顶层共享的 Highcharts 就绪守卫；显示本实例的加载占位
    function whenHighchartsReady(cb) {
        const mainEl = container.querySelector('.main-chart');
        if (typeof Highcharts === 'undefined' && mainEl && !mainEl.dataset.waitingHighcharts) {
            mainEl.dataset.waitingHighcharts = '1';
            mainEl.innerHTML = '<div class="loading-text" style="text-align:center;padding:30px;">图表库加载中…</div>';
        }
        window.__waitHighchartsReady(cb, () => {
            if (mainEl) {
                mainEl.innerHTML = '<div class="loading-text" style="text-align:center;padding:30px;color:#b85e00;">图表库（Highcharts CDN）加载失败，请检查网络后刷新页面。</div>';
            }
        });
    }

    // Update charts with current data
    function updateCharts() {
        whenHighchartsReady(() => {
            const chartData = prepareChartData();
            renderTrendStats(chartData.trends);

            // Update main chart
            if (state.mainChart) {
                state.mainChart.destroy();
            }
            state.mainChart = Highcharts.chart(
                container.querySelector('.main-chart'),
                getChartConfig(chartData.data, chartData.trends, chartData.yMin, chartData.yMax)
            );

            // Update trend chart if it exists
            if (state.trendOnlyGraph) {
                if (state.trendChart) {
                    state.trendChart.destroy();
                }
                state.trendChart = Highcharts.chart(
                    state.trendOnlyGraph,
                    getChartConfig(chartData.data, chartData.trends, chartData.yMin, chartData.yMax, true)
                );
            }
        });
    }

    function toggleZeroLine() {
        state.isZeroLineRed = !state.isZeroLineRed;
        this.classList.toggle('active-button');
        
        const updateZeroLine = (chart) => {
            if (!chart) return;
            const zeroLine = chart.yAxis[0].plotLinesAndBands[0];
            zeroLine.svgElem?.attr({
                stroke: state.isZeroLineRed ? '#ff3333' : '#CCCCCC'
            });
        };
        
        updateZeroLine(state.mainChart);
        updateZeroLine(state.trendChart);
    }

    function toggleTrend() {
        state.showTrendInMain = !state.showTrendInMain;
        this.classList.toggle('active-button');
        updateCharts();
    }

    function toggleSeparateTrend() {
        if (!state.trendOnlyGraph) {
            // Create separate trend graph
            const graphContainer = document.createElement('div');
            graphContainer.className = 'trend-only-graph';
            container.appendChild(graphContainer);
            
            const toggleButton = createButton('Show Data Points', () => {
                state.showDataPointsInTrend = !state.showDataPointsInTrend;
                toggleButton.classList.toggle('active-button');
                updateCharts();
            });
            container.appendChild(toggleButton);
            
            state.trendOnlyGraph = graphContainer;
            this.classList.add('active-button');
            state.showTrendInMain = false;
        } else {
            // Remove separate trend graph
            container.removeChild(state.trendOnlyGraph.nextSibling); // Remove toggle button
            container.removeChild(state.trendOnlyGraph);
            state.trendOnlyGraph = null;
            this.classList.remove('active-button');
            state.showTrendInMain = true;
        }
        updateCharts();
    }

    function prepareChartData() {
        const filteredFullData = state.filteredData.map((point) => {
            const seq = point[0];
            const val = point[1];
            const overThreshold = state.activeThreshold && Math.abs(val) > state.activeThreshold;
            const manuallyExcluded = state.manualExcluded.has(seq);
            const manuallyIncluded = state.manualIncluded.has(seq);
            // Exclusion priority: manualExcluded > threshold (unless manuallyIncluded overrides threshold)
            if (manuallyExcluded || (overThreshold && !manuallyIncluded)) {
                return [seq, null];
            }
            return [seq, val !== null ? Number(val.toFixed(3)) : null];
        });
        
        const validFilteredData = filteredFullData
            .filter(point => point[1] !== null)
            .map(point => [point[0], point[1]]);
        
        const trends = calculateTrends(validFilteredData);
        
        const validValues = validFilteredData.map(point => point[1]);

        let yMin = -1;
        let yMax = 1;
        if (validValues.length > 0) {
            const dataMin = Math.min(...validValues, 0);
            const dataMax = Math.max(...validValues, 0);
            const span = Math.max(0.1, dataMax - dataMin);
            const padding = Math.max(0.1, span * 0.1);
            yMin = dataMin - padding;
            yMax = dataMax + padding;
        }
        
        return { data: filteredFullData, trends, yMin, yMax };
    }

    // Initialize chart
    // External controller plumbing
    const thresholdListeners = new Set();
    function emitThresholdChange() {
        thresholdListeners.forEach(fn => {
            try { fn(state.activeThreshold); } catch (_) { /* ignore */ }
        });
    }

    function handleFilterChange(threshold) {
        state.activeThreshold = threshold || 0;
        updateCharts();
        emitThresholdChange();
    }

    function initialize() {
        // Create main chart container
        const mainChartContainer = document.createElement('div');
        mainChartContainer.className = 'main-chart';
        container.appendChild(mainChartContainer);
        // Create stats container
        const statsContainer = document.createElement('div');
        statsContainer.className = 'trend-stats';
        container.appendChild(statsContainer);

        // Create UI controls
        createControls();

        // Set initial state and apply it
        setTimeout(() => {
            // Set defaults
            const segmentSelect = container.querySelector('select');
            if (segmentSelect) segmentSelect.value = '1';

            const filterSelect = container.querySelectorAll('select')[1];
            if (filterSelect) filterSelect.value = '2';

            // Apply initial filter
            handleFilterChange(2);

            // Buttons already initialized with correct active state in createControls

            updateCharts();
        }, 0);
    }

    // Add CSS for controls
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .chart-controls {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                align-items: center;
                gap: 10px;
                margin: 14px 0 18px;
                padding: 10px;
                border: 1px solid rgba(255,255,255,0.14);
                border-radius: 8px;
                background: rgba(0,0,0,0.22);
            }
            .control-group {
                display: flex;
                align-items: center;
                gap: 8px;
                color: #aeb8c7;
                font-size: 13px;
                font-weight: 800;
            }
            .button-group {
                display: flex;
                gap: 10px;
            }
            .chart-control-button {
                padding: 8px 16px;
                min-height: 40px;
                background: rgba(255,255,255,0.09);
                color: #fff;
                border: 1px solid rgba(255,255,255,0.24);
                border-radius: 6px;
                cursor: pointer;
                font-weight: 700;
                transition: background 0.18s ease, border-color 0.18s ease;
            }
            .chart-control-button:hover {
                background: rgba(255,255,255,0.15);
                border-color: rgba(255,255,255,0.42);
            }
            .chart-control-button.active-button {
                background: linear-gradient(135deg, #00d294, #00996e);
                color: #04110d;
            }
            .chart-control-select {
                min-height: 40px;
                background:
                    linear-gradient(180deg, rgba(255,255,255,0.11), rgba(255,255,255,0.045)),
                    #15161a;
                color: #f7f7f8;
                padding: 5px 10px;
                border: 1px solid rgba(255,255,255,0.24);
                border-radius: 6px;
                font-weight: 700;
            }
            .excluded-points {
                padding: 10px;
                background: rgba(255,255,255,0.06);
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 8px;
                margin-top: 10px;
                text-align: center;
                color: #d8e2f0;
            }
            .trend-only-graph {
                width: 100%;
                height: 400px;
                margin-top: 20px;
            }
            .main-chart {
                width: 100%;
                height: 400px;
            }
            .trend-stats {
                margin-top: 12px;
                font-size: 13px;
                color: #b9c6d8;
                display: flex;
                flex-direction: column;
                gap: 6px;
                padding: 10px 12px;
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 8px;
                background: rgba(255,255,255,0.045);
            }
            .trend-stat-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .trend-color {
                width: 12px;
                height: 12px;
                border-radius: 2px;
                display: inline-block;
            }
            .trend-stat-text {
                line-height: 1.3;
            }
            .help-hint {
                cursor: help;
                text-decoration: underline dotted;
                text-underline-offset: 2px;
            }
        `;
        document.head.appendChild(style);
    }

    // Public controller to interact with external UI (e.g., per-race checkboxes)
    const controller = {
        setExcluded: (seqArray) => {
            state.manualExcluded = new Set(Array.isArray(seqArray) ? seqArray : []);
            updateCharts();
        },
        setIncluded: (seqArray) => {
            state.manualIncluded = new Set(Array.isArray(seqArray) ? seqArray : []);
            updateCharts();
        },
        getExcluded: () => Array.from(state.manualExcluded),
        getIncluded: () => Array.from(state.manualIncluded),
        getThreshold: () => state.activeThreshold,
        setThreshold: (threshold) => {
            // try to sync UI select if present
            try {
                const selects = container.querySelectorAll('select');
                const filterSelect = selects && selects[1];
                if (filterSelect) {
                    filterSelect.value = String(threshold || 0);
                }
            } catch (_) { /* ignore */ }
            handleFilterChange(threshold || 0);
        },
        onThresholdChange: (fn) => { if (typeof fn === 'function') thresholdListeners.add(fn); return () => thresholdListeners.delete(fn); },
        refresh: () => updateCharts()
    };

    // Render trend statistics beneath the chart
    function renderTrendStats(trends) {
        const statsRoot = container.querySelector('.trend-stats');
        if (!statsRoot) return;
        if (!trends || trends.length === 0) {
            statsRoot.textContent = 'No trend data available';
            return;
        }
        statsRoot.innerHTML = '';
        trends.forEach((t, idx) => {
            const row = document.createElement('div');
            row.className = 'trend-stat-row';
            const colorBox = document.createElement('span');
            colorBox.className = 'trend-color';
            colorBox.style.backgroundColor = t.color || '#000';
            const text = document.createElement('span');
            text.className = 'trend-stat-text';
            const c = t.custom || {};
            const slopePerRace = typeof c.slope === 'number' ? c.slope : 0;
            const delta = typeof c.delta === 'number' ? c.delta : 0;
            const r2 = typeof c.r2 === 'number' ? c.r2 : NaN;
            // Build rich, hover-explained metrics
            const nameNode = document.createTextNode(`${t.name || 'Trend'}: `);

            const slopeSpan = document.createElement('span');
            slopeSpan.className = 'help-hint';
            slopeSpan.title = 'Slope: Average change in the qualifying gap per race within this segment. Positive = trending upward (more positive gap); negative = trending downward.';
            slopeSpan.textContent = `slope ${slopePerRace.toFixed(4)} %/race`;

            const comma1 = document.createTextNode(', ');

            const changeSpan = document.createElement('span');
            changeSpan.className = 'help-hint';
            changeSpan.title = 'Change (Δ%): Predicted total change from the first to the last race in this segment based on the trend line.';
            changeSpan.textContent = `change ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}%`;

            const comma2 = document.createTextNode(', ');

            const r2Span = document.createElement('span');
            r2Span.className = 'help-hint';
            r2Span.title = 'R² (coefficient of determination): How well the linear trend explains the variation in the data (1 = perfect fit, 0 = no linear relationship).';
            r2Span.textContent = `R² ${isNaN(r2) ? 'N/A' : r2.toFixed(3)}`;

            const space = document.createTextNode(' ');

            const spanSpan = document.createElement('span');
            spanSpan.className = 'help-hint';
            spanSpan.title = 'Segment span: The race numbers covered by this trend segment (start → end).';
            spanSpan.textContent = `(${c.startX ?? ''}→${c.endX ?? ''})`;

            text.appendChild(nameNode);
            text.appendChild(slopeSpan);
            text.appendChild(comma1);
            text.appendChild(changeSpan);
            text.appendChild(comma2);
            text.appendChild(r2Span);
            text.appendChild(space);
            text.appendChild(spanSpan);
            row.appendChild(colorBox);
            row.appendChild(text);
            statsRoot.appendChild(row);
        });
    }

    // Run initialization
    addStyles();
    initialize();
    return controller;
}
