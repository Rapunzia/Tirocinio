import { appState } from '../state.js';
import { rnaConfig } from '../constants.js';
import { hexToRgb } from '../utils/color.js';
import { setLoading, finishProgress } from '../ui/loading.js';
import { showToast } from '../ui/toast.js';

let nglColorSchemeCounter = 0;

// Releases WebGL and DOM resources used by one engine instance.
export function destroyEngine(engineName) {
    try {
        if (engineName === '3dmol' && appState.viewer3Dmol) {
            appState.viewer3Dmol.removeAllModels();
            document.getElementById('gldiv-3dmol').innerHTML = '';
            appState.viewer3Dmol = null;
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

// Re-applies colors/representations for whichever engine is active.
export function updateCurrentEngineStyles() {
    if (appState.currentEngine === '3dmol') apply3DmolStyles();
    if (appState.currentEngine === 'molstar') applyMolstarStyles();
    if (appState.currentEngine === 'jsmol') applyJSmolStyles();
    if (appState.currentEngine === 'ngl') applyNglStyles();
}

// Groups residues by chain+color to reduce draw-call count in style passes.
function buildStyleGroups(chainProperty) {
    const showUnknown = document.getElementById('toggleUnknown').checked;
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

    return Object.values(groups);
}

function buildResidueKey(residue, authChain) {
    return `${residue}|${authChain}`;
}

function createResidueSelection(residue, authChain) {
    return { chain: authChain, resi: residue.toString() };
}

function getResidueBoundingCenter(residue, authChain) {
    if (!appState.viewer3Dmol) return null;

    const atoms = appState.viewer3Dmol.selectedAtoms(createResidueSelection(residue, authChain));
    if (!atoms || atoms.length === 0) return null;

    if (typeof $3Dmol === 'undefined' || typeof $3Dmol.getExtent !== 'function') {
        return { x: atoms[0].x, y: atoms[0].y, z: atoms[0].z };
    }

    const extent = $3Dmol.getExtent(atoms);
    if (!Array.isArray(extent) || !Array.isArray(extent[2]) || extent[2].length !== 3) {
        return { x: atoms[0].x, y: atoms[0].y, z: atoms[0].z };
    }

    return { x: extent[2][0], y: extent[2][1], z: extent[2][2] };
}

function buildResidueLabelStyle(colorHex, fontColor = '#111827') {
    return {
        font: 'sans-serif',
        fontSize: 11,
        fontColor,
        backgroundColor: '#ffffff',
        backgroundOpacity: 0.95,
        borderColor: colorHex,
        borderThickness: 1.2,
        inFront: true,
        showBackground: true,
        alignment: 'topLeft'
    };
}

function addManualResidueLabels() {
    appState.manualLabels.forEach((labelData) => {
        appState.viewer3Dmol.addLabel(
            labelData.text,
            buildResidueLabelStyle(labelData.colorHex || '#0891b2'),
            createResidueSelection(labelData.residue, labelData.authChain)
        );
    });
}

function addMeasurementOverlay() {
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

        const dx = secondCenter.x - firstCenter.x;
        const dy = secondCenter.y - firstCenter.y;
        const dz = secondCenter.z - firstCenter.z;
        const distance = Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
        pair.distanceAngstrom = distance;

        appState.viewer3Dmol.addLine({
            start: firstCenter,
            end: secondCenter,
            color: '#0f172a',
            dashed: true,
            dashLength: 0.7,
            gapLength: 0.3,
            linewidth: 4
        });

        appState.viewer3Dmol.addLabel(
            `${pair.a.display} ${pair.a.residue}`,
            buildResidueLabelStyle(pair.a.colorHex, pair.a.colorHex),
            createResidueSelection(pair.a.residue, pair.a.authChain)
        );

        appState.viewer3Dmol.addLabel(
            `${pair.b.display} ${pair.b.residue}`,
            buildResidueLabelStyle(pair.b.colorHex, pair.b.colorHex),
            createResidueSelection(pair.b.residue, pair.b.authChain)
        );

        appState.viewer3Dmol.addLabel(
            `${distance.toFixed(2)} A`,
            {
                font: 'sans-serif',
                fontSize: 12,
                fontColor: '#0f172a',
                backgroundColor: '#ffffff',
                backgroundOpacity: 0.95,
                borderColor: '#0f172a',
                borderThickness: 0.8,
                inFront: true,
                showBackground: true,
                position: {
                    x: (firstCenter.x + secondCenter.x) / 2,
                    y: (firstCenter.y + secondCenter.y) / 2,
                    z: (firstCenter.z + secondCenter.z) / 2
                }
            }
        );
    });
}

export function toggleManualResidueLabel(mod) {
    if (!mod || !mod._isResolved) return { changed: false, reason: 'invalid' };
    if (appState.currentEngine !== '3dmol') return { changed: false, reason: 'engine' };

    const residue = mod['Positions in the Structure'];
    const key = buildResidueKey(residue, mod._authChain);

    if (appState.manualLabels.has(key)) {
        appState.manualLabels.delete(key);
    } else {
        appState.manualLabels.set(key, {
            residue,
            authChain: mod._authChain,
            colorHex: mod._palette.hex,
            text: `${mod._displayMod} ${residue}`
        });
    }

    updateCurrentEngineStyles();
    return { changed: true, reason: 'ok' };
}

export function clearManualResidueLabels() {
    appState.manualLabels.clear();
    updateCurrentEngineStyles();
}

export function selectResidueForMeasurement(mod) {
    if (!mod || !mod._isResolved) return { changed: false, stage: 'invalid' };
    if (appState.currentEngine !== '3dmol') return { changed: false, stage: 'engine' };

    const slot = {
        residue: mod['Positions in the Structure'],
        authChain: mod._authChain,
        structId: mod._structId,
        type: mod['Type Structure'],
        display: mod._displayMod,
        colorHex: mod._palette.hex
    };

    const measure = appState.measurementDraft;
    const slotKey = buildResidueKey(slot.residue, slot.authChain);
    const firstKey = measure.first ? buildResidueKey(measure.first.residue, measure.first.authChain) : null;

    if (!measure.first) {
        measure.first = slot;
        measure.second = null;
        updateCurrentEngineStyles();
        return { changed: true, stage: 'first' };
    }

    if (slotKey === firstKey) return { changed: false, stage: 'same' };

    const pair = {
        id: ++appState.measurementPairCounter,
        a: measure.first,
        b: slot,
        distanceAngstrom: null
    };

    appState.measurementPairs.unshift(pair);
    measure.first = null;
    measure.second = null;
    updateCurrentEngineStyles();
    return { changed: true, stage: 'linked', pair };
}

export function clearMeasurementSelection() {
    appState.measurementDraft.first = null;
    appState.measurementDraft.second = null;
    updateCurrentEngineStyles();
}

export function unlinkMeasurementPair(pairId) {
    appState.measurementPairs = appState.measurementPairs.filter((pair) => pair.id !== pairId);
    updateCurrentEngineStyles();
}

export function clearAllMeasurementPairs() {
    appState.measurementPairs = [];
    appState.measurementDraft.first = null;
    appState.measurementDraft.second = null;
    updateCurrentEngineStyles();
}

function apply3DmolStyles() {
    if (!appState.viewer3Dmol) return;

    const config = rnaConfig[appState.currentRibo];
    const showProteins = document.getElementById('toggleProteins').checked;
    const showLabels = document.getElementById('toggleLabels').checked;

    appState.viewer3Dmol.setStyle({}, {});
    appState.viewer3Dmol.removeAllLabels();
    appState.viewer3Dmol.removeAllShapes();

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

    if (showLabels) {
        const showUnknown = document.getElementById('toggleUnknown').checked;

        appState.modifications.forEach((mod) => {
            if (!mod._isResolved) return;

            const isKnown = mod['Knwon Positions Modifications'] === 'Y';
            if (!isKnown && !showUnknown) return;

            const residue = mod['Positions in the Structure'];
            const labelText = `${mod._displayMod} ${residue}`;

            appState.viewer3Dmol.addLabel(
                labelText,
                {
                    ...buildResidueLabelStyle(mod._palette.hex),
                    fontSize: 14,
                    backgroundOpacity: 0.85,
                    borderThickness: 1.5
                },
                { chain: mod._authChain, resi: residue.toString() }
            );
        });
    }

    // Always draw user-managed overlays after base/global labels.
    addManualResidueLabels();
    addMeasurementOverlay();

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
        appState.viewer3Dmol.zoomTo(selection, 1000);
        appState.viewer3Dmol.setStyle(selection, {
            cartoon: { color: '#ffe066' },
            sphere: { radius: 1.8, color: '#ffe066' }
        });
        appState.viewer3Dmol.render();
        setTimeout(() => apply3DmolStyles(), 1600);
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

function downloadSnapshot(uri, filename) {
    const link = document.createElement('a');
    link.href = uri;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
            const originalWidth = container.style.width;
            const originalHeight = container.style.height;

            container.style.width = '3840px';
            container.style.height = '2160px';
            appState.viewer3Dmol.resize();
            appState.viewer3Dmol.render();

            const imageData = appState.viewer3Dmol.pngURI();

            container.style.width = originalWidth;
            container.style.height = originalHeight;
            appState.viewer3Dmol.resize();
            appState.viewer3Dmol.render();

            downloadSnapshot(imageData, filename);
            showToast('4K snapshot (3Dmol) saved.');
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
