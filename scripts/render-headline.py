"""Build the website panels from the paper's original photographs.

Requires pdfLaTeX, Poppler, and cwebp. Pass the paper's headline directory,
which contains references/launch.jpg, cubesat.jpg, and antenna.jpg.
"""

import argparse
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--preview", type=Path, help="Keep PDF and PNG previews here")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    destination = root / "assets" / "figures"

    for program in ("pdflatex", "pdftoppm", "cwebp"):
        if not shutil.which(program):
            parser.error(f"Missing required program: {program}")
    with tempfile.TemporaryDirectory(prefix="leopt-headline-") as temporary:
        work = Path(temporary)
        photos = work / "photos"
        photos.mkdir()
        for name in ("launch", "cubesat", "antenna"):
            shutil.copyfile(args.source / "references" / f"{name}.jpg", photos / f"{name}.jpg")
        shutil.copyfile(root / "scripts" / "headline-web.tex", work / "headline-web.tex")
        for panel, name in enumerate(("launch", "uncertainty", "acquisition"), start=1):
            stem = f"headline-{name}"
            command = ["pdflatex", "-interaction=nonstopmode", "-halt-on-error",
                       "-no-shell-escape", f"-jobname={stem}",
                       rf"\def\panel{{{panel}}}\def\photodir{{photos}}\input{{headline-web.tex}}"]
            build = subprocess.run(command, cwd=work, capture_output=True, text=True)
            if build.returncode:
                raise RuntimeError(build.stdout + build.stderr)
            subprocess.run(["pdftoppm", "-singlefile", "-r", "360", "-png",
                            f"{stem}.pdf", stem], cwd=work, check=True, capture_output=True)
            subprocess.run(["cwebp", "-quiet", "-q", "88", "-m", "6",
                            f"{stem}.png", "-o", str(destination / f"{stem}.webp")],
                           cwd=work, check=True)
            if args.preview:
                args.preview.mkdir(parents=True, exist_ok=True)
                for extension in ("pdf", "png"):
                    shutil.copyfile(work / f"{stem}.{extension}", args.preview / f"{stem}.{extension}")
            print(f"Built {stem}.webp")


if __name__ == "__main__":
    main()
