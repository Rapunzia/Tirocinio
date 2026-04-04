/* =========================================================
   28S BENCHMARK — app.js
   Improvements over original:
   - residueExists() cache built once on CIF load (O(1) vs O(n) regex)
   - Debounced search & filter in sidebar
   - Stats panel with modification counts
   - CSV export
   - Toast notifications instead of alert()
   - Selected state tracking in sidebar
   - Legend collapse + keyboard shortcut L
   - Proper loading overlay with progress simulation
   - File name display after upload
   - Opacity value display
   ========================================================= */

'use strict';

// ── STATE ──────────────────────────────────────────────────
let currentEngine = '3dmol';
let structureDataText = null;
let modifications = [];
let currentOpacity = 0.3;
let selectedLi = null;

// Engine instances
let viewer3Dmol  = null;
let viewerMolstar = null;
let viewerNgl    = null;
let nglComponent = null;

// Performance: residue existence cache built once per CIF load
// key: `${resi}|${authChain}` → true/false
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
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null;
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
    _progTimer = setInterval(() => {
        p += Math.random() * 12;
        if (p >= 90) { clearInterval(_progTimer); p = 90; }
        bar.style.width = p + '%';
    }, 200);
}
function finishProgress() {
    clearInterval(_progTimer);
    const bar = document.getElementById('progressBar');
    bar.style.width = '100%';
    setTimeout(() => setLoading(false), 300);
}

// ── RESIDUE CACHE (KEY PERF FIX) ──────────────────────────

function buildResidueCache(cifText) {
    residueCache = new Set();
   
    const lines = cifText.split('\n');
    let inAtomSite = false;
    let headers = [];
    let colSeqId = -1, colAuthChain = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith('_atom_site.')) {
            inAtomSite = true;
            headers.push(line);
            if (line === '_atom_site.label_seq_id') colSeqId = headers.length - 1;
            if (line === '_atom_site.auth_asym_id')  colAuthChain = headers.length - 1;
            continue;
        }

        if (inAtomSite && headers.length > 0) {
            if (line.startsWith('_') || line.startsWith('#') || line === '') {
                // End of this section
                if (colSeqId >= 0 && colAuthChain >= 0) break;
                inAtomSite = false; headers = []; colSeqId = -1; colAuthChain = -1;
                continue;
            }
            if (colSeqId >= 0 && colAuthChain >= 0 && !line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
            if ((line.startsWith('ATOM') || line.startsWith('HETATM'))) {
                const parts = line.split(/\s+/);
                if (parts.length > Math.max(colSeqId, colAuthChain)) {
                    const resi  = parts[colSeqId];
                    const chain = parts[colAuthChain];
                    if (resi && chain && resi !== '.' && resi !== '?') {
                        residueCache.add(`${resi}|${chain}`);
                    }
                }
            }
        }
    }

    // Fallback: if CIF parsing found nothing, keep cache as null-bypass
    if (residueCache.size === 0) residueCache = null;
}

