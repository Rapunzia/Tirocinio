// Color palette used to classify and render modification domains.
export const modPalette = {
    standard: { hex: '#CCCCCC', rgb: { r: 204, g: 204, b: 204 } },
    varI: { hex: '#00E676', rgb: { r: 0, g: 230, b: 118 } },
    varR: { hex: '#2979FF', rgb: { r: 41, g: 121, b: 255 } },
    varB: { hex: '#FF1744', rgb: { r: 255, g: 23, b: 68 } },
    varBR: { hex: '#D500F9', rgb: { r: 213, g: 0, b: 249 } },
    varIR: { hex: '#00E5FF', rgb: { r: 0, g: 229, b: 255 } },
    complex: { hex: '#FF9100', rgb: { r: 255, g: 145, b: 0 } },
    hyper: { hex: '#222222', rgb: { r: 34, g: 34, b: 34 } },
    unknown: { hex: '#FFEA00', rgb: { r: 255, g: 234, b: 0 } }
};

// Structure-level configuration for each supported ribosome dataset.
export const rnaConfig = {
    '4v6x': {
        file: '4v6x.cif',
        chains: {
            '28S': { struct: 'IC', auth: 'A5', defaultColor: '#555555' },
            '18S': { struct: 'JA', auth: 'B2', defaultColor: '#E6E6E6' },
            '5.8S': { struct: 'KC', auth: 'A8', defaultColor: '#FFD700' },
            '5S': { struct: 'JC', auth: 'A7', defaultColor: '#4169E1' },
            'tRNA': { struct: 'KA', auth: 'BC', defaultColor: '#90EE90' }
        }
    }
};

export const supportedEngines = ['3dmol', 'molstar', 'jsmol', 'ngl'];
