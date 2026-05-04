import { appState } from './state.js';
import { rnaConfig, modPalette, statusPalette } from './constants.js';
import { showToast } from './ui/toast.js';
import { setLoading, finishProgress } from './ui/loading.js';
import { applyColorModeToModifications, hydrateModifications } from './data/modifications.js';
import {
    applyFilters,
    generateDOMList,
    initModListSelectionHandler,
    prependMeasurementPairNode,
    refreshInteractionMarkers,
    removeMeasurementPairNode,
    setMeasurementPairUnlinkHandler,
    setMeasurementPairSelectionHandler,
    setFilterQuery,
    setFilterType,
    setSortMode
} from './ui/mod-list.js';
import {
    clearAllMeasurementPairs,
    clearManualResidueLabels,
    clearMeasurementSelection,
    centerOnMeasurementPair,
    centerOnResidue,
    exportSnapshot,
    resetCameraView,
    renderActiveEngine,
    refresh3DmolProteinsOnly,
    selectResidueForMeasurement,
    set3DmolResiduePickHandler,
    toggleManualResidueLabel,
    unlinkMeasurementPair,
    updateCurrentEngineStyles
} from './viewers/engine-manager.js';

let opacityUpdateTimerId = null;
let pendingFocusRequest = null;
let focusRequestTimerId = null;
let pendingInteractionUiTimerId = null;
let contextMenuResidue = null;

function waitNextFrame() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}

function scheduleInteractionUiRefresh() {
    if (pendingInteractionUiTimerId) return;

    pendingInteractionUiTimerId = setTimeout(() => {
        pendingInteractionUiTimerId = null;
        refreshInteractionMarkers();
        updateInteractionPanels();
    }, 0);
}

// Entry point for wiring UI events and cross-module interactions.
export function initializeApp() {
    initModListSelectionHandler(handleResidueListSelection);
    setMeasurementPairUnlinkHandler(handlePairUnlink);
    setMeasurementPairSelectionHandler(handlePairFocus);
    set3DmolResiduePickHandler(handleViewerResiduePick);

    bindStructureLoader();
    bindJsonLoader();
    bindOpacitySlider();
    bindColorModeControl();
    bindFilterControls();
    bindLabelTools();
    bindSidebarToggle();
    bindLegendControls();
    bindViewerToggles();
    bindCameraReset();
    bindSnapshotExport();
    bindResidueContextMenu();
    renderLegend();
}

function scheduleResidueFocus(mod) {
    pendingFocusRequest = mod;
    if (focusRequestTimerId) return;

    focusRequestTimerId = setTimeout(() => {
        focusRequestTimerId = null;
        const next = pendingFocusRequest;
        pendingFocusRequest = null;
        if (!next) return;

        centerOnResidue(next.resi, next._authChain);
    }, 0);
}

function handleViewerResiduePick(mod, meta = {}) {
    const isRightClick = meta.mouseButton === 'right';

    if (isRightClick) {
        openResidueContextMenu(mod, meta.clientX, meta.clientY);
        return;
    }

    closeResidueContextMenu();

    if (appState.measurementDraft.first) {
        const result = selectResidueForMeasurement(mod);

        if (result.stage === 'linked') {
            prependMeasurementPairNode(result.pair);
            showToast('Measurement pair created.');
            centerOnMeasurementPair(result.pair);
        } else if (result.stage === 'same') {
            showToast('Pick a different second residue.', true);
        }

        if (result.stage !== 'same') {
            const actionHint = document.getElementById('actionHint');
            if (actionHint) actionHint.textContent = 'Left click on residue: zoom. Right click: actions menu.';
        }

        scheduleInteractionUiRefresh();
        return;
    }

    scheduleResidueFocus(mod);
}

function handlePairFocus(pair) {
    centerOnMeasurementPair(pair);
}

function handleResidueListSelection(mod) {
    closeResidueContextMenu();
    scheduleResidueFocus(mod);
}

function handlePairUnlink(pairId) {
    const didUnlink = unlinkMeasurementPair(pairId);
    if (didUnlink) removeMeasurementPairNode(pairId);
    scheduleInteractionUiRefresh();
    if (didUnlink) showToast('Measurement pair unlinked.');
}

