let viewerInstance = null;
let structureData = null; // Novità: conserviamo il testo per controlli rapidi
let modifications = [];
let currentOpacity = 0.3; 

// Mappa Colori Mol* (Richiede i valori RGB esplosi)
const colorMap = {
    'mC': { hex: '#E74C3C', rgb: {r: 231, g: 76, b: 60} },
    'm6a': { hex: '#3498DB', rgb: {r: 52, g: 152, b: 219} },
    'Y': { hex: '#2ECC71', rgb: {r: 46, g: 204, b: 113} },
    'Psi': { hex: '#2ECC71', rgb: {r: 46, g: 204, b: 113} },
    'unknown': { hex: '#F39C12', rgb: {r: 243, g: 156, b: 18} },
    'none': { hex: '#CCCCCC', rgb: {r: 204, g: 204, b: 204} },
    'default': { hex: '#9B59B6', rgb: {r: 155, g: 89, b: 182} }
};

// Configurazione con doppio mapping: 
// 'struct' (label_asym_id) serve al motore 3D Mol*
// 'auth' (auth_asym_id) serve per i controlli di testo nel CIF originale
const rnaConfig = {
    "4v6x": {
        file: "4v6x.cif",
        chains: {
            "28S": { struct: "IC", auth: "A5" },
            "18S": { struct: "JA", auth: "B2" },
            "5.8S": { struct: "KC", auth: "A8" },
            "5S": { struct: "JC", auth: "A7" },
            "E-tRNA": { struct: "KA", auth: "BC" }
        }
    }
};

let currentRibo = "4v6x";

// 1. Controllo ad altissime prestazioni per verificare l'esistenza del residuo
function residueExists(resi, authChain) {
    if (!structureData) return false;
    // Cerca il pattern esatto del PDB alla fine della riga atomica (es. " 4137 C A5 ")
    const regex = new RegExp(`(?:^|\\s)${resi}\\s+[A-Za-z0-9]+\\s+${authChain}\\s+`);
    return regex.test(structureData);
}

// 2. Inizializzazione Mol*
function initViewer(blobUrl) {
    if (!viewerInstance) {
        viewerInstance = new PDBeMolstarPlugin();
        
        const options = {
            customData: { url: blobUrl, format: 'cif', binary: false },
            bgColor: { r: 255, g: 255, b: 255 },
            lighting: 'flat',
            
            // Spegnimento UI
            hideControls: true, hideIconWall: true, hideExpandIcon: true,
            hideSelectionIcon: true, hideAnimationIcon: true, hideDefaultSettings: true,
            hideSystemMenu: true, layoutShowControls: false, layoutShowSequence: false,
            layoutShowLog: false, landscape: false
        };
        
        viewerInstance.render(document.getElementById('gldiv'), options);

        viewerInstance.events.loadComplete.subscribe(() => {
            if (modifications.length > 0) apply3DStyles();
        });
    } else {
        viewerInstance.visual.update({
            customData: { url: blobUrl, format: 'cif', binary: false }
        });
    }
}

// 3. Caricamento File
document.getElementById('loadCifBtn').addEventListener('click', async function() {
    const selectEl = document.getElementById('riboSelect');
    currentRibo = selectEl.value;
    const config = rnaConfig[currentRibo];
    
    try {
        const response = await fetch(config.file);
        if (!response.ok) throw new Error("File non trovato");
        
        // Salviamo in globale per usarlo nei controlli regex
        structureData = await response.text(); 
        
        const blob = new Blob([structureData], { type: 'text/plain' });
        const blobUrl = URL.createObjectURL(blob);
        initViewer(blobUrl);
    } catch (error) {
        alert("Errore di caricamento. Verifica il server locale.");
        console.error(error);
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
        if (viewerInstance) apply3DStyles();
    };
    reader.readAsText(file);
});

// Controlli UI (Reset, Toggle)

document.getElementById('toggleUnknown').addEventListener('change', () => {
    if (viewerInstance && modifications.length > 0) apply3DStyles();
});

// 4. Costruzione della lista con ripristino del controllo "Non Risolto"
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

        let displayMod, colorObj;
        if (isMod) {
            colorObj = colorMap[modType] || colorMap['default'];
            displayMod = modType;
            if (modType === 'mC') displayMod = 'm₅C';
            if (modType === 'm6A') displayMod = 'm₆A';
            if (modType === 'Y' || modType === 'Psi') displayMod = 'Ψ';
        } else {
            colorObj = colorMap['unknown'];
            displayMod = 'Non nota';
        }

        const li = document.createElement('li');

        if (isResolved) {
            li.innerHTML = `<strong>${resi}</strong> (${typeStr})<br>${displayMod}`;
            li.style.borderLeftColor = colorObj.hex;
            li.title = `Clicca per centrare il residuo ${resi}`;
            
            li.addEventListener('click', () => {
                viewerInstance.visual.focus([{
                    struct_asym_id: targetStruct,
                    start_residue_number: resi,
                    end_residue_number: resi
                }]);
            });
        } else {
            li.innerHTML = `<strong>${resi}</strong> (${typeStr})<br>${displayMod} <br><span style="color:#c0392b; font-size:8px;">(Non risolto in 3D)</span>`;
            li.style.borderLeftColor = '#bdc3c7'; 
            li.style.opacity = '0.5'; 
            li.style.cursor = 'not-allowed';
            li.title = `Residuo ${resi} assente nel modello 3D (regione flessibile)`;
        }

        listEl.appendChild(li);
    });
}

// 5. Applica gli stili 3D
function apply3DStyles() {
    if (!viewerInstance) return;

    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const selectionData = [];

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        
        const targetStruct = config.chains[typeStr] ? config.chains[typeStr].struct : typeStr;
        const targetAuth = config.chains[typeStr] ? config.chains[typeStr].auth : typeStr;

        const isResolved = residueExists(resi, targetAuth);

        // Se il residuo non è risolto in 3D, non proviamo nemmeno a passarlo a Mol*
        if (isResolved && (isMod || showUnknown)) {
            const modType = mod["Possible Modifications"];
            let colorObj = isMod ? (colorMap[modType] || colorMap['default']) : colorMap['unknown'];
            
            selectionData.push({
                struct_asym_id: targetStruct,
                start_residue_number: resi,
                end_residue_number: resi,
                color: colorObj.rgb,
                focus: false
            });
        }
    });

    viewerInstance.visual.clearSelection();
    
    if (selectionData.length > 0) {
        viewerInstance.visual.select({
            data: selectionData,
            nonSelectedColor: colorMap['none'].rgb 
        });
    }
}