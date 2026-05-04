import { appState } from '../state.js';
import { showToast } from './toast.js';

const ENGINE_IDS = ['3dmol', 'molstar', 'jsmol', 'ngl'];
const ENGINE_LABELS = {
    '3dmol': '3Dmol.js',
    molstar: 'Mol*',
    jsmol: 'JSmol',
    ngl: 'NGL'
};

const METRIC_DEFS = [
    { key: 'vectorialOutput', label: 'Vectorial Output', kind: 'boolean', defaultWeight: 4 },
    { key: 'librarySizeKb', label: 'Library Size (KB)', kind: 'inverse-numeric', defaultWeight: 3 },
    { key: 'performanceFps', label: 'Performance / FPS', kind: 'numeric', defaultWeight: 5 },
    { key: 'coloringComplexity', label: 'Custom Coloring API Complexity', kind: 'subjective', defaultWeight: 4 },
    { key: 'angularCompatibility', label: 'Angular Compatibility', kind: 'subjective', defaultWeight: 3 },
    { key: 'visualBeauty', label: 'Visual Rendering / Beauty', kind: 'subjective', defaultWeight: 4 }
];

// Official CDN artifact sizes used by this project (captured on 2026-04-19).
const OFFICIAL_LIBRARY_SIZE_KB = {
    '3dmol': 481.28,
    molstar: 5523.43,
    jsmol: 221.05,
    ngl: 1284.01
};

const benchmarkState = {
    isInitialized: false,
    isOpen: false,
    weights: {
        vectorialOutput: 4,
        librarySizeKb: 3,
        performanceFps: 5,
        coloringComplexity: 4,
        angularCompatibility: 3,
        visualBeauty: 4
    },
    engines: {
        '3dmol': {
            vectorialOutput: false,
            librarySizeKb: OFFICIAL_LIBRARY_SIZE_KB['3dmol'],
            performanceFps: 52,
            coloringComplexity: 8,
            angularCompatibility: 8,
            visualBeauty: 7
        },
        molstar: {
            vectorialOutput: true,
            librarySizeKb: OFFICIAL_LIBRARY_SIZE_KB.molstar,
            performanceFps: 45,
            coloringComplexity: 6,
            angularCompatibility: 9,
            visualBeauty: 9
        },
        jsmol: {
            vectorialOutput: false,
            librarySizeKb: OFFICIAL_LIBRARY_SIZE_KB.jsmol,
            performanceFps: 24,
            coloringComplexity: 5,
            angularCompatibility: 6,
            visualBeauty: 4
        },
        ngl: {
            vectorialOutput: false,
            librarySizeKb: OFFICIAL_LIBRARY_SIZE_KB.ngl,
            performanceFps: 58,
            coloringComplexity: 7,
            angularCompatibility: 8,
            visualBeauty: 8
        }
    }
};

let benchmarkRoot = null;
let benchmarkBackdrop = null;
let benchmarkOpenButton = null;
let benchmarkCloseButton = null;
let benchmarkInputContainer = null;
let benchmarkSummaryBody = null;
let benchmarkBars = null;
let benchmarkFpsButton = null;
let benchmarkFpsStatus = null;

