import { appState } from '../state.js';
import { rnaConfig } from '../constants.js';
import { buildResidueKey, getModificationsHydrationToken } from '../data/modifications.js';
import { setLoading, finishProgress } from '../ui/loading.js';
import { showToast } from '../ui/toast.js';

let focusPulseShape3Dmol = null;
let focusPulseTimer3Dmol = null;
let pendingStyleUpdateTimerId = null;
let pendingStyleUpdateMode = 'full';
let hoverResidueLabel3Dmol = null;
let hoveredResidueKey3Dmol = null;
let pendingHoverRenderRafId3Dmol = null;
let isMeasureHoverEnabled3Dmol = false;
let hasBound3DmolPicking = false;
let on3DmolResiduePicked = null;

let dynamicOverlayLabels3Dmol = [];
let dynamicOverlayShapes3Dmol = [];

const styleGroupCache3Dmol = {
    key: null,
    groups: []
};

const selectableResidueCache3Dmol = {
    key: null,
    map: new Map(),
    residueFallbackMap: new Map()
};

const STYLE_UPDATE_MODE_FULL = 'full';
const STYLE_UPDATE_MODE_OVERLAY = 'overlay';

const EXPORT_WIDTH_3DMOL = 3840;
const EXPORT_HEIGHT_3DMOL = 2160;
const BASE_LABEL_FONT_SIZE = 11;

export function destroyEngine(engineName = '3dmol') {
    if (engineName !== '3dmol') return;

    try {
        if (!appState.viewer3Dmol) return;

        clear3DmolHoverResidue();
        appState.viewer3Dmol.removeAllModels();
        document.getElementById('gldiv-3dmol').innerHTML = '';
        appState.viewer3Dmol = null;
        hasBound3DmolPicking = false;
    } catch (error) {
        console.warn('Error during 3Dmol cleanup:', error);
    }
}

export function renderActiveEngine() {
    setLoading(true, 'Initializing 3Dmol viewer...');

    if (!appState.viewer3Dmol) {
        appState.viewer3Dmol = $3Dmol.createViewer('gldiv-3dmol', { backgroundColor: '#ffffff' });
    }

    appState.viewer3Dmol.clear();
    appState.viewer3Dmol.addModel(appState.structureDataText, 'cif');
    bind3DmolResiduePicking();
    appState.viewer3Dmol.zoomTo();
    apply3DmolStyles();
    finishProgress();
}

function applyCurrentEngineStylesNow(mode = STYLE_UPDATE_MODE_FULL) {
    if (mode === STYLE_UPDATE_MODE_OVERLAY) {
        apply3DmolOverlayOnly();
        return;
    }

    apply3DmolStyles();
}

export function updateCurrentEngineStyles(options = {}) {
    const {
        immediate = false,
        mode = STYLE_UPDATE_MODE_FULL
    } = options;

    const requestedMode = mode === STYLE_UPDATE_MODE_OVERLAY
        ? STYLE_UPDATE_MODE_OVERLAY
        : STYLE_UPDATE_MODE_FULL;

    if (immediate) {
        if (pendingStyleUpdateTimerId) {
            clearTimeout(pendingStyleUpdateTimerId);
            pendingStyleUpdateTimerId = null;
        }

        pendingStyleUpdateMode = STYLE_UPDATE_MODE_FULL;
        applyCurrentEngineStylesNow(requestedMode);
        return;
    }

    if (pendingStyleUpdateTimerId) {
        if (requestedMode === STYLE_UPDATE_MODE_FULL) {
            pendingStyleUpdateMode = STYLE_UPDATE_MODE_FULL;
        }
        return;
    }

    pendingStyleUpdateMode = requestedMode;

    pendingStyleUpdateTimerId = setTimeout(() => {
        const modeToApply = pendingStyleUpdateMode;
        pendingStyleUpdateTimerId = null;
        pendingStyleUpdateMode = STYLE_UPDATE_MODE_FULL;
        applyCurrentEngineStylesNow(modeToApply);
    }, 0);
}

function buildStyleGroups() {
    const hydrationToken = getModificationsHydrationToken();
    const cacheKey = `${hydrationToken}`;

    if (styleGroupCache3Dmol.key === cacheKey) {
        return styleGroupCache3Dmol.groups;
    }

    const groups = {};

    appState.modifications.forEach((mod) => {
        if (!mod._isResolved) return;

        const chain = mod._authChain;
        const hex = mod._palette.hex;
        const key = `${chain}|${hex}`;

        if (!groups[key]) {
            groups[key] = {
                chain,
                color: hex,
                resi: []
            };
        }

        groups[key].resi.push(mod.resi);
    });

    styleGroupCache3Dmol.key = cacheKey;
    styleGroupCache3Dmol.groups = Object.values(groups);
    return styleGroupCache3Dmol.groups;
}

