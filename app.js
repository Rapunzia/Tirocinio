'use strict';

// ── STATE ──────────────────────────────────────────────────
let currentEngine = '3dmol';
let structureDataText = null;
let modifications = [];
let currentOpacity = 0.85;
let selectedLi = null;

// Engine instances
let viewer3Dmol  = null;
let viewerMolstar = null;
let viewerNgl    = null;
let nglComponent = null;

// Performance cache
let residueCache = null;

// ── PALETTE ────────────────────────────────────────────────
const modPalette = {
    standard: { hex: '#CCCCCC', rgb: { r: 204, g: 204, b: 204 } },
    varI:     { hex: '#00E676', rgb: { r: 0,   g: 230, b: 118 } },
    varR:     { hex: '#2979FF', rgb: { r: 41,  g: 121, b: 255 } },
    varB:     { hex: '#FF1744', rgb: { r: 255, g: 23,  b: 68  } },
    varBR:    { hex: '#D500F9', rgb: { r: 213, g: 0,   b: 249 } },
    varIR:    { hex: '#00E5FF', rgb: { r: 0,   g: 229, b: 255 } },
    complex:  { hex: '#FF9100', rgb: { r: 255, g: 145, b: 0   } },
    hyper:    { hex: '#222222', rgb: { r: 34,  g: 34,  b: 34  } },
    unknown:  { hex: '#FFEA00', rgb: { r: 255, g: 234, b: 0   } }
};

// ── RNA CONFIG ─────────────────────────────────────────────
const rnaConfig = {
    "4v6x": {
        file: "4v6x.cif",
        chains: {
            "28S":  { struct: "IC", auth: "A5", defaultColor: "#555555" },
            "18S":  { struct: "JA", auth: "B2", defaultColor: "#E6E6E6" },
            "5.8S": { struct: "KC", auth: "A8", defaultColor: "#FFD700" },
            "5S":   { struct: "JC", auth: "A7", defaultColor: "#4169E1" },
            "tRNA": { struct: "KA", auth: "BC", defaultColor: "#90EE90" }
        }
    }
};
let currentRibo = "4v6x";

// ── UTILS ──────────────────────────────────────────────────
function hexToRgb(hex) {
    if (hexToRgbCache[hex]) return hexToRgbCache[hex];
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const rgb = r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null;
    if (rgb) hexToRgbCache[hex] = rgb;
    return rgb;
}

function showToast(msg, isError = false) {
    let el = document.getElementById('_toast');
    if (!el) { el = document.createElement('div'); el.id = '_toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    requestAnimationFrame(() => { el.classList.add('visible'); });
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), 3000);
}

function setLoading(on, msg = 'Loading…') {
    const ov = document.getElementById('loadingOverlay');
    document.getElementById('loadingMsg').textContent = msg;
    ov.classList.toggle('active', on);
    if (on) { document.getElementById('progressBar').style.width = '0%'; simulateProgress(); }
}
let _progTimer;
function simulateProgress() {
    clearInterval(_progTimer);
    let p = 0;
    const bar = document.getElementById('progressBar');
    _progTimer = setInterval(() => { p += Math.random() * 12; if (p >= 90) { clearInterval(_progTimer); p = 90; } bar.style.width = p + '%'; }, 200);
}
function finishProgress() {
    clearInterval(_progTimer);
    document.getElementById('progressBar').style.width = '100%';
    setTimeout(() => setLoading(false), 300);
}

