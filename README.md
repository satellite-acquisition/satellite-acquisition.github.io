# LEOPT project website

Paper and project page for Bayesian Search MPC for Spacecraft Acquisition Under
Orbital Uncertainty. Project URL: <https://satellite-acquisition.github.io>.

```bash
python3 -m http.server 8080
```

Open <http://localhost:8080>. Edit `index.html` for paper links, citation, and
content; `styles.css` controls the layout. Kayhan validation results remain `XX`
until measured results are available.

**Launch console** opens `console/` in a separate window, with the dark theme
and LEOPT intro animation. Edit the mission, then select **Roll out**.
The JavaScript solvers implement BS-MPC, MPC without continuation, Bayesian
greedy, frozen-prior greedy, prior-ranked sweep, tube sweep, and sky raster.
The demo uses circular orbits, a two-dimensional angular detection model,
and rate- and acceleration-limited motion. Each contact has up to 32 six-second
stages; MPC uses a four-dwell horizon and 40 retained prefixes. Plans follow
the all-miss branch until a simulated confirmation ends the search.
The globe and entropy plot show the along-track marginal. That belief carries
between contacts; the cross-track prior is initialized anew for each contact.

This reduced example does not reproduce the SGP4 paper experiments or export
operational schedules. Run the full application from the
[LEOPT repository](https://github.com/satellite-acquisition/leopt).

```bash
node --check site.js
node scripts/check-site.mjs
node scripts/check-console.mjs
node scripts/check-solvers.mjs
```

GitHub Actions checks the site and deploys `main` to GitHub Pages. Select
**GitHub Actions** as the Pages source in the repository settings.

LEOPT is a separate research project from SPAR-MPC. Only the website styling
draws on the [SPAR-MPC project website](https://github.com/spar-mpc/spar-mpc.github.io);
its MIT notice is retained in [LICENSE](LICENSE). The paper, methods, figures,
results, and solver code are from LEOPT.
