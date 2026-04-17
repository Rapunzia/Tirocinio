import { appState } from '../state.js';
import { rnaConfig } from '../constants.js';
import { hexToRgb } from '../utils/color.js';
import { getResidueCenter } from '../data/cif-cache.js';
import { getModificationsHydrationToken } from '../data/modifications.js';
import { setLoading, finishProgress } from '../ui/loading.js';
import { showToast } from '../ui/toast.js';

let nglColorSchemeCounter = 0;
let focusPulseShape3Dmol = null;
let focusPulseTimer3Dmol = null;
let pendingStyleUpdateTimerId = null;
let pendingStyleUpdateMode = 'full';
let hoverResidueLabel3Dmol = null;
let hoveredResidueKey3Dmol = null;
let hasBound3DmolPicking = false;
let on3DmolResiduePicked = null;

let dynamicOverlayLabels3Dmol = [];
let dynamicOverlayShapes3Dmol = [];
let baseResidueLabels3Dmol = [];

const styleGroupCacheByChainProperty = {
    _authChain: { key: null, groups: [] },
    _structId: { key: null, groups: [] }
};

const selectableResidueCache3Dmol = {
    key: null,
    map: new Map()
};

const STYLE_UPDATE_MODE_FULL = 'full';
const STYLE_UPDATE_MODE_OVERLAY = 'overlay';

const EXPORT_WIDTH_3DMOL = 3840;
const EXPORT_HEIGHT_3DMOL = 2160;
const BASE_LABEL_FONT_SIZE = 11;
const BASE_LABEL_BATCH_SIZE = 120;

let baseLabelBuildToken3Dmol = 0;

// Releases WebGL and DOM resources used by one engine instance.
export function destroyEngine(engineName) {
    try {
        if (engineName === '3dmol' && appState.viewer3Dmol) {
            clear3DmolHoverResidue();
            appState.viewer3Dmol.removeAllModels();
            document.getElementById('gldiv-3dmol').innerHTML = '';
            appState.viewer3Dmol = null;
            hasBound3DmolPicking = false;
        } else if (engineName === 'molstar' && appState.viewerMolstar) {
            document.getElementById('gldiv-molstar').innerHTML = '';
            appState.viewerMolstar = null;

            if (appState.molstarBlobUrl) {
                URL.revokeObjectURL(appState.molstarBlobUrl);
                appState.molstarBlobUrl = null;
            }
        } else if (engineName === 'jsmol' && window.myJmol) {
            document.getElementById('gldiv-jsmol').innerHTML = '';
            window.myJmol = null;
        } else if (engineName === 'ngl' && appState.viewerNgl) {
            appState.viewerNgl.dispose();
            document.getElementById('gldiv-ngl').innerHTML = '';
            appState.viewerNgl = null;
            appState.nglComponent = null;
        }
    } catch (error) {
        console.warn(`Error during cleanup for engine ${engineName}:`, error);
    }
}

// Renders the currently selected engine using already loaded structure text.
export function renderActiveEngine() {
    switch (appState.currentEngine) {
        case '3dmol':
            render3Dmol();
            break;
        case 'molstar':
            renderMolstar();
            break;
        case 'jsmol':
            renderJSmol();
            break;
        case 'ngl':
            renderNgl();
            break;
        default:
            break;
    }
}