// ── ZERO-ALLOCATION CIF PARSER (CPU/RAM FIX) ───────────────
function buildResidueCache(cifText) {
    residueCache = new Set();
    let pos = 0;
    let inAtomSite = false;
    let headers = [];
    let colSeqId = -1, colAuthChain = -1;

    while (pos < cifText.length) {
        let nextNewline = cifText.indexOf('\n', pos);
        if (nextNewline === -1) nextNewline = cifText.length;

        const line = cifText.slice(pos, nextNewline).trim();
        pos = nextNewline + 1;

        if (!line) continue;
        if (line.startsWith('_atom_site.')) {
            inAtomSite = true;
            headers.push(line);
            if (line === '_atom_site.label_seq_id') colSeqId = headers.length - 1;
            if (line === '_atom_site.auth_asym_id') colAuthChain = headers.length - 1;
            continue;
        }

        if (inAtomSite && headers.length > 0) {
            if (line[0] === '_' || line[0] === '#') {
                if (colSeqId >= 0 && colAuthChain >= 0) break;
                inAtomSite = false; headers = []; colSeqId = -1; colAuthChain = -1;
                continue;
            }

            if (colSeqId >= 0 && colAuthChain >= 0 && (line.startsWith('ATOM') || line.startsWith('HETATM'))) {
                const parts = line.split(/\s+/);
                if (parts.length > Math.max(colSeqId, colAuthChain)) {
                    const resi = parts[colSeqId], chain = parts[colAuthChain];
                    if (resi !== '.' && resi !== '?') residueCache.add(`${resi}|${chain}`);
                }
            }
        }
    }
    if (residueCache.size === 0) residueCache = null;
}

function residueExists(resi, authChain) {
    if (!structureDataText) return false;
    return residueCache ? residueCache.has(`${resi}|${authChain}`) : false;
}

// ── MODIFICATION LOGIC ────────────────────────────────────
function getModificationColor(modRaw, isMod) {
    if (!isMod) return modPalette.unknown;
    let mods = Array.isArray(modRaw) ? modRaw : (typeof modRaw === 'string' ? modRaw.split(/[,/]/).map(s => s.trim()) : []);
    mods = mods.filter(Boolean);

    if (mods.length === 0 || mods.includes('none')) return modPalette.standard;
    if (mods.includes('unknown') || mods.includes('?'))  return modPalette.unknown;

    let hasI = false, hasR = false, hasB = false, hasC = false;
    mods.forEach(mod => {
        const m = mod.toLowerCase();
        if (m === 'y' || m === 'psi' || m === 'ψ') { hasI = true; return; }
        if (m.includes('ac') || m.includes('acp') || m === 'd') { hasC = true; return; }
        if (m === 'ym' || m === 'psim' || m === 'ψm') { hasI = true; hasR = true; return; }
        if (m.endsWith('m') && m !== 'm') hasR = true;
        if (m.startsWith('m') && m.length > 1 && m !== 'm') hasB = true;
    });

    if (hasC || (hasI && hasB) || (hasI && hasR && hasB)) return modPalette.hyper;
    if (hasI && hasR) return modPalette.varIR;
    if (hasB && hasR) return modPalette.varBR;
    if (hasB)  return modPalette.varB;
    if (hasR)  return modPalette.varR;
    if (hasI)  return modPalette.varI;
    return modPalette.unknown;
}

const SUP = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};
function formatModText(modRaw) {
    let mods = Array.isArray(modRaw) ? modRaw : (typeof modRaw === 'string' ? modRaw.split(/[,/]/).map(s => s.trim()) : []);
    if (mods.length === 0) return 'Unknown';
    return mods.map(mod => {
        if (!mod) return '';
        if (mod.toLowerCase() === 'unknown' || mod === '?') return 'Unknown';
        if (mod === 'mC') return 'm⁵C';
        if (['y','psi','ψ'].includes(mod.toLowerCase())) return 'Ψ';
        return mod.replace(/(m|ac|acp)(\d+)/ig, (_, pre, num) => pre + num.split('').map(d => SUP[d]).join(''));
    }).filter(Boolean).join(', ');
}

