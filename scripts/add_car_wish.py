"""Wunsch-Autos (Sketchfab-Links) in den Car-Picker aufnehmen: Lizenz/Download prüfen, in
assets/cars/candidates.json eintragen.  Aufruf: python3 scripts/add_car_wish.py <Link oder uid> [Marke] …"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def add(ref, brand="Other"):
    m = re.search(r"([0-9a-f]{32})", ref)
    if not m:
        return "no model id in " + ref
    uid = m.group(1)
    p = os.path.join(ROOT, "assets", "cars", "candidates.json")
    c = json.load(open(p, encoding="utf-8"))
    if any(x["uid"] == uid for x in c):
        return "already listed: " + uid
    d = None
    for wait in (0, 30, 90):   # Sketchfab-Bremse (429): kurz warten, nochmal
        time.sleep(wait)
        try:
            d = json.load(urllib.request.urlopen("https://api.sketchfab.com/v3/models/" + uid, timeout=30))
            break
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
    if d is None:
        return "Sketchfab rate limit, try again later: " + uid
    lic = (d.get("license") or {}).get("label", "")
    if not d.get("isDownloadable") or not lic:
        return "not downloadable / no free licence: " + d.get("name", uid)
    imgs = sorted(d["thumbnails"]["images"], key=lambda i: abs(i["width"] - 480))
    c.append({"uid": uid, "brand": brand, "name": d["name"], "author": d["user"]["displayName"], "license": lic,
              "faces": d.get("faceCount") or 0, "url": d["viewerUrl"], "thumb": imgs[0]["url"], "wish": True})
    json.dump(c, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return "added: %s | %s | %s triangles | %s" % (d["name"], lic, d.get("faceCount"), uid)


if __name__ == "__main__":
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if re.search(r"[0-9a-f]{32}", a):
            nxt = args[i + 1] if i + 1 < len(args) and not re.search(r"[0-9a-f]{32}", args[i + 1]) else "Other"
            print(add(a, nxt))
