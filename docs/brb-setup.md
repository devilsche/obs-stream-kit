# BRB-Szene — Setup

## 1. Lokalen Server starten

```bash
cd ~/git/obs-stream-kit
python3 -m http.server 8080
```

Server läuft dann auf `http://localhost:8080`.

## 2. URL für OBS Browser-Source

```
http://localhost:8080/scenes/brb-pause.html?channel=LuCKoR_HD&client_id=DEINE_CLIENT_ID&client_secret=DEIN_CLIENT_SECRET
```

### Parameter

| Parameter | Pflicht | Default | Beschreibung |
|-----------|---------|---------|--------------|
| `channel` | nein | `LuCKoR_HD` | Twitch-Kanalname |
| `client_id` | ja* | — | Twitch App Client-ID |
| `client_secret` | ja* | — | Twitch App Client-Secret |
| `clips` | ja* | — | Manuelle Clip-Slugs (kommagetrennt) |
| `count` | nein | `100` | Anzahl Clips (max 100) |
| `countdown` | nein | `5` | Countdown-Sekunden zwischen Clips |

\* Entweder `client_id` + `client_secret` (automatisch) ODER `clips` (manuell).

### Manueller Modus (ohne API)

```
http://localhost:8080/scenes/brb-pause.html?clips=SlugA,SlugB,SlugC
```

## 3. OBS Einrichtung

1. **Quelle hinzufügen** → Browser
2. **URL**: siehe oben (NICHT als lokale Datei!)
3. **Breite**: 1920 / **Höhe**: 1080
4. **Audio über OBS steuern** aktivieren (für Clip-Sound)

## 4. Twitch App erstellen

Falls noch keine App vorhanden:

1. [dev.twitch.tv/console](https://dev.twitch.tv/console) → Anwendung registrieren
2. Name: frei wählbar
3. OAuth-Redirect-URL: `http://localhost`
4. Client-Typ: **Vertraulich** (wichtig — sonst kein Secret!)
5. Speichern → Client-ID kopieren → "Neues Secret" klicken → kopieren
