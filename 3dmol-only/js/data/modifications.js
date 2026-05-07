import { modPalette, rnaConfig, statusPalette } from '../constants.js';
import { appState } from '../state.js';

let modificationsHydrationToken = 0;

const PER_MOD_PALETTE = [
    modPalette.varI,
    modPalette.varR,
    modPalette.varB,
    modPalette.varBR,
    modPalette.varIR,
    modPalette.complex,
    modPalette.hyper
];

const perModConfig = {
    active: false,
    legendRows: [],
    paletteMap: new Map()
};

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

export function buildResidueKey(residueNumber, authChain) {
    return `${residueNumber}|${authChain}`;
}

function normalizeFrequency(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.min(1, Math.max(0, parsed));
}

function normalizeMods(rawMods) {
    if (Array.isArray(rawMods)) return rawMods.map((item) => String(item).trim()).filter(Boolean);
    if (typeof rawMods === 'string') return rawMods.split(/[,/]/).map((item) => item.trim()).filter(Boolean);
    return [];
}

function normalizeModKey(rawMod) {
    const key = String(rawMod).trim().toLowerCase();
    if (key === '\u03c8' || key === 'psi') return 'psi';
    return key;
}

function isCountableModKey(key) {
    if (!key) return false;
    return key !== 'none' && key !== 'unknown' && key !== '?';
}

function formatSingleModLabel(rawMod) {
    return formatModificationText([rawMod]);
}

function formatCombinedModLabel(rawMods) {
    return rawMods
        .map((mod) => formatSingleModLabel(mod))
        .filter(Boolean)
        .join('+');
}

function buildComboKey(modKeys) {
    if (!Array.isArray(modKeys) || modKeys.length < 2) return null;
    return [...modKeys].sort((a, b) => a.localeCompare(b)).join('+');
}

function normalizeWarnings(rawWarnings) {
    if (Array.isArray(rawWarnings)) return rawWarnings.map((item) => String(item).trim()).filter(Boolean);
    if (typeof rawWarnings === 'string') {
        const trimmed = rawWarnings.trim();
        return trimmed ? [trimmed] : [];
    }
    return [];
}

function normalizeRequiredFields(modification, index) {
    const warnings = [];

    const rawResi = modification.resi;
    const parsedResi = Number(rawResi);
    if (!Number.isFinite(parsedResi)) {
        warnings.push('Missing/invalid "resi"; showing placeholder and skipping 3D mapping.');
        modification.resi = null;
        modification._displayResi = '—';
    } else {
        modification.resi = parsedResi;
        modification._displayResi = String(parsedResi);
    }

    const rawChain = modification.chain;
    if (rawChain === undefined || rawChain === null || String(rawChain).trim() === '') {
        warnings.push('Missing "chain"; defaulted to "unknown" for list display.');
        modification.chain = 'unknown';
    } else {
        modification.chain = String(rawChain).trim();
    }

    const rawStatus = modification.status;
    if (rawStatus === undefined || rawStatus === null || String(rawStatus).trim() === '') {
        warnings.push('Missing "status"; defaulted to "match" for coloring.');
        modification.status = 'match';
    } else {
        modification.status = String(rawStatus).trim().toLowerCase();
    }

    if (modification.in_3d === undefined || modification.in_3d === null) {
        warnings.push('Missing "in_3d"; defaulted to false (not resolved).');
        modification.in_3d = false;
    } else {
        modification.in_3d = Boolean(modification.in_3d);
    }

    if (!modification._displayResi) {
        modification._displayResi = modification.resi === null ? '—' : String(modification.resi);
    }

    if (warnings.length > 0) {
        const existing = normalizeWarnings(modification.warnings);
        modification.warnings = [...existing, ...warnings];
        modification._hasAutofillWarnings = true;
    } else {
        modification.warnings = normalizeWarnings(modification.warnings);
        modification._hasAutofillWarnings = false;
    }

    modification._index = index;
}

function getStatusColor(status) {
    if (status === 'match') return statusPalette.match;
    if (status === 'novel') return statusPalette.novel;
    if (status === 'missing') return statusPalette.missing;
    return statusPalette.fallback;
}

function resolveActivePalette(modification) {
    if (appState.colorMode === 'analytic') {
        if (perModConfig.active && modification._perModPalette) return modification._perModPalette;
        return modification._analyticPalette;
    }
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
    const uniqueLabelKeys = new Set();
    const labelByKey = new Map();

    appState.modifications.forEach((modification, index) => {
        normalizeRequiredFields(modification, index);
        modification.mods = normalizeMods(modification.mods);
        modification.ref_mods = normalizeMods(modification.ref_mods);
        modification.confidence = modification.confidence ?? null;
        modification.frequency = normalizeFrequency(modification.frequency);
        modification.evidence = modification.evidence ?? null;
        modification.source = modification.source ?? null;
        modification.xref = modification.xref ?? null;
        modification.warnings = modification.warnings.length > 0 ? modification.warnings : null;

        modification._modKeys = modification.mods.map(normalizeModKey).filter(isCountableModKey);
        modification._comboKey = buildComboKey(modification._modKeys);

        if (modification._modKeys.length === 1) {
            const key = modification._modKeys[0];
            uniqueLabelKeys.add(key);
            if (!labelByKey.has(key)) labelByKey.set(key, formatSingleModLabel(modification.mods[0]));
        }

        if (modification._comboKey) {
            uniqueLabelKeys.add(modification._comboKey);
            if (!labelByKey.has(modification._comboKey)) {
                labelByKey.set(modification._comboKey, formatCombinedModLabel(modification.mods));
            }
        }
    });

    perModConfig.active = uniqueLabelKeys.size > 0 && uniqueLabelKeys.size <= PER_MOD_PALETTE.length;
    perModConfig.legendRows = [];
    perModConfig.paletteMap = new Map();

    if (perModConfig.active) {
        const sortedKeys = Array.from(uniqueLabelKeys).sort((a, b) => a.localeCompare(b));

        sortedKeys.forEach((key, index) => {
            const palette = PER_MOD_PALETTE[index];
            perModConfig.paletteMap.set(key, palette);
            const rawLabel = labelByKey.get(key) || key;
            perModConfig.legendRows.push({
                label: formatSingleModLabel(rawLabel),
                color: palette.hex
            });
        });
    }

    appState.modifications.forEach((modification, index) => {
        const chainConfig = config.chains[modification.chain] || null;
        modification._authChain = chainConfig ? chainConfig.auth : modification.chain;
        modification._structId = chainConfig ? chainConfig.struct : modification.chain;
        modification._isResolved = modification.in_3d;
        modification._center = null;
        modification._analyticPalette = getModificationColor(modification.mods);
        modification._statusPalette = getStatusColor(modification.status);
        modification._perModPalette = null;

        if (perModConfig.active) {
            if (modification._comboKey) {
                modification._perModPalette = perModConfig.paletteMap.get(modification._comboKey) || null;
            } else if (modification._modKeys.length === 1) {
                const key = modification._modKeys[0];
                modification._perModPalette = perModConfig.paletteMap.get(key) || null;
            }
        }

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

export function getAnalyticLegendRows() {
    if (!perModConfig.active) return null;
    return perModConfig.legendRows.slice();
}