function render3Dmol() {
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

function renderMolstar() {
    setLoading(true, 'Initializing Mol* viewer...');

    const blob = new Blob([appState.structureDataText], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);

    if (appState.molstarBlobUrl) URL.revokeObjectURL(appState.molstarBlobUrl);
    appState.molstarBlobUrl = blobUrl;

    if (!appState.viewerMolstar) {
        appState.viewerMolstar = new PDBeMolstarPlugin();
        appState.viewerMolstar.render(document.getElementById('gldiv-molstar'), {
            customData: { url: blobUrl, format: 'cif', binary: false },
            bgColor: { r: 255, g: 255, b: 255 },
            lighting: 'flat',
            hideControls: true,
            hideIconWall: true,
            hideExpandIcon: true,
            hideSystemMenu: true,
            layoutShowControls: false,
            layoutShowSequence: false,
            layoutShowLog: false
        });

        appState.viewerMolstar.events.loadComplete.subscribe(() => {
            applyMolstarStyles();
            finishProgress();
        });
    } else {
        appState.viewerMolstar.visual.update({
            customData: { url: blobUrl, format: 'cif', binary: false }
        });

        setTimeout(() => {
            applyMolstarStyles();
            finishProgress();
        }, 500);
    }
}

function renderJSmol() {
    setLoading(true, 'Initializing JSmol viewer...');

    if (!window.myJmol) {
        const info = {
            width: '100%',
            height: '100%',
            use: 'HTML5',
            j2sPath: 'https://chemapps.stolaf.edu/jmol/jsmol/j2s',
            disableInitialConsole: true,
            readyFunction(applet) {
                Jmol.script(applet, `load DATA 'model'\n${appState.structureDataText}\nEND 'model'; cartoon only;`);
                applyJSmolStyles();
                finishProgress();
            }
        };

        document.getElementById('gldiv-jsmol').innerHTML = Jmol.getAppletHtml('myJmol', info);
    } else {
        Jmol.script(window.myJmol, `load DATA 'model'\n${appState.structureDataText}\nEND 'model'; cartoon only;`);
        applyJSmolStyles();
        finishProgress();
    }
}

function renderNgl() {
    setLoading(true, 'Initializing NGL viewer...');

    if (!appState.viewerNgl) {
        appState.viewerNgl = new NGL.Stage('gldiv-ngl', { backgroundColor: 'white' });
        window.addEventListener('resize', () => appState.viewerNgl && appState.viewerNgl.handleResize());
    }

    appState.viewerNgl.removeAllComponents();
    appState.viewerNgl
        .loadFile(new Blob([appState.structureDataText], { type: 'text/plain' }), { ext: 'cif' })
        .then((component) => {
            appState.nglComponent = component;
            component.autoView();
            applyNglStyles();
            finishProgress();
        });
}

function applyCurrentEngineStylesNow(mode = STYLE_UPDATE_MODE_FULL) {
    if (appState.currentEngine === '3dmol') {
        if (mode === STYLE_UPDATE_MODE_OVERLAY) {
            apply3DmolOverlayOnly();
        } else {
            apply3DmolStyles();
        }
    }
    if (appState.currentEngine === 'molstar') applyMolstarStyles();
    if (appState.currentEngine === 'jsmol') applyJSmolStyles();
    if (appState.currentEngine === 'ngl') applyNglStyles();
}

// Re-applies colors/representations for whichever engine is active.
// By default this is deferred to the next frame to keep UI interactions snappy.
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

    // Run after current task so button/list visual feedback can paint first.
    pendingStyleUpdateTimerId = setTimeout(() => {
        const modeToApply = pendingStyleUpdateMode;
        pendingStyleUpdateTimerId = null;
        pendingStyleUpdateMode = STYLE_UPDATE_MODE_FULL;
        applyCurrentEngineStylesNow(modeToApply);
    }, 0);
}

// Groups residues by chain+color to reduce draw-call count in style passes.
function buildStyleGroups(chainProperty) {
    const cacheEntry = styleGroupCacheByChainProperty[chainProperty];
    if (!cacheEntry) return [];

    const showUnknown = document.getElementById('toggleUnknown').checked;
    const hydrationToken = getModificationsHydrationToken();
    const cacheKey = `${hydrationToken}|${showUnknown ? '1' : '0'}`;

    if (cacheEntry.key === cacheKey) {
        return cacheEntry.groups;
    }

    const groups = {};

    appState.modifications.forEach((mod) => {
        if (!mod._isResolved) return;

        const isKnown = mod['Knwon Positions Modifications'] === 'Y';
        if (!isKnown && !showUnknown) return;

        const chain = mod[chainProperty];
        const hex = mod._palette.hex;
        const key = `${chain}|${hex}`;

        if (!groups[key]) {
            groups[key] = {
                chain,
                color: hex,
                rgb: mod._palette.rgb,
                resi: []
            };
        }

        groups[key].resi.push(mod['Positions in the Structure']);
    });

    cacheEntry.key = cacheKey;
    cacheEntry.groups = Object.values(groups);
    return cacheEntry.groups;
}

function buildResidueKey(residue, authChain) {
    return `${residue}|${authChain}`;
}

function getSelectableResidueModMap3Dmol() {
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const hydrationToken = getModificationsHydrationToken();
    const cacheKey = `${hydrationToken}|${showUnknown ? '1' : '0'}`;

    if (selectableResidueCache3Dmol.key === cacheKey) {
        return selectableResidueCache3Dmol.map;
    }

    const map = new Map();

    appState.modifications.forEach((mod) => {
        if (!mod._isResolved) return;

        const isKnown = mod['Knwon Positions Modifications'] === 'Y';
        if (!isKnown && !showUnknown) return;

        const residue = mod['Positions in the Structure'];
        map.set(buildResidueKey(residue, mod._authChain), mod);
    });

    selectableResidueCache3Dmol.key = cacheKey;
    selectableResidueCache3Dmol.map = map;
    return map;
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

    const map = getSelectableResidueModMap3Dmol();

    for (const chain of chainCandidates) {
        const match = map.get(buildResidueKey(residue, chain));
        if (match) return match;
    }

    return null;
}

