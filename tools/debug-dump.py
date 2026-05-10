#!/usr/bin/env python3
"""
Diagnose-Dump-Helper.

Holt einen Debug-Endpoint vom lokalen Server, schreibt das Ergebnis
in eine .log-Datei im Repo-Root und pusht das per git automatisch
zum Remote. Damit kann der Streaming-PC schnell Diagnose-Daten
liefern, ohne dass der User manuell curl/jq/git triggern muss.

Aufruf:
  python3 tools/debug-dump.py                    # default: first-fight, session
  python3 tools/debug-dump.py first-fight week
  PORT=8080 python3 tools/debug-dump.py first-fight session

Voraussetzung: Server läuft lokal auf 9000 (oder PORT env-var).
"""
import json
import os
import subprocess
import sys
import urllib.request

# ───────────────────────────────────────────────────────────────────────────
# Mapping: kurzer Name -> (Endpoint-Path, Output-Filename)
# Hier neue Diagnose-Endpoints einfach hinzufügen.
DUMPS = {
    "first-fight": ("/api/pubg/first-fight-debug", "firstfight.log"),
}

PORT = int(os.environ.get("PORT", "9000"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, check=True, **kw)


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "first-fight"
    range_key = sys.argv[2] if len(sys.argv) > 2 else "session"

    if name not in DUMPS:
        print(f"unknown dump '{name}'. options: {', '.join(DUMPS)}")
        sys.exit(2)
    path, out = DUMPS[name]
    url = f"http://localhost:{PORT}{path}?range={range_key}"

    print(f"[1/3] GET {url}")
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.load(r)
    except Exception as e:
        print(f"  failed: {e}")
        sys.exit(1)

    print(f"[2/3] writing {out}")
    out_path = os.path.join(ROOT, out)
    with open(out_path, "w") as f:
        json.dump(data, f, indent=4)

    print("[3/3] git add + commit + push")
    run(["git", "add", out])
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT)
    if diff.returncode == 0:
        print("  nothing changed — nothing to push")
        return
    msg = f"chore(debug): dump {name} ({range_key})"
    run(["git", "commit", "-m", msg])
    run(["git", "push"])
    print(f"\n  done. tell claude: 'fertig' (bzw. {out} ist gepusht)")


if __name__ == "__main__":
    main()