function residueExists(resi, authChain) {
    if (!structureDataText) return false;
    // Fast path: use cache if available
    if (residueCache) return residueCache.has(`${resi}|${authChain}`);
    // Slow fallback (original approach) — only if cache build failed
    const regex = new RegExp(`(?:^|\\s)${resi}\\s+[A-Za-z0-9]+\\s+${authChain}\\s+`);
    return regex.test(structureDataText);
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

// ── STATS PANEL ───────────────────────────────────────────
function updateStats() {
    const panel = document.getElementById('statsPanel');
    if (modifications.length === 0) { panel.classList.remove('visible'); return; }

    const config = rnaConfig[currentRibo];
    let total = 0, resolved = 0, known = 0;
    modifications.forEach(mod => {
        total++;
        const resi = mod["Positions in the Structure"];
        const typeStr = mod["Type Structure"];
        const authChain = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;
        if (residueExists(resi, authChain)) resolved++;
        if (mod["Knwon Positions Modifications"] === "Y") known++;
    });

    panel.innerHTML = `
        <div class="stats-title">Dataset Stats</div>
        <div class="stats-row"><span class="stats-label">Total</span><span class="stats-val">${total}</span></div>
        <div class="stats-row"><span class="stats-label">Resolved in 3D</span><span class="stats-val">${resolved}</span></div>
        <div class="stats-row"><span class="stats-label">Known mods</span><span class="stats-val">${known}</span></div>
        <div class="stats-row"><span class="stats-label">Unknown</span><span class="stats-val">${total - known}</span></div>
    `;
    panel.classList.add('visible');
}

// ── SIDEBAR LIST ──────────────────────────────────────────
let _filterQuery = '';
let _filterType  = 'all';
let _filterDebounce;

function getFilteredMods() {
    return modifications.filter(mod => {
        const typeStr = mod["Type Structure"] || '';
        if (_filterType !== 'all' && typeStr !== _filterType) return false;
        if (_filterQuery) {
            const resi = String(mod["Positions in the Structure"] || '');
            const modTxt = formatModText(mod["Possible Modifications"]).toLowerCase();
            const q = _filterQuery.toLowerCase();
            if (!resi.includes(q) && !modTxt.includes(q) && !typeStr.toLowerCase().includes(q)) return false;
        }
        return true;
    });
}

function buildList() {
    const listEl = document.getElementById('modList');
    const countEl = document.getElementById('residueCount');
    if (!listEl) return;
    listEl.innerHTML = '';

    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;

    if (modifications.length === 0) {
        listEl.innerHTML = '<li class="empty-msg">Load files to see residues…</li>';
        countEl.textContent = '—';
        return;
    }

    const filtered = getFilteredMods();
    countEl.textContent = filtered.length;

    if (filtered.length === 0) {
        listEl.innerHTML = '<li class="empty-msg">No residues match filter.</li>';
        return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(mod => {
        const resi       = mod["Positions in the Structure"];
        const isMod      = mod["Knwon Positions Modifications"] === "Y";
        const modRaw     = mod["Possible Modifications"];
        const typeStr    = mod["Type Structure"];
        const targetAuth  = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;
        const targetStruct = config.chains[typeStr] ? config.chains[typeStr].struct : typeStr;
        const isResolved  = residueExists(resi, targetAuth);

        if (!isResolved && !showUnknown) return; // skip

        const palette    = getModificationColor(modRaw, isMod);
        const displayMod = isMod ? formatModText(modRaw) : 'Unknown';

        const li = document.createElement('li');
        li.dataset.resi = resi;

        if (isResolved) {
            li.style.borderLeftColor = palette.hex;
            li.innerHTML = `
                <span class="li-resi">${resi}</span>
                <span class="li-chain">${typeStr}</span>
                <span class="li-mod">${displayMod}</span>
            `;
            // No title= attribute here — we use the custom JS tooltip only

            li.addEventListener('click', () => {
                // Deselect previous
                if (selectedLi) selectedLi.classList.remove('selected');
                li.classList.add('selected');
                selectedLi = li;

                centerOnResidue(resi, targetAuth, targetStruct, palette);
            });

            // Tooltip on hover
            li.addEventListener('mouseenter', (e) => showTooltip(e, resi, typeStr, displayMod, palette.hex, isResolved));
            li.addEventListener('mouseleave', hideTooltip);

        } else {
            li.classList.add('li-absent');
            li.style.borderLeftColor = '#333';
            li.innerHTML = `
                <span class="li-resi">${resi}</span>
                <span class="li-chain">${typeStr}</span>
                <span class="li-mod">${displayMod}</span>
                <span class="li-absent-label">not in 3D</span>
            `;
        }

        fragment.appendChild(li);
    });

    listEl.appendChild(fragment);
    updateStats();
}

// ── TOOLTIP ───────────────────────────────────────────────
const tooltipEl = document.getElementById('tooltip');
function showTooltip(e, resi, chain, mod, color, inStructure) {
    tooltipEl.innerHTML = `<strong>${resi}</strong>${chain} · ${inStructure ? '✓ In structure' : '✗ Not resolved'}<br><span style="color:${color}">${mod}</span>`;
    tooltipEl.classList.add('visible');
    moveTooltip(e);
}
function hideTooltip() { tooltipEl.classList.remove('visible'); }
function moveTooltip(e) {
    const x = e.clientX + 14, y = e.clientY - 8;
    tooltipEl.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    tooltipEl.style.top  = Math.min(y, window.innerHeight - 120) + 'px';
}
document.addEventListener('mousemove', e => { if (tooltipEl.classList.contains('visible')) moveTooltip(e); });

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
        Jmol.script(window.myJmol,
            `zoomto 1 (resno=${resi} and chain=${authChain}) 300;
             select (resno=${resi} and chain=${authChain}); spacefill 2.0; color spacefill [xF1C40F];`
        );
        setTimeout(() => applyJSmolStyles(), 1500);

    } else if (currentEngine === 'ngl' && viewerNgl && nglComponent) {
        const sele = `${resi}:${authChain}`;
        const seleObj = new NGL.Selection(sele);
        viewerNgl.animationControls.zoomTo(nglComponent.structure.getView(seleObj), 1000);
        const hl = nglComponent.addRepresentation('spacefill', { sele, color: '#ffe066', scale: 1.5 });
        setTimeout(() => nglComponent.removeRepresentation(hl), 1600);
    }
}

