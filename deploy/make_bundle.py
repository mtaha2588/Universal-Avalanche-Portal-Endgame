"""Pack the portal into dist/avalanche-portal.zip (+ dist/setup_server.sh) for upload to the server.

Run from the project folder:  python deploy\\make_bundle.py
Leaves out the local virtual environment, caches and editor settings. Includes .env
(Mapbox token and secret key) because the server needs it, so do not share the zip.
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "avalanche-portal.zip"
SKIP_DIRS = {".venv", "__pycache__", ".pytest_cache", ".vscode", ".git", "dist"}
SKIP_SUFFIXES = {".pyc"}


def wanted(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    if any(part in SKIP_DIRS for part in rel.parts):
        return False
    if path.suffix in SKIP_SUFFIXES or ".bak-" in path.name:
        return False
    return path.is_file()


def main():
    OUT.parent.mkdir(exist_ok=True)
    files = sorted(p for p in ROOT.rglob("*") if wanted(p))
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for p in files:
            # as_posix() keeps forward slashes, so Linux unzip recreates the folders correctly.
            zf.write(p, p.relative_to(ROOT).as_posix())
    if not (ROOT / ".env").exists():
        print("WARNING: no .env found; the server will run without the Mapbox token.")
    # Ship the installer next to the zip with Unix line endings (bash rejects CRLF).
    script = (ROOT / "deploy" / "setup_server.sh").read_bytes().replace(b"\r\n", b"\n")
    (OUT.parent / "setup_server.sh").write_bytes(script)
    print(f"{len(files)} files -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
