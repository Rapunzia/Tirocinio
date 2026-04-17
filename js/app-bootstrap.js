import { appState } from './state.js';
import { rnaConfig, supportedEngines } from './constants.js';
import { showToast } from './ui/toast.js';
import { setLoading, finishProgress } from './ui/loading.js';
import { buildResidueCache } from './data/cif-cache.js';
import { hydrateModifications, warmupModificationDataInBackground } from './data/modifications.js';
import {
    applyFilters,
    generateDOMList,
    initModListSelectionHandler,
    prependMeasurementPairNode,
    refreshInteractionMarkers,
    removeMeasurementPairNode,
    setMeasurementPairUnlinkHandler,
    setFilterQuery,
    setFilterType,
    setSortMode
} from './ui/mod-list.js';
import {
    clear3DmolResidueHover,
    clearAllMeasurementPairs,
    clearManualResidueLabels,
    clearMeasurementSelection,
    centerOnResidue,
    destroyEngine,
    exportSnapshot,
    resetCameraView,
    renderActiveEngine,
    refresh3DmolBaseLabelsOnly,
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
    set3DmolResiduePickHandler(handleResidueListSelection);

    bindEngineSelector();
    bindStructureLoader();
    bindJsonLoader();
    bindOpacitySlider();
    bindFilterControls();
    bindInteractionTools();
    bindSidebarToggle();
    bindLegendControls();
    bindViewerToggles();
    bindCameraReset();
    bindSnapshotExport();

    syncEnginePanels();
    syncOpacityControlVisibility();
    setInteractionMode('navigate');
}

function scheduleResidueFocus(mod) {
    pendingFocusRequest = mod;
    if (focusRequestTimerId) return;

    focusRequestTimerId = setTimeout(() => {
        focusRequestTimerId = null;
        const next = pendingFocusRequest;
        pendingFocusRequest = null;
        if (!next) return;

        centerOnResidue(next['Positions in the Structure'], next._authChain, next._structId);
    }, 0);
}

function handleResidueListSelection(mod) {
    if (appState.interactionMode === 'label') {
        const result = toggleManualResidueLabel(mod);
        if (!result.changed && result.reason === 'engine') {
            showToast('Label edit mode currently supports 3Dmol only.', true);
        }
        scheduleInteractionUiRefresh();
        return;
    }

    if (appState.interactionMode === 'measure') {
        const result = selectResidueForMeasurement(mod);

        if (result.stage === 'engine') {
            showToast('Measurement mode currently supports 3Dmol only.', true);
        } else if (result.stage === 'first') {
            showToast('First residue selected. Click a second residue to measure distance.');
        } else if (result.stage === 'linked') {
            showToast('Residue pair linked for distance measurement.');
            prependMeasurementPairNode(result.pair);
        } else if (result.stage === 'same') {
            showToast('Choose a different second residue.', true);
        }

        scheduleInteractionUiRefresh();
        return;
    }

    scheduleResidueFocus(mod);
}

function handlePairUnlink(pairId) {
    const didUnlink = unlinkMeasurementPair(pairId);
    if (didUnlink) removeMeasurementPairNode(pairId);
    scheduleInteractionUiRefresh();
    if (didUnlink) showToast('Measurement pair unlinked.');
}