// ── ENGINE RENDERING ──────────────────────────────────────
function renderActiveEngine() {
    buildList();
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
        const Info = {
            width: '100%', height: '100%', use: 'HTML5',
            j2sPath: 'https://chemapps.stolaf.edu/jmol/jsmol/j2s',
            disableInitialConsole: true,
            readyFunction: function(applet) {
                Jmol.script(applet, `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`);
                applyJSmolStyles();
                finishProgress();
            }
        };
        document.getElementById('gldiv-jsmol').innerHTML = Jmol.getAppletHtml('myJmol', Info);
    } else {
        Jmol.script(window.myJmol, `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`);
        applyJSmolStyles();
        finishProgress();
    }
}

function renderNgl() {
    setLoading(true, 'Initialising NGL viewer…');
    if (!viewerNgl) {
        viewerNgl = new NGL.Stage('gldiv-ngl', { backgroundColor: 'white' });
        window.addEventListener('resize', () => viewerNgl.handleResize());
    }
    viewerNgl.removeAllComponents();
    viewerNgl.loadFile(new Blob([structureDataText], { type: 'text/plain' }), { ext: 'cif' }).then(comp => {
        nglComponent = comp; comp.autoView(); applyNglStyles(); finishProgress();
    });
}

// ── STYLE APPLICATION ─────────────────────────────────────
function updateCurrentEngineStyles() {
    if (currentEngine === '3dmol')   apply3DmolStyles();
    if (currentEngine === 'molstar') applyMolstarStyles();
    if (currentEngine === 'jsmol')   applyJSmolStyles();
    if (currentEngine === 'ngl')     applyNglStyles();
}

/** Build batched style groups from current modifications */
function buildStyleGroups(getChainFn) {
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const groups = {};

    modifications.forEach(mod => {
        const resi    = mod["Positions in the Structure"];
        const isMod   = mod["Knwon Positions Modifications"] === "Y";
        const typeStr = mod["Type Structure"];
        const chain   = getChainFn(config, typeStr);
        const authChain = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (!residueExists(resi, authChain)) return;
        if (!isMod && !showUnknown) return;

        const palette = getModificationColor(mod["Possible Modifications"], isMod);
        const key = `${chain}|${palette.hex}`;
        if (!groups[key]) groups[key] = { chain, color: palette.hex, rgb: palette.rgb, resi: [] };
        groups[key].resi.push(resi);
    });

    return Object.values(groups);
}