// ── DATA HYDRATION (Calculated ONCE) ──────────────────────
function hydrateModifications() {
    const config = rnaConfig[currentRibo];
    modifications.forEach((mod, index) => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y";
        const typeStr = mod["Type Structure"];

        mod._index = index;
        mod._authChain = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;
        mod._structId = config.chains[typeStr] ? config.chains[typeStr].struct : typeStr;
        mod._isResolved = residueExists(resi, mod._authChain);
        mod._palette = getModificationColor(mod["Possible Modifications"], isMod);
        mod._displayMod = isMod ? formatModText(mod["Possible Modifications"]) : 'Unknown';

        // Cache search string for instant filtering
        mod._searchStr = `${resi} ${mod._displayMod} ${typeStr}`.toLowerCase();
    });
}

// ── DOM GENERATION & FAST FILTERING ───────────────────────
let _filterQuery = '';
let _filterType  = 'all';
let _filterDebounce;

function generateDOMList() {
    const listEl = document.getElementById('modList');
    listEl.innerHTML = ''; 
    const fragment = document.createDocumentFragment();

    if (modifications.length === 0) {
        listEl.innerHTML = '<li class="empty-msg">Load files to see residues…</li>';
        document.getElementById('residueCount').textContent = '—';
        return;
    }

    modifications.forEach(mod => {
        const li = document.createElement('li');
        li.dataset.idx = mod._index;

        if (mod._isResolved) {
            li.style.borderLeftColor = mod._palette.hex;
            li.innerHTML = `
                <span class="li-resi">${mod["Positions in the Structure"]}</span>
                <span class="li-chain">${mod["Type Structure"]}</span>
                <span class="li-mod" title="${mod._displayMod}">${mod._displayMod}</span>
            `;
        } else {
            li.classList.add('li-absent');
            li.innerHTML = `
                <span class="li-resi">${mod["Positions in the Structure"]}</span>
                <span class="li-chain">${mod["Type Structure"]}</span>
                <span class="li-absent-label">Not in 3D</span>
            `;
        }
        mod._domNode = li;
        fragment.appendChild(li);
    });

    listEl.appendChild(fragment);
    applyFilters();
}

function applyFilters() {
    const showUnknown = document.getElementById('toggleUnknown').checked;
    let visibleCount = 0;

    modifications.forEach(mod => {
        let isVisible = true;
        if (!mod._isResolved && !showUnknown) isVisible = false;
        if (isVisible && _filterType !== 'all' && mod["Type Structure"] !== _filterType) isVisible = false;
        if (isVisible && _filterQuery && !mod._searchStr.includes(_filterQuery)) isVisible = false;

        if (isVisible) {
            mod._domNode.classList.remove('li-hidden');
            visibleCount++;
        } else {
            mod._domNode.classList.add('li-hidden');
        }
    });

    document.getElementById('residueCount').textContent = visibleCount;

    let emptyEl = document.getElementById('emptyMsg');
    if (visibleCount === 0) {
        if (!emptyEl) {
            emptyEl = document.createElement('li');
            emptyEl.id = 'emptyMsg'; emptyEl.className = 'empty-msg';
            emptyEl.textContent = 'No residues match filter.';
            document.getElementById('modList').appendChild(emptyEl);
        } else { emptyEl.style.display = 'block'; }
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
    }
}

// ── EVENT DELEGATION FOR CLICKS (Zero Memory Leak) ────────
document.getElementById('modList').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li || li.classList.contains('empty-msg') || li.classList.contains('li-absent')) return;

    if (selectedLi) selectedLi.classList.remove('selected');
    li.classList.add('selected');
    selectedLi = li;

    const mod = modifications[li.dataset.idx];
    centerOnResidue(mod["Positions in the Structure"], mod._authChain, mod._structId, mod._palette);
});

