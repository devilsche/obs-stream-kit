#!/usr/bin/env python3
"""HiDrive SFTP Verbindungscheck.
Ausfuehren auf dem Streaming-PC:
  python -m pubg.hidrive_check
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main():
    try:
        import paramiko
    except ImportError:
        print("FEHLER: pip install paramiko")
        sys.exit(1)

    from pubg.hidrive_telemetry import _get_hd_cfg
    secrets = os.path.join(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__))), ".secrets")
    cfg = _get_hd_cfg(secrets)

    print("=== HiDrive Config (aus .secrets) ===")
    if not cfg:
        print("FEHLER: Keine HiDrive-Credentials!\n")
        print("Trag in .secrets ein:")
        print("  HiDrive Host: sftp.hidrive.strato.com")
        print("  HiDrive User: dein-strato-user")
        print("  HiDrive Pass: dein-passwort")
        print("  HiDrive Path: /users/dein-strato-user/pubg/telemetry")
        sys.exit(1)

    print(f"  Host: {cfg['host']}:{cfg['port']}")
    print(f"  User: {cfg['user']}")
    print(f"  Pass: {'*' * len(cfg.get('password',''))}")
    print(f"  Path: {cfg['path']}")

    print("\n=== Verbindung ===")
    try:
        t = paramiko.Transport((cfg["host"], int(cfg["port"])))
        t.connect(username=cfg["user"], password=cfg["password"])
        sftp = paramiko.SFTPClient.from_transport(t)
        print("  OK")
    except Exception as e:
        print(f"  FEHLGESCHLAGEN: {e}")
        print("\nMoegliche Ursachen:")
        print("  - Falsches Passwort")
        print("  - Falscher Hostname (versuche sftp.hidrive.de statt .strato.com)")
        print("  - Port gesperrt (probiere Port 2222)")
        sys.exit(1)

    print("\n=== Root-Verzeichnis ===")
    cwd = sftp.getcwd()
    print(f"  CWD nach Login: {cwd or '/'}")
    try:
        ls = sftp.listdir(".")
        print(f"  Inhalt: {ls}")
    except Exception as e:
        print(f"  listdir: {e}")

    print(f"\n=== Pfad-Test: '{cfg['path']}' ===")
    path = cfg["path"].rstrip("/")
    parts = path.lstrip("/").split("/")
    cur = ""
    ok = True
    for part in parts:
        if not part: continue
        cur = f"/{part}" if not cur else f"{cur}/{part}"
        try:
            sftp.stat(cur)
            print(f"  {cur}  ✓ vorhanden")
        except IOError:
            print(f"  {cur}  – nicht da, versuche mkdir...", end="")
            try:
                sftp.mkdir(cur)
                print(" OK")
            except Exception as e2:
                print(f" FEHLER: {e2}")
                ok = False
                print(f"\n  TIPP: Pfad '{cur}' kann nicht angelegt werden.")
                print(f"  Strato HiDrive: Dein Home ist /users/{cfg['user']}/")
                print(f"  Aendere HiDrive Path auf: /users/{cfg['user']}/pubg/telemetry")
                break

    if ok:
        print(f"\n=== Upload-Test ===")
        test = f"{path}/_test.txt"
        try:
            with sftp.open(test, "w") as f:
                f.write("ok")
            sftp.remove(test)
            print(f"  Schreiben + Loeschen: OK")
            print(f"\n=== ALLES OK — HiDrive bereit ===")
        except Exception as e:
            print(f"  Schreiben fehlgeschlagen: {e}")

    sftp.close(); t.close()

if __name__ == "__main__":
    main()