function clear3DmolHoverResidue() {
    hoveredResidueKey3Dmol = null;

    if (!appState.viewer3Dmol || !hoverResidueLabel3Dmol) {
        hoverResidueLabel3Dmol = null;
        return;
    }

    try {
        if (hoverResidueLabel3Dmol) appState.viewer3Dmol.removeLabel(hoverResidueLabel3Dmol);
    } catch (error) {
        // Ignore stale handles removed by a full redraw path.
    }

    hoverResidueLabel3Dmol = null;
}

function paint3DmolHoverResidue(mod) {
    if (!appState.viewer3Dmol || !mod) return;

    const residue = mod['Positions in the Structure'];
    const residueKey = buildResidueKey(residue, mod._authChain);
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
    appState.viewer3Dmol.render();
}

function bind3DmolResiduePicking() {
    if (!appState.viewer3Dmol || hasBound3DmolPicking) return;

    if (typeof appState.viewer3Dmol.setHoverDuration === 'function') {
        appState.viewer3Dmol.setHoverDuration(60);
    }

    appState.viewer3Dmol.setClickable({}, true, (atom) => {
        if (appState.interactionMode !== 'measure') return;

        const mod = getSelectableModFromPickedAtom(atom);
        if (!mod) return;

        if (typeof on3DmolResiduePicked === 'function') {
            on3DmolResiduePicked(mod);
        }
    });

    appState.viewer3Dmol.setHoverable(
        {},
        true,
        (atom) => {
            if (appState.interactionMode !== 'measure') {
                if (hoverResidueLabel3Dmol) {
                    clear3DmolHoverResidue();
                    appState.viewer3Dmol.render();
                }
                return;
            }

            const mod = getSelectableModFromPickedAtom(atom);
            if (!mod) {
                if (hoverResidueLabel3Dmol) {
                    clear3DmolHoverResidue();
                    appState.viewer3Dmol.render();
                }
                return;
            }

            paint3DmolHoverResidue(mod);
        },
        () => {
            if (!hoverResidueLabel3Dmol) return;
            clear3DmolHoverResidue();
            appState.viewer3Dmol.render();
        }
    );

    hasBound3DmolPicking = true;
}

export function set3DmolResiduePickHandler(handler) {
    on3DmolResiduePicked = typeof handler === 'function' ? handler : null;
}

export function clear3DmolResidueHover() {
    if (!hoverResidueLabel3Dmol && !hoveredResidueKey3Dmol) return false;
    clear3DmolHoverResidue();
    if (appState.viewer3Dmol) appState.viewer3Dmol.render();
    return true;
}

function cacheResidueCenter(residue, authChain, center) {
    if (!center) return;
    if (!appState.residueCenterCache) appState.residueCenterCache = new Map();
    appState.residueCenterCache.set(buildResidueKey(residue, authChain), cloneCenter(center));
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
    const residue = mod['Positions in the Structure'];
    const authChain = mod._authChain;

    if (!mod._center) {
        const cachedCenter = getResidueCenter(residue, authChain);
        if (cachedCenter) mod._center = cachedCenter;
    }

    return {
        residue,
        authChain,
        structId: mod._structId,
        type: mod['Type Structure'],
        display: mod._displayMod,
        colorHex: mod._palette.hex,
        center: cloneCenter(mod._center)
    };
}