// ── CENTER ON RESIDUE ─────────────────────────────────────
function centerOnResidue(resi, authChain, structId, palette) {
    if (currentEngine === '3dmol' && viewer3Dmol) {
        const sel = { chain: authChain, resi: resi.toString() };
        viewer3Dmol.zoomTo(sel, 1000);
        viewer3Dmol.setStyle(sel, { cartoon: { color: '#ffe066' }, sphere: { radius: 1.8, color: '#ffe066' } });
        viewer3Dmol.render();
        setTimeout(() => apply3DmolStyles(), 1600);
    } else if (currentEngine === 'molstar' && viewerMolstar) {
        viewerMolstar.visual.focus([{ struct_asym_id: structId, start_residue_number: resi, end_residue_number: resi }]);
    } else if (currentEngine === 'jsmol' && window.myJmol) {
        Jmol.script(window.myJmol, `zoomto 1 (resno=${resi} and chain=${authChain}) 300; select (resno=${resi} and chain=${authChain}); spacefill 2.0; color spacefill [xF1C40F];`);
        setTimeout(() => applyJSmolStyles(), 1500);
    } else if (currentEngine === 'ngl' && viewerNgl && nglComponent) {
        const sele = `${resi}:${authChain}`;
        const seleObj = new NGL.Selection(sele);
        viewerNgl.animationControls.zoomTo(nglComponent.structure.getView(seleObj), 1000);
        const hl = nglComponent.addRepresentation('spacefill', { sele, color: '#ffe066', scale: 1.5 });
        setTimeout(() => nglComponent.removeRepresentation(hl), 1600);
    }
}

// ── ENGINE RENDERING & GPU CLEANUP ────────────────────────
function destroyEngine(eng) {
    try {
        if (eng === '3dmol' && viewer3Dmol) {
            viewer3Dmol.removeAllModels();
            document.getElementById('gldiv-3dmol').innerHTML = '';
            viewer3Dmol = null;
        } else if (eng === 'molstar' && viewerMolstar) {
            document.getElementById('gldiv-molstar').innerHTML = '';
            viewerMolstar = null;
        } else if (eng === 'jsmol' && window.myJmol) {
            document.getElementById('gldiv-jsmol').innerHTML = '';
            window.myJmol = null;
        } else if (eng === 'ngl' && viewerNgl) {
            viewerNgl.dispose();
            document.getElementById('gldiv-ngl').innerHTML = '';
            viewerNgl = null;
        }
    } catch(e) { console.warn(`Error during cleanup for engine ${eng}:`, e); }
}

function renderActiveEngine() {
    switch (currentEngine) {
        case '3dmol':  render3Dmol();  break;
        case 'molstar': renderMolstar(); break;
        case 'jsmol':  renderJSmol();  break;
        case 'ngl':    renderNgl();    break;
    }
}

function render3Dmol() {
    setLoading(true, 'Initialising 3Dmol viewer…');
    if (!viewer3Dmol) viewer3Dmol = $3Dmol.createViewer('gldiv-3dmol', { backgroundColor: '#ffffff' });
    viewer3Dmol.clear();
    viewer3Dmol.addModel(structureDataText, 'cif');
    viewer3Dmol.zoomTo();
    apply3DmolStyles();
    finishProgress();
}

function renderMolstar() {
    setLoading(true, 'Initialising Mol* viewer…');
    const blob = new Blob([structureDataText], { type: 'text/plain' });
    const blobUrl = URL.createObjectURL(blob);
    if (!viewerMolstar) {
        viewerMolstar = new PDBeMolstarPlugin();
        viewerMolstar.render(document.getElementById('gldiv-molstar'), {
            customData: { url: blobUrl, format: 'cif', binary: false },
            bgColor: { r: 255, g: 255, b: 255 }, lighting: 'flat',
            hideControls: true, hideIconWall: true, hideExpandIcon: true, hideSystemMenu: true,
            layoutShowControls: false, layoutShowSequence: false, layoutShowLog: false
        });
        viewerMolstar.events.loadComplete.subscribe(() => { applyMolstarStyles(); finishProgress(); });
    } else {
        viewerMolstar.visual.update({ customData: { url: blobUrl, format: 'cif', binary: false } });
        setTimeout(() => { applyMolstarStyles(); finishProgress(); }, 500);
    }
}