function bindStructureLoader() {
    const loadButton = document.getElementById('loadCifBtn');

    function setLoadButtonWorking(isWorking) {
        if (isWorking) {
            if (!loadButton.dataset.defaultLabel) {
                loadButton.dataset.defaultLabel = loadButton.innerHTML;
            }

            loadButton.classList.add('is-working');
            loadButton.disabled = true;
            loadButton.setAttribute('aria-busy', 'true');
            loadButton.innerHTML = '<span class="btn-icon">...</span> Loading';
            return;
        }

        loadButton.classList.remove('is-working');
        loadButton.disabled = false;
        loadButton.removeAttribute('aria-busy');
        if (loadButton.dataset.defaultLabel) loadButton.innerHTML = loadButton.dataset.defaultLabel;
    }

    loadButton.addEventListener('click', async () => {
        setLoadButtonWorking(true);
        await waitNextFrame();

        const selectedRibo = document.getElementById('riboSelect').value;
        const config = rnaConfig[selectedRibo];

        appState.currentRibo = selectedRibo;

        setLoading(true, `Fetching ${config.file}...`);

        try {
            const response = await fetch(config.file);
            if (!response.ok) throw new Error('Structure file was not found.');

            appState.structureDataText = await response.text();

            if (appState.modifications.length > 0) {
                hydrateModifications();
                generateDOMList();
                scheduleInteractionUiRefresh();
            }

            renderActiveEngine();
            showToast(`Structure ${appState.currentRibo} loaded.`);
        } catch (error) {
            finishProgress();
            showToast('Load failed. Check that your local server is running.', true);
        } finally {
            setLoadButtonWorking(false);
        }
    });
}

function bindJsonLoader() {
    const uploadPill = document.getElementById('uploadPill');

    document.getElementById('jsonFile').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        document.getElementById('fileNameDisplay').textContent = truncateFileName(file.name);

        const reader = new FileReader();
        reader.onload = async (loadEvent) => {
            uploadPill.classList.add('is-working');
            await waitNextFrame();

            try {
                try {
                    const parsed = JSON.parse(loadEvent.target.result);
                    if (!Array.isArray(parsed)) throw new Error('Expected JSON array.');
                    appState.modifications = parsed;
                    appState.manualLabels.clear();
                    clearMeasurementSelection({ skipRender: true });
                    clearAllMeasurementPairs({ skipRender: true });
                } catch (error) {
                    showToast('Invalid JSON file.', true);
                    return;
                }

                hydrateModifications();
                generateDOMList();
                updateCurrentEngineStyles();
                scheduleInteractionUiRefresh();
                showToast(`Loaded ${appState.modifications.length} modifications.`);
            } finally {
                uploadPill.classList.remove('is-working');
            }
        };

        reader.readAsText(file);
    });
}

function bindOpacitySlider() {
    const slider = document.getElementById('opacitySlider');
    const commitOpacityUpdate = () => {
        if (opacityUpdateTimerId) return;
        opacityUpdateTimerId = setTimeout(() => {
            opacityUpdateTimerId = null;
            if (!refresh3DmolProteinsOnly()) {
                updateCurrentEngineStyles();
            }
        }, 75);
    };

    slider.addEventListener('input', function onOpacityInput() {
        appState.currentOpacity = parseFloat(this.value);
        document.getElementById('opacityVal').textContent = appState.currentOpacity.toFixed(2);
        commitOpacityUpdate();
    });

    slider.addEventListener('change', () => {
        if (opacityUpdateTimerId) {
            clearTimeout(opacityUpdateTimerId);
            opacityUpdateTimerId = null;
        }
        if (!refresh3DmolProteinsOnly()) {
            updateCurrentEngineStyles();
        }
    });
}

function bindFilterControls() {
    document.getElementById('searchInput').addEventListener('input', function onSearchInput() {
        clearTimeout(appState.filterDebounceId);
        appState.filterDebounceId = setTimeout(() => {
            setFilterQuery(this.value);
            applyFilters();
        }, 150);
    });

    document.getElementById('filterType').addEventListener('change', function onTypeChange() {
        setFilterType(this.value);
        applyFilters();
    });

    document.getElementById('sortMode').addEventListener('change', function onSortChange() {
        setSortMode(this.value);
        generateDOMList();
        scheduleInteractionUiRefresh();
    });
}

function bindColorModeControl() {
    const colorModeToggle = document.getElementById('colorModeToggle');
    const colorModeLabel = document.getElementById('colorModeLabel');
    if (!colorModeToggle || !colorModeLabel) return;

    colorModeToggle.checked = appState.colorMode === 'global';
    colorModeLabel.textContent = colorModeToggle.checked ? 'Global' : 'Analytic';

    colorModeToggle.addEventListener('change', () => {
        const nextMode = colorModeToggle.checked ? 'global' : 'analytic';
        applyColorModeToModifications(nextMode);
        syncOverlayColorsToActiveMode();
        renderLegend();
        colorModeLabel.textContent = colorModeToggle.checked ? 'Global' : 'Analytic';

        if (appState.modifications.length > 0) {
            generateDOMList();
            updateCurrentEngineStyles();
            scheduleInteractionUiRefresh();
        }
    });
}