// Initializes benchmark dashboard controls and event wiring.
export function initializeBenchmarkDashboard() {
    if (benchmarkState.isInitialized) return;

    benchmarkRoot = document.getElementById('benchmarkOverlay');
    benchmarkBackdrop = document.getElementById('benchmarkBackdrop');
    benchmarkOpenButton = document.getElementById('benchmarkBtn');
    benchmarkCloseButton = document.getElementById('benchmarkCloseBtn');
    benchmarkInputContainer = document.getElementById('benchmarkMatrixContainer');
    benchmarkSummaryBody = document.getElementById('benchmarkSummaryBody');
    benchmarkBars = document.getElementById('benchmarkBars');
    benchmarkFpsButton = document.getElementById('benchmarkFpsBtn');
    benchmarkFpsStatus = document.getElementById('benchmarkFpsStatus');

    if (!benchmarkRoot || !benchmarkOpenButton || !benchmarkInputContainer || !benchmarkSummaryBody || !benchmarkBars) {
        return;
    }

    renderMatrixInputs();
    recalculateAndRender();

    benchmarkOpenButton.addEventListener('click', () => toggleDashboard());

    if (benchmarkCloseButton) {
        benchmarkCloseButton.addEventListener('click', () => closeDashboard());
    }

    if (benchmarkBackdrop) {
        benchmarkBackdrop.addEventListener('click', () => closeDashboard());
    }

    if (benchmarkFpsButton) {
        benchmarkFpsButton.addEventListener('click', async () => {
            if (benchmarkFpsButton.disabled) return;

            benchmarkFpsButton.disabled = true;
            setFpsStatus('Running FPS probe...');

            try {
                const result = await runActiveEngineFpsProbe();
                if (!result.ok) {
                    setFpsStatus(result.reason || 'FPS probe failed.');
                    if (result.reason) showToast(result.reason, true);
                    return;
                }

                benchmarkState.engines[result.engineId].performanceFps = Math.round(result.averageFps * 10) / 10;
                const input = getMetricInput(result.engineId, 'performanceFps');
                if (input) input.value = benchmarkState.engines[result.engineId].performanceFps;

                setFpsStatus(`Measured ${ENGINE_LABELS[result.engineId]} at ${result.averageFps.toFixed(1)} FPS.`);
                recalculateAndRender();
                showToast(`FPS probe completed for ${ENGINE_LABELS[result.engineId]}.`);
            } catch (error) {
                console.error(error);
                setFpsStatus('FPS probe failed due to a runtime error.');
                showToast('FPS probe failed.', true);
            } finally {
                benchmarkFpsButton.disabled = false;
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!benchmarkState.isOpen) return;
        closeDashboard();
    });

    benchmarkState.isInitialized = true;
}

function toggleDashboard(forceOpen) {
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !benchmarkState.isOpen;
    if (shouldOpen) {
        openDashboard();
    } else {
        closeDashboard();
    }
}

function openDashboard() {
    if (!benchmarkRoot) return;
    benchmarkRoot.classList.add('is-open');
    benchmarkState.isOpen = true;
}

function closeDashboard() {
    if (!benchmarkRoot) return;
    benchmarkRoot.classList.remove('is-open');
    benchmarkState.isOpen = false;
}

function renderMatrixInputs() {
    const table = document.createElement('table');
    table.className = 'benchmark-matrix-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Metric</th>
            <th>Weight (1-5)</th>
            <th>3Dmol.js</th>
            <th>Mol*</th>
            <th>JSmol</th>
            <th>NGL</th>
        </tr>
    `;

    const tbody = document.createElement('tbody');

    METRIC_DEFS.forEach((metric) => {
        const row = document.createElement('tr');

        const metricCell = document.createElement('td');
        metricCell.textContent = metric.label;

        const weightCell = document.createElement('td');
        const weightInput = document.createElement('input');
        weightInput.type = 'number';
        weightInput.min = '1';
        weightInput.max = '5';
        weightInput.step = '1';
        weightInput.value = benchmarkState.weights[metric.key] ?? metric.defaultWeight;
        weightInput.className = 'benchmark-input benchmark-weight-input';
        weightInput.dataset.metric = metric.key;
        weightInput.addEventListener('input', onWeightInputChanged);
        weightCell.appendChild(weightInput);

        row.appendChild(metricCell);
        row.appendChild(weightCell);

        ENGINE_IDS.forEach((engineId) => {
            const valueCell = document.createElement('td');
            valueCell.appendChild(buildMetricEditor(engineId, metric));
            row.appendChild(valueCell);
        });

        tbody.appendChild(row);
    });

    table.appendChild(thead);
    table.appendChild(tbody);

    benchmarkInputContainer.innerHTML = '';
    benchmarkInputContainer.appendChild(table);
}

function buildMetricEditor(engineId, metric) {
    const currentValue = benchmarkState.engines[engineId][metric.key];

    if (metric.kind === 'boolean') {
        const wrapper = document.createElement('label');
        wrapper.className = 'benchmark-checkbox';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(currentValue);
        input.dataset.engine = engineId;
        input.dataset.metric = metric.key;
        input.addEventListener('change', onMetricInputChanged);

        const label = document.createElement('span');
        label.textContent = input.checked ? 'Yes' : 'No';

        input.addEventListener('change', () => {
            label.textContent = input.checked ? 'Yes' : 'No';
        });

        wrapper.appendChild(input);
        wrapper.appendChild(label);
        return wrapper;
    }

    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.engine = engineId;
    input.dataset.metric = metric.key;
    input.className = 'benchmark-input';

    if (metric.kind === 'inverse-numeric') {
        input.min = '1';
        input.step = '1';
    }

    if (metric.kind === 'numeric') {
        input.min = '0';
        input.step = '0.1';
    }

    if (metric.kind === 'subjective') {
        input.min = '1';
        input.max = '10';
        input.step = '1';
    }

    input.value = String(currentValue);
    input.addEventListener('input', onMetricInputChanged);

    return input;
}

function onWeightInputChanged(event) {
    const metricKey = event.target.dataset.metric;
    const parsed = clampNumber(parseFloat(event.target.value), 1, 5, 1);
    benchmarkState.weights[metricKey] = parsed;
    event.target.value = String(parsed);
    recalculateAndRender();
}

function onMetricInputChanged(event) {
    const engineId = event.target.dataset.engine;
    const metricKey = event.target.dataset.metric;
    if (!engineId || !metricKey) return;

    const metricDef = METRIC_DEFS.find((item) => item.key === metricKey);
    if (!metricDef) return;

    if (metricDef.kind === 'boolean') {
        benchmarkState.engines[engineId][metricKey] = Boolean(event.target.checked);
        recalculateAndRender();
        return;
    }

    const rawValue = parseFloat(event.target.value);
    let normalized = Number.isFinite(rawValue) ? rawValue : 0;

    if (metricDef.kind === 'inverse-numeric') {
        normalized = Math.max(1, normalized);
    }

    if (metricDef.kind === 'numeric') {
        normalized = Math.max(0, normalized);
    }

    if (metricDef.kind === 'subjective') {
        normalized = clampNumber(normalized, 1, 10, 1);
    }

    benchmarkState.engines[engineId][metricKey] = normalized;
    event.target.value = String(normalized);
    recalculateAndRender();
}

function recalculateAndRender() {
    const scored = buildEngineScores();
    renderSummaryTable(scored);
    renderBars(scored);
}

function buildEngineScores() {
    const totals = [];
    const scoreCache = {};

    METRIC_DEFS.forEach((metric) => {
        scoreCache[metric.key] = computeMetricScores(metric);
    });

    ENGINE_IDS.forEach((engineId) => {
        let weightedSum = 0;
        let weightTotal = 0;

        METRIC_DEFS.forEach((metric) => {
            const weight = benchmarkState.weights[metric.key] || 1;
            const metricScore = scoreCache[metric.key][engineId] ?? 0;
            weightedSum += metricScore * weight;
            weightTotal += weight;
        });

        const total = weightTotal > 0 ? weightedSum / weightTotal : 0;
        totals.push({
            engineId,
            label: ENGINE_LABELS[engineId],
            total,
            percent: total * 10
        });
    });

    totals.sort((a, b) => b.total - a.total);
    return totals;
}

function computeMetricScores(metric) {
    const map = {};

    if (metric.kind === 'boolean') {
        ENGINE_IDS.forEach((engineId) => {
            map[engineId] = benchmarkState.engines[engineId][metric.key] ? 10 : 0;
        });
        return map;
    }

    if (metric.kind === 'subjective') {
        ENGINE_IDS.forEach((engineId) => {
            const value = benchmarkState.engines[engineId][metric.key];
            map[engineId] = clampNumber(Number(value), 1, 10, 1);
        });
        return map;
    }

    const values = ENGINE_IDS
        .map((engineId) => Number(benchmarkState.engines[engineId][metric.key]))
        .filter((value) => Number.isFinite(value));

    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const spread = max - min;

    ENGINE_IDS.forEach((engineId) => {
        const raw = Number(benchmarkState.engines[engineId][metric.key]);
        if (!Number.isFinite(raw)) {
            map[engineId] = 0;
            return;
        }

        if (spread === 0) {
            map[engineId] = 10;
            return;
        }

        if (metric.kind === 'inverse-numeric') {
            map[engineId] = ((max - raw) / spread) * 10;
            return;
        }

        map[engineId] = ((raw - min) / spread) * 10;
    });

    return map;
}

function renderSummaryTable(scored) {
    benchmarkSummaryBody.innerHTML = '';

    scored.forEach((row, index) => {
        const tr = document.createElement('tr');

        const rankCell = document.createElement('td');
        rankCell.textContent = String(index + 1);

        const engineCell = document.createElement('td');
        engineCell.textContent = row.label;

        const scoreCell = document.createElement('td');
        scoreCell.textContent = row.total.toFixed(2);

        const percentCell = document.createElement('td');
        percentCell.textContent = `${row.percent.toFixed(1)}%`;

        tr.appendChild(rankCell);
        tr.appendChild(engineCell);
        tr.appendChild(scoreCell);
        tr.appendChild(percentCell);
        benchmarkSummaryBody.appendChild(tr);
    });
}

function renderBars(scored) {
    benchmarkBars.innerHTML = '';

    scored.forEach((row) => {
        const item = document.createElement('div');
        item.className = 'benchmark-bar-item';

        const label = document.createElement('div');
        label.className = 'benchmark-bar-label';
        label.textContent = `${row.label} (${row.total.toFixed(2)})`;

        const track = document.createElement('div');
        track.className = 'benchmark-bar-track';

        const fill = document.createElement('div');
        fill.className = 'benchmark-bar-fill';
        fill.style.width = `${Math.max(0, Math.min(100, row.percent))}%`;

        track.appendChild(fill);
        item.appendChild(label);
        item.appendChild(track);
        benchmarkBars.appendChild(item);
    });
}

function getMetricInput(engineId, metricKey) {
    return benchmarkRoot?.querySelector(`input[data-engine="${engineId}"][data-metric="${metricKey}"]`) ?? null;
}

function setFpsStatus(message) {
    if (!benchmarkFpsStatus) return;
    benchmarkFpsStatus.textContent = message;
}

function clampNumber(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function rotateActiveViewerStep() {
    try {
        if (appState.currentEngine === '3dmol' && appState.viewer3Dmol) {
            appState.viewer3Dmol.rotate(3, 'y');
            appState.viewer3Dmol.render();
            return true;
        }

        if (appState.currentEngine === 'ngl' && appState.viewerNgl && appState.viewerNgl.viewerControls) {
            appState.viewerNgl.viewerControls.rotate([0, 1, 0], 0.04);
            appState.viewerNgl.requestRender();
            return true;
        }

        // Skeleton path for Mol* and JSmol: add direct camera spin integration when benchmark API is finalized.
        return false;
    } catch (error) {
        console.warn('Benchmark FPS step failed:', error);
        return false;
    }
}

// Skeleton benchmark helper: rotates the active viewer around Y (approx 360 deg) and estimates average FPS.
export function runActiveEngineFpsProbe(options = {}) {
    const durationMs = Number.isFinite(options.durationMs) ? options.durationMs : 2000;
    const steps = Number.isFinite(options.steps) ? options.steps : 120;

    if (!appState.structureDataText) {
        return Promise.resolve({ ok: false, reason: 'Load a structure before running FPS benchmark.' });
    }

    return new Promise((resolve) => {
        let frameCount = 0;
        let stepCount = 0;
        const start = performance.now();

        function tick() {
            frameCount += 1;
            stepCount += 1;

            const moved = rotateActiveViewerStep();
            const now = performance.now();
            const elapsed = now - start;

            if (!moved) {
                resolve({
                    ok: false,
                    reason: `FPS auto-rotation is not yet wired for ${ENGINE_LABELS[appState.currentEngine]}.`
                });
                return;
            }

            if (elapsed >= durationMs || stepCount >= steps) {
                const averageFps = elapsed > 0 ? (frameCount * 1000) / elapsed : 0;
                console.info('[Benchmark] FPS probe result', {
                    engine: appState.currentEngine,
                    averageFps,
                    frameCount,
                    elapsedMs: elapsed
                });

                resolve({
                    ok: true,
                    engineId: appState.currentEngine,
                    averageFps,
                    frameCount,
                    elapsedMs: elapsed
                });
                return;
            }

            requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
    });
}