function renderJSmol() {
    setLoading(true, 'Initialising JSmol viewer…');
    if (!window.myJmol) {
        const Info = { width: '100%', height: '100%', use: 'HTML5', j2sPath: 'https://chemapps.stolaf.edu/jmol/jsmol/j2s', disableInitialConsole: true, readyFunction: function(applet) { Jmol.script(applet, `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`); applyJSmolStyles(); finishProgress(); } };
        document.getElementById('gldiv-jsmol').innerHTML = Jmol.getAppletHtml('myJmol', Info);
    } else {
        Jmol.script(window.myJmol, `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`);
        applyJSmolStyles();
        finishProgress();
    }
}

function renderNgl() {
    setLoading(true, 'Initialising NGL viewer…');
    if (!viewerNgl) { viewerNgl = new NGL.Stage('gldiv-ngl', { backgroundColor: 'white' }); window.addEventListener('resize', () => viewerNgl.handleResize()); }
    viewerNgl.removeAllComponents();
    viewerNgl.loadFile(new Blob([structureDataText], { type: 'text/plain' }), { ext: 'cif' }).then(comp => { nglComponent = comp; comp.autoView(); applyNglStyles(); finishProgress(); });
}

// ── STYLE APPLICATION ─────────────────────────────────────
function updateCurrentEngineStyles() {
    if (currentEngine === '3dmol')   apply3DmolStyles();
    if (currentEngine === 'molstar') applyMolstarStyles();
    if (currentEngine === 'jsmol')   applyJSmolStyles();
    if (currentEngine === 'ngl')     applyNglStyles();
}

function buildStyleGroups(chainProp) {
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const groups = {};
    modifications.forEach(mod => {
        if (!mod._isResolved) return;
        const isMod = mod["Knwon Positions Modifications"] === "Y";
        if (!isMod && !showUnknown) return;

        const chain = mod[chainProp];
        const hex = mod._palette.hex;
        const key = `${chain}|${hex}`;

        if (!groups[key]) groups[key] = { chain, color: hex, rgb: mod._palette.rgb, resi: [] };
        groups[key].resi.push(mod["Positions in the Structure"]);
    });
    return Object.values(groups);
}

async function apply3DmolStyles() {
    if (!viewer3Dmol) return;
    const config = rnaConfig[currentRibo];
    const showProteins = document.getElementById('toggleProteins').checked;
    const showLabels = document.getElementById('toggleLabels').checked; // Leggiamo il toggle

    // Reset totale di tutti gli stili e delle etichette
    viewer3Dmol.setStyle({}, {}); 
    viewer3Dmol.removeAllLabels(); // Pulizia essenziale per non sovrapporre testo a ogni ricaricamento

    // 1. STILI BACKBONE
    if (showProteins) {
        viewer3Dmol.setStyle({}, { cartoon: { color: '#E0E0E0', opacity: currentOpacity } });
    }
    Object.values(config.chains).forEach(ch => { 
        if (ch.auth && ch.defaultColor) {
            viewer3Dmol.setStyle({ chain: ch.auth }, { cartoon: { color: ch.defaultColor, opacity: currentOpacity } }); 
        }
    });

    // 2. SFERE DELLE MODIFICHE
    buildStyleGroups('_authChain').forEach(g => { 
        viewer3Dmol.setStyle({ chain: g.chain, resi: g.resi }, { cartoon: { color: g.color, opacity: 1.0 }, sphere: { radius: 1.2, color: g.color } }); 
    });
    
    // 3. OVERLAY TESTUALE (PAPER-READY)
    if (showLabels) {
        const showUnknown = document.getElementById('toggleUnknown').checked;
        
        modifications.forEach(mod => {
            if (!mod._isResolved) return; // Saltiamo se non esiste nel 3D
            const isMod = mod["Knwon Positions Modifications"] === "Y";
            if (!isMod && !showUnknown) return; // Rispettiamo il filtro unknown

            const resi = mod["Positions in the Structure"];
            const text = `${mod._displayMod} ${resi}`; // Esempio: "119 m⁵C"

            // Aggiungiamo la label al centro esatto del residuo
            viewer3Dmol.addLabel(text, {
                font: 'sans-serif',
                fontSize: 14,
                fontColor: '#111827',         
                backgroundColor: '#ffffff',   // Sfondo bianco per massima leggibilità
                backgroundOpacity: 0.85,      // Leggermente traslucido per non coprire del tutto la struttura
                borderColor: mod._palette.hex, // Il bordo della label riprende il colore della sfera
                borderThickness: 1.5,
                inFront: true,                // Forza la label a stare "sopra" il 3D per non essere tagliata dalla mesh
                showBackground: true,
                alignment: 'topLeft'
            }, { chain: mod._authChain, resi: resi.toString() });
        });
    }

    viewer3Dmol.render();
}

