let currentEngine = '3dmol';
let structureDataText = null; 
let modifications = [];
let currentOpacity = 0.3;

// Istanze dei Motori
let viewer3Dmol = null;
let viewerMolstar = null;
let viewerNgl = null;
let nglComponent = null;

// ==========================================
// 1. PALETTE VIBRANTE E CONFIGURAZIONE
// ==========================================
const modPalette = {
    standard: { hex: '#CCCCCC', rgb: { r: 204, g: 204, b: 204 } }, 
    varI:     { hex: '#00E676', rgb: { r: 0,   g: 230, b: 118 } }, 
    varR:     { hex: '#2979FF', rgb: { r: 41,  g: 121, b: 255 } }, 
    varB:     { hex: '#FF1744', rgb: { r: 255, g: 23,  b: 68  } }, 
    varBR:    { hex: '#D500F9', rgb: { r: 213, g: 0,   b: 249 } }, 
    varIR:    { hex: '#00E5FF', rgb: { r: 0,   g: 229, b: 255 } }, 
    complex:  { hex: '#FF9100', rgb: { r: 255, g: 145, b: 0   } }, 
    hyper:    { hex: '#000000', rgb: { r: 0,   g: 0,   b: 0   } }, 
    unknown:  { hex: '#FFEA00', rgb: { r: 255, g: 234, b: 0   } }  
};

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

function getModificationColor(modRaw, isMod) {
    if (!isMod) return modPalette.unknown; 

    let modArray = Array.isArray(modRaw) ? modRaw : (typeof modRaw === 'string' ? modRaw.split(/[,/]/).map(s => s.trim()) : []);
    modArray = modArray.filter(Boolean); 
    
    if (modArray.length === 0 || modArray.includes('none')) return modPalette.standard;
    if (modArray.includes('unknown') || modArray.includes('?')) return modPalette.unknown;

    let hasI = false, hasR = false, hasB = false, hasC = false;

    modArray.forEach(mod => {
        const m = mod.toLowerCase();
        if (m === 'y' || m === 'psi' || m === 'ψ') hasI = true;
        else if (m.includes('ac') || m.includes('acp') || m === 'd') hasC = true;
        else {
            if (m.endsWith('m') && m !== 'm') hasR = true;
            if (m.startsWith('m') && m.length > 1 && m !== 'm') hasB = true;
            if (m === 'ym' || m === 'psim' || m === 'ψm') { hasI = true; hasR = true; }
        }
    });

    if (hasC || (hasI && hasB) || (hasI && hasR && hasB)) return modPalette.hyper;
    if (hasI && hasR) return modPalette.varIR;
    if (hasB && hasR) return modPalette.varBR;
    if (hasB) return modPalette.varB;
    if (hasR) return modPalette.varR;
    if (hasI) return modPalette.varI;

    return modPalette.unknown; 
}

function formatModText(modRaw) {
    let modArray = Array.isArray(modRaw) ? modRaw : (typeof modRaw === 'string' ? modRaw.split(/[,/]/).map(s => s.trim()) : []);
    if (modArray.length === 0) return 'Unknown';

    const superscripts = {'0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹'};

    return modArray.map(mod => {
        let m = mod;
        if (m.toLowerCase() === 'unknown' || m === '?') return 'Unknown';
        if (m === 'mC') return 'm⁵C'; 
        if (m.toLowerCase() === 'y' || m.toLowerCase() === 'psi' || m === 'ψ') return 'Ψ';
        return m.replace(/(m|ac|acp)(\d+)/ig, (match, prefisso, numero) => {
            let sub = numero.split('').map(d => superscripts[d]).join('');
            return prefisso + sub;
        });
    }).join(', ');
}

// ==========================================
// 2. LOGICA UI, EVENT LISTENER E CARICAMENTO
// ==========================================

document.getElementById('engineSelect').addEventListener('change', (e) => {
    currentEngine = e.target.value;
    document.getElementById('ui-opacity').style.display = (currentEngine !== 'molstar') ? 'flex' : 'none';

    ['3dmol', 'molstar', 'jsmol' , 'ngl'].forEach(eng => {
        const el = document.getElementById(`gldiv-${eng}`);
        if (eng === currentEngine) {
            el.classList.replace('hidden-engine', 'active-engine');
        } else {
            el.classList.replace('active-engine', 'hidden-engine');
        }
    });

    if (structureDataText && structureDataText.trim() !== "") renderActiveEngine();
});