function getResidueBoundingCenter(residue, authChain) {
    const cachedCenter = getResidueCenter(residue, authChain);
    if (cachedCenter) return cloneCenter(cachedCenter);

    if (!appState.viewer3Dmol) return null;

    const atoms = appState.viewer3Dmol.selectedAtoms(createResidueSelection(residue, authChain));
    if (!atoms || atoms.length === 0) return null;

    if (typeof $3Dmol === 'undefined' || typeof $3Dmol.getExtent !== 'function') {
        const fallbackCenter = cloneCenter({ x: atoms[0].x, y: atoms[0].y, z: atoms[0].z });
        cacheResidueCenter(residue, authChain, fallbackCenter);
        return fallbackCenter;
    }

    const extent = $3Dmol.getExtent(atoms);
    if (!Array.isArray(extent) || !Array.isArray(extent[2]) || extent[2].length !== 3) {
        const fallbackCenter = cloneCenter({ x: atoms[0].x, y: atoms[0].y, z: atoms[0].z });
        cacheResidueCenter(residue, authChain, fallbackCenter);
        return fallbackCenter;
    }

    const center = cloneCenter({ x: extent[2][0], y: extent[2][1], z: extent[2][2] });
    cacheResidueCenter(residue, authChain, center);
    return center;
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

function clearBaseResidueLabels3Dmol() {
    baseLabelBuildToken3Dmol += 1;

    if (!appState.viewer3Dmol) {
        baseResidueLabels3Dmol = [];
        return;
    }

    baseResidueLabels3Dmol.forEach((label) => {
        try {
            appState.viewer3Dmol.removeLabel(label);
        } catch (error) {
            // Ignore stale handles removed by a full redraw path.
        }
    });

    baseResidueLabels3Dmol = [];
}

function getEligibleBaseLabelMods() {
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const eligible = [];

    appState.modifications.forEach((mod) => {
        if (!mod._isResolved) return;

        const isKnown = mod['Knwon Positions Modifications'] === 'Y';
        if (!isKnown && !showUnknown) return;

        eligible.push(mod);
    });

    return eligible;
}

function addBaseResidueLabels3Dmol(labelScale = 1) {
    if (!appState.viewer3Dmol) return;

    const showLabels = document.getElementById('toggleLabels').checked;
    if (!showLabels) return;

    const eligibleMods = getEligibleBaseLabelMods();
    if (eligibleMods.length === 0) return;

    const token = ++baseLabelBuildToken3Dmol;
    let cursor = 0;

    const renderChunk = () => {
        if (!appState.viewer3Dmol) return;
        if (token !== baseLabelBuildToken3Dmol) return;
        if (!document.getElementById('toggleLabels').checked) return;

        const end = Math.min(cursor + BASE_LABEL_BATCH_SIZE, eligibleMods.length);
        for (; cursor < end; cursor += 1) {
            const mod = eligibleMods[cursor];
        const residue = mod['Positions in the Structure'];
        const labelText = `${mod._displayMod} ${residue}`;

        const label = appState.viewer3Dmol.addLabel(
            labelText,
            buildResidueLabelStyle(mod._palette.hex, { scale: labelScale }),
            { chain: mod._authChain, resi: residue.toString() }
        );

            if (label) baseResidueLabels3Dmol.push(label);
        }

        appState.viewer3Dmol.render();

        if (cursor < eligibleMods.length) {
            setTimeout(renderChunk, 0);
        }
    };

    setTimeout(renderChunk, 0);
}

function addMeasurementOverlay(labelScale = 1) {
    if (!appState.viewer3Dmol) return;

    appState.measurementPairs.forEach((pair) => {
        if (!pair.centerA) pair.centerA = getResidueBoundingCenter(pair.a.residue, pair.a.authChain);
        if (!pair.centerB) pair.centerB = getResidueBoundingCenter(pair.b.residue, pair.b.authChain);

        const firstCenter = pair.centerA;
        const secondCenter = pair.centerB;

        // Keep the card visible even when distance cannot be resolved in the current frame.
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
            // Ignore stale handles removed by a full redraw path.
        }
    });

    dynamicOverlayShapes3Dmol.forEach((shape) => {
        try {
            appState.viewer3Dmol.removeShape(shape);
        } catch (error) {
            // Ignore stale handles removed by a full redraw path.
        }
    });

    dynamicOverlayLabels3Dmol = [];
    dynamicOverlayShapes3Dmol = [];
}