async function apply3DmolStyles() {
    if (!viewer3Dmol) return;
    const config = rnaConfig[currentRibo];

    viewer3Dmol.setStyle({}, { cartoon: { color: '#E0E0E0', opacity: currentOpacity } });
    Object.values(config.chains).forEach(ch => {
        if (ch.auth && ch.defaultColor)
            viewer3Dmol.setStyle({ chain: ch.auth }, { cartoon: { color: ch.defaultColor, opacity: currentOpacity } });
    });

    const groups = buildStyleGroups((cfg, t) => cfg.chains[t] ? cfg.chains[t].auth : t);
    groups.forEach(g => {
        viewer3Dmol.setStyle(
            { chain: g.chain, resi: g.resi },
            { cartoon: { color: g.color, opacity: 1.0 }, sphere: { radius: 1.2, color: g.color } }
        );
    });

    viewer3Dmol.render();
}

function applyMolstarStyles() {
    if (!viewerMolstar) return;
    const config = rnaConfig[currentRibo];
    const selectionData = [];

    Object.values(config.chains).forEach(ch => {
        if (ch.struct && ch.defaultColor)
            selectionData.push({ struct_asym_id: ch.struct, color: hexToRgb(ch.defaultColor), focus: false });
    });

    const groups = buildStyleGroups((cfg, t) => cfg.chains[t] ? cfg.chains[t].struct : t);
    groups.forEach(g => {
        g.resi.forEach(resi => {
            selectionData.push({
                struct_asym_id: g.chain,
                start_residue_number: resi, end_residue_number: resi,
                color: g.rgb, focus: false,
                representation: 'spacefill', representationColor: g.rgb
            });
        });
    });

    viewerMolstar.visual.clearSelection();
    if (selectionData.length > 0)
        viewerMolstar.visual.select({ data: selectionData, nonSelectedColor: { r: 224, g: 224, b: 224 } });
}

