import { appState } from '../state.js';

let onResidueSelected = null;
let onPairUnlink = null;

function getResidueKey(mod) {
    return `${mod['Positions in the Structure']}|${mod._authChain}`;
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

function getResidueNumber(mod) {
    const raw = mod['Positions in the Structure'];
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function isKnownModification(mod) {
    return mod['Knwon Positions Modifications'] === 'Y';
}

function getSortedModifications() {
    const sorted = [...appState.modifications];

    switch (appState.sortMode) {
        case 'resi-desc':
            sorted.sort((a, b) => getResidueNumber(b) - getResidueNumber(a));
            break;
        case 'chain-asc':
            sorted.sort((a, b) => {
                const chainCompare = String(a['Type Structure']).localeCompare(String(b['Type Structure']));
                if (chainCompare !== 0) return chainCompare;
                return getResidueNumber(a) - getResidueNumber(b);
            });
            break;
        case 'mod-first':
            sorted.sort((a, b) => {
                const knownDiff = Number(isKnownModification(b)) - Number(isKnownModification(a));
                if (knownDiff !== 0) return knownDiff;
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
        ? `${pair.distanceAngstrom.toFixed(2)} A`
        : 'Pending distance';

    item.innerHTML = `
        <div
            class="pair-split-bar"
            style="--pair-color-a:${pair.a.colorHex}; --pair-color-b:${pair.b.colorHex}"
        ></div>
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
        <div class="pair-meta">
            <span class="pair-distance">${distanceText}</span>
            <button class="unlink-pair-btn" type="button" data-pair-id="${pair.id}">Unlink</button>
        </div>
    `;

    return item;
}

export function refreshInteractionMarkers() {
    const context = {
        measureAKey: getMeasurementKey(appState.measurementDraft.first),
        measureBKey: getMeasurementKey(appState.measurementDraft.second),
        linkedResidueKeys: buildLinkedResidueKeySet()
    };

    appState.modifications.forEach((mod) => applyInteractionMarkersForItem(mod, context));
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

        const item = event.target.closest('li');
        if (!item || item.classList.contains('empty-msg') || item.classList.contains('li-absent') || item.classList.contains('li-linked-pair')) return;

        if (appState.selectedListItem) appState.selectedListItem.classList.remove('selected');
        item.classList.add('selected');
        appState.selectedListItem = item;

        const mod = appState.modifications[item.dataset.idx];
        if (!mod || !onResidueSelected) return;

        onResidueSelected(mod);
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

        if (mod._isResolved) {
            item.style.borderLeftColor = mod._palette.hex;
            item.innerHTML = `
                <span class="li-resi">${mod['Positions in the Structure']}</span>
                <span class="li-chain">${mod['Type Structure']}</span>
                <span class="li-mod" title="${mod._displayMod}">${mod._displayMod}</span>
            `;
        } else {
            item.classList.add('li-absent');
            item.innerHTML = `
                <span class="li-resi">${mod['Positions in the Structure']}</span>
                <span class="li-chain">${mod['Type Structure']}</span>
                <span class="li-absent-label">Not in 3D</span>
            `;
        }

        mod._domNode = item;
        applyInteractionMarkersForItem(mod);
        fragment.appendChild(item);
    });

    listElement.appendChild(fragment);
    applyFilters();
}

// Applies active search/type/unknown filters without rebuilding the full list.
export function applyFilters() {
    const showUnknown = document.getElementById('toggleUnknown').checked;
    let visibleCount = 0;

    appState.modifications.forEach((mod) => {
        let isVisible = true;

        if (!mod._isResolved && !showUnknown) isVisible = false;
        if (isVisible && appState.filterType !== 'all' && mod['Type Structure'] !== appState.filterType) isVisible = false;
        if (isVisible && appState.filterQuery && !mod._searchStr.includes(appState.filterQuery)) isVisible = false;

        if (isVisible) {
            mod._domNode.classList.remove('li-hidden');
            visibleCount += 1;
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
