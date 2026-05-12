import { appState } from './state.js';
import { rnaConfig, modPalette, statusPalette } from './constants.js';
import { hideToast, showToast } from './ui/toast.js';
import { setLoading, finishProgress } from './ui/loading.js';
import { getAnalyticLegendRows, hydrateModifications } from './data/modifications.js';
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
    setSortMode,
    selectCardForMod
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
    applyOpacityToBackboneOnly,
    refresh3DmolProteinsOnly,
    selectResidueForMeasurement,
    set3DmolResiduePickHandler,
    toggleManualResidueLabel,
    unlinkMeasurementPair,
    updateCurrentEngineStyles
} from './viewers/engine-manager.js';

let pendingFocusRequest = null;
let focusRequestTimerId = null;
let pendingInteractionUiTimerId = null;
let contextMenuResidue = null;
let setLegendExpandedHandler = null;
let overlayCloseTimerId = null;
let uploadMode = 'resume';
let sessionData = null;
let sequenceData = null;
let modificationData = null;
let isMeasureModeActive = false;

const MEASURE_WAITING_MESSAGE = 'Select second residue.';

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

function runRenderTask(task, message) {
    setLoading(true, message);
    setTimeout(() => {
        try {
            task();
        } finally {
            finishProgress();
        }
    }, 0);
}

function showMeasureWaitingToast() {
    showToast(MEASURE_WAITING_MESSAGE, false, null);
}

function clearMeasureWaitingToast() {
    const toast = document.getElementById('_toast');
    if (toast && toast.textContent === MEASURE_WAITING_MESSAGE) hideToast();
}

function setMeasureModeActive(isActive) {
    const viewer = document.getElementById('viewer-container');
    if (viewer) viewer.classList.toggle('is-measuring', isActive);

    isMeasureModeActive = isActive;

    if (isActive) {
        const toast = document.getElementById('_toast');
        const hasBlockingError = toast
            && toast.classList.contains('visible')
            && toast.classList.contains('error');

        if (!hasBlockingError) showMeasureWaitingToast();
        return;
    }

    clearMeasureWaitingToast();
}

function cancelMeasurementMode() {
    if (!appState.measurementDraft.first) return;
    clearMeasurementSelection();
    setMeasureModeActive(false);
    scheduleInteractionUiRefresh();
}

// Entry point for wiring UI events and cross-module interactions.
export function initializeApp() {
    initModListSelectionHandler(handleResidueListSelection);
    setMeasurementPairUnlinkHandler(handlePairUnlink);
    setMeasurementPairSelectionHandler(handlePairFocus);
    set3DmolResiduePickHandler(handleViewerResiduePick);

    bindLoadOverlayControls();
    bindLeftSidebarPanels();
    bindHelpButton();
    bindSaveSession();
    bindStructureLoader();
    bindUploadModeControls();
    bindUploadDropzones();
    bindOpacitySlider();
    bindFilterControls();
    bindLabelTools();
    bindSidebarToggle();
    bindLegendControls();
    bindViewerToggles();
    bindCameraReset();
    bindSnapshotExport();
    bindPymolExport();
    bindResidueContextMenu();
    bindGlobalMeasurementCancel();
    renderLegend();
    updateRenderButtonState();
}

function bindGlobalMeasurementCancel() {
    document.addEventListener('click', (event) => {
        if (!appState.measurementDraft.first) return;

        const target = event.target;
        const isViewerClick = target.closest('#gldiv-3dmol');
        const isContextMenuClick = target.closest('#residueContextMenu');
        if (isViewerClick || isContextMenuClick) return;

        cancelMeasurementMode();
    });
}