document.getElementById('loadCifBtn').addEventListener('click', async function() {
    const config = rnaConfig[document.getElementById('riboSelect').value];
    try {
        const response = await fetch(config.file);
        if (!response.ok) throw new Error("File not found");
        structureDataText = await response.text(); 
        renderActiveEngine();
    } catch (error) {
        alert("Loading error. Is the local server running?");
    }
});

document.getElementById('jsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try { modifications = JSON.parse(evt.target.result); } 
        catch (error) { alert("JSON error."); return; }
        
        buildList();
        if (currentEngine === '3dmol' && viewer3Dmol) apply3DmolStyles();
        if (currentEngine === 'molstar' && viewerMolstar) applyMolstarStyles();
        if (currentEngine === 'jsmol' && window.myJmol) applyJSmolStyles();
        if (currentEngine === 'ngl' && viewerNgl) applyNglStyles();
    };
    reader.readAsText(file);
});

document.getElementById('toggleUnknown').addEventListener('change', () => {
    if (modifications.length > 0) {
        if (currentEngine === '3dmol' && viewer3Dmol) apply3DmolStyles();
        if (currentEngine === 'molstar' && viewerMolstar) applyMolstarStyles();
        if (currentEngine === 'jsmol' && window.myJmol) applyJSmolStyles();
        if (currentEngine === 'ngl' && viewerNgl) applyNglStyles();
    }
});

document.getElementById('opacitySlider').addEventListener('input', function(e) {
    currentOpacity = parseFloat(e.target.value);
    if (currentEngine === '3dmol' && viewer3Dmol) apply3DmolStyles(); 
    if (currentEngine === 'jsmol' && window.myJmol) applyJSmolStyles();
    if (currentEngine === 'ngl' && viewerNgl) applyNglStyles();
});

function residueExists(resi, authChain) {
    if (!structureDataText) return false;
    const regex = new RegExp(`(?:^|\\s)${resi}\\s+[A-Za-z0-9]+\\s+${authChain}\\s+`);
    return regex.test(structureDataText);
}

function renderActiveEngine() {
    buildList();

    switch (currentEngine) {
        case '3dmol':
            if (!viewer3Dmol) viewer3Dmol = $3Dmol.createViewer("gldiv-3dmol", { backgroundColor: "#ffffff" });
            viewer3Dmol.clear();
            viewer3Dmol.addModel(structureDataText, "cif");
            viewer3Dmol.zoomTo();
            apply3DmolStyles(); 
            break;

        case 'molstar':
            const blob = new Blob([structureDataText], { type: 'text/plain' });
            const blobUrl = URL.createObjectURL(blob);
            if (!viewerMolstar) {
                viewerMolstar = new PDBeMolstarPlugin();
                const options = {
                    customData: { url: blobUrl, format: 'cif', binary: false },
                    bgColor: { r: 255, g: 255, b: 255 }, lighting: 'flat',
                    hideControls: true, hideIconWall: true, hideExpandIcon: true, hideSystemMenu: true,
                    layoutShowControls: false, layoutShowSequence: false, layoutShowLog: false
                };
                viewerMolstar.render(document.getElementById('gldiv-molstar'), options);
                viewerMolstar.events.loadComplete.subscribe(() => applyMolstarStyles());
            } else {
                viewerMolstar.visual.update({ customData: { url: blobUrl, format: 'cif', binary: false } });
                setTimeout(() => applyMolstarStyles(), 500); 
            }
            break;

        case 'jsmol':
            if (!window.myJmol) {
                const Info = { width: "100%", height: "100%", use: "HTML5", j2sPath: "https://chemapps.stolaf.edu/jmol/jsmol/j2s", disableInitialConsole: true,
                    readyFunction: function(applet) {
                        Jmol.script(applet, `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`);
                        applyJSmolStyles();
                    }
                };
                document.getElementById("gldiv-jsmol").innerHTML = Jmol.getAppletHtml("myJmol", Info);
            } else {
                Jmol.script(window.myJmol, `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`);
                applyJSmolStyles();
            }
            break;

        case 'ngl':
            if (!viewerNgl) { viewerNgl = new NGL.Stage("gldiv-ngl", { backgroundColor: "white" }); window.addEventListener("resize", () => viewerNgl.handleResize()); }
            viewerNgl.removeAllComponents();
            viewerNgl.loadFile(new Blob([structureDataText], { type: 'text/plain' }), { ext: "cif" }).then(comp => {
                nglComponent = comp; comp.autoView(); applyNglStyles();
            });
            break;
    }
}