function applyMolstarStyles() {
    if (!viewerMolstar) return;
    const config = rnaConfig[currentRibo];
    // Nota: Mol* plugin di default mostra l'intero polimero. Per nascondere le proteine
    // servirebbe manipolare l'albero di stato. Manteniamo la selezione di base.
    const selectionData = [];
    Object.values(config.chains).forEach(ch => { if (ch.struct && ch.defaultColor) selectionData.push({ struct_asym_id: ch.struct, color: hexToRgb(ch.defaultColor), focus: false }); });
    buildStyleGroups('_structId').forEach(g => { g.resi.forEach(resi => { selectionData.push({ struct_asym_id: g.chain, start_residue_number: resi, end_residue_number: resi, color: g.rgb, focus: false, representation: 'spacefill', representationColor: g.rgb }); }); });
    viewerMolstar.visual.clearSelection();
    if (selectionData.length > 0) viewerMolstar.visual.select({ data: selectionData, nonSelectedColor: { r: 224, g: 224, b: 224 } });
}

function applyJSmolStyles() {
    if (!window.myJmol) return;
    const config = rnaConfig[currentRibo];
    const showProteins = document.getElementById('toggleProteins').checked;

    // Spegne tutto di default
    let script = `select all; spacefill off; wireframe off; cartoon off; `;
    
    if (showProteins) {
        script += `select all; cartoon only; color cartoon [xE0E0E0]; color cartoon translucent ${1.0 - currentOpacity}; `;
    }
    
    // Accende e colora solo l'RNA
    Object.values(config.chains).forEach(ch => { 
        if (ch.auth && ch.defaultColor) {
            script += `select chain=${ch.auth}; cartoon only; color cartoon ${ch.defaultColor.replace('#', '[x')}]; color cartoon translucent ${1.0 - currentOpacity}; `; 
        }
    });
    
    buildStyleGroups('_authChain').forEach(g => { 
        const c = g.color.replace('#', '[x') + ']'; 
        script += `select (resno=${g.resi.join(",")} and chain=${g.chain}); color cartoon opaque; color cartoon ${c}; spacefill 1.5; color spacefill ${c}; `; 
    });
    
    script += 'select none;';
    Jmol.script(myJmol, script);
}

