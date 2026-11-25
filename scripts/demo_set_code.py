"""
demo_set_code.py - set the 4-digit access code of the static interview demo (demo/config.js)
===========================================================================================
    python scripts/demo_set_code.py 1234        set the code
    python scripts/demo_set_code.py off         no code (the demo opens directly)

Only a salted SHA-256 hash of the code is written. This is a courtesy door for a static GitHub Pages site, NOT
security: the check runs in the visitor's browser, the page's images are public files, and 10,000 codes can be tried
in seconds. Do not put anything in demo/ that must stay confidential.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

CFG = Path(__file__).resolve().parents[1] / "demo" / "config.js"
SALT = "avalanche-portal-demo:"


def main():
    arg = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if arg != "off" and not re.fullmatch(r"\d{4}", arg):
        sys.exit("usage: python scripts/demo_set_code.py <4 digits> | off")
    text = CFG.read_text(encoding="utf-8")
    value = "null" if arg == "off" else json.dumps(hashlib.sha256((SALT + arg).encode()).hexdigest())
    new, n = re.subn(r"codeHash:\s*(null|\"[0-9a-f]*\")", f"codeHash: {value}", text)
    if n != 1:
        sys.exit(f"codeHash not found in {CFG}")
    CFG.write_text(new, encoding="utf-8")
    print("demo code removed" if arg == "off" else f"demo code set ({len(arg)} digits); hash written to {CFG.name}")


if __name__ == "__main__":
    main()