function scheduleResidueFocus(mod) {
    pendingFocusRequest = mod;
    if (focusRequestTimerId) return;

    focusRequestTimerId = setTimeout(() => {
        focusRequestTimerId = null;
        const next = pendingFocusRequest;
        pendingFocusRequest = null;
        if (!next) return;

        selectCardForMod(next);
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
            setMeasureModeActive(false);
        } else if (result.stage === 'same') {
            showToast('Pick a different second residue.', true, 2000);
            setTimeout(() => {
                if (appState.measurementDraft.first) showMeasureWaitingToast();
            }, 2100);
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
        if (!isRenderReady()) {
            showToast('Add the required files before rendering.', true);
            return;
        }

        setLoadButtonWorking(true);
        await waitNextFrame();

        const uploadPayload = {
            mode: uploadMode,
            sessionData,
            sequenceData,
            modificationData
        };

        if (uploadMode === 'resume') {
            const applied = await applySessionData(uploadPayload.sessionData);
            if (!applied) {
                setLoadButtonWorking(false);
                return;
            }
        } else {
            appState.modifications = [];
            appState.manualLabels.clear();
            clearMeasurementSelection({ skipRender: true });
            clearAllMeasurementPairs({ skipRender: true });
        }

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
                renderLegend();
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

function bindUploadModeControls() {
    const toggle = document.getElementById('uploadModeToggle');
    if (!toggle) return;

    toggle.addEventListener('click', (event) => {
        const button = event.target.closest('[data-mode]');
        if (!button) return;
        setUploadMode(button.dataset.mode === 'new' ? 'new' : 'resume');
    });

    setUploadMode(uploadMode);
}

function bindUploadDropzones() {
    const sessionDropzone = document.getElementById('sessionDropzone');
    const sessionInput = document.getElementById('sessionFileInput');
    const newDropzone = document.getElementById('newDropzone');
    const newInput = document.getElementById('newFilesInput');

    if (sessionDropzone && sessionInput) {
        wireDropzone(sessionDropzone, sessionInput, 'resume');
    }

    if (newDropzone && newInput) {
        wireDropzone(newDropzone, newInput, 'new');
    }
}

function wireDropzone(dropzone, input, mode) {
    dropzone.addEventListener('click', () => input.click());

    dropzone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropzone.classList.add('is-dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('is-dragover');
    });

    dropzone.addEventListener('drop', async (event) => {
        event.preventDefault();
        dropzone.classList.remove('is-dragover');
        await handleFiles(event.dataTransfer?.files, mode);
    });

    input.addEventListener('change', async (event) => {
        await handleFiles(event.target.files, mode);
        input.value = '';
    });
}

async function handleFiles(fileList, mode) {
    if (!fileList || fileList.length === 0) return;

    const tasks = [];
    Array.from(fileList).forEach((file) => {
        const ext = getFileExtension(file.name);
        if (mode === 'resume') {
            if (ext !== 'json') {
                showToast('Resume Session accepts only .json files.', true);
                return;
            }
            tasks.push(assignFileData('session', file));
            return;
        }

        if (ext === 'fasta') {
            tasks.push(assignFileData('sequence', file));
            return;
        }

        if (ext === 'csv') {
            tasks.push(assignFileData('modification', file));
            return;
        }

        showToast('New Session accepts only .fasta and .csv files.', true);
    });

    await Promise.all(tasks);
    renderFileChips();
    updateRenderButtonState();
}

function getFileExtension(fileName) {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return '';
    return fileName.slice(lastDot + 1).trim().toLowerCase();
}

async function assignFileData(kind, file) {
    const text = await readFileAsText(file);

    if (kind === 'session') {
        sessionData = { file, text };
    } else if (kind === 'sequence') {
        sequenceData = { file, text };
    } else if (kind === 'modification') {
        modificationData = { file, text };
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(String(event.target.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file.'));
        reader.readAsText(file);
    });
}

async function applySessionData(sessionPayload) {
    if (!sessionPayload || !sessionPayload.text) {
        showToast('No session file loaded.', true);
        return false;
    }

    try {
        const parsed = JSON.parse(sessionPayload.text);
        if (!Array.isArray(parsed)) throw new Error('Expected JSON array.');
        appState.modifications = parsed;
        appState.manualLabels.clear();
        clearMeasurementSelection({ skipRender: true });
        clearAllMeasurementPairs({ skipRender: true });
        return true;
    } catch (error) {
        showToast('Invalid JSON session file.', true);
        return false;
    }
}

function renderFileChips() {
    const sessionChips = document.getElementById('sessionChips');
    const newChips = document.getElementById('newChips');

    if (sessionChips) {
        sessionChips.innerHTML = sessionData
            ? buildFileChip(sessionData.file.name, 'fa-file-code')
            : '';
    }

    if (newChips) {
        const chips = [];
        if (sequenceData) chips.push(buildFileChip(sequenceData.file.name, 'fa-dna'));
        if (modificationData) chips.push(buildFileChip(modificationData.file.name, 'fa-table'));
        newChips.innerHTML = chips.join('');
    }
}

function buildFileChip(fileName, iconClass) {
    return `<span class="file-chip"><i class="fa-solid ${iconClass}" aria-hidden="true"></i>${escapeHtml(fileName)}</span>`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function setUploadMode(nextMode) {
    uploadMode = nextMode === 'new' ? 'new' : 'resume';
    const toggle = document.getElementById('uploadModeToggle');
    const resumePanel = document.getElementById('resumePanel');
    const newPanel = document.getElementById('newPanel');
    const options = document.querySelectorAll('#uploadModeToggle [data-mode]');

    if (toggle) toggle.dataset.active = uploadMode;
    if (resumePanel) resumePanel.classList.toggle('is-active', uploadMode === 'resume');
    if (newPanel) newPanel.classList.toggle('is-active', uploadMode === 'new');

    options.forEach((button) => {
        const isActive = button.dataset.mode === uploadMode;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
    });

    updateRenderButtonState();
}

function isRenderReady() {
    if (uploadMode === 'resume') return Boolean(sessionData);
    return Boolean(sequenceData && modificationData);
}

function updateRenderButtonState() {
    const loadButton = document.getElementById('loadCifBtn');
    if (!loadButton) return;
    const isReady = isRenderReady();
    loadButton.disabled = !isReady;
    loadButton.setAttribute('aria-disabled', String(!isReady));
}

function bindLoadOverlayControls() {
    const modal = document.getElementById('zeroStateModal');
    const openButton = document.getElementById('openLoadOverlayBtn');
    const closeButton = document.getElementById('closeLoadOverlayBtn');
    const loadButton = document.getElementById('loadCifBtn');

    if (!modal || !loadButton) return;

    function setOverlayOpen(isOpen) {
        if (overlayCloseTimerId) {
            clearTimeout(overlayCloseTimerId);
            overlayCloseTimerId = null;
        }

        if (isOpen) {
            modal.classList.remove('overlay-hidden', 'overlay-invisible');
        } else {
            modal.classList.add('overlay-hidden');
            overlayCloseTimerId = setTimeout(() => {
                modal.classList.add('overlay-invisible');
                overlayCloseTimerId = null;
            }, 500);
        }
        appState.ui.isLoadOverlayOpen = isOpen;
    }

    if (openButton) {
        openButton.addEventListener('click', () => setOverlayOpen(true));
    }

    if (closeButton) {
        closeButton.addEventListener('click', () => setOverlayOpen(false));
    }

    const observer = new MutationObserver(() => {
        if (!loadButton.classList.contains('is-working')) {
            setTimeout(() => setOverlayOpen(false), 500);
        }
    });
    observer.observe(loadButton, { attributes: true, attributeFilter: ['class'] });
}

function bindLeftSidebarPanels() {
    const panelButtons = document.querySelectorAll('[data-panel-target]');
    const closeButtons = document.querySelectorAll('[data-panel-close]');
    const panels = {
        style: document.getElementById('stylePanel'),
        export: document.getElementById('exportPanel')
    };

    function setActivePanel(panelName) {
        Object.entries(panels).forEach(([key, panel]) => {
            if (!panel) return;
            const isActive = key === panelName;
            panel.classList.toggle('panel-open', isActive);
            panel.setAttribute('aria-hidden', String(!isActive));
        });

        panelButtons.forEach((button) => {
            const isActive = button.dataset.panelTarget === panelName;
            button.classList.toggle('is-active', isActive);
        });

        appState.ui.activePanel = panelName;
    }

    panelButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const target = button.dataset.panelTarget;
            if (!target) return;
            if (appState.ui.activePanel === target) {
                setActivePanel(null);
                return;
            }
            setActivePanel(target);
        });
    });

    closeButtons.forEach((button) => {
        button.addEventListener('click', () => setActivePanel(null));
    });
}

