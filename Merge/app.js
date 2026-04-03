let currentEngine = '3dmol';
let structureDataText = null; 
let modifications = [];
let currentOpacity = 0.3;

// Istanze dei Motori
let viewer3Dmol = null;
let viewerMolstar = null;
let viewerNgl = null;
let nglComponent = null;

// Dizionari
const colorMap3Dmol = {
    'mC': '#E74C3C', 'm6a': '#3498DB', 'm6A': '#3498DB', 'Y': '#2ECC71', 'Psi': '#2ECC71',
    'unknown': '#F39C12', 'none': '#CCCCCC', 'default': '#9B59B6'
};
const colorMapMolstar = {
    'mC': { hex: '#E74C3C', rgb: {r: 231, g: 76, b: 60} },
    'm6a': { hex: '#3498DB', rgb: {r: 52, g: 152, b: 219} },
    'm6A': { hex: '#3498DB', rgb: {r: 52, g: 152, b: 219} },
    'Y': { hex: '#2ECC71', rgb: {r: 46, g: 204, b: 113} },
    'Psi': { hex: '#2ECC71', rgb: {r: 46, g: 204, b: 113} },
    'unknown': { hex: '#F39C12', rgb: {r: 243, g: 156, b: 18} },
    'none': { hex: '#CCCCCC', rgb: {r: 204, g: 204, b: 204} },
    'default': { hex: '#9B59B6', rgb: {r: 155, g: 89, b: 182} }
};

const rnaConfig = {
    "4v6x": {
        file: "4v6x.cif",
        chains: {
            "28S": { struct: "IC", auth: "A5" },
            "18S": { struct: "JA", auth: "B2" },
            "5.8S": { struct: "KC", auth: "A8" },
            "5S": { struct: "JC", auth: "A7" }
        }
    }
};
let currentRibo = "4v6x";

// --- LOGICA DI SCAMBIO MOTORE ---
document.getElementById('engineSelect').addEventListener('change', (e) => {
    currentEngine = e.target.value;

    // Adatta l'interfaccia (mostra/nasconde lo slider trasparenza)
    document.getElementById('ui-opacity').style.display = (currentEngine !== 'molstar') ? 'flex' : 'none';

    // Scambia i Canvas
    ['3dmol', 'molstar', 'jsmol' , 'ngl'].forEach(eng => {
        const el = document.getElementById(`gldiv-${eng}`);
        if (eng === currentEngine) {
            el.classList.replace('hidden-engine', 'active-engine');
        } else {
            el.classList.replace('active-engine', 'hidden-engine');
        }
    });

    // Se un file è già in memoria, inietta i dati nel nuovo motore
    if (structureDataText && structureDataText.trim() !== "") {
        renderActiveEngine();
    }
});

// Controllo Esistenza Residuo
function residueExists(resi, authChain) {
    if (!structureDataText) return false;
    const regex = new RegExp(`(?:^|\\s)${resi}\\s+[A-Za-z0-9]+\\s+${authChain}\\s+`);
    return regex.test(structureDataText);
}

