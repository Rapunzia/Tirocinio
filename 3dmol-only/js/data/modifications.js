import { modPalette, rnaConfig, statusPalette } from '../constants.js';
import { appState } from '../state.js';

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

function buildResidueKey(residueNumber, authChain) {
    return `${residueNumber}|${authChain}`;
}

function normalizeFrequency(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(1, Math.max(0, parsed));
}

function normalizeMods(rawMods) {
    if (Array.isArray(rawMods)) return rawMods.map((item) => String(item).trim()).filter(Boolean);
    if (typeof rawMods === 'string') return rawMods.split(/[,/]/).map((item) => item.trim()).filter(Boolean);
    return [];
}

function getStatusColor(status) {
    if (status === 'match') return statusPalette.match;
    if (status === 'novel') return statusPalette.novel;
    if (status === 'missing') return statusPalette.missing;
    return statusPalette.fallback;
}

function resolveActivePalette(modification) {
    return appState.colorMode === 'global'
        ? modification._statusPalette
        : modification._analyticPalette;
}

function buildLabelPayload(modification) {
    const activePalette = resolveActivePalette(modification);

    return {
        residue: modification.resi,
        authChain: modification._authChain,
        colorHex: activePalette.hex,
        text: `${modification._displayMod} ${modification.resi}`
    };
}

function buildMeasurementSlot(modification) {
    const activePalette = resolveActivePalette(modification);

    return {
        residue: modification.resi,
        authChain: modification._authChain,
        structId: modification._structId,
        type: modification.chain,
        display: modification._displayMod,
        colorHex: activePalette.hex,
        center: null
    };
}

export function getModificationColor(rawMods) {
    const mods = normalizeMods(rawMods);

    if (mods.length === 0 || mods.includes('none')) return modPalette.standard;
    if (mods.includes('unknown') || mods.includes('?')) return modPalette.standard;

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

    return modPalette.standard;
}

export function formatModificationText(rawMods) {
    const mods = normalizeMods(rawMods);
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

export function hydrateModifications() {
    const config = rnaConfig[appState.currentRibo];

    appState.modifications.forEach((modification, index) => {
        modification.resi = Number(modification.resi);
        modification.chain = String(modification.chain || '');
        modification.status = String(modification.status || 'match').toLowerCase();
        modification.mods = normalizeMods(modification.mods);
        modification.ref_mods = normalizeMods(modification.ref_mods);
        modification.in_3d = Boolean(modification.in_3d);
        modification.confidence = modification.confidence ?? null;
        modification.frequency = normalizeFrequency(modification.frequency);
        modification.evidence = modification.evidence ?? null;
        modification.source = modification.source ?? null;
        modification.xref = modification.xref ?? null;
        modification.warnings = modification.warnings ?? null;

        const chainConfig = config.chains[modification.chain] || null;

        modification._index = index;
        modification._authChain = chainConfig ? chainConfig.auth : modification.chain;
        modification._structId = chainConfig ? chainConfig.struct : modification.chain;
        modification._isResolved = modification.in_3d;
        modification._center = null;
        modification._analyticPalette = getModificationColor(modification.mods);
        modification._statusPalette = getStatusColor(modification.status);
        modification._palette = resolveActivePalette(modification);
        modification._displayMod = modification.mods.length > 0
            ? formatModificationText(modification.mods)
            : (modification.ref_mods.length > 0
                ? `${formatModificationText(modification.ref_mods)} (ref)`
                : 'Unknown');
        modification._residueKey = buildResidueKey(modification.resi, modification._authChain);
        modification._labelPayload = buildLabelPayload(modification);
        modification._measurementSlot = buildMeasurementSlot(modification);
        modification._searchStr = `${modification.resi} ${modification._displayMod} ${modification.chain} ${modification.status}`.toLowerCase();
    });

    modificationsHydrationToken += 1;
}

export function applyColorModeToModifications(mode) {
    appState.colorMode = mode === 'global' ? 'global' : 'analytic';

    appState.modifications.forEach((modification) => {
        modification._palette = resolveActivePalette(modification);
        modification._labelPayload = buildLabelPayload(modification);
        modification._measurementSlot = buildMeasurementSlot(modification);
        
        // Synchronize the DOM node's left border if it exists
        if (modification._domNode) {
            modification._domNode.style.borderLeftColor = modification._palette ? modification._palette.hex : '#CCCCCC';
        }
    });

    modificationsHydrationToken += 1;
}

export function getModificationsHydrationToken() {
    return modificationsHydrationToken;
}
