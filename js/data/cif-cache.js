import { appState } from '../state.js';

function buildResidueKey(resi, authChain) {
    return `${resi}|${authChain}`;
}

// Builds lookup caches from CIF atom rows.
// `residueCache` stores existence and `residueCenterCache` stores xyz centers.
// The parser scans text line by line to avoid large intermediate allocations.
export function buildResidueCache(cifText) {
    appState.residueCache = new Set();
    appState.residueCenterCache = new Map();

    const centerAccumulator = new Map();

    let pos = 0;
    let inAtomSite = false;
    let headers = [];
    let colSeqId = -1;
    let colAuthSeqId = -1;
    let colAuthChain = -1;
    let colX = -1;
    let colY = -1;
    let colZ = -1;

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
            if (line === '_atom_site.auth_seq_id') colAuthSeqId = headers.length - 1;
            if (line === '_atom_site.auth_asym_id') colAuthChain = headers.length - 1;
            if (line === '_atom_site.Cartn_x') colX = headers.length - 1;
            if (line === '_atom_site.Cartn_y') colY = headers.length - 1;
            if (line === '_atom_site.Cartn_z') colZ = headers.length - 1;
            continue;
        }

        if (inAtomSite && headers.length > 0) {
            if (line[0] === '_' || line[0] === '#') {
                const hasResidueColumns = (colSeqId >= 0 || colAuthSeqId >= 0) && colAuthChain >= 0;
                if (hasResidueColumns) break;
                inAtomSite = false;
                headers = [];
                colSeqId = -1;
                colAuthSeqId = -1;
                colAuthChain = -1;
                colX = -1;
                colY = -1;
                colZ = -1;
                continue;
            }

            const hasResidueColumns = (colSeqId >= 0 || colAuthSeqId >= 0) && colAuthChain >= 0;
            if (hasResidueColumns && (line.startsWith('ATOM') || line.startsWith('HETATM'))) {
                const parts = line.split(/\s+/);
                const residueColumnIndex = colAuthSeqId >= 0 ? colAuthSeqId : colSeqId;
                const hasCoordinateColumns = colX >= 0 && colY >= 0 && colZ >= 0;
                const maxIndex = Math.max(
                    residueColumnIndex,
                    colAuthChain,
                    hasCoordinateColumns ? colX : -1,
                    hasCoordinateColumns ? colY : -1,
                    hasCoordinateColumns ? colZ : -1
                );

                if (parts.length > maxIndex) {
                    const resi = parts[residueColumnIndex];
                    const chain = parts[colAuthChain];
                    if (resi === '.' || resi === '?' || chain === '.' || chain === '?') continue;

                    const residueKey = buildResidueKey(resi, chain);
                    appState.residueCache.add(residueKey);

                    if (!hasCoordinateColumns) continue;

                    const x = Number.parseFloat(parts[colX]);
                    const y = Number.parseFloat(parts[colY]);
                    const z = Number.parseFloat(parts[colZ]);

                    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

                    const current = centerAccumulator.get(residueKey) || {
                        sumX: 0,
                        sumY: 0,
                        sumZ: 0,
                        count: 0
                    };

                    current.sumX += x;
                    current.sumY += y;
                    current.sumZ += z;
                    current.count += 1;

                    centerAccumulator.set(residueKey, current);
                }
            }
        }
    }

    if (appState.residueCache.size === 0) appState.residueCache = null;

    centerAccumulator.forEach((entry, residueKey) => {
        if (!entry.count) return;
        appState.residueCenterCache.set(residueKey, {
            x: entry.sumX / entry.count,
            y: entry.sumY / entry.count,
            z: entry.sumZ / entry.count
        });
    });

    if (appState.residueCenterCache.size === 0) appState.residueCenterCache = null;
}

// Returns true when a residue exists in the loaded structure cache.
export function residueExists(resi, authChain) {
    if (!appState.structureDataText || !appState.residueCache) return false;
    return appState.residueCache.has(buildResidueKey(resi, authChain));
}

// Returns cached xyz center for a residue when available.
export function getResidueCenter(resi, authChain) {
    if (!appState.structureDataText || !appState.residueCenterCache) return null;
    return appState.residueCenterCache.get(buildResidueKey(resi, authChain)) || null;
}