function syncOverlayColorsToActiveMode() {
    const modByKey = new Map();
    appState.modifications.forEach((mod) => {
        modByKey.set(`${mod.resi}|${mod._authChain}`, mod);
    });

    const recoloredManualLabels = new Map();
    appState.manualLabels.forEach((label, key) => {
        const mod = modByKey.get(key);
        if (mod && mod._labelPayload) {
            recoloredManualLabels.set(key, { ...mod._labelPayload });
            return;
        }
        recoloredManualLabels.set(key, label);
    });
    appState.manualLabels = recoloredManualLabels;

    appState.measurementPairs = appState.measurementPairs.map((pair) => {
        const keyA = `${pair.a.residue}|${pair.a.authChain}`;
        const keyB = `${pair.b.residue}|${pair.b.authChain}`;
        const modA = modByKey.get(keyA);
        const modB = modByKey.get(keyB);

        return {
            ...pair,
            a: {
                ...pair.a,
                colorHex: modA ? modA._palette.hex : pair.a.colorHex
            },
            b: {
                ...pair.b,
                colorHex: modB ? modB._palette.hex : pair.b.colorHex
            }
        };
    });
}

function bindLabelTools() {
    document.getElementById('clearLabelsBtn').addEventListener('click', () => {
        const changed = clearManualResidueLabels({ skipRender: true });
        scheduleInteractionUiRefresh();
        if (changed) updateCurrentEngineStyles({ mode: 'overlay' });
        showToast('All manual residue labels removed.');
    });
}

function bindResidueContextMenu() {
    const menu = document.getElementById('residueContextMenu');
    const insertLabelBtn = document.getElementById('menuInsertLabelBtn');
    const startMeasureBtn = document.getElementById('menuStartMeasureBtn');
    const viewer = document.getElementById('gldiv-3dmol');

    if (!menu || !insertLabelBtn || !startMeasureBtn || !viewer) return;

    viewer.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    insertLabelBtn.addEventListener('click', () => {
        if (!contextMenuResidue) return;

        toggleManualResidueLabel(contextMenuResidue);
        closeResidueContextMenu();
        updateCurrentEngineStyles({ mode: 'overlay' });
        scheduleInteractionUiRefresh();
    });

    startMeasureBtn.addEventListener('click', () => {
        if (!contextMenuResidue) return;

        clearMeasurementSelection({ skipRender: true });
        const result = selectResidueForMeasurement(contextMenuResidue);
        closeResidueContextMenu();

        if (result.stage === 'first') {
            const actionHint = document.getElementById('actionHint');
            if (actionHint) {
                actionHint.textContent = `Measuring from ${result.changed ? contextMenuResidue.chain : ''}:${contextMenuResidue.resi}. Click second residue in viewer.`;
            }
            showToast('First residue selected. Click the second residue in the viewer.');
        }

        scheduleInteractionUiRefresh();
    });

    document.addEventListener('click', (event) => {
        if (!menu.classList.contains('open')) return;
        if (event.target.closest('#residueContextMenu')) return;
        closeResidueContextMenu();
    });
}

function openResidueContextMenu(mod, clientX, clientY) {
    const menu = document.getElementById('residueContextMenu');
    const insertLabelBtn = document.getElementById('menuInsertLabelBtn');
    if (!menu || !mod) return;

    contextMenuResidue = mod;

    if (insertLabelBtn) {
        const residueKey = `${mod.resi}|${mod._authChain}`;
        const hasLabel = appState.manualLabels.has(residueKey);
        insertLabelBtn.textContent = hasLabel ? 'Remove Label' : 'Add Label';
    }

    menu.classList.add('open');
    menu.setAttribute('aria-hidden', 'false');

    const fallbackX = window.innerWidth / 2;
    const fallbackY = window.innerHeight / 2;
    const x = Number.isFinite(clientX) ? clientX : fallbackX;
    const y = Number.isFinite(clientY) ? clientY : fallbackY;

    const maxX = window.innerWidth - menu.offsetWidth - 8;
    const maxY = window.innerHeight - menu.offsetHeight - 8;
    menu.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
}

function closeResidueContextMenu() {
    const menu = document.getElementById('residueContextMenu');
    if (!menu) return;

    contextMenuResidue = null;
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
}

