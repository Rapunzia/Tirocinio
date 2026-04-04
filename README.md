# 🧬 Modifications Map - 3D rRNA Viewer Benchmark

**Modifications Map** is an interactive, high-performance web platform designed for the 3D visualization and analysis of post-transcriptional modifications on ribosomal RNA (rRNA). 

The tool also serves as a **benchmarking** environment, allowing real-time comparison of performance and graphical rendering across the four main WebGL-based molecular rendering engines: **3Dmol.js**, **Mol\***, **JSmol**, and **NGL Viewer**.

---

## ✨ Main Features

* **Multi-Engine Rendering:** Instantly switch between 3Dmol.js, Mol*, JSmol, and NGL Viewer while maintaining the same structural context and applied data.
* **Intelligent Structural Coloring:** Automatic recognition and coloring of rRNA backbones (e.g., 28S in dark grey, 18S in light grey, 5.8S in yellow, 5S in blue, tRNA in green).
* **Dynamic Modifications Parsing:** Custom algorithm capable of interpreting complex modification lists (e.g., `m6A`, `Am`, `Psi`, `acp3U`) and categorizing them biochemically into domains (Base, Ribose, Isomerization, Complex).
* **Colorblind-Safe Palette:** Uses a vibrant, high-contrast palette (inspired by Okabe-Ito) optimized for readability on 3D models and fully accessible to users with color vision deficiencies.
* **Modern UI:** Floating and collapsible legend, interactive sidebar to center the camera on specific residues (with dynamic sphere highlighting), and automatic scientific typographic formatting (e.g., m^6A correctly rendered with real superscripts).
* **Ultra-High Performance:** * **Graphics Batching:** WebGL engine calls are minimized by grouping residues by color, allowing the simultaneous visualization of thousands of spheres at a solid 60 FPS without camera rotation lag.
    * **Asynchronous Debouncing:** Global opacity calculation leverages `requestAnimationFrame` to ensure smooth transitions without event flooding during slider drag.

---

## 🛠 Technologies Used

The application is built entirely in **Vanilla JavaScript**, HTML5, and CSS3, ensuring maximum lightness and zero build dependencies (no npm, webpack, or JS frameworks required).

**Integrated Molecular Libraries:**
* [`3Dmol.js`](https://3dmol.csb.pitt.edu/) (v2.0.4)
* [`PDBe Mol*`](https://molstar.org/) (v3.2.0)
* [`JSmol`](http://jmol.sourceforge.net/) (HTML5 version)
* [`NGL Viewer`](http://nglviewer.org/) (v2.3.0)

---

## 🎨 Color Logic and Biochemical Domains

The engine assigns colors not to the single textual annotation, but to the **biochemical impact** of the modification. It properly handles hyper-variable sites (multiple possible modifications on the same residue):

| Domain | Description | UI Color | Examples |
| :--- | :--- | :--- | :--- |
| **Domain I** | Isomerization | Neon Green | `Ψ`, `Psi`, `Y` |
| **Domain R** | Sugar (2'-O) Methylation | Electric Blue | `Am`, `Cm`, `Gm`, `Um` |
| **Domain B** | Base Methylation | Bright Red | `m6A`, `m5C`, `m7G`, `m22G` |
| **Mix B+R** | Base + Ribose | Fuchsia / Purple | `m5Cm`, array: `["m6A", "Am"]` |
| **Mix I+R** | Isomerization + Ribose | Cyan | `Ψm`, array: `["Psi", "Um"]` |
| **Complex** | Mod. with high steric hindrance | Orange | `ac4C`, `acp3U`, `D` |
| **Hyper-Variable**| Intersection of 3+ domains | Pure Black | Array: `["m1A", "acp3U", "Psi"]` |
| **Unknown** | Missing or uncertain data | Yellow | `unknown`, `?`, `none` |

---

## 📥 Data Format (JSON Input)

The application accepts JSON files structured as an array of objects. Each object must describe a single residue. The `Possible Modifications` field accepts single strings, comma-separated strings, or arrays.

**Example of a valid JSON:**
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
  },
  {
    "Positions in the Structure": 110,
    "Type Structure": "5S",
    "Knwon Positions Modifications": "N",
    "Possible Modifications": "unknown"
  }
]