// Invia i dati in RAM al motore attualmente a schermo
function renderActiveEngine() {
    buildList(); // Ricostruisce i click eventi per indirizzarli al motore giusto

    switch (currentEngine) {
        
        // --- 1. BLOCCO 3DMOL ---
        case '3dmol':
            if (!viewer3Dmol) {
                viewer3Dmol = $3Dmol.createViewer("gldiv-3dmol", { backgroundColor: "#ffffff" });
            }
            viewer3Dmol.clear();
            viewer3Dmol.addModel(structureDataText, "cif");
            viewer3Dmol.zoomTo();
            
            if (modifications.length > 0) {
                apply3DmolStyles();
            } else {
                viewer3Dmol.setStyle({}, { cartoon: { color: colorMap3Dmol['none'], opacity: currentOpacity } });
                viewer3Dmol.render();
            }
            break;

        // --- 2. BLOCCO MOL* ---
        case 'molstar':
            const blob = new Blob([structureDataText], { type: 'text/plain' });
            const blobUrl = URL.createObjectURL(blob);
            
            if (!viewerMolstar) {
                viewerMolstar = new PDBeMolstarPlugin();
                const options = {
                    customData: { url: blobUrl, format: 'cif', binary: false },
                    bgColor: { r: 255, g: 255, b: 255 }, lighting: 'flat',
                    hideControls: true, hideIconWall: true, hideExpandIcon: true, hideSelectionIcon: true,
                    hideAnimationIcon: true, hideDefaultSettings: true, hideSystemMenu: true,
                    layoutShowControls: false, layoutShowSequence: false, layoutShowLog: false, landscape: false
                };
                viewerMolstar.render(document.getElementById('gldiv-molstar'), options);
                viewerMolstar.events.loadComplete.subscribe(() => {
                    if (modifications.length > 0) applyMolstarStyles();
                });
            } else {
                viewerMolstar.visual.update({ customData: { url: blobUrl, format: 'cif', binary: false } });
                if (modifications.length > 0) applyMolstarStyles();
            }
            break;

        // --- 3. BLOCCO JSMOL ---
        case 'jsmol':
            if (!window.myJmol) {
                const Info = {
                    width: "100%", height: "100%", use: "HTML5",
                    j2sPath: "https://chemapps.stolaf.edu/jmol/jsmol/j2s",
                    disableInitialConsole: true, disableJ2SLoadMonitor: true,
                    // Questa funzione si attiva SOLO quando JSmol è pronto
                    readyFunction: function(applet) {
                        const loadScript = `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`;
                        Jmol.script(applet, loadScript);
                        
                        if (modifications.length > 0) applyJSmolStyles();
                        else Jmol.script(applet, `color cartoon [xCCCCCC]; color cartoon translucent ${1.0 - currentOpacity};`);
                    }
                };
                // JSmol crea automaticamente window.myJmol
                document.getElementById("gldiv-jsmol").innerHTML = Jmol.getAppletHtml("myJmol", Info);
            } else {
                // Se JSmol è già stato inizializzato in precedenza, invia direttamente i dati
                const loadScript = `load DATA 'model'\n${structureDataText}\nEND 'model'; cartoon only;`;
                Jmol.script(window.myJmol, loadScript);
                
                if (modifications.length > 0) applyJSmolStyles();
                else Jmol.script(window.myJmol, `color cartoon [xCCCCCC]; color cartoon translucent ${1.0 - currentOpacity};`);
            }
            break;

        // --- 4. BLOCCO NGL ---
        case 'ngl':
            if (!viewerNgl) {
                viewerNgl = new NGL.Stage("gldiv-ngl", { backgroundColor: "white" });
                // Rendi NGL responsivo ai cambi di finestra
                window.addEventListener("resize", function () {
                    viewerNgl.handleResize();
                }, false);
            }
            
            const nglBlob = new Blob([structureDataText], { type: 'text/plain' });
            
            viewerNgl.removeAllComponents();
            viewerNgl.loadFile(nglBlob, { ext: "cif" }).then(function (comp) {
                nglComponent = comp;
                comp.autoView();
                
                if (modifications.length > 0) {
                    applyNglStyles();
                } else {
                    comp.addRepresentation("cartoon", { color: colorMap3Dmol['none'], opacity: currentOpacity });
                }
            });
            break;

        // --- FALLBACK ---
        default:
            console.error("Motore di rendering non riconosciuto:", currentEngine);
            break;
    }
}
// Caricamenti Iniziali
document.getElementById('loadCifBtn').addEventListener('click', async function() {
    const config = rnaConfig[document.getElementById('riboSelect').value];
    try {
        const response = await fetch(config.file);
        if (!response.ok) throw new Error("File non trovato");
        structureDataText = await response.text(); 
        renderActiveEngine();
    } catch (error) {
        alert("Errore caricamento. Server locale in esecuzione?");
    }
});

document.getElementById('jsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try { modifications = JSON.parse(evt.target.result); } 
        catch (error) { alert("Errore JSON."); return; }
        
        buildList();
        if (currentEngine === '3dmol' && viewer3Dmol) apply3DmolStyles();
        if (currentEngine === 'molstar' && viewerMolstar) applyMolstarStyles();
    };
    reader.readAsText(file);
});

// Controlli UI Condivisi
document.getElementById('toggleUnknown').addEventListener('change', () => {
    if (modifications.length > 0) {
        if (currentEngine === '3dmol' && viewer3Dmol) apply3DmolStyles();
        if (currentEngine === 'molstar' && viewerMolstar) applyMolstarStyles();
        if (currentEngine === 'jsmol' && window.myJmol) applyJSmolStyles();
        if (currentEngine === 'ngl' && viewerNgl) applyNglStyles();
    }
});
document.getElementById('opacitySlider').addEventListener('change', function(e) {
    currentOpacity = parseFloat(e.target.value);
    if (currentEngine === '3dmol' && viewer3Dmol) apply3DmolStyles(); 
    if (currentEngine === 'jsmol' && window.myJmol) applyJSmolStyles();
    if (currentEngine === 'ngl' && viewerNgl) applyNglStyles();
});

