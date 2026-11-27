# ECDNet project page

Static site for https://lht-research.github.io/ecdnet/. GitHub Pages publishes the repository root. There is no external request. Fonts, scripts, and data are served from `assets/`.

- `index.html`: page content.
- `assets/site.css`, `assets/site.js`: styles, the closed-loop explorer, and the charts.
- `assets/explorer-data.js`: closed-loop spectrum map construction by ECDNet on three demonstration scenes, four bands, quantized to 8 bits over the range from -85 to -25 dBm.
- `assets/chart-data.js`: Table II of the paper.
- `assets/fonts/`: TeX Gyre Termes (GUST Font License) and Source Sans 3 (SIL Open Font License), subset to Latin.
- `assets/framework.png`, `assets/prototype.png`, `assets/field.jpg`: figures from the paper.

To preview locally, run `python3 -m http.server 8000` in this folder and open http://localhost:8000.