function bindHelpButton() {
    const helpButton = document.getElementById('helpBtn');
    const legendBody = document.getElementById('legendBody');
    if (!helpButton || !legendBody) return;

    helpButton.addEventListener('click', () => {
        const shouldExpand = legendBody.classList.contains('collapsed');
        if (setLegendExpandedHandler) {
            setLegendExpandedHandler(shouldExpand);
        }
        appState.ui.isHelpOpen = shouldExpand;
    });
}

function bindSaveSession() {
    const saveButton = document.getElementById('saveSessionBtn');
    if (!saveButton) return;
    saveButton.addEventListener('click', () => {
        exportSessionJson();
    });
}

function bindOpacitySlider() {
    const slider = document.getElementById('opacitySlider');
    slider.addEventListener('input', function onOpacityInput() {
        appState.currentOpacity = parseFloat(this.value);
        document.getElementById('opacityVal').textContent = appState.currentOpacity.toFixed(2);
    });

    slider.addEventListener('change', () => {
        runRenderTask(() => {
            applyOpacityToBackboneOnly();
        }, 'Updating opacity...');
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

        setMeasureModeActive(Boolean(appState.measurementDraft.first));

        if (result.stage === 'first') {
            const actionHint = document.getElementById('actionHint');
            if (actionHint) {
                actionHint.textContent = `Measuring from ${result.changed ? contextMenuResidue.chain : ''}:${contextMenuResidue.resi}. Click second residue in viewer.`;
            }
            showMeasureWaitingToast();
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
    const toggleButton = document.getElementById('inspectorEar');
    const workspace = document.getElementById('workspaceLayout');
    if (!toggleButton || !workspace) return;

    toggleButton.addEventListener('click', () => {
        const collapsed = workspace.classList.toggle('sidebar-collapsed');
        toggleButton.setAttribute('aria-expanded', String(!collapsed));
        toggleButton.title = collapsed ? 'Expand right panel' : 'Collapse right panel';
        const icon = toggleButton.querySelector('i');
        if (icon) {
            icon.classList.toggle('fa-chevron-left', collapsed);
            icon.classList.toggle('fa-chevron-right', !collapsed);
        }
    });
}

function bindLegendControls() {
    const body = document.getElementById('legendBody');
    const helpButton = document.getElementById('helpBtn');

    if (!body || !helpButton) return;

    function setLegendExpanded(expanded) {
        body.classList.toggle('collapsed', !expanded);
        helpButton.classList.toggle('expanded', expanded);
    }

    setLegendExpandedHandler = setLegendExpanded;
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

    const dynamicAnalyticRows = getAnalyticLegendRows('analytic');
    const modeRows = dynamicAnalyticRows || analyticRows;
    let html = `${renderLegendRows('RNA backbones', chainRows)}`;
    html += `${renderLegendRows('Modifications', modeRows)}`;

    legendBody.innerHTML = html;
}

function bindViewerToggles() {
    const toggleProteins = document.getElementById('toggleProteins');
    const toggleDatabaseOverlay = document.getElementById('toggleDatabaseOverlay');
    if (!toggleProteins) return;

    toggleProteins.addEventListener('change', () => {
        runRenderTask(() => {
            if (!refresh3DmolProteinsOnly()) {
                updateCurrentEngineStyles();
            }
        }, 'Updating proteins...');
    });

    if (!toggleDatabaseOverlay) return;

    toggleDatabaseOverlay.addEventListener('change', () => {
        appState.databaseOverlayEnabled = toggleDatabaseOverlay.checked;
        updateCurrentEngineStyles();
        renderLegend();
    });

    const toggleIsolateUnknown = document.getElementById('toggleIsolateUnknown');
    if (toggleIsolateUnknown) {
        toggleIsolateUnknown.addEventListener('change', () => {
            appState.isolateUnknownEnabled = toggleIsolateUnknown.checked;
            updateCurrentEngineStyles();
        });
    }
}

function bindCameraReset() {
    const resetButton = document.getElementById('resetCameraSidebarBtn');
    if (!resetButton) return;
    resetButton.addEventListener('click', () => {
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

function bindPymolExport() {
    const exportButton = document.getElementById('pymolExportBtn');
    if (!exportButton) return;
    exportButton.addEventListener('click', () => {
        exportPymolScript();
    });
}

function exportSessionJson() {
    if (!appState.structureDataText) {
        showToast('Load a structure before saving a session.', true);
        return;
    }

    const view = appState.viewer3Dmol && typeof appState.viewer3Dmol.getView === 'function'
        ? appState.viewer3Dmol.getView()
        : null;

    const payload = {
        version: 1,
        ribo: appState.currentRibo,
        globalOpacity: appState.currentOpacity,
        proteinOpacity: appState.proteinOpacity,
        clippingDepth: appState.clippingDepth,
        cameraView: view,
        manualLabels: Array.from(appState.manualLabels.entries()),
        measurementPairs: appState.measurementPairs,
        modifications: appState.modifications
    };

    const fileName = `session-${appState.currentRibo}.json`;
    downloadTextFile(JSON.stringify(payload, null, 2), fileName, 'application/json');
    showToast('Session saved as JSON.');
}

function exportPymolScript() {
    const fileName = `session-${appState.currentRibo}.pml`;
    const script = [
        '# PyMOL export (template)',
        `# Structure: ${appState.currentRibo}`,
        `load ${appState.currentRibo}.cif`,
        'hide everything, all',
        'show cartoon, all',
        'color gray70, all',
        '# TODO: map residue colors and labels from session JSON'
    ].join('\n');

    downloadTextFile(script, fileName, 'text/plain');
    showToast('PyMOL script downloaded.');
}

function downloadTextFile(text, filename, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function updateInteractionPanels() {
    const labelCount = appState.manualLabels.size;
    document.getElementById('labelCount').textContent = `${labelCount}`;

    const actionHint = document.getElementById('actionHint');
    if (!actionHint) return;

    const hasDraft = Boolean(appState.measurementDraft.first);
    setMeasureModeActive(hasDraft);
    actionHint.textContent = hasDraft
        ? `Measuring from ${formatResidueTag(appState.measurementDraft.first)}. Click second residue in viewer.`
        : 'Left click on residue: zoom. Right click: actions menu.';
}

function formatResidueTag(residueSlot) {
    return `${residueSlot.type}:${residueSlot.residue}`;
}

