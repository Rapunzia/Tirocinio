// Central mutable state shared by all modules.
// Keeping state in one place avoids implicit globals and clarifies ownership.
export const appState = {
    currentRibo: '4v6x',
    colorMode: 'analytic',
    structureDataText: null,
    modifications: [],
    currentOpacity: 0.85,
    selectedListItem: null,

    ui: {
        activePanel: null,
        isLoadOverlayOpen: true,
        isHelpOpen: false
    },

    viewer3Dmol: null,

    filterQuery: '',
    filterType: 'all',
    sortMode: 'resi-asc',
    filterDebounceId: null,

    manualLabels: new Map(),
    measurementDraft: {
        first: null,
        second: null
    },
    measurementPairs: [],
    measurementPairCounter: 0,

    progressTimer: null
};
