// Central mutable state shared by all modules.
// Keeping state in one place avoids implicit globals and clarifies ownership.
export const appState = {
    currentEngine: '3dmol',
    currentRibo: '4v6x',
    structureDataText: null,
    modifications: [],
    currentOpacity: 0.85,
    selectedListItem: null,

    viewer3Dmol: null,
    viewerMolstar: null,
    viewerNgl: null,
    nglComponent: null,

    residueCache: null,

    filterQuery: '',
    filterType: 'all',
    sortMode: 'resi-asc',
    interactionMode: 'navigate',
    filterDebounceId: null,

    manualLabels: new Map(),
    measurementDraft: {
        first: null,
        second: null
    },
    measurementPairs: [],
    measurementPairCounter: 0,

    progressTimer: null,
    molstarBlobUrl: null
};
