// Central mutable state shared by all modules.
// Keeping state in one place avoids implicit globals and clarifies ownership.
export const appState = {
    currentRibo: '4v6x',
    colorMode: 'analytic',
    availableColorModes: ['analytic', 'global', 'database'],
    structureDataText: null,
    modifications: [],
    currentOpacity: 0.7,
    selectedListItem: null,
    statusOverlayEnabled: false,
    isolateUnknownEnabled: false,
    isolateCustomEnabled: false,
    isPositionalOnly: false,

    ui: {
        activePanel: null,
        isLoadOverlayOpen: true,
        isHelpOpen: false
    },

    viewer3Dmol: null,

    filterQuery: '',
    filterType: 'all',
    sortMode: 'mod-first',
    filterDebounceId: null,

    manualLabels: new Map(),
    customColors: new Map(),
    customStyles: new Map(),
    customNotes: new Map(),
    measurementDraft: {
        first: null,
        second: null
    },
    measurementPairs: [],
    measurementPairCounter: 0,

    progressTimer: null
};