function getSelectableResidueModMap3Dmol() {
    const hydrationToken = getModificationsHydrationToken();
    const cacheKey = `${hydrationToken}`;

    if (selectableResidueCache3Dmol.key === cacheKey) {
        return selectableResidueCache3Dmol;
    }

    const map = new Map();
    const residueFallbackMap = new Map();

    appState.modifications.forEach((mod) => {
        if (!mod._isResolved) return;

        map.set(buildResidueKey(mod.resi, mod._authChain), mod);
        map.set(buildResidueKey(mod.resi, mod._structId), mod);

        const residueKey = String(mod.resi);
        if (!residueFallbackMap.has(residueKey)) {
            residueFallbackMap.set(residueKey, mod);
        }
    });

    selectableResidueCache3Dmol.key = cacheKey;
    selectableResidueCache3Dmol.map = map;
    selectableResidueCache3Dmol.residueFallbackMap = residueFallbackMap;
    return selectableResidueCache3Dmol;
}

function getSelectableModFromPickedAtom(atom) {
    if (!atom) return null;

    const residue = atom.resi ?? atom.resno;
    if (residue === null || residue === undefined) return null;

    const chainCandidates = [
        atom.chain,
        atom.auth,
        atom.chainname,
        atom.pdbchain
    ].filter(Boolean);

    if (chainCandidates.length === 0) return null;

    const cache = getSelectableResidueModMap3Dmol();
    const map = cache.map;

    for (const chain of chainCandidates) {
        const match = map.get(buildResidueKey(residue, chain));
        if (match) return match;
    }

    return cache.residueFallbackMap.get(String(residue)) || null;
}

function clear3DmolHoverResidue() {
    hoveredResidueKey3Dmol = null;

    if (!appState.viewer3Dmol || !hoverResidueLabel3Dmol) {
        hoverResidueLabel3Dmol = null;
        return;
    }

    try {
        appState.viewer3Dmol.removeLabel(hoverResidueLabel3Dmol);
    } catch (error) {
        // Ignore stale label handles.
    }

    hoverResidueLabel3Dmol = null;
}

function requestHoverRender3Dmol() {
    if (!appState.viewer3Dmol) return;
    if (pendingHoverRenderRafId3Dmol) return;

    pendingHoverRenderRafId3Dmol = requestAnimationFrame(() => {
        pendingHoverRenderRafId3Dmol = null;
        if (!appState.viewer3Dmol) return;
        appState.viewer3Dmol.render();
    });
}

function paint3DmolHoverResidue(mod) {
    if (!appState.viewer3Dmol || !mod) return;

    const residue = mod.resi;
    const residueKey = buildResidueKey(residue, mod._authChain);
    if (appState.manualLabels.has(residueKey)) {
        clear3DmolHoverResidue();
        return;
    }
    if (hoveredResidueKey3Dmol === residueKey) return;

    clear3DmolHoverResidue();

    const center = getResidueBoundingCenter(residue, mod._authChain);
    if (!center) return;

    hoverResidueLabel3Dmol = appState.viewer3Dmol.addLabel(
        `${mod._displayMod} ${residue}`,
        buildResidueLabelStyle(mod._palette.hex, {
            scale: 0.95,
            alignment: 'topLeft',
            position: {
                x: center.x + 2.1,
                y: center.y + 2.1,
                z: center.z + 1.0
            }
        })
    );

    hoveredResidueKey3Dmol = residueKey;
    requestHoverRender3Dmol();
}

function handle3DmolHoverIn(atom) {
    const mod = getSelectableModFromPickedAtom(atom);
    if (!mod) {
        if (hoverResidueLabel3Dmol) {
            clear3DmolHoverResidue();
            requestHoverRender3Dmol();
        }
        return;
    }

    const residueKey = buildResidueKey(mod.resi, mod._authChain);
    if (appState.manualLabels.has(residueKey)) {
        if (hoverResidueLabel3Dmol) {
            clear3DmolHoverResidue();
            requestHoverRender3Dmol();
        }
        return;
    }

    paint3DmolHoverResidue(mod);
}

