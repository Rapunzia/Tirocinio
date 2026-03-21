let viewer = null;
let structureData = null;
let modifications = [];
let currentOpacity = 0.3; // Valore di default dello slider

// Mappa dei colori (incluso l'arancione per le posizioni non note)
const colorMap = {
    'mC': '#E74C3C',    // Rosso
    'm6a': '#3498DB',   // Blu
    'Y': '#2ECC71',     // Verde
    'Psi': '#2ECC71',   // Verde
    'unknown': '#F39C12', // Arancione
    'none': '#CCCCCC',  // Grigio
    'default': '#9B59B6' // Viola
};

// Configurazione scalabile per i vari ribosomi
const rnaConfig = {
    "4v6x": {
        file: "4v6x.cif",
        chainMapping: {
            "28S": "A5",
            "18S": "B2",
            "5.8S": "A8",
            "5S": "A7"
        }
    }
};

let currentRibo = "4v6x";

// 1. Caricamento CIF automatico dal Server Locale
document.getElementById('loadCifBtn').addEventListener('click', async function() {
    const selectEl = document.getElementById('riboSelect');
    currentRibo = selectEl.value;
    const config = rnaConfig[currentRibo];
    
    try {
        const response = await fetch(config.file);
        if (!response.ok) throw new Error("File non trovato o errore di rete.");
        
        structureData = await response.text();
        initViewer();
    } catch (error) {
        alert(`Errore: Impossibile caricare ${config.file}.\n\nAssicurati di aver avviato un Local Web Server per evitare il blocco CORS del browser.`);
        console.error(error);
    }
});

// 2. Gestione caricamento JSON
document.getElementById('jsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        // Separiamo il controllo del JSON dalla grafica
        try {
            modifications = JSON.parse(evt.target.result);
        } catch (error) {
            alert("Errore nella lettura del JSON. Verifica il formato.");
            console.error(error);
            return; // Ferma tutto se il JSON è davvero rotto
        }

        // Se arriviamo qui, il JSON è valido. Ora proviamo ad applicare la grafica.
        if (viewer && structureData) {
            buildList();
            apply3DStyles();
        }
    };
    reader.readAsText(file);
});

// 3. Gestione Slider Trasparenza
document.getElementById('opacitySlider').addEventListener('change', function(e) {
    currentOpacity = parseFloat(e.target.value);
    if (viewer && structureData) {
        apply3DStyles();
    }
});

// 4. Gestione Spunta "Mostra/Nascondi non noti"
document.getElementById('toggleUnknown').addEventListener('change', function() {
    if (viewer && structureData && modifications.length > 0) {
        apply3DStyles(); 
    }
});

document.getElementById('resetZoomBtn').addEventListener('click', function() {
    if (viewer) {
        viewer.zoomTo(); // Senza argomenti, reimposta la visuale sull'intero modello
    }
});

// Inizializza il canvas 3D
function initViewer() {
    if (!viewer) {
        viewer = $3Dmol.createViewer("gldiv", { backgroundColor: "#ffffff" });
    }
    viewer.clear();
    viewer.addModel(structureData, "cif");
    
    if (modifications.length > 0) {
        buildList();
        apply3DStyles();
    } else {
        viewer.setStyle({}, { cartoon: { color: colorMap['none'], opacity: currentOpacity } });
        viewer.render();
    }
    
    viewer.zoomTo();
}

