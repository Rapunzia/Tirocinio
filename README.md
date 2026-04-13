# Modifications Map

Modifications Map is the frontend prototype of a thesis project focused on molecular visualization for RNA-related research workflows.

The long-term goal is to provide a web application where researchers upload a FASTA sequence, a backend service processes and annotates that sequence, and the frontend viewer presents an interactive structural visualization with fast, publication-ready snapshot export.

At this stage, this repository covers the visualization layer only.

## Project Scope

In scope (this repository):
- Interactive molecular viewer UI.
- Structural rendering and residue highlighting.
- Visualization controls (filters, labeling, measurement, opacity, engine switching).
- Snapshot/export workflows for figure preparation.

Out of scope (external/backend work):
- FASTA parsing and biological sequence processing.
- Annotation pipelines and prediction logic.
- Storage, authentication, and data services.

## Current Capabilities

- Multi-engine rendering benchmark and comparison:
  - 3Dmol.js
  - Mol*
  - JSmol
  - NGL Viewer
- Residue list with search, filtering, sorting, and interaction modes.
- Manual labels and residue-to-residue distance linking (3Dmol-focused interaction features).
- Configurable coloring for structural chains and modification domains.
- Fast UI interactions with reduced redraw overhead for smoother exploration.
- Snapshot support designed for paper-ready figures.

## Target Workflow (Thesis Direction)

1. Researcher uploads FASTA input.
2. Backend processes sequence and produces annotated output.
3. Frontend loads structural and annotation data.
4. Researcher explores, compares, measures, labels, and exports publication-quality views.

This repository currently implements steps 3 and 4.

## Input Data (Current Prototype)

The app currently uses:
- A structure file (example: `4v6x.cif`).
- A JSON file describing residue-level modifications.

Example JSON entry format:

```json
[
  {
    "Positions in the Structure": 119,
    "Type Structure": "28S",
    "Knwon Positions Modifications": "Y",
    "Possible Modifications": "mC"
  },
  {
    "Positions in the Structure": 2250,
    "Type Structure": "28S",
    "Knwon Positions Modifications": "Y",
    "Possible Modifications": ["m5C", "Cm"]
  }
]
```

## Tech Stack

- Vanilla JavaScript (ES modules)
- HTML5
- CSS3
- 3Dmol.js
- PDBe Mol*
- JSmol
- NGL Viewer

No build system is required for the current prototype.

## Running Locally

Because browsers block some local file fetch operations, run the project through a local static server.

Example:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Notes for Collaborators

- The codebase is modularized by concern (`data`, `ui`, `viewers`, `state`, bootstrap wiring).
- Backend integration points are intentionally separated from visualization logic to support future FASTA pipeline integration.
- The current priority is frontend reliability, performance, and reproducible figure generation for research outputs.