export function toggleManualResidueLabel(mod) {
    if (!mod || !mod._isResolved) return { changed: false, reason: 'invalid' };
    if (appState.currentEngine !== '3dmol') return { changed: false, reason: 'engine' };

    const residue = mod['Positions in the Structure'];
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
    if (appState.currentEngine !== '3dmol') return { changed: false, stage: 'engine' };

    const slotSource = mod._measurementSlot || buildMeasurementSlotFromMod(mod);
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
    const showProteins = document.getElementById('toggleProteins').checked;

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

    buildStyleGroups('_authChain').forEach((group) => {
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
    if (appState.currentEngine !== '3dmol' || !appState.viewer3Dmol) return false;
    apply3DmolBackboneStylesOnly();
    appState.viewer3Dmol.render();
    return true;
}

export function refresh3DmolBaseLabelsOnly(options = {}) {
    if (appState.currentEngine !== '3dmol' || !appState.viewer3Dmol) return false;

    const labelScale = normalizeLabelScale(options.labelScale);
    clearBaseResidueLabels3Dmol();
    addBaseResidueLabels3Dmol(labelScale);
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

    baseResidueLabels3Dmol = [];
    clear3DmolHoverResidue();

    const labelScale = normalizeLabelScale(options.labelScale);

    dynamicOverlayLabels3Dmol = [];
    dynamicOverlayShapes3Dmol = [];

    appState.viewer3Dmol.setStyle({}, {});
    appState.viewer3Dmol.removeAllLabels();
    appState.viewer3Dmol.removeAllShapes();

    apply3DmolBackboneStylesOnly();
    addBaseResidueLabels3Dmol(labelScale);

    // Always draw user-managed overlays after base/global labels.
    addManualResidueLabels(labelScale);
    addMeasurementOverlay(labelScale);

    appState.viewer3Dmol.render();
}

function applyMolstarStyles() {
    if (!appState.viewerMolstar) return;

    const config = rnaConfig[appState.currentRibo];
    const selectionData = [];

    Object.values(config.chains).forEach((chainConfig) => {
        if (!chainConfig.struct || !chainConfig.defaultColor) return;
        selectionData.push({
            struct_asym_id: chainConfig.struct,
            color: hexToRgb(chainConfig.defaultColor),
            focus: false
        });
    });

    buildStyleGroups('_structId').forEach((group) => {
        group.resi.forEach((resi) => {
            selectionData.push({
                struct_asym_id: group.chain,
                start_residue_number: resi,
                end_residue_number: resi,
                color: group.rgb,
                focus: false,
                representation: 'spacefill',
                representationColor: group.rgb
            });
        });
    });

    appState.viewerMolstar.visual.clearSelection();

    if (selectionData.length > 0) {
        appState.viewerMolstar.visual.select({
            data: selectionData,
            nonSelectedColor: { r: 224, g: 224, b: 224 }
        });
    }
}

function applyJSmolStyles() {
    if (!window.myJmol) return;

    const config = rnaConfig[appState.currentRibo];
    const showProteins = document.getElementById('toggleProteins').checked;

    let script = 'select all; spacefill off; wireframe off; cartoon off; ';

    if (showProteins) {
        script += `select all; cartoon only; color cartoon [xE0E0E0]; color cartoon translucent ${1.0 - appState.currentOpacity}; `;
    }

    Object.values(config.chains).forEach((chainConfig) => {
        if (!chainConfig.auth || !chainConfig.defaultColor) return;
        script += `select chain=${chainConfig.auth}; cartoon only; color cartoon ${chainConfig.defaultColor.replace('#', '[x')}]; color cartoon translucent ${1.0 - appState.currentOpacity}; `;
    });

    buildStyleGroups('_authChain').forEach((group) => {
        const color = `${group.color.replace('#', '[x')}]`;
        script += `select (resno=${group.resi.join(',')} and chain=${group.chain}); color cartoon opaque; color cartoon ${color}; spacefill 1.5; color spacefill ${color}; `;
    });

    script += 'select none;';
    Jmol.script(window.myJmol, script);
}

function applyNglStyles() {
    if (!appState.viewerNgl || !appState.nglComponent) return;

    appState.nglComponent.removeAllRepresentations();

    const config = rnaConfig[appState.currentRibo];
    const showProteins = document.getElementById('toggleProteins').checked;

    const schemeData = [];
    const rnaSelections = [];

    Object.values(config.chains).forEach((chainConfig) => {
        if (!chainConfig.auth || !chainConfig.defaultColor) return;

        schemeData.push([chainConfig.defaultColor, `:${chainConfig.auth}`]);
        rnaSelections.push(`:${chainConfig.auth}`);
    });

    if (showProteins) schemeData.push(['#E0E0E0', '*']);

    nglColorSchemeCounter += 1;
    const colorScheme = NGL.ColormakerRegistry.addSelectionScheme(
        schemeData,
        `rnaBackboneScheme_${nglColorSchemeCounter}`
    );

    const baseRepresentation = {
        color: colorScheme,
        opacity: appState.currentOpacity,
        depthWrite: appState.currentOpacity === 1.0
    };

    if (showProteins) {
        appState.nglComponent.addRepresentation('cartoon', baseRepresentation);
    } else {
        appState.nglComponent.addRepresentation('cartoon', {
            ...baseRepresentation,
            sele: rnaSelections.join(' or ')
        });
    }

    buildStyleGroups('_authChain').forEach((group) => {
        const selection = `${group.resi.join(',')}:${group.chain}`;

        appState.nglComponent.addRepresentation('cartoon', {
            sele: selection,
            color: group.color,
            opacity: 1.0
        });

        appState.nglComponent.addRepresentation('spacefill', {
            sele: selection,
            color: group.color,
            opacity: 1.0,
            scale: 0.8
        });
    });
}

// Moves camera to a residue and adds a short-lived visual highlight.
export function centerOnResidue(resi, authChain, structId) {
    if (appState.currentEngine === '3dmol' && appState.viewer3Dmol) {
        const selection = { chain: authChain, resi: resi.toString() };
        const center = getResidueBoundingCenter(resi, authChain);

        appState.viewer3Dmol.zoomTo(selection, 750);

        if (focusPulseTimer3Dmol) {
            clearTimeout(focusPulseTimer3Dmol);
            focusPulseTimer3Dmol = null;
        }

        if (focusPulseShape3Dmol) {
            appState.viewer3Dmol.removeShape(focusPulseShape3Dmol);
            focusPulseShape3Dmol = null;
        }

        if (center) {
            focusPulseShape3Dmol = appState.viewer3Dmol.addSphere({
                center,
                radius: 2.2,
                color: '#ffe066',
                opacity: 0.42,
                wireframe: false
            });

            focusPulseTimer3Dmol = setTimeout(() => {
                if (!appState.viewer3Dmol || !focusPulseShape3Dmol) return;
                appState.viewer3Dmol.removeShape(focusPulseShape3Dmol);
                focusPulseShape3Dmol = null;
                appState.viewer3Dmol.render();
            }, 950);
        }

        appState.viewer3Dmol.render();
        return;
    }

    if (appState.currentEngine === 'molstar' && appState.viewerMolstar) {
        appState.viewerMolstar.visual.focus([
            {
                struct_asym_id: structId,
                start_residue_number: resi,
                end_residue_number: resi
            }
        ]);
        return;
    }

    if (appState.currentEngine === 'jsmol' && window.myJmol) {
        Jmol.script(
            window.myJmol,
            `zoomto 1 (resno=${resi} and chain=${authChain}) 300; select (resno=${resi} and chain=${authChain}); spacefill 2.0; color spacefill [xF1C40F];`
        );
        setTimeout(() => applyJSmolStyles(), 1500);
        return;
    }

    if (appState.currentEngine === 'ngl' && appState.viewerNgl && appState.nglComponent) {
        const selection = `${resi}:${authChain}`;
        const selectionObj = new NGL.Selection(selection);
        appState.viewerNgl.animationControls.zoomTo(
            appState.nglComponent.structure.getView(selectionObj),
            1000
        );
        const highlight = appState.nglComponent.addRepresentation('spacefill', {
            sele: selection,
            color: '#ffe066',
            scale: 1.5
        });
        setTimeout(() => appState.nglComponent && appState.nglComponent.removeRepresentation(highlight), 1600);
    }
}

export function resetCameraView() {
    if (appState.currentEngine !== '3dmol') return { ok: false, reason: 'engine' };
    if (!appState.viewer3Dmol) return { ok: false, reason: 'viewer' };

    appState.viewer3Dmol.zoomTo();
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

// Exports a PNG snapshot, using each engine's best available strategy.
export function exportSnapshot() {
    if (appState.currentEngine === 'molstar' || appState.currentEngine === 'jsmol') {
        showToast(`Use the built-in ${appState.currentEngine} export tools for image output.`, true);
        return;
    }

    showToast('Rendering 4K snapshot... please wait.');

    setTimeout(() => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `28S_Benchmark_${appState.currentRibo}_${appState.currentEngine}_4K_${timestamp}.png`;

        if (appState.currentEngine === '3dmol' && appState.viewer3Dmol) {
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

            return;
        }

        if (appState.currentEngine === 'ngl' && appState.viewerNgl) {
            appState.viewerNgl
                .makeImage({
                    factor: 3,
                    antialias: true,
                    trim: false,
                    transparent: true
                })
                .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    downloadSnapshot(url, filename);
                    URL.revokeObjectURL(url);
                    showToast('High-resolution snapshot (NGL) saved.');
                })
                .catch((error) => {
                    console.error(error);
                    showToast('Error while rendering NGL snapshot.', true);
                });
        }
    }, 100);
}