// Generazione della Lista HTML
function buildList() {
    const listEl = document.getElementById('modList');
    listEl.innerHTML = ''; 
    const config = rnaConfig[currentRibo];

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const modType = mod["Possible Modifications"];
        const typeStr = mod["Type Structure"];
        
        const targetStruct = config.chains[typeStr] ? config.chains[typeStr].struct : typeStr;
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        const isResolved = residueExists(resi, targetAuth);

        let displayMod, colorObj, hexColor;
        if (isMod) {
            hexColor = colorMap3Dmol[modType] || colorMap3Dmol['default'];
            displayMod = modType;
            if (modType === 'mC') displayMod = 'm₅C';
            if (modType === 'm6a' || modType === 'm6A') displayMod = 'm₆A';
            if (modType === 'Y' || modType === 'Psi') displayMod = 'Ψ';
        } else {
            hexColor = colorMap3Dmol['unknown'];
            displayMod = 'Non nota';
        }

        const li = document.createElement('li');
        li.style.padding = '4px'; li.style.fontSize = '10px'; li.style.marginBottom = '2px'; li.style.cursor = 'pointer'; li.style.background = '#ecf0f1';

        if (isResolved) {
            li.innerHTML = `<strong>${resi}</strong> (${typeStr})<br>${displayMod}`;
            li.style.borderLeft = `3px solid ${hexColor}`;
            li.title = `Clicca per centrare il residuo ${resi}`;
            
            li.addEventListener('click', () => {
                // Dirotta il click della lista sul motore attivo
                if (currentEngine === '3dmol' && viewer3Dmol) {
                    const sel = { chain: targetAuth, resi: resi.toString() };
                    viewer3Dmol.zoomTo(sel, 1000);
                    viewer3Dmol.setStyle(sel, { cartoon: { color: '#F1C40F' }, stick: { radius: 0.3, color: '#F1C40F' } });
                    viewer3Dmol.render();
                    setTimeout(() => apply3DmolStyles(), 1500);
                } else if (currentEngine === 'molstar' && viewerMolstar) {
                    viewerMolstar.visual.focus([{ struct_asym_id: targetStruct, start_residue_number: resi, end_residue_number: resi }]);
                } else if (currentEngine === 'jsmol' && window.myJmol) {
                    // Centra (zoomto), colora temporaneamente di giallo e poi riapplica gli stili
                    Jmol.script(window.myJmol, `zoomto 1 (resno=${resi} and chain=${targetAuth}) 300; select (resno=${resi} and chain=${targetAuth}); color cartoon opaque; color cartoon [xF1C40F];`);
                    setTimeout(() => applyJSmolStyles(), 1500);
                } else if (currentEngine === 'ngl' && viewerNgl && nglComponent) {
                    let sele = `${resi}:${targetAuth}`;
                    let seleObj = new NGL.Selection(sele);
                    
                    // Zoom sul residuo
                    viewerNgl.animationControls.zoomTo(nglComponent.structure.getView(seleObj), 1000);
                    
                    // Highlight temporaneo
                    let highlightRepr = nglComponent.addRepresentation("spacefill", { sele: sele, color: "#F1C40F", scale: 1.5 });
                    setTimeout(() => {
                        nglComponent.removeRepresentation(highlightRepr);
                    }, 1500);
                }
            });
        } else {
            li.innerHTML = `<strong>${resi}</strong> (${typeStr})<br>${displayMod} <br><span style="color:#c0392b; font-size:8px;">(Non in 3D)</span>`;
            li.style.borderLeft = '3px solid #bdc3c7'; li.style.opacity = '0.5'; li.style.cursor = 'not-allowed';
        }
        listEl.appendChild(li);
    });
}