// Costruisce la lista HTML compatta
function buildList() {
    const listEl = document.getElementById('modList');
    listEl.innerHTML = ''; 
    const config = rnaConfig[currentRibo];

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const modType = mod["Possible Modifications"];
        const typeStr = mod["Type Structure"];
        const targetChain = config.chainMapping[typeStr] || typeStr;

        let displayMod, color;
        if (isMod) {
            color = colorMap[modType] || colorMap['default'];
            displayMod = modType;
            // Nomenclatura scientifica
            if (modType === 'mC') displayMod = 'm₅C';
            if (modType === 'm6A') displayMod = 'm₆A';
            if (modType === 'Y' || modType === 'Psi') displayMod = 'Ψ';
        } else {
            color = colorMap['unknown'];
            displayMod = 'Non nota';
        }

        const li = document.createElement('li');
        const sel = { chain: targetChain, resi: resi.toString() };
        
        // CONTROLLO CRITICO: Verifica se il residuo esiste fisicamente nel modello 3D
        const atoms = viewer.selectedAtoms(sel);
        const isResolved = atoms.length > 0;

        if (isResolved) {
            // Il residuo esiste: comportamento normale
            li.innerHTML = `<strong>${resi}</strong> (${typeStr})<br>${displayMod}`;
            li.style.borderLeftColor = color;
            li.title = `Clicca per centrare il residuo ${resi}`;
            
            li.addEventListener('click', () => {
                viewer.zoomTo(sel, 1000);
                viewer.setStyle(sel, {
                    cartoon: { color: '#F1C40F', opacity: 1.0 },
                    stick: { radius: 0.3, color: '#F1C40F', opacity: 1.0 }
                });
                viewer.render();
                setTimeout(() => { apply3DStyles(); }, 1500);
            });
        } else {
            // Il residuo MANCA nel file CIF (regione flessibile)
            li.innerHTML = `<strong>${resi}</strong> (${typeStr})<br>${displayMod} <br><span style="color:#c0392b; font-size:8px;">(Non risolto in 3D)</span>`;
            li.style.borderLeftColor = '#bdc3c7'; // Bordo grigio spento
            li.style.opacity = '0.5'; // Rende l'elemento semitrasparente
            li.style.cursor = 'not-allowed';
            li.title = `Residuo ${resi} assente nel modello 3D (probabile regione flessibile)`;
        }

        listEl.appendChild(li);
    });
}

// Applica o aggiorna i colori sul modello 3D
function apply3DStyles() {
    // Resetta lo stile base con l'opacità attuale dello slider
    viewer.setStyle({}, { cartoon: { color: colorMap['none'], opacity: currentOpacity } });
    
    const config = rnaConfig[currentRibo];
    const showUnknown = document.getElementById('toggleUnknown').checked;
    const tooltip = document.getElementById('tooltip');

    // RIMOZIONE: Ho eliminato viewer.removeAllHover() che causava il crash.
    // 3Dmol sovrascrive automaticamente i comandi di hover quando riassegnati.

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const typeStr = mod["Type Structure"];
        const targetChain = config.chainMapping[typeStr] || typeStr;

        if (isMod || showUnknown) {
            const modType = mod["Possible Modifications"];
            let color = isMod ? (colorMap[modType] || colorMap['default']) : colorMap['unknown'];
            
            let displayMod = isMod ? modType : 'Non nota';
            if (isMod && modType === 'mC') displayMod = 'm₅C';
            if (isMod && modType === 'm6A') displayMod = 'm₆A';
            if (isMod && (modType === 'Y' || modType === 'Psi')) displayMod = 'Ψ';

            const sel = { chain: targetChain, resi: resi.toString() };

            // Evidenzia solido (opacity 1.0)
            viewer.setStyle(sel, {
                cartoon: { color: color, opacity: 1.0 },
                stick: { radius: 0.2, color: color, opacity: 1.0 }
            });

            // Aggiungi interattività Hover
            viewer.setHoverable(sel, true,
                function(atom, viewer_instance, event, container) {
                    if (!atom.labelCreated) {
                        tooltip.innerHTML = `<strong>Residuo:</strong> ${resi} (${typeStr})<br><strong>Modifica:</strong> ${displayMod}`;
                        tooltip.style.left = (event.clientX + 15) + 'px';
                        tooltip.style.top = (event.clientY + 15) + 'px';
                        tooltip.classList.remove('hidden');
                        atom.labelCreated = true;
                    }
                },
                function(atom, viewer_instance) {
                    tooltip.classList.add('hidden');
                    atom.labelCreated = false;
                }
            );
        }
    });

    viewer.render();
}