function applyNglStyles() {
    if (!viewerNgl || !nglComponent) return;
    nglComponent.removeAllRepresentations();
    const config = rnaConfig[currentRibo];
    const showProteins = document.getElementById('toggleProteins').checked;

    let schemeData = [];
    let rnaSele = []; // Array per isolare solo le catene RNA
    
    Object.values(config.chains).forEach(ch => { 
        if (ch.auth && ch.defaultColor) {
            schemeData.push([ch.defaultColor, `:${ch.auth}`]); 
            rnaSele.push(`:${ch.auth}`);
        }
    });
    
    if (showProteins) {
        schemeData.push(['#E0E0E0', '*']);
        nglComponent.addRepresentation('cartoon', { color: NGL.ColormakerRegistry.addSelectionScheme(schemeData, 'rnaBackbone'), opacity: currentOpacity, depthWrite: currentOpacity === 1.0 });
    } else {
        // Genera una selezione stringa tipo ":A5 or :B2 or :A8" e renderizza SOLO quella
        const sele = rnaSele.join(' or ');
        nglComponent.addRepresentation('cartoon', { sele: sele, color: NGL.ColormakerRegistry.addSelectionScheme(schemeData, 'rnaBackbone'), opacity: currentOpacity, depthWrite: currentOpacity === 1.0 });
    }
    
    buildStyleGroups('_authChain').forEach(g => { 
        const sele = `${g.resi.join(',')}:${g.chain}`; 
        nglComponent.addRepresentation('cartoon', { sele, color: g.color, opacity: 1.0 }); 
        nglComponent.addRepresentation('spacefill', { sele, color: g.color, opacity: 1.0, scale: 0.8 }); 
    });
}
// ── UTILITY: DOWNLOAD FILE ────────────────────────────────
function downloadSnapshot(uri, filename) {
    const link = document.createElement('a');
    link.href = uri;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ── SNAPSHOT EXPORT ────────────────────────────────────
document.getElementById('snapshotBtn').addEventListener('click', () => {
    if (currentEngine === 'molstar' || currentEngine === 'jsmol') {
        showToast(`Usa i comandi integrati di ${currentEngine} per l'export.`, true);
        return;
    }

    showToast('Rendering 4K in corso... attendere.');

    setTimeout(() => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `28S_Benchmark_${currentRibo}_${currentEngine}_4K_${timestamp}.png`;

        if (currentEngine === '3dmol' && viewer3Dmol) {
            const container = document.getElementById('gldiv-3dmol');
            
            // 1. Salva lo stato originale
            const origW = container.style.width;
            const origH = container.style.height;
            
            // 2. Forza dimensioni 4K UHD (invisibile all'utente grazie a overflow:hidden del parent)
            container.style.width = '3840px';
            container.style.height = '2160px';
            viewer3Dmol.resize();
            viewer3Dmol.render();
            
            // 3. Estrai l'immagine
            const imgData = viewer3Dmol.pngURI();
            
            // 4. Ripristina istantaneamente l'interfaccia
            container.style.width = origW;
            container.style.height = origH;
            viewer3Dmol.resize();
            viewer3Dmol.render();
            
            // 5. Scarica
            downloadSnapshot(imgData, filename);
            showToast('Snapshot 4K (3Dmol) salvato ✓');

        } else if (currentEngine === 'ngl' && viewerNgl) {
            // NGL ha il supporto nativo per l'upscaling (factor: 4 = 4x la risoluzione attuale)
            // Se lo schermo è FHD (1080p), factor 2 fa il 4K. Usiamo 3 o 4 per sicurezza.
            viewerNgl.makeImage({ 
                factor: 3, 
                antialias: true, 
                trim: false, 
                transparent: true // Utile per sovrapposizioni su poster
            }).then(blob => {
                const url = URL.createObjectURL(blob);
                downloadSnapshot(url, filename);
                URL.revokeObjectURL(url);
                showToast('Snapshot HD (NGL) salvato ✓');
            }).catch(err => {
                console.error(err);
                showToast('Errore durante il rendering NGL.', true);
            });
        }
    }, 100);
});

// ── EVENT LISTENERS ───────────────────────────────────────
document.getElementById('engineSelect').addEventListener('change', e => {
    const newEngine = e.target.value;
    if (currentEngine !== newEngine) destroyEngine(currentEngine); // GPU MEMORY CLEANUP
    
    currentEngine = newEngine;
    document.getElementById('ui-opacity').style.display = currentEngine === 'molstar' ? 'none' : 'flex';
    
    ['3dmol', 'molstar', 'jsmol', 'ngl'].forEach(eng => { 
        const el = document.getElementById(`gldiv-${eng}`); 
        el.classList.toggle('active-engine', eng === currentEngine); 
        el.classList.toggle('hidden-engine', eng !== currentEngine); 
    });
    
    if (structureDataText) renderActiveEngine();
});