function bindEngineSelector() {
    document.getElementById('engineSelect').addEventListener('change', (event) => {
        const nextEngine = event.target.value;
        if (appState.currentEngine !== nextEngine) destroyEngine(appState.currentEngine);

        appState.currentEngine = nextEngine;
        syncOpacityControlVisibility();
        syncEnginePanels();

        if (appState.structureDataText) renderActiveEngine();
    });
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

            // Yield once to keep the UI responsive before cache generation starts.
            await new Promise((resolve) => setTimeout(resolve, 0));
            buildResidueCache(appState.structureDataText);

            if (appState.modifications.length > 0) {
                hydrateModifications();
                generateDOMList();
                warmupModificationDataInBackground();
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
                warmupModificationDataInBackground();
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

    document.getElementById('toggleUnknown').addEventListener('change', () => {
        if (appState.modifications.length === 0) return;
        applyFilters();
        updateCurrentEngineStyles();
    });

    document.getElementById('sortMode').addEventListener('change', function onSortChange() {
        setSortMode(this.value);
        generateDOMList();
        scheduleInteractionUiRefresh();
    });
}

function bindInteractionTools() {
    document.getElementById('modeNavigateBtn').addEventListener('click', () => {
        setInteractionMode('navigate');
    });

    document.getElementById('modeLabelBtn').addEventListener('click', () => {
        setInteractionMode('label');
    });

    document.getElementById('modeMeasureBtn').addEventListener('click', () => {
        setInteractionMode('measure');
    });

    document.getElementById('clearLabelsBtn').addEventListener('click', () => {
        const changed = clearManualResidueLabels({ skipRender: true });
        scheduleInteractionUiRefresh();
        if (changed) updateCurrentEngineStyles({ mode: 'overlay' });
        showToast('All manual residue labels removed.');
    });
}

function bindSidebarToggle() {
    const toggleButton = document.getElementById('sidebarToggleBtn');
    const workspace = document.getElementById('workspaceLayout');
    if (!toggleButton || !workspace) return;

    toggleButton.addEventListener('click', () => {
        const collapsed = workspace.classList.toggle('sidebar-collapsed');
        toggleButton.textContent = collapsed ? '◀' : '▶';
        toggleButton.setAttribute('aria-expanded', String(!collapsed));
        toggleButton.title = collapsed ? 'Expand right panel' : 'Collapse right panel';
    });
}

function bindLegendControls() {
    document.getElementById('legendToggle').addEventListener('click', function onLegendToggle() {
        const body = document.getElementById('legendBody');
        const collapsed = body.classList.toggle('collapsed');
        this.textContent = `LEGEND ${collapsed ? '▼' : '▲'}`;
    });

    document.addEventListener('keydown', (event) => {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
        if (event.key === 'l' || event.key === 'L') document.getElementById('legendToggle').click();
    });
}

function bindViewerToggles() {
    document.getElementById('toggleProteins').addEventListener('change', () => {
        if (!refresh3DmolProteinsOnly()) {
            updateCurrentEngineStyles();
        }
    });

    document.getElementById('toggleLabels').addEventListener('change', () => {
        if (appState.currentEngine !== '3dmol') {
            showToast('Labels are currently supported only in 3Dmol.', true);
            document.getElementById('toggleLabels').checked = false;
            return;
        }
        if (!refresh3DmolBaseLabelsOnly()) {
            updateCurrentEngineStyles();
        }
    });
}

function bindCameraReset() {
    document.getElementById('resetCameraBtn').addEventListener('click', () => {
        const result = resetCameraView();
        if (!result.ok && result.reason === 'engine') {
            showToast('Camera reset is currently supported only in 3Dmol.', true);
            return;
        }

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

// Keeps only the active engine layer visible.
function syncEnginePanels() {
    supportedEngines.forEach((engineName) => {
        const layer = document.getElementById(`gldiv-${engineName}`);
        layer.classList.toggle('active-engine', engineName === appState.currentEngine);
        layer.classList.toggle('hidden-engine', engineName !== appState.currentEngine);
    });
}

function syncOpacityControlVisibility() {
    document.getElementById('ui-opacity').style.display = appState.currentEngine === 'molstar' ? 'none' : 'flex';
}

function setInteractionMode(mode) {
    appState.interactionMode = mode;

    document.getElementById('modeNavigateBtn').classList.toggle('active', mode === 'navigate');
    document.getElementById('modeLabelBtn').classList.toggle('active', mode === 'label');
    document.getElementById('modeMeasureBtn').classList.toggle('active', mode === 'measure');

    let didClearMeasurementDraft = false;
    if (mode !== 'measure') {
        didClearMeasurementDraft = clearMeasurementSelection({ skipRender: true });
        clear3DmolResidueHover();
    }

    const threeDContainer = document.getElementById('gldiv-3dmol');
    if (threeDContainer) {
        threeDContainer.style.cursor = mode === 'measure' ? 'crosshair' : 'default';
    }

    scheduleInteractionUiRefresh();

    if (didClearMeasurementDraft) {
        updateCurrentEngineStyles({ mode: 'overlay' });
    }
}

function updateInteractionPanels() {
    const labelCount = appState.manualLabels.size;
    document.getElementById('labelCount').textContent = `${labelCount}`;

    const modeHint = document.getElementById('modeHint');
    if (appState.interactionMode === 'label') {
        modeHint.textContent = 'Label mode: click a residue to toggle a manual label (3Dmol).';
    } else if (appState.interactionMode === 'measure') {
        const hasDraft = Boolean(appState.measurementDraft.first);
        modeHint.textContent = hasDraft
            ? `Measure mode: selected ${formatResidueTag(appState.measurementDraft.first)}, click a second residue in the 3D viewer to link.`
            : 'Measure mode: hover/click selectable residues directly in the 3D viewer to create a distance pair (3Dmol).';
    } else {
        modeHint.textContent = 'Navigate mode: click a residue to focus it in the active viewer.';
    }
}

function formatResidueTag(residueSlot) {
    return `${residueSlot.type}:${residueSlot.residue}`;
}

function truncateFileName(fileName) {
    return fileName.length > 18 ? `${fileName.slice(0, 15)}...` : fileName;
}