function applyJSmolStyles() {
    if (!window.myJmol) return;
    const config = rnaConfig[currentRibo];

    let script = `select all; cartoon only; spacefill off; color cartoon [xE0E0E0]; `;
    Object.values(config.chains).forEach(ch => {
        if (ch.auth && ch.defaultColor)
            script += `select chain=${ch.auth}; color cartoon ${ch.defaultColor.replace('#', '[x')}]; `;
    });
    script += `select all; color cartoon translucent ${1.0 - currentOpacity}; `;

    const groups = buildStyleGroups((cfg, t) => cfg.chains[t] ? cfg.chains[t].auth : t);
    groups.forEach(g => {
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

    let schemeData = [];
    Object.values(config.chains).forEach(ch => {
        if (ch.auth && ch.defaultColor) schemeData.push([ch.defaultColor, `:${ch.auth}`]);
    });
    schemeData.push(['#E0E0E0', '*']);

    nglComponent.addRepresentation('cartoon', {
        color: NGL.ColormakerRegistry.addSelectionScheme(schemeData, 'rnaBackbone'),
        opacity: currentOpacity, depthWrite: currentOpacity === 1.0
    });

    const groups = buildStyleGroups((cfg, t) => cfg.chains[t] ? cfg.chains[t].auth : t);
    groups.forEach(g => {
        const sele = `${g.resi.join(',')}:${g.chain}`;
        nglComponent.addRepresentation('cartoon',   { sele, color: g.color, opacity: 1.0 });
        nglComponent.addRepresentation('spacefill', { sele, color: g.color, opacity: 1.0, scale: 0.8 });
    });
}

// ── CSV EXPORT ────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', () => {
    if (modifications.length === 0) { showToast('No data to export.', true); return; }
    const config = rnaConfig[currentRibo];
    const rows = [['Residue', 'Type', 'Modification', 'Known', 'In3D']];
    modifications.forEach(mod => {
        const resi     = mod["Positions in the Structure"];
        const typeStr  = mod["Type Structure"];
        const isMod    = mod["Knwon Positions Modifications"] === "Y";
        const auth     = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;
        const inStruct = residueExists(resi, auth);
        rows.push([resi, typeStr, formatModText(mod["Possible Modifications"]), isMod ? 'Y' : 'N', inStruct ? 'Y' : 'N']);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `28S_modifications_${currentRibo}.csv`;
    a.click();
    showToast('CSV exported ✓');
});

// ── EVENT LISTENERS ───────────────────────────────────────

// Engine switch
document.getElementById('engineSelect').addEventListener('change', e => {
    currentEngine = e.target.value;
    document.getElementById('ui-opacity').style.display = currentEngine === 'molstar' ? 'none' : 'flex';
    ['3dmol', 'molstar', 'jsmol', 'ngl'].forEach(eng => {
        const el = document.getElementById(`gldiv-${eng}`);
        el.classList.toggle('active-engine', eng === currentEngine);
        el.classList.toggle('hidden-engine', eng !== currentEngine);
    });
    if (structureDataText) renderActiveEngine();
});

// Load CIF
document.getElementById('loadCifBtn').addEventListener('click', async () => {
    const config = rnaConfig[document.getElementById('riboSelect').value];
    currentRibo = document.getElementById('riboSelect').value;
    setLoading(true, `Fetching ${config.file}…`);
    try {
        const res = await fetch(config.file);
        if (!res.ok) throw new Error('File not found');
        structureDataText = await res.text();

        // Build cache asynchronously to avoid blocking UI
        await new Promise(r => setTimeout(r, 0));
        buildResidueCache(structureDataText);

        renderActiveEngine();
        showToast(`Structure ${currentRibo} loaded ✓`);
    } catch (err) {
        finishProgress();
        showToast('Load failed — is the local server running?', true);
    }
});

// JSON upload
document.getElementById('jsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('fileNameDisplay').textContent = file.name.length > 18 ? file.name.slice(0, 15) + '…' : file.name;
    const reader = new FileReader();
    reader.onload = evt => {
        try { modifications = JSON.parse(evt.target.result); }
        catch { showToast('Invalid JSON file.', true); return; }
        buildList();
        updateCurrentEngineStyles();
        showToast(`Loaded ${modifications.length} modifications ✓`);
    };
    reader.readAsText(file);
});

// Toggle unknown
document.getElementById('toggleUnknown').addEventListener('change', () => {
    if (modifications.length > 0) { buildList(); updateCurrentEngineStyles(); }
});

// Opacity with debouncing
let opacityFrame;
document.getElementById('opacitySlider').addEventListener('input', function() {
    currentOpacity = parseFloat(this.value);
    document.getElementById('opacityVal').textContent = currentOpacity.toFixed(2);
    if (opacityFrame) cancelAnimationFrame(opacityFrame);
    opacityFrame = requestAnimationFrame(async () => {
        await new Promise(r => setTimeout(r, 0));
        updateCurrentEngineStyles();
    });
});

// Search input (debounced)
document.getElementById('searchInput').addEventListener('input', function() {
    clearTimeout(_filterDebounce);
    _filterDebounce = setTimeout(() => { _filterQuery = this.value.trim(); buildList(); }, 200);
});

// Filter by type
document.getElementById('filterType').addEventListener('change', function() {
    _filterType = this.value; buildList();
});

// Legend toggle
document.getElementById('legendToggle').addEventListener('click', function() {
    const body = document.getElementById('legendBody');
    const collapsed = body.classList.toggle('collapsed');
    this.textContent = 'LEGEND ' + (collapsed ? '▼' : '▲');
});

// Keyboard shortcut: L = toggle legend
document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'l' || e.key === 'L') document.getElementById('legendToggle').click();
});