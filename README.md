# LEOPT project website

Paper and project page for Bayesian Search MPC for Spacecraft Acquisition Under
Orbital Uncertainty. Published at <https://satellite-acquisition.github.io>.

```bash
python3 -m http.server 8080
```

Open <http://localhost:8080>. Edit `index.html` for paper links, citation, and
content; `styles.css` controls the layout. The arXiv link is marked forthcoming.

```bash
node --check site.js
node scripts/check-site.mjs
```

GitHub Actions checks the site and deploys `main` to GitHub Pages. Select
**GitHub Actions** as the Pages source in the repository settings.

Layout adapted from [SPAR-MPC](https://github.com/spar-mpc/spar-mpc.github.io)
under the [MIT License](LICENSE). The reported values and figures come from the
project's synthetic deployment benchmark.