function buildList() {
    const listEl = document.getElementById('modList');
    if(!listEl) return;
    listEl.innerHTML = ''; 
    const config = rnaConfig[currentRibo];

    if(modifications.length === 0) {
        listEl.innerHTML = '<li class="empty-msg">Load files to see the list...</li>';
        return;
    }

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const modRaw = mod["Possible Modifications"];
        const typeStr = mod["Type Structure"];
        
        const targetStruct = config.chains[typeStr] ? config.chains[typeStr].struct : typeStr;
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        const isResolved = residueExists(resi, targetAuth);
        
        const paletteObj = getModificationColor(modRaw, isMod);
        const hexColor = paletteObj.hex;
        const displayMod = isMod ? formatModText(modRaw) : 'Unknown';

        const li = document.createElement('li');

        if (isResolved) {
            li.innerHTML = `<strong>${resi}</strong><br><span style="font-size:9px;color:#7f8c8d;">${typeStr}</span><br><strong>${displayMod}</strong>`;
            li.style.borderLeft = `5px solid ${hexColor}`;
            li.title = `Click to center on residue ${resi}`;
            
            li.addEventListener('click', () => {
                if (currentEngine === '3dmol' && viewer3Dmol) {
                    const sel = { chain: targetAuth, resi: resi.toString() };
                    viewer3Dmol.zoomTo(sel, 1000);
                    viewer3Dmol.setStyle(sel, { cartoon: { color: '#F1C40F' }, sphere: { radius: 1.8, color: '#F1C40F' } });
                    viewer3Dmol.render();
                    setTimeout(() => apply3DmolStyles(), 1500); 
                } else if (currentEngine === 'molstar' && viewerMolstar) {
                    viewerMolstar.visual.focus([{ struct_asym_id: targetStruct, start_residue_number: resi, end_residue_number: resi }]);
                } else if (currentEngine === 'jsmol' && window.myJmol) {
                    Jmol.script(window.myJmol, `zoomto 1 (resno=${resi} and chain=${targetAuth}) 300; select (resno=${resi} and chain=${targetAuth}); spacefill 2.0; color spacefill [xF1C40F];`);
                    setTimeout(() => applyJSmolStyles(), 1500);
                } else if (currentEngine === 'ngl' && viewerNgl && nglComponent) {
                    let sele = `${resi}:${targetAuth}`;
                    let seleObj = new NGL.Selection(sele);
                    viewerNgl.animationControls.zoomTo(nglComponent.structure.getView(seleObj), 1000);
                    let highlightRepr = nglComponent.addRepresentation("spacefill", { sele: sele, color: "#F1C40F", scale: 1.5 });
                    setTimeout(() => { nglComponent.removeRepresentation(highlightRepr); }, 1500);
                }
            });
        } else {
            li.innerHTML = `<strong>${resi}</strong><br><span style="font-size:9px;color:#7f8c8d;">${typeStr}</span><br>${displayMod} <br><span style="color:#c0392b; font-size:8px;">(Not in 3D)</span>`;
            li.style.borderLeft = '5px solid #bdc3c7'; li.style.opacity = '0.5'; li.style.cursor = 'not-allowed';
        }
        listEl.appendChild(li);
    });
}

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

// ==========================================
// 3. APPLICAZIONE STILI AI MOTORI (PULITO)
// ==========================================

function apply3DmolStyles() {
    if (!viewer3Dmol) return;
    
    const config = rnaConfig[currentRibo];
    
    viewer3Dmol.setStyle({}, { cartoon: { color: '#E0E0E0', opacity: currentOpacity } });
    Object.values(config.chains).forEach(ch => {
        if (ch.auth && ch.defaultColor) {
            viewer3Dmol.setStyle({chain: ch.auth}, { cartoon: { color: ch.defaultColor, opacity: currentOpacity } });
        }
    });
    
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const styleGroups = {};

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
            const modRaw = mod["Possible Modifications"];
            const paletteObj = getModificationColor(modRaw, isMod);
            const color = paletteObj.hex;
            
            const groupKey = `${targetAuth}|${color}`;
            if (!styleGroups[groupKey]) {
                styleGroups[groupKey] = { chain: targetAuth, color: color, resi: [] };
            }
            styleGroups[groupKey].resi.push(resi);
        }
    });

    Object.values(styleGroups).forEach(group => {
        const sel = { chain: group.chain, resi: group.resi }; 
        
        viewer3Dmol.setStyle(sel, { 
            cartoon: { color: group.color, opacity: 1.0 }, 
            sphere: { radius: 1.2, color: group.color }
        });
    });

    viewer3Dmol.render();
}

