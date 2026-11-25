"""
publish_demo.py - publish demo/ to the gh-pages branch (GitHub Pages)
=====================================================================
Pushes the contents of demo/ as the root of an orphan branch "gh-pages", which GitHub Pages serves at
https://<user>.github.io/<repo>/ . Only demo/ is published: the portal, its data and the forecast engine stay off
the public site. Nothing in the working tree is touched (the branch is built in a temporary clone).

    python scripts/publish_demo.py                 build and push gh-pages
    python scripts/publish_demo.py --dry-run       build it, show what would be pushed, push nothing

Then, once: repository Settings -> Pages -> Source: "Deploy from a branch" -> gh-pages / (root).
(`deploy/github-pages-workflow.yml` does the same through Actions if your token has the "workflow" scope.)
"""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo"
BRANCH = "gh-pages"
NEEDED = ["index.html", "demo.js", "demo.css", "config.js", "assets/demo.mp4", "assets/poster.jpg",
          "data/facts.json", "data/chapters.json"]


def run(args, cwd, **kw):
    return subprocess.run(args, cwd=cwd, check=True, text=True, capture_output=True, **kw).stdout.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    missing = [f for f in NEEDED if not (DEMO / f).is_file() or not (DEMO / f).stat().st_size]
    if missing:
        sys.exit("missing demo files: " + ", ".join(missing))
    url = run(["git", "remote", "get-url", "origin"], ROOT)
    tmp = Path(tempfile.mkdtemp(prefix="gh-pages-"))
    try:
        work = tmp / "repo"
        run(["git", "clone", "--no-checkout", "--depth", "1", str(ROOT), str(work)], ROOT)
        run(["git", "remote", "set-url", "origin", url], work)
        run(["git", "checkout", "--orphan", BRANCH], work)
        run(["git", "rm", "-rf", "--cached", "--ignore-unmatch", "."], work)
        for p in work.iterdir():
            if p.name != ".git":
                shutil.rmtree(p) if p.is_dir() else p.unlink()
        for src in DEMO.rglob("*"):
            if ".record" in src.parts or not src.is_file():
                continue
            dst = work / src.relative_to(DEMO)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        (work / ".nojekyll").touch()          # serve files and folders starting with _ as they are
        run(["git", "add", "-A"], work)
        head = run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"], ROOT)
        files = run(["git", "diff", "--cached", "--name-only"], work).splitlines()
        size = sum((work / f).stat().st_size for f in files if (work / f).is_file())
        print(f"{len(files)} files, {size / 1e6:.1f} MB")
        if a.dry_run:
            print("\n".join("  " + f for f in sorted(files)))
            return
        who = [c for k in ("user.name", "user.email")                       # a fresh clone has no commit identity of its own
               for c in ("-c", f"{k}={subprocess.run(['git', 'config', k], cwd=ROOT, text=True, capture_output=True).stdout.strip()}")]
        run(["git", *who, "commit", "-q", "-m", f"Interview demo (from {head})"], work)
        run(["git", "push", "-q", "--force", "origin", BRANCH], work)
        print(f"pushed {BRANCH}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