function handle3DmolHoverOut() {
    if (!hoverResidueLabel3Dmol) return;
    clear3DmolHoverResidue();
    requestHoverRender3Dmol();
}

export function set3DmolMeasureHoverEnabled(enabled) {
    isMeasureHoverEnabled3Dmol = Boolean(enabled);

    if (!appState.viewer3Dmol) return false;

    if (typeof appState.viewer3Dmol.setHoverDuration === 'function') {
        appState.viewer3Dmol.setHoverDuration(120);
    }

    // Keep hover overlays disabled in measure mode to avoid render churn while picking.
    const isHoverEnabled = !isMeasureHoverEnabled3Dmol;
    appState.viewer3Dmol.setHoverable({}, isHoverEnabled, handle3DmolHoverIn, handle3DmolHoverOut);

    if (!isHoverEnabled || (hoverResidueLabel3Dmol || hoveredResidueKey3Dmol)) {
        clear3DmolHoverResidue();
        requestHoverRender3Dmol();
    }

    return true;
}

function bind3DmolResiduePicking() {
    if (!appState.viewer3Dmol || hasBound3DmolPicking) return;

    appState.viewer3Dmol.setClickable({}, true, (atom, _viewer, event) => {
        const mod = getSelectableModFromPickedAtom(atom);
        if (!mod) return;

        const mouseButton = event && event.button === 2 ? 'right' : 'left';
        if (mouseButton === 'right' && event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }

        if (typeof on3DmolResiduePicked === 'function') {
            on3DmolResiduePicked(mod, {
                source: 'viewer',
                mouseButton,
                clientX: event && Number.isFinite(event.clientX) ? event.clientX : null,
                clientY: event && Number.isFinite(event.clientY) ? event.clientY : null
            });
        }
    });

    set3DmolMeasureHoverEnabled(false);
    hasBound3DmolPicking = true;
}

export function set3DmolResiduePickHandler(handler) {
    on3DmolResiduePicked = typeof handler === 'function' ? handler : null;
}

export function clear3DmolResidueHover() {
    if (!hoverResidueLabel3Dmol && !hoveredResidueKey3Dmol) return false;
    clear3DmolHoverResidue();
    requestHoverRender3Dmol();
    return true;
}

function createResidueSelection(residue, authChain) {
    return { chain: authChain, resi: residue.toString() };
}

function cloneCenter(center) {
    if (!center) return null;
    return { x: center.x, y: center.y, z: center.z };
}