function bindSidebarToggle() {
    const toggleButton = document.getElementById('sidebarToggleBtn');
    const workspace = document.getElementById('workspaceLayout');
    if (!toggleButton || !workspace) return;

    toggleButton.addEventListener('click', () => {
        const collapsed = workspace.classList.toggle('sidebar-collapsed');
        toggleButton.setAttribute('aria-expanded', String(!collapsed));
        toggleButton.title = collapsed ? 'Expand right panel' : 'Collapse right panel';
        toggleButton.classList.toggle('is-collapsed', collapsed);
    });
}

function bindLegendControls() {
    const panel = document.getElementById('legendPanel');
    const body = document.getElementById('legendBody');
    const miniButton = document.getElementById('legendMiniBtn');
    const closeButton = document.getElementById('legendToggle');

    if (!panel || !body || !miniButton || !closeButton) return;

    function setLegendExpanded(expanded) {
        body.classList.toggle('collapsed', !expanded);
        panel.classList.toggle('expanded', expanded);
        closeButton.setAttribute('aria-expanded', String(expanded));
    }

    miniButton.addEventListener('click', () => setLegendExpanded(true));
    closeButton.addEventListener('click', () => setLegendExpanded(false));

    document.addEventListener('keydown', (event) => {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
        if (event.key === 'l' || event.key === 'L') setLegendExpanded(body.classList.contains('collapsed'));
    });
}

function renderLegendRows(sectionTitle, rows) {
    const title = `<div class="legend-section-title">${sectionTitle}</div>`;
    const body = rows
        .map((row) => `<div class="legend-row"><span class="lswatch" style="--c:${row.color}"></span>${row.label}</div>`)
        .join('');

    return `${title}${body}`;
}

function renderLegend() {
    const legendBody = document.getElementById('legendBody');
    if (!legendBody) return;

    const chainRows = [
        { label: '28S rRNA', color: '#555555' },
        { label: '18S rRNA', color: '#E6E6E6' },
        { label: '5.8S rRNA', color: '#FFD700' },
        { label: '5S rRNA', color: '#4169E1' },
        { label: 'tRNA', color: '#90EE90' }
    ];

    const analyticRows = [
        { label: 'Standard', color: modPalette.standard.hex },
        { label: '\u03a8 (Domain I)', color: modPalette.varI.hex },
        { label: 'Ribose (R)', color: modPalette.varR.hex },
        { label: 'Base (B)', color: modPalette.varB.hex },
        { label: 'Base+Ribose', color: modPalette.varBR.hex },
        { label: '\u03a8+Ribose', color: modPalette.varIR.hex },
        { label: 'Complex (ac, D)', color: modPalette.complex.hex },
        { label: 'Hyper-Variable', color: modPalette.hyper.hex }
    ];

    const globalRows = [
        { label: 'Match', color: statusPalette.match.hex },
        { label: 'Novel', color: statusPalette.novel.hex },
        { label: 'Missing', color: statusPalette.missing.hex }
    ];

    const modeRows = appState.colorMode === 'global' ? globalRows : analyticRows;
    const modeTitle = appState.colorMode === 'global' ? 'Status (Global View)' : 'Modification Type (Analytic View)';

    legendBody.innerHTML = `${renderLegendRows('RNA Backbones', chainRows)}${renderLegendRows(modeTitle, modeRows)}`;
}

function bindViewerToggles() {
    document.getElementById('toggleProteins').addEventListener('change', () => {
        if (!refresh3DmolProteinsOnly()) {
            updateCurrentEngineStyles();
        }
    });
}

function bindCameraReset() {
    document.getElementById('resetCameraBtn').addEventListener('click', () => {
        const result = resetCameraView();
        if (!result.ok && result.reason === 'viewer') {
            showToast('Load a structure before resetting the camera.', true);
        }
    });
}

function bindSnapshotExport() {
    document.getElementById('snapshotBtn').addEventListener('click', () => {
        exportSnapshot();
    });
}

function updateInteractionPanels() {
    const labelCount = appState.manualLabels.size;
    document.getElementById('labelCount').textContent = `${labelCount}`;

    const actionHint = document.getElementById('actionHint');
    if (!actionHint) return;

    const hasDraft = Boolean(appState.measurementDraft.first);
    actionHint.textContent = hasDraft
        ? `Measuring from ${formatResidueTag(appState.measurementDraft.first)}. Click second residue in viewer.`
        : 'Left click on residue: zoom. Right click: actions menu.';
}

function formatResidueTag(residueSlot) {
    return `${residueSlot.type}:${residueSlot.residue}`;
}

function truncateFileName(fileName) {
    return fileName.length > 18 ? `${fileName.slice(0, 15)}...` : fileName;
}
