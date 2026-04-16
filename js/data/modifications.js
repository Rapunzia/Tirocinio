import { modPalette, rnaConfig } from '../constants.js';
import { appState } from '../state.js';
import { getResidueCenter, residueExists } from './cif-cache.js';

const BACKGROUND_INIT_CHUNK_SIZE = 120;
let backgroundInitToken = 0;
let modificationsHydrationToken = 0;

const SUPERSCRIPT_DIGITS = {
    '0': '\u2070',
    '1': '\u00b9',
    '2': '\u00b2',
    '3': '\u00b3',
    '4': '\u2074',
    '5': '\u2075',
    '6': '\u2076',
    '7': '\u2077',
    '8': '\u2078',
    '9': '\u2079'
};

function cloneCenter(center) {
    if (!center) return null;
    return { x: center.x, y: center.y, z: center.z };
}

function buildResidueKey(residueNumber, authChain) {
    return `${residueNumber}|${authChain}`;
}

function ensureCenter(modification) {
    if (modification._center) return modification._center;

    const center = getResidueCenter(modification['Positions in the Structure'], modification._authChain);
    if (center) modification._center = center;
    return modification._center || null;
}

function buildLabelPayload(modification) {
    return {
        residue: modification['Positions in the Structure'],
        authChain: modification._authChain,
        colorHex: modification._palette.hex,
        text: `${modification._displayMod} ${modification['Positions in the Structure']}`
    };
}

function buildMeasurementSlot(modification) {
    const center = ensureCenter(modification);

    return {
        residue: modification['Positions in the Structure'],
        authChain: modification._authChain,
        structId: modification._structId,
        type: modification['Type Structure'],
        display: modification._displayMod,
        colorHex: modification._palette.hex,
        center: cloneCenter(center)
    };
}

// Assigns a palette class according to biochemical behavior inferred from raw labels.
export function getModificationColor(rawModification, isKnownModification) {
    if (!isKnownModification) return modPalette.unknown;

    let mods = Array.isArray(rawModification)
        ? rawModification
        : (typeof rawModification === 'string'
            ? rawModification.split(/[,/]/).map((token) => token.trim())
            : []);

    mods = mods.filter(Boolean);

    if (mods.length === 0 || mods.includes('none')) return modPalette.standard;
    if (mods.includes('unknown') || mods.includes('?')) return modPalette.unknown;

    let hasI = false;
    let hasR = false;
    let hasB = false;
    let hasComplex = false;

    mods.forEach((mod) => {
        const normalized = mod.toLowerCase();

        if (normalized === 'y' || normalized === 'psi' || normalized === '\u03c8') {
            hasI = true;
            return;
        }

        if (normalized.includes('ac') || normalized.includes('acp') || normalized === 'd') {
            hasComplex = true;
            return;
        }

        if (normalized === 'ym' || normalized === 'psim' || normalized === '\u03c8m') {
            hasI = true;
            hasR = true;
            return;
        }

        if (normalized.endsWith('m') && normalized !== 'm') hasR = true;
        if (normalized.startsWith('m') && normalized.length > 1 && normalized !== 'm') hasB = true;
    });

    if (hasComplex || (hasI && hasB) || (hasI && hasR && hasB)) return modPalette.hyper;
    if (hasI && hasR) return modPalette.varIR;
    if (hasB && hasR) return modPalette.varBR;
    if (hasB) return modPalette.varB;
    if (hasR) return modPalette.varR;
    if (hasI) return modPalette.varI;

    return modPalette.unknown;
}

// Converts raw modification strings to display-friendly scientific labels.
export function formatModificationText(rawModification) {
    const mods = Array.isArray(rawModification)
        ? rawModification
        : (typeof rawModification === 'string'
            ? rawModification.split(/[,/]/).map((token) => token.trim())
            : []);

    if (mods.length === 0) return 'Unknown';

    return mods
        .map((mod) => {
            if (!mod) return '';
            if (mod.toLowerCase() === 'unknown' || mod === '?') return 'Unknown';
            if (mod === 'mC') return 'm\u2075C';
            if (['y', 'psi', '\u03c8'].includes(mod.toLowerCase())) return '\u03a8';

            return mod.replace(/(m|ac|acp)(\d+)/ig, (_, prefix, num) => {
                const superscript = num
                    .split('')
                    .map((digit) => SUPERSCRIPT_DIGITS[digit])
                    .join('');
                return `${prefix}${superscript}`;
            });
        })
        .filter(Boolean)
        .join(', ');
}

// Enriches each row from JSON with precomputed values used by UI and viewers.
export function hydrateModifications() {
    const config = rnaConfig[appState.currentRibo];

    appState.modifications.forEach((modification, index) => {
        const residueNumber = modification['Positions in the Structure'];
        const isKnownModification = modification['Knwon Positions Modifications'] === 'Y';
        const typeStructure = modification['Type Structure'];

        modification._index = index;
        modification._authChain = config.chains[typeStructure] ? config.chains[typeStructure].auth : typeStructure;
        modification._structId = config.chains[typeStructure] ? config.chains[typeStructure].struct : typeStructure;
        modification._isResolved = residueExists(residueNumber, modification._authChain);
        modification._center = getResidueCenter(residueNumber, modification._authChain);
        modification._palette = getModificationColor(modification['Possible Modifications'], isKnownModification);
        modification._displayMod = isKnownModification
            ? formatModificationText(modification['Possible Modifications'])
            : 'Unknown';
        modification._residueKey = buildResidueKey(residueNumber, modification._authChain);
        modification._labelPayload = buildLabelPayload(modification);
        modification._measurementSlot = buildMeasurementSlot(modification);

        // Cached lowercase searchable text for fast client-side filtering.
        modification._searchStr = `${residueNumber} ${modification._displayMod} ${typeStructure}`.toLowerCase();
    });

    modificationsHydrationToken += 1;
}

export function getModificationsHydrationToken() {
    return modificationsHydrationToken;
}

// Completes slower derived fields in chunks so interactions are instant when activated later.
export function warmupModificationDataInBackground(options = {}) {
    const {
        chunkSize = BACKGROUND_INIT_CHUNK_SIZE,
        onComplete = null
    } = options;

    const mods = appState.modifications;
    if (!Array.isArray(mods) || mods.length === 0) {
        if (typeof onComplete === 'function') onComplete();
        return;
    }

    const token = ++backgroundInitToken;
    let index = 0;

    const runChunk = () => {
        if (token !== backgroundInitToken) return;

        const endIndex = Math.min(index + chunkSize, mods.length);
        for (; index < endIndex; index += 1) {
            const mod = mods[index];
            if (!mod) continue;

            mod._residueKey = mod._residueKey || buildResidueKey(mod['Positions in the Structure'], mod._authChain);
            mod._labelPayload = mod._labelPayload || buildLabelPayload(mod);

            if (!mod._center) {
                mod._center = getResidueCenter(mod['Positions in the Structure'], mod._authChain);
            }

            mod._measurementSlot = buildMeasurementSlot(mod);
        }

        if (index < mods.length) {
            setTimeout(runChunk, 0);
            return;
        }

        if (typeof onComplete === 'function') onComplete();
    };

    setTimeout(runChunk, 0);
}