function computeDistanceAngstrom(firstCenter, secondCenter) {
    if (!firstCenter || !secondCenter) return null;
    const dx = secondCenter.x - firstCenter.x;
    const dy = secondCenter.y - firstCenter.y;
    const dz = secondCenter.z - firstCenter.z;
    return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function buildMeasurementSlotFromMod(mod) {
    return {
        residue: mod.resi,
        authChain: mod._authChain,
        structId: mod._structId,
        type: mod.chain,
        display: mod._displayMod,
        colorHex: mod._palette.hex,
        center: cloneCenter(mod._center)
    };
}

function getResidueBoundingCenter(residue, authChain) {
    if (!appState.viewer3Dmol) return null;

    const atoms = appState.viewer3Dmol.selectedAtoms(createResidueSelection(residue, authChain));
    if (!atoms || atoms.length === 0) return null;

    if (typeof $3Dmol === 'undefined' || typeof $3Dmol.getExtent !== 'function') {
        return cloneCenter({ x: atoms[0].x, y: atoms[0].y, z: atoms[0].z });
    }

    const extent = $3Dmol.getExtent(atoms);
    if (!Array.isArray(extent) || !Array.isArray(extent[2]) || extent[2].length !== 3) {
        return cloneCenter({ x: atoms[0].x, y: atoms[0].y, z: atoms[0].z });
    }

    return cloneCenter({ x: extent[2][0], y: extent[2][1], z: extent[2][2] });
}

function normalizeLabelScale(scale) {
    const numericScale = Number.isFinite(scale) ? scale : 1;
    return Math.min(3, Math.max(1, numericScale));
}

function buildResidueLabelStyle(colorHex, options = {}) {
    const {
        fontColor = '#111827',
        scale = 1,
        ...styleOverrides
    } = options;

    const safeScale = normalizeLabelScale(scale);

    return {
        font: 'sans-serif',
        fontSize: Math.round(BASE_LABEL_FONT_SIZE * safeScale),
        fontColor,
        backgroundColor: '#ffffff',
        backgroundOpacity: 0.95,
        borderColor: colorHex,
        borderThickness: Number((1.2 * Math.min(safeScale, 2)).toFixed(2)),
        inFront: true,
        showBackground: true,
        alignment: 'topLeft',
        ...styleOverrides
    };
}

function addManualResidueLabels(labelScale = 1) {
    if (!appState.viewer3Dmol) return;

    appState.manualLabels.forEach((labelData) => {
        const label = appState.viewer3Dmol.addLabel(
            labelData.text,
            buildResidueLabelStyle(labelData.colorHex || '#0891b2', { scale: labelScale }),
            createResidueSelection(labelData.residue, labelData.authChain)
        );
        if (label) dynamicOverlayLabels3Dmol.push(label);
    });
}

function addMeasurementOverlay(labelScale = 1) {
    if (!appState.viewer3Dmol) return;

    appState.measurementPairs.forEach((pair) => {
        if (!pair.centerA) pair.centerA = getResidueBoundingCenter(pair.a.residue, pair.a.authChain);
        if (!pair.centerB) pair.centerB = getResidueBoundingCenter(pair.b.residue, pair.b.authChain);

        const firstCenter = pair.centerA;
        const secondCenter = pair.centerB;

        if (!firstCenter || !secondCenter) {
            pair.distanceAngstrom = null;
            return;
        }

        const distance = typeof pair.distanceAngstrom === 'number'
            ? pair.distanceAngstrom
            : computeDistanceAngstrom(firstCenter, secondCenter);
        pair.distanceAngstrom = distance;

        const line = appState.viewer3Dmol.addLine({
            start: firstCenter,
            end: secondCenter,
            color: '#0f172a',
            dashed: true,
            dashLength: 0.7,
            gapLength: 0.3,
            linewidth: 4
        });
        if (line) dynamicOverlayShapes3Dmol.push(line);

        const labelA = appState.viewer3Dmol.addLabel(
            `${pair.a.display} ${pair.a.residue}`,
            buildResidueLabelStyle(pair.a.colorHex, { scale: labelScale }),
            createResidueSelection(pair.a.residue, pair.a.authChain)
        );
        if (labelA) dynamicOverlayLabels3Dmol.push(labelA);

        const labelB = appState.viewer3Dmol.addLabel(
            `${pair.b.display} ${pair.b.residue}`,
            buildResidueLabelStyle(pair.b.colorHex, { scale: labelScale }),
            createResidueSelection(pair.b.residue, pair.b.authChain)
        );
        if (labelB) dynamicOverlayLabels3Dmol.push(labelB);

        const distanceLabel = appState.viewer3Dmol.addLabel(
            `${distance.toFixed(2)} A`,
            buildResidueLabelStyle('#0f172a', {
                scale: labelScale,
                alignment: 'center',
                position: {
                    x: (firstCenter.x + secondCenter.x) / 2,
                    y: (firstCenter.y + secondCenter.y) / 2,
                    z: (firstCenter.z + secondCenter.z) / 2
                }
            })
        );
        if (distanceLabel) dynamicOverlayLabels3Dmol.push(distanceLabel);
    });
}

function clear3DmolDynamicOverlays() {
    if (!appState.viewer3Dmol) {
        dynamicOverlayLabels3Dmol = [];
        dynamicOverlayShapes3Dmol = [];
        return;
    }

    dynamicOverlayLabels3Dmol.forEach((label) => {
        try {
            appState.viewer3Dmol.removeLabel(label);
        } catch (error) {
            // Ignore stale label handles.
        }
    });

    dynamicOverlayShapes3Dmol.forEach((shape) => {
        try {
            appState.viewer3Dmol.removeShape(shape);
        } catch (error) {
            // Ignore stale shape handles.
        }
    });

    dynamicOverlayLabels3Dmol = [];
    dynamicOverlayShapes3Dmol = [];
}

export function toggleManualResidueLabel(mod) {
    if (!mod || !mod._isResolved) return { changed: false, reason: 'invalid' };

    const residue = mod.resi;
    const key = buildResidueKey(residue, mod._authChain);

    if (appState.manualLabels.has(key)) {
        appState.manualLabels.delete(key);
    } else {
        const payload = mod._labelPayload || {
            residue,
            authChain: mod._authChain,
            colorHex: mod._palette.hex,
            text: `${mod._displayMod} ${residue}`
        };
        mod._labelPayload = payload;
        appState.manualLabels.set(key, payload);
    }

    updateCurrentEngineStyles({ mode: STYLE_UPDATE_MODE_OVERLAY });
    return { changed: true, reason: 'ok' };
}

export function clearManualResidueLabels(options = {}) {
    const { skipRender = false } = options;
    if (appState.manualLabels.size === 0) return false;

    appState.manualLabels.clear();
    if (!skipRender) updateCurrentEngineStyles({ mode: STYLE_UPDATE_MODE_OVERLAY });
    return true;
}

export function selectResidueForMeasurement(mod) {
    if (!mod || !mod._isResolved) return { changed: false, stage: 'invalid' };

    if (!mod._center) {
        mod._center = getResidueBoundingCenter(mod.resi, mod._authChain);
    }

    const slotSource = mod._measurementSlot || buildMeasurementSlotFromMod(mod);
    slotSource.center = cloneCenter(mod._center);
    mod._measurementSlot = slotSource;

    const slot = {
        ...slotSource,
        center: cloneCenter(slotSource.center)
    };

    const measure = appState.measurementDraft;
    const slotKey = buildResidueKey(slot.residue, slot.authChain);
    const firstKey = measure.first ? buildResidueKey(measure.first.residue, measure.first.authChain) : null;

    if (!measure.first) {
        measure.first = slot;
        measure.second = null;
        return { changed: true, stage: 'first' };
    }

    if (slotKey === firstKey) return { changed: false, stage: 'same' };

    const pair = {
        id: ++appState.measurementPairCounter,
        a: measure.first,
        b: slot,
        centerA: cloneCenter(measure.first.center),
        centerB: cloneCenter(slot.center),
        distanceAngstrom: computeDistanceAngstrom(measure.first.center, slot.center)
    };

    appState.measurementPairs.unshift(pair);
    measure.first = null;
    measure.second = null;
    updateCurrentEngineStyles({ mode: STYLE_UPDATE_MODE_OVERLAY });
    return { changed: true, stage: 'linked', pair };
}

export function clearMeasurementSelection(options = {}) {
    const { skipRender = false } = options;
    const hadDraft = Boolean(appState.measurementDraft.first || appState.measurementDraft.second);
    if (!hadDraft) return false;

    appState.measurementDraft.first = null;
    appState.measurementDraft.second = null;
    if (!skipRender) updateCurrentEngineStyles({ mode: STYLE_UPDATE_MODE_OVERLAY });
    return true;
}

export function unlinkMeasurementPair(pairId) {
    const previousLength = appState.measurementPairs.length;
    appState.measurementPairs = appState.measurementPairs.filter((pair) => pair.id !== pairId);
    if (appState.measurementPairs.length === previousLength) return false;
    updateCurrentEngineStyles({ mode: STYLE_UPDATE_MODE_OVERLAY });
    return true;
}

export function clearAllMeasurementPairs(options = {}) {
    const { skipRender = false } = options;
    if (appState.measurementPairs.length === 0 && !appState.measurementDraft.first && !appState.measurementDraft.second) return false;

    appState.measurementPairs = [];
    appState.measurementDraft.first = null;
    appState.measurementDraft.second = null;
    if (!skipRender) updateCurrentEngineStyles({ mode: STYLE_UPDATE_MODE_OVERLAY });
    return true;
}

function apply3DmolBackboneStylesOnly() {
    if (!appState.viewer3Dmol) return;

    const config = rnaConfig[appState.currentRibo];
    const showProteins = document.getElementById('toggleProteins')?.checked !== false;

    appState.viewer3Dmol.setStyle({}, {});

    if (showProteins) {
        appState.viewer3Dmol.setStyle({}, {
            cartoon: {
                color: '#E0E0E0',
                opacity: appState.currentOpacity
            }
        });
    }

    Object.values(config.chains).forEach((chainConfig) => {
        if (!chainConfig.auth || !chainConfig.defaultColor) return;

        appState.viewer3Dmol.setStyle(
            { chain: chainConfig.auth },
            {
                cartoon: {
                    color: chainConfig.defaultColor,
                    opacity: appState.currentOpacity
                }
            }
        );
    });

    buildStyleGroups().forEach((group) => {
        appState.viewer3Dmol.setStyle(
            {
                chain: group.chain,
                resi: group.resi
            },
            {
                cartoon: { color: group.color, opacity: 1.0 },
                sphere: { radius: 1.2, color: group.color }
            }
        );
    });

}

export function refresh3DmolProteinsOnly() {
    if (!appState.viewer3Dmol) return false;
    apply3DmolBackboneStylesOnly();
    appState.viewer3Dmol.render();
    return true;
}

function apply3DmolOverlayOnly(options = {}) {
    if (!appState.viewer3Dmol) return;

    const labelScale = normalizeLabelScale(options.labelScale);
    clear3DmolDynamicOverlays();
    addManualResidueLabels(labelScale);
    addMeasurementOverlay(labelScale);
    appState.viewer3Dmol.render();
}

function apply3DmolStyles(options = {}) {
    if (!appState.viewer3Dmol) return;

    clear3DmolHoverResidue();

    const labelScale = normalizeLabelScale(options.labelScale);

    dynamicOverlayLabels3Dmol = [];
    dynamicOverlayShapes3Dmol = [];

    appState.viewer3Dmol.setStyle({}, {});
    appState.viewer3Dmol.removeAllLabels();
    appState.viewer3Dmol.removeAllShapes();

    apply3DmolBackboneStylesOnly();
    addManualResidueLabels(labelScale);
    addMeasurementOverlay(labelScale);

    appState.viewer3Dmol.render();
}

export function centerOnResidue(resi, authChain) {
    if (!appState.viewer3Dmol) return;

    const selection = { chain: authChain, resi: resi.toString() };

    appState.viewer3Dmol.zoomTo(selection, 750);

    if (focusPulseTimer3Dmol) {
        clearTimeout(focusPulseTimer3Dmol);
        focusPulseTimer3Dmol = null;
    }

    if (focusPulseShape3Dmol) {
        appState.viewer3Dmol.removeShape(focusPulseShape3Dmol);
        focusPulseShape3Dmol = null;
    }

    appState.viewer3Dmol.render();
}

export function centerOnMeasurementPair(pair) {
    if (!pair || !appState.viewer3Dmol) return;

    const selection = {
        or: [
            { chain: pair.a.authChain, resi: pair.a.residue.toString() },
            { chain: pair.b.authChain, resi: pair.b.residue.toString() }
        ]
    };

    appState.viewer3Dmol.zoomTo(selection, 750);
    appState.viewer3Dmol.render();
}

export function resetCameraView() {
    if (!appState.viewer3Dmol) return { ok: false, reason: 'viewer' };

    appState.viewer3Dmol.zoomTo(undefined, 750);
    appState.viewer3Dmol.render();
    return { ok: true, reason: 'ok' };
}

function downloadSnapshot(uri, filename) {
    const link = document.createElement('a');
    link.href = uri;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function compute3DmolExportLabelScale(viewportWidth, viewportHeight) {
    const safeWidth = Math.max(1, viewportWidth || 1);
    const safeHeight = Math.max(1, viewportHeight || 1);
    const widthScale = EXPORT_WIDTH_3DMOL / safeWidth;
    const heightScale = EXPORT_HEIGHT_3DMOL / safeHeight;
    return normalizeLabelScale(Math.max(widthScale, heightScale));
}

export function exportSnapshot() {
    if (!appState.viewer3Dmol) {
        showToast('Load a structure before exporting a PNG.', true);
        return;
    }

    showToast('Rendering 4K snapshot... please wait.');

    setTimeout(() => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `28S_${appState.currentRibo}_3dmol_4K_${timestamp}.png`;
        const container = document.getElementById('gldiv-3dmol');

        if (!container) {
            showToast('3Dmol container is not available.', true);
            return;
        }

        const originalWidth = container.style.width;
        const originalHeight = container.style.height;
        const labelScale = compute3DmolExportLabelScale(container.clientWidth, container.clientHeight);

        try {
            container.style.width = `${EXPORT_WIDTH_3DMOL}px`;
            container.style.height = `${EXPORT_HEIGHT_3DMOL}px`;
            appState.viewer3Dmol.resize();
            apply3DmolStyles({ labelScale });

            const imageData = appState.viewer3Dmol.pngURI();
            downloadSnapshot(imageData, filename);
            showToast('4K snapshot (3Dmol) saved.');
        } catch (error) {
            console.error(error);
            showToast('Error while rendering 3Dmol snapshot.', true);
        } finally {
            container.style.width = originalWidth;
            container.style.height = originalHeight;
            appState.viewer3Dmol.resize();
            apply3DmolStyles();
        }
    }, 100);
}
