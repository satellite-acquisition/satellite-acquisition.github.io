"""Render the website figure from the paper's plotted coordinates.

Requires Matplotlib. Run from any directory; --preview writes a PNG as well.
"""

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview", type=Path, help="Optional PNG output path")
    args = parser.parse_args()

    figures = Path(__file__).resolve().parents[1] / "assets" / "figures"
    data = json.loads((figures / "uncertainty-data.json").read_text())
    points = data["points"]
    cells = data["cells"]
    bounds = data["rasterExtent"]

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
    fig.subplots_adjust(left=0.115, right=0.98, bottom=0.16, top=0.86)

    axis.add_patch(Rectangle(
        (bounds["xMin"], bounds["yMin"]),
        bounds["xMax"] - bounds["xMin"],
        bounds["yMax"] - bounds["yMin"],
        fill=False, edgecolor="#8b8b8b", linewidth=1.2,
        linestyle=(0, (5, 4)), zorder=2,
    ))
    axis.text(bounds["xMax"] - 1.5, bounds["yMax"] - 5,
              "Full-area scan", ha="right", va="top", color="#666666")
    axis.scatter(*zip(*points), s=23, alpha=0.58, color="#29668d",
                 edgecolors="none", label="Possible spacecraft directions", zorder=4)
    axis.scatter(*zip(*cells), marker="|", s=190, linewidths=1.5,
                 color="#b27e28", label="Pointings along the track", zorder=3)

    axis.set(xlim=(-30, 34), ylim=(-32, 32),
             xticks=(-20, 0, 20), yticks=(-20, 0, 20),
             xlabel="Along the track (°)", ylabel="Across the track (°)")
    axis.xaxis.labelpad = 10
    axis.yaxis.labelpad = 10
    axis.set_axisbelow(True)
    axis.grid(color="#ededed", linewidth=0.7)
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["left", "bottom"]].set_color("#c7c7c7")
    axis.tick_params(length=0, pad=7)
    axis.legend(loc="lower center", bbox_to_anchor=(0.5, 1.035),
                ncol=2, frameon=False, handletextpad=0.5, columnspacing=1.5)

    fig.savefig(figures / "uncertainty-tube.svg", metadata={
        "Date": None,
        "Title": "Orbital uncertainty during one simulated pass",
        "Description": "160 possible spacecraft directions, 17 along-track "
                       "pointings, and the full-area scan extent. Coordinates "
                       "recovered from the paper figure; see uncertainty-data.json.",
    })
    if args.preview:
        fig.savefig(args.preview, dpi=140)
    plt.close(fig)


if __name__ == "__main__":
    main()
