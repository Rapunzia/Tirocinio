// Color palette used to classify and render modification domains.
export const modPalette = {
    standard: { hex: '#CCCCCC', rgb: { r: 204, g: 204, b: 204 } },
    varI: { hex: '#f28200', rgb: { r: 242, g: 130, b: 0 } },       
    varR: { hex: '#ffdb28', rgb: { r: 255, g: 219, b: 40 } },      
    varB: { hex: '#00e1da', rgb: { r: 0, g: 225, b: 218 } },      
    varBR: { hex: '#007bd8', rgb: { r: 0, g: 123, b: 216 } },     
    varIR: { hex: '#8f2be7', rgb: { r: 143, g: 43, b: 231 } },     
    complex: { hex: '#fb4fd9', rgb: { r: 251, g: 79, b: 217 } },      
    hyper: { hex: '#000075', rgb: { r: 0, g: 0, b: 117 } },      
    unannotated: { hex: '#A9A9A9', rgb: { r: 169, g: 169, b: 169 } } 
};

export const statusPalette = {
    match: { hex: '#1fb819', rgb: { r: 31, g: 184, b: 25 } },
    novel: { hex: '#e9162d', rgb: { r: 233, g: 22, b: 45 } },
    missing: { hex: '#fca5a5', rgb: { r: 252, g: 165, b: 165 } },
    fallback: { hex: '#9ca3af', rgb: { r: 156, g: 163, b: 175 } }
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
