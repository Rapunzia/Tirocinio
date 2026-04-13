import { appState } from '../state.js';

// Builds a compact lookup Set("resi|chain") from CIF atom rows.
// The parser scans text line by line to avoid large intermediate allocations.
export function buildResidueCache(cifText) {
    appState.residueCache = new Set();

    let pos = 0;
    let inAtomSite = false;
    let headers = [];
    let colSeqId = -1;
    let colAuthChain = -1;

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
                inAtomSite = false;
                headers = [];
                colSeqId = -1;
                colAuthChain = -1;
                continue;
            }

            if (colSeqId >= 0 && colAuthChain >= 0 && (line.startsWith('ATOM') || line.startsWith('HETATM'))) {
                const parts = line.split(/\s+/);
                if (parts.length > Math.max(colSeqId, colAuthChain)) {
                    const resi = parts[colSeqId];
                    const chain = parts[colAuthChain];
                    if (resi !== '.' && resi !== '?') appState.residueCache.add(`${resi}|${chain}`);
                }
            }
        }
    }

    if (appState.residueCache.size === 0) appState.residueCache = null;
}

// Returns true when a residue exists in the loaded structure cache.
export function residueExists(resi, authChain) {
    if (!appState.structureDataText || !appState.residueCache) return false;
    return appState.residueCache.has(`${resi}|${authChain}`);
}