function applyMolstarStyles() {
    if (!viewerMolstar) return;
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const selectionData = [];

    Object.values(config.chains).forEach(ch => {
        if (ch.struct && ch.defaultColor) {
            selectionData.push({
                struct_asym_id: ch.struct,
                color: hexToRgb(ch.defaultColor), 
                focus: false
            });
        }
    });

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetStruct = config.chains[typeStr] ? config.chains[typeStr].struct : typeStr;
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
            const modRaw = mod["Possible Modifications"];
            const paletteObj = getModificationColor(modRaw, isMod);
            
            selectionData.push({
                struct_asym_id: targetStruct, start_residue_number: resi, end_residue_number: resi,
                color: paletteObj.rgb, 
                focus: false,
                representation: 'spacefill', 
                representationColor: paletteObj.rgb
            });
        }
    });

    viewerMolstar.visual.clearSelection();
    if (selectionData.length > 0) {
        viewerMolstar.visual.select({ data: selectionData, nonSelectedColor: {r: 224, g: 224, b: 224} });
    }
}

function applyJSmolStyles() {
    if (!window.myJmol) return;
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    
    let script = `select all; cartoon only; spacefill off; color cartoon [xE0E0E0]; `;
    
    Object.values(config.chains).forEach(ch => {
        if (ch.auth && ch.defaultColor) {
            let jcolor = ch.defaultColor.replace('#', '[x') + ']';
            script += `select chain=${ch.auth}; color cartoon ${jcolor}; `;
        }
    });
    
    script += `select all; color cartoon translucent ${1.0 - currentOpacity}; `;
    
    const styleGroups = {};
    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
            const modRaw = mod["Possible Modifications"];
            const paletteObj = getModificationColor(modRaw, isMod);
            const groupKey = `${targetAuth}|${paletteObj.hex}`;
            if (!styleGroups[groupKey]) styleGroups[groupKey] = { chain: targetAuth, color: paletteObj.hex, resi: [] };
            styleGroups[groupKey].resi.push(resi);
        }
    });

    Object.values(styleGroups).forEach(group => {
        const resiList = group.resi.join(",");
        const jsmolColor = group.color.replace('#', '[x') + ']';
        script += `select (resno=${resiList} and chain=${group.chain}); color cartoon opaque; color cartoon ${jsmolColor}; spacefill 1.5; color spacefill ${jsmolColor}; `;
    });
    
    script += "select none;"; 
    Jmol.script(myJmol, script);
}

function applyNglStyles() {
    if (!viewerNgl || !nglComponent) return;
    nglComponent.removeAllRepresentations();
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    
    let schemeData = [];
    Object.values(config.chains).forEach(ch => {
        if (ch.auth && ch.defaultColor) schemeData.push([ch.defaultColor, `:${ch.auth}`]);
    });
    schemeData.push(["#E0E0E0", "*"]); 
    
    const schemeId = NGL.ColormakerRegistry.addSelectionScheme(schemeData, "rnaBackbone");
    
    nglComponent.addRepresentation("cartoon", { 
        color: schemeId, 
        opacity: currentOpacity,
        depthWrite: currentOpacity === 1.0
    });
    
    const styleGroups = {};
    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
            const modRaw = mod["Possible Modifications"];
            const paletteObj = getModificationColor(modRaw, isMod);
            const groupKey = `${targetAuth}|${paletteObj.hex}`;
            if (!styleGroups[groupKey]) styleGroups[groupKey] = { chain: targetAuth, color: paletteObj.hex, resi: [] };
            styleGroups[groupKey].resi.push(resi);
        }
    });

    Object.values(styleGroups).forEach(group => {
        const sele = `${group.resi.join(",")}:${group.chain}`;
        nglComponent.addRepresentation("cartoon", { sele: sele, color: group.color, opacity: 1.0 });
        nglComponent.addRepresentation("spacefill", { sele: sele, color: group.color, opacity: 1.0, scale: 0.8 });
    });
}