// Stili 3Dmol (Asincrono per non bloccare l'UI)
async function apply3DmolStyles() {
    if (!viewer3Dmol) return;
    viewer3Dmol.setStyle({}, { cartoon: { color: colorMap3Dmol['none'], opacity: currentOpacity } });
    
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const tooltip = document.getElementById('tooltip');

    const chunkSize = 50; 
    for (let i = 0; i < modifications.length; i += chunkSize) {
        const chunk = modifications.slice(i, i + chunkSize);

        chunk.forEach(mod => {
            const resi = mod["Positions in the Structure"];
            const isMod = mod["Knwon Positions Modifications"] === "Y"; 
            const typeStr = mod["Type Structure"];
            const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

            if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
                const modType = mod["Possible Modifications"];
                let color = isMod ? (colorMap3Dmol[modType] || colorMap3Dmol['default']) : colorMap3Dmol['unknown'];
                let displayMod = isMod ? modType : 'Non nota';
                if (isMod && modType === 'mC') displayMod = 'm₅C';
                if (isMod && (modType === 'm6a' || modType === 'm6A')) displayMod = 'm₆A';
                if (isMod && (modType === 'Y' || modType === 'Psi')) displayMod = 'Ψ';

                const sel = { chain: targetAuth, resi: resi.toString() };
                viewer3Dmol.setStyle(sel, { cartoon: { color: color, opacity: 1.0 }, stick: { radius: 0.2, color: color, opacity: 1.0 } });

                viewer3Dmol.setHoverable(sel, true,
                    function(atom, viewer, event) {
                        if (!atom.labelCreated) {
                            tooltip.innerHTML = `<strong>Residuo:</strong> ${resi} (${typeStr})<br><strong>Modifica:</strong> ${displayMod}`;
                            tooltip.style.left = (event.clientX + 15) + 'px';
                            tooltip.style.top = (event.clientY + 15) + 'px';
                            tooltip.style.display = 'block';
                            atom.labelCreated = true;
                        }
                    },
                    function(atom) { tooltip.style.display = 'none'; atom.labelCreated = false; }
                );
            }
        });
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    viewer3Dmol.render();
}

// Stili Mol*
function applyMolstarStyles() {
    if (!viewerMolstar) return;
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const selectionData = [];

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetStruct = config.chains[typeStr] ? config.chains[typeStr].struct : typeStr;
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
            const modType = mod["Possible Modifications"];
            let colorObj = isMod ? (colorMapMolstar[modType] || colorMapMolstar['default']) : colorMapMolstar['unknown'];
            
            selectionData.push({
                struct_asym_id: targetStruct, start_residue_number: resi, end_residue_number: resi,
                color: colorObj.rgb, focus: false
            });
        }
    });

    viewerMolstar.visual.clearSelection();
    if (selectionData.length > 0) {
        viewerMolstar.visual.select({ data: selectionData, nonSelectedColor: colorMapMolstar['none'].rgb });
    }
}
// Stili JSmol
function applyJSmolStyles() {
    if (!window.myJmol) return;
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    
    // Resetta tutto l'RNA a grigio con l'opacità decisa dallo slider
    let script = `select all; cartoon only; color cartoon [xCCCCCC]; color cartoon translucent ${1.0 - currentOpacity}; `;
    
    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
            const modType = mod["Possible Modifications"];
            let hexColor = isMod ? (colorMap3Dmol[modType] || colorMap3Dmol['default']) : colorMap3Dmol['unknown'];
            
            // Adatta l'esadecimale (#E74C3C -> [xE74C3C])
            let jsmolColor = hexColor.replace('#', '[x') + ']';
            
            // Colora la modifica e rimuovi la trasparenza (opaque)
            script += `select (resno=${resi} and chain=${targetAuth}); color cartoon opaque; color cartoon ${jsmolColor}; `;
        }
    });
    
    script += "select none;"; // Deseleziona tutto alla fine
    Jmol.script(myJmol, script);
}
//Stili NGL
function applyNglStyles() {
    if (!viewerNgl || !nglComponent) return;
    
    nglComponent.removeAllRepresentations();
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    
    // 1. Rappresentazione base dell'RNA con opacità regolabile
    nglComponent.addRepresentation("cartoon", { 
        color: colorMap3Dmol['none'], 
        opacity: currentOpacity,
        depthWrite: currentOpacity === 1.0 // Ottimizzazione NGL per le trasparenze
    });
    
    // 2. Livelli sovrapposti per i residui modificati
    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        if (residueExists(resi, targetAuth) && (isMod || showUnknown)) {
            const modType = mod["Possible Modifications"];
            let hexColor = isMod ? (colorMap3Dmol[modType] || colorMap3Dmol['default']) : colorMap3Dmol['unknown'];
            
            // Sintassi di selezione NGL: numeroResiduo:catena
            let sele = `${resi}:${targetAuth}`;
            
            // Applica il colore solido al cartoon e aggiunge i legami (licorice) per evidenziarlo
            nglComponent.addRepresentation("cartoon", { sele: sele, color: hexColor, opacity: 1.0 });
            nglComponent.addRepresentation("licorice", { sele: sele, color: hexColor, opacity: 1.0, scale: 0.5 });
        }
    });
}