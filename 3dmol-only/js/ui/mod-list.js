import { appState } from '../state.js';

let onResidueSelected = null;
let onPairUnlink = null;
let onMeasurementPairSelected = null;
let pendingResidueSelectionTimerId = null;
let pendingResidueSelectionMod = null;

let residueModByKey = new Map();
let previousMarkerState = null;

function scheduleResidueSelection(mod, source = 'list') {
    pendingResidueSelectionMod = mod;
    if (pendingResidueSelectionTimerId) return;

    pendingResidueSelectionTimerId = setTimeout(() => {
        pendingResidueSelectionTimerId = null;
        const nextMod = pendingResidueSelectionMod;
        pendingResidueSelectionMod = null;
        if (!nextMod || !onResidueSelected) return;
        onResidueSelected(nextMod, source);
    }, 0);
}

function getResidueKey(mod) {
    return `${mod.resi}|${mod._authChain}`;
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function hasMetadata(mod) {
    return Boolean(
        (Array.isArray(mod.ref_mods) && mod.ref_mods.length > 0)
        || mod.confidence !== null
        || mod.frequency !== null
        || mod.evidence
        || mod.source
        || mod.xref
        || mod.warnings
    );
}

function formatMetadataValue(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function buildMetadataRow(label, rawValue) {
    const value = formatMetadataValue(rawValue).trim();
    if (!value) return '';
    return `<div class="li-meta-row"><span class="li-meta-key">${escapeHtml(label)}</span><span class="li-meta-val">${escapeHtml(value)}</span></div>`;
}

function buildMetadataMarkup(mod) {
    const evidenceSource = [mod.evidence, mod.source].filter(Boolean).join(' / ');
    const rows = [
        buildMetadataRow('ref_mods', mod.ref_mods),
        buildMetadataRow('confidence', mod.confidence),
        buildMetadataRow('frequency', mod.frequency !== null ? mod.frequency.toFixed(3) : null),
        buildMetadataRow('evidence/source', evidenceSource),
        buildMetadataRow('xref', mod.xref),
        buildMetadataRow('warnings', mod.warnings)
    ].filter(Boolean);

    if (!mod._isResolved) {
        rows.push('<div class="li-meta-row" style="grid-column: 1 / -1; color: var(--danger); font-weight: 600; padding-top: 4px;">Residue not resolved in 3D</div>');
    }

    if (rows.length === 0) return '';
    return `<div class="li-meta">\n${rows.join('')}\n</div>`;
}

function collapseAllExpandedItems(listElement) {
    listElement.querySelectorAll('.li-expanded').forEach((node) => node.classList.remove('li-expanded'));
}

function getMeasurementKey(slot) {
    if (!slot) return null;
    return `${slot.residue}|${slot.authChain}`;
}

function buildLinkedResidueKeySet() {
    const linkedKeys = new Set();
    appState.measurementPairs.forEach((pair) => {
        linkedKeys.add(`${pair.a.residue}|${pair.a.authChain}`);
        linkedKeys.add(`${pair.b.residue}|${pair.b.authChain}`);
    });
    return linkedKeys;
}

function buildManualLabelKeySet() {
    return new Set(appState.manualLabels.keys());
}

function addMaybe(set, value) {
    if (value) set.add(value);
}

function addSymmetricDiff(target, previousSet, nextSet) {
    previousSet.forEach((value) => {
        if (!nextSet.has(value)) target.add(value);
    });

    nextSet.forEach((value) => {
        if (!previousSet.has(value)) target.add(value);
    });
}

function rebuildResidueModIndex() {
    residueModByKey = new Map();

    appState.modifications.forEach((mod) => {
        if (!mod || !mod._domNode) return;
        residueModByKey.set(getResidueKey(mod), mod);
    });
}

function snapshotMarkerState() {
    return {
        measureAKey: getMeasurementKey(appState.measurementDraft.first),
        measureBKey: getMeasurementKey(appState.measurementDraft.second),
        linkedResidueKeys: buildLinkedResidueKeySet(),
        manualLabelKeys: buildManualLabelKeySet()
    };
}

function resetMarkerStateCache() {
    previousMarkerState = null;
}

function getResidueNumber(mod) {
    const raw = mod.resi;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function getStatusRank(status) {
    if (status === 'match') return 0;
    if (status === 'novel') return 1;
    if (status === 'missing') return 2;
    return 3;
}

function getSortedModifications() {
    const sorted = [...appState.modifications];

    switch (appState.sortMode) {
        case 'resi-desc':
            sorted.sort((a, b) => getResidueNumber(b) - getResidueNumber(a));
            break;
        case 'chain-asc':
            sorted.sort((a, b) => {
                const chainCompare = String(a.chain).localeCompare(String(b.chain));
                if (chainCompare !== 0) return chainCompare;
                return getResidueNumber(a) - getResidueNumber(b);
            });
            break;
        case 'mod-first':
            sorted.sort((a, b) => {
                const statusDiff = getStatusRank(a.status) - getStatusRank(b.status);
                if (statusDiff !== 0) return statusDiff;
                return getResidueNumber(a) - getResidueNumber(b);
            });
            break;
        case 'resi-asc':
        default:
            sorted.sort((a, b) => getResidueNumber(a) - getResidueNumber(b));
            break;
    }

    return sorted;
}

function applyInteractionMarkersForItem(mod, context = null) {
    if (!mod._domNode) return;

    const residueKey = getResidueKey(mod);
    const measureAKey = context?.measureAKey ?? getMeasurementKey(appState.measurementDraft.first);
    const measureBKey = context?.measureBKey ?? getMeasurementKey(appState.measurementDraft.second);
    const linkedResidueKeys = context?.linkedResidueKeys ?? buildLinkedResidueKeySet();
    const isLinkedTarget = linkedResidueKeys.has(residueKey);

    mod._domNode.classList.toggle('li-labeled', appState.manualLabels.has(residueKey));
    mod._domNode.classList.toggle('li-measure-a', residueKey === measureAKey);
    mod._domNode.classList.toggle('li-measure-b', residueKey === measureBKey);
    mod._domNode.classList.toggle('li-linked-target', isLinkedTarget);
}

function createLinkedPairNode(pair) {
    const item = document.createElement('li');
    item.className = 'li-linked-pair';
    item.dataset.pairId = String(pair.id);

    const distanceText = typeof pair.distanceAngstrom === 'number'
        ? `${pair.distanceAngstrom.toFixed(2)} Å`
        : 'Pending distance';

    item.innerHTML = `
        <div class="pair-meta">
            <span class="pair-distance">${distanceText}</span>
            <button class="unlink-pair-btn" type="button" data-pair-id="${pair.id}" aria-label="Unlink pair">
                &times;
            </button>
        </div>
        <div class="pair-half pair-half-a" style="--pair-color:${pair.a.colorHex}">
            <span class="pair-resi">${pair.a.residue}</span>
            <span class="pair-chain">${pair.a.type}</span>
            <span class="pair-mod" title="${pair.a.display}">${pair.a.display}</span>
        </div>
        <div class="pair-half pair-half-b" style="--pair-color:${pair.b.colorHex}">
            <span class="pair-resi">${pair.b.residue}</span>
            <span class="pair-chain">${pair.b.type}</span>
            <span class="pair-mod" title="${pair.b.display}">${pair.b.display}</span>
        </div>
    `;

    return item;
}

function getModListElement() {
    return document.getElementById('modList');
}

function removeStaticEmptyMessageIfPresent(listElement) {
    const first = listElement.firstElementChild;
    if (first && first.classList.contains('empty-msg') && !first.id) {
        first.remove();
    }
}

export function prependMeasurementPairNode(pair) {
    if (!pair) return;

    const listElement = getModListElement();
    if (!listElement) return;

    removeStaticEmptyMessageIfPresent(listElement);
    listElement.insertBefore(createLinkedPairNode(pair), listElement.firstChild);
}

export function removeMeasurementPairNode(pairId) {
    const listElement = getModListElement();
    if (!listElement) return;

    const pairNode = listElement.querySelector(`.li-linked-pair[data-pair-id="${pairId}"]`);
    if (!pairNode) return;
    pairNode.remove();

    if (appState.modifications.length === 0 && appState.measurementPairs.length === 0) {
        listElement.innerHTML = '<li class="empty-msg">Load files to see residues...</li>';
        document.getElementById('residueCount').textContent = '\u2014';
    }
}

export function refreshInteractionMarkers() {
    const nextState = snapshotMarkerState();

    if (!previousMarkerState || residueModByKey.size === 0) {
        appState.modifications.forEach((mod) => applyInteractionMarkersForItem(mod, nextState));
        previousMarkerState = nextState;
        return;
    }

    const changedResidueKeys = new Set();

    addMaybe(changedResidueKeys, previousMarkerState.measureAKey);
    addMaybe(changedResidueKeys, previousMarkerState.measureBKey);
    addMaybe(changedResidueKeys, nextState.measureAKey);
    addMaybe(changedResidueKeys, nextState.measureBKey);

    addSymmetricDiff(changedResidueKeys, previousMarkerState.linkedResidueKeys, nextState.linkedResidueKeys);
    addSymmetricDiff(changedResidueKeys, previousMarkerState.manualLabelKeys, nextState.manualLabelKeys);

    changedResidueKeys.forEach((key) => {
        const mod = residueModByKey.get(key);
        if (!mod) return;
        applyInteractionMarkersForItem(mod, nextState);
    });

    previousMarkerState = nextState;
}

// Registers one delegated click handler for residue cards.
export function initModListSelectionHandler(selectionCallback) {
    onResidueSelected = selectionCallback;

    document.getElementById('modList').addEventListener('click', (event) => {
        const unlinkButton = event.target.closest('.unlink-pair-btn');
        if (unlinkButton) {
            const pairId = Number(unlinkButton.dataset.pairId);
            if (onPairUnlink && Number.isFinite(pairId)) onPairUnlink(pairId);
            return;
        }

        const linkedPairItem = event.target.closest('.li-linked-pair');
        if (linkedPairItem) {
            const pairId = Number(linkedPairItem.dataset.pairId);
            const pair = appState.measurementPairs.find((entry) => entry.id === pairId);
            if (pair && onMeasurementPairSelected) onMeasurementPairSelected(pair);
            return;
        }

        const item = event.target.closest('li');
        if (!item || item.classList.contains('empty-msg') || item.classList.contains('li-linked-pair')) return;

        const listElement = document.getElementById('modList');
        const shouldExpand = !item.classList.contains('li-expanded');
        collapseAllExpandedItems(listElement);
        if (shouldExpand) item.classList.add('li-expanded');

        if (appState.selectedListItem) appState.selectedListItem.classList.remove('selected');
        item.classList.add('selected');
        appState.selectedListItem = item;

        const mod = appState.modifications[item.dataset.idx];
        if (!mod || !onResidueSelected) return;

        if (mod._isResolved) {
            scheduleResidueSelection(mod, 'list');
        }
    });
}

// Rebuilds the residue list markup from the hydrated modification objects.
export function generateDOMList() {
    const listElement = document.getElementById('modList');
    listElement.innerHTML = '';

    const fragment = document.createDocumentFragment();

    appState.measurementPairs.forEach((pair) => {
        fragment.appendChild(createLinkedPairNode(pair));
    });

    if (appState.modifications.length === 0 && appState.measurementPairs.length === 0) {
        listElement.innerHTML = '<li class="empty-msg">Load files to see residues...</li>';
        document.getElementById('residueCount').textContent = '\u2014';
        return;
    }

    getSortedModifications().forEach((mod) => {
        const item = document.createElement('li');
        item.dataset.idx = mod._index;
        item.style.borderLeftColor = mod._palette ? mod._palette.hex : '#CCCCCC';

        const metadataMarkup = buildMetadataMarkup(mod);

        if (!mod._isResolved) {
            item.classList.add('li-absent');
        }

        item.innerHTML = `
            <span class="li-resi">${mod._displayResi}</span>
            <span class="li-chain">${mod.chain}</span>
            <span class="li-mod" title="${mod._displayMod}">${mod._displayMod}</span>
            ${metadataMarkup}
        `;

        mod._domNode = item;
        applyInteractionMarkersForItem(mod);
        fragment.appendChild(item);
    });

    listElement.appendChild(fragment);
    rebuildResidueModIndex();
    resetMarkerStateCache();
    applyFilters();
}

// Applies active search/type filters without rebuilding the full list.
export function applyFilters() {
    let visibleCount = 0;

    appState.modifications.forEach((mod) => {
        const typeMatch = appState.filterType === 'all' || mod.chain === appState.filterType;
        const queryMatch = !appState.filterQuery || mod._searchStr.includes(appState.filterQuery);

        if (typeMatch && queryMatch) {
            mod._domNode.classList.remove('li-hidden');
            visibleCount++;
        } else {
            mod._domNode.classList.add('li-hidden');
        }
    });

    document.getElementById('residueCount').textContent = visibleCount;

    let emptyMessage = document.getElementById('emptyMsg');
    if (visibleCount === 0) {
        if (!emptyMessage) {
            emptyMessage = document.createElement('li');
            emptyMessage.id = 'emptyMsg';
            emptyMessage.className = 'empty-msg';
            emptyMessage.textContent = 'No residues match filter.';
            document.getElementById('modList').appendChild(emptyMessage);
        } else {
            emptyMessage.style.display = 'block';
        }
    } else if (emptyMessage) {
        emptyMessage.style.display = 'none';
    }
}

export function setFilterQuery(query) {
    appState.filterQuery = query.trim().toLowerCase();
}

export function setFilterType(type) {
    appState.filterType = type;
}

export function setSortMode(mode) {
    appState.sortMode = mode;
}

export function setMeasurementPairUnlinkHandler(handler) {
    onPairUnlink = handler;
}

export function setMeasurementPairSelectionHandler(handler) {
    onMeasurementPairSelected = handler;
}
