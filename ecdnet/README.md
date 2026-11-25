# ECDNet project page

Static site for https://lht-research.github.io/ecdnet/. GitHub Pages publishes the repository root. There is no build step and no external request: fonts, scripts, and data are served from `assets/`.

- `index.html`: page content.
- `assets/site.css`, `assets/site.js`: styles, the interactive comparison, and the charts.
- `assets/explorer-data.js`: spectrum maps at 3.5 GHz of one demonstration scene (one transmitter, three obstacles) along nine routes, ECDNet with the first 41 readings and U-Net with the first 164 readings, quantized to 8 bits over -85 to -25 dBm.
- `assets/chart-data.js`: Table II of the paper and the nine-route results on 120 held-out scenes.
- `assets/fonts/`: TeX Gyre Termes (GUST Font License) and Source Sans 3 (SIL Open Font License), subset to Latin.
- `assets/framework.png`, `assets/prototype.png`, `assets/field.jpg`: figures from the paper.

The Paper button is hidden until the arXiv announcement. To show it, set the `href` of `#paper-link` in `index.html` and remove the `hidden` attribute from its list item.

To preview locally, run `python3 -m http.server 8000` in this folder and open http://localhost:8000.