document.getElementById('loadCifBtn').addEventListener('click', async () => {
    const config = rnaConfig[document.getElementById('riboSelect').value];
    currentRibo = document.getElementById('riboSelect').value;
    setLoading(true, `Fetching ${config.file}…`);
    try {
        const res = await fetch(config.file);
        if (!res.ok) throw new Error('File not found');
        structureDataText = await res.text();
        await new Promise(r => setTimeout(r, 0));
        buildResidueCache(structureDataText);
        
        // Se c'è già un json caricato, re-idrata perché sono cambiati i _isResolved
        if (modifications.length > 0) { hydrateModifications(); generateDOMList(); }
        
        renderActiveEngine();
        showToast(`Structure ${currentRibo} loaded ✓`);
    } catch (err) { finishProgress(); showToast('Load failed — is the local server running?', true); }
});

document.getElementById('jsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('fileNameDisplay').textContent = file.name.length > 18 ? file.name.slice(0, 15) + '…' : file.name;
    const reader = new FileReader();
    reader.onload = evt => {
        try { modifications = JSON.parse(evt.target.result); } catch { showToast('Invalid JSON file.', true); return; }
        
        hydrateModifications(); // DATA PREP (ONCE)
        generateDOMList();      // DOM RENDER (ONCE)
        updateCurrentEngineStyles(); 
        
        showToast(`Loaded ${modifications.length} modifications ✓`);
    };
    reader.readAsText(file);
});

// Opacity Slider (Debounced for smooth rendering)
let opacityFrame;
document.getElementById('opacitySlider').addEventListener('input', function() {
    currentOpacity = parseFloat(this.value);
    document.getElementById('opacityVal').textContent = currentOpacity.toFixed(2);
    if (opacityFrame) cancelAnimationFrame(opacityFrame);
    opacityFrame = requestAnimationFrame(async () => { await new Promise(r => setTimeout(r, 0)); updateCurrentEngineStyles(); });
});

// UI Inputs (Trigger applyFilters, NOT list regeneration)
document.getElementById('searchInput').addEventListener('input', function() { 
    clearTimeout(_filterDebounce); 
    _filterDebounce = setTimeout(() => { _filterQuery = this.value.trim().toLowerCase(); applyFilters(); }, 150); 
});
document.getElementById('filterType').addEventListener('change', function() { _filterType = this.value; applyFilters(); });
document.getElementById('toggleUnknown').addEventListener('change', () => { 
    if (modifications.length > 0) { applyFilters(); updateCurrentEngineStyles(); } 
});

// Legend Toggle
document.getElementById('legendToggle').addEventListener('click', function() { 
    const body = document.getElementById('legendBody'); 
    const collapsed = body.classList.toggle('collapsed'); 
    this.textContent = 'LEGEND ' + (collapsed ? '▼' : '▲'); 
});
document.addEventListener('keydown', e => { 
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; 
    if (e.key === 'l' || e.key === 'L') document.getElementById('legendToggle').click(); 
});
// Toggle Proteins Listener
document.getElementById('toggleProteins').addEventListener('change', () => { 
    updateCurrentEngineStyles(); 
});
document.getElementById('toggleLabels').addEventListener('change', () => { 
    if (currentEngine !== '3dmol') {
        showToast('Labels attualmente supportate solo su 3Dmol.', true);
        // Riporta il toggle a spento visivamente se si tenta di usarlo altrove
        document.getElementById('toggleLabels').checked = false;
        return;
    }
    updateCurrentEngineStyles(); 
});