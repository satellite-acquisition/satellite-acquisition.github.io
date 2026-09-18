"""Render the website figure from the paper's plotted coordinates.

Requires Matplotlib. Run from any directory; --preview writes a PNG as well.
"""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path, help="Optional PNG output path")
    args = parser.parse_args()

    figures = Path(__file__).resolve().parents[1] / "assets" / "figures"
    data = json.loads((figures / "uncertainty-data.json").read_text())
    points = data["points"]

    plt.rcParams.update({
        "font.family": ["Arial", "DejaVu Sans", "sans-serif"],
        "font.size": 12,
        "text.color": "#454545",
        "axes.labelcolor": "#454545",
        "xtick.color": "#666666",
        "ytick.color": "#666666",
        "svg.fonttype": "none",
        "svg.hashsalt": "leopt-uncertainty",
    })
    fig, axis = plt.subplots(figsize=(9, 4.6))
    fig.subplots_adjust(left=0.115, right=0.98, bottom=0.16, top=0.96)

    axis.scatter(*zip(*points), s=23, alpha=0.58, color="#29668d",
                 edgecolors="none", zorder=3)

    axis.set(xlim=(-15, 32), ylim=(-10, 10),
             xticks=(-10, 0, 10, 20, 30), yticks=(-10, 0, 10),
             xlabel="Along the track (°)", ylabel="Across the track (°)")
    axis.set_aspect("equal", adjustable="box")
    axis.xaxis.labelpad = 10
    axis.yaxis.labelpad = 10
    axis.set_axisbelow(True)
    axis.grid(color="#ededed", linewidth=0.7)
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["left", "bottom"]].set_color("#c7c7c7")
    axis.tick_params(length=0, pad=7)

    svg_path = figures / "uncertainty-tube.svg"
    fig.savefig(svg_path, metadata={
        "Date": None,
        "Title": "Orbital uncertainty during one simulated pass",
        "Description": "Particle belief with 160 possible spacecraft directions "
                       "shown on equally scaled angular axes. Coordinates "
                       "recovered from the paper figure; see uncertainty-data.json.",
    })
    svg_path.write_text("\n".join(line.rstrip() for line in svg_path.read_text().splitlines()) + "\n")
    if args.preview:
        fig.savefig(args.preview, dpi=140)
    plt.close(fig)


if __name__ == "__main__":
    main()
