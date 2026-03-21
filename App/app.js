let viewer = null;
let structureData = null;
let modifications = [];

const colorMap = {
    'mC': '#E74C3C',    // Rosso
    'none': '#CCCCCC',  // Grigio
    'default': '#9B59B6' // Viola
};

// Configurazione scalabile per il menu a tendina
const rnaConfig = {
    "4v6x": {
        file: "4v6x.cif",
        chainMapping: {
            "28S": "A5",
            "18S": "A2",
            "5.8S": "A8",
            "5S": "A7"
        }
    }
};

let currentRibo = "4v6x";

// 1. Caricamento CIF automatico dalla directory tramite fetch
document.getElementById('loadCifBtn').addEventListener('click', async function() {
    const selectEl = document.getElementById('riboSelect');
    currentRibo = selectEl.value;
    const config = rnaConfig[currentRibo];
    
    try {
        // Richiede un server locale funzionante per evitare l'errore CORS
        const response = await fetch(config.file);
        if (!response.ok) throw new Error("File non trovato o errore di rete.");
        
        structureData = await response.text();
        initViewer();
    } catch (error) {
        alert(`Errore: Impossibile caricare ${config.file}.\n\nSe stai aprendo index.html col doppio clic (file://), il browser sta bloccando l'azione per sicurezza. Avvia un Local Web Server!`);
        console.error(error);
    }
});

// 2. Gestione caricamento JSON (rimane manuale per flessibilità)
document.getElementById('jsonFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            modifications = JSON.parse(evt.target.result);
            if (viewer && structureData) {
                applyModifications();
            }
        } catch (error) {
            alert("Errore nella lettura del JSON.");
        }
    };
    reader.readAsText(file);
});

// Inizializza il canvas 3D
function initViewer() {
    if (!viewer) {
        viewer = $3Dmol.createViewer("gldiv", { backgroundColor: "#ffffff" });
    }
    viewer.clear();
    
    viewer.addModel(structureData, "cif");

    // Novità: Stile base con trasparenza (opacity: 0.3)
    viewer.setStyle({}, { cartoon: { color: colorMap['none'], opacity: 0.3 } });
    viewer.zoomTo();
    viewer.render();

    if (modifications.length > 0) {
        applyModifications();
    }
}

// Mappa le modifiche sulla struttura
function applyModifications() {
    const listEl = document.getElementById('modList');
    listEl.innerHTML = ''; 
    const tooltip = document.getElementById('tooltip');
    
    const config = rnaConfig[currentRibo];

    modifications.forEach(mod => {
        const resi = mod["Positions in the Structure"];
        const isMod = mod["Knwon Positions Modifications"] === "Y"; 
        const modType = mod["Possible Modifications"];
        const typeStr = mod["Type Structure"];

        const targetChain = config.chainMapping[typeStr] || typeStr;

        if (isMod) {
            const color = colorMap[modType] || colorMap['default'];
            
            // Format grafico per la UI con apice
            const displayMod = modType === 'mC' ? 'm<sup>5</sup>C' : modType;

            const li = document.createElement('li');
            li.innerHTML = `<strong>Pos:</strong> ${resi} <br><strong>Tipo:</strong> ${displayMod} <br><strong>Catena:</strong> ${typeStr}`;
            li.style.borderLeftColor = color;
            
            // Novità: Rende l'elemento della lista cliccabile
            li.style.cursor = 'pointer';
            li.title = "Clicca per centrare la visuale su questo residuo";
            
            // Evento Click per zoomare
            li.addEventListener('click', () => {
                const sel = { chain: targetChain, resi: resi.toString() };
                
                // Zoom animato (durata 1000ms)
                viewer.zoomTo(sel, 1000);
                
                // Effetto visivo temporaneo: il residuo lampeggia di giallo
                viewer.setStyle(sel, {
                    cartoon: { color: '#F1C40F' },
                    stick: { radius: 0.3, color: '#F1C40F' }
                });
                viewer.render();
                
                // Ripristina il colore originale dopo 1.5 secondi
                setTimeout(() => {
                    viewer.setStyle(sel, {
                        cartoon: { color: color },
                        stick: { radius: 0.2, color: color }
                    });
                    viewer.render();
                }, 1500);
            });

            listEl.appendChild(li);

            // Selezione mirata per 3Dmol (mantiene opacità 1.0 per farli risaltare)
            const sel = { chain: targetChain, resi: resi.toString() };

            viewer.setStyle(sel, {
                cartoon: { color: color, opacity: 1.0 },
                stick: { radius: 0.2, color: color, opacity: 1.0 }
            });

            // Gestione Hover 
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