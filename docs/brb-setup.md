# BRB-Overlay — Setup

Das BRB-Overlay spielt automatisch Twitch-Clips deines Kanals ab. Die Clips werden
**server-seitig** über den Endpoint `/s/<token>/api/twitch/clips` geladen — die
Twitch-App-Credentials des Tenants bleiben am Server, das Client-Secret landet
**nie** im Browser bzw. in der URL.

## 1. Twitch-App-Credentials hinterlegen (einmalig, server-seitig)

Die Clip-Wiedergabe braucht eine Twitch-App (Client-ID + Client-Secret) und den
Kanalnamen. Diese werden **pro Tenant am Server** gespeichert (über die
Settings/Einrichtung), nicht als URL-Parameter übergeben.

Falls noch keine Twitch-App vorhanden:

1. [dev.twitch.tv/console](https://dev.twitch.tv/console) → Anwendung registrieren
2. Name: frei wählbar
3. OAuth-Redirect-URL: `http://localhost`
4. Client-Typ: **Vertraulich** (wichtig — sonst kein Secret!)
5. Speichern → Client-ID kopieren → "Neues Secret" klicken → kopieren
6. Client-ID, Client-Secret und Twitch-Channel in den Settings hinterlegen.

## 2. URL für OBS Browser-Source

Die tokenisierte URL bekommst du aus dem Overlay-Dashboard
(`overlays.stats-overlay.info`):

```
https://overlays.stats-overlay.info/s/<token>/overlays/brb-pause.html
```

### Parameter

| Parameter | Pflicht | Default | Beschreibung |
|-----------|---------|---------|--------------|
| `clips` | nein | — | Manuelle Clip-Slugs (kommagetrennt); überschreibt den Server-Abruf |
| `count` | nein | `100` | Anzahl Clips (max 100) |
| `countdown` | nein | `5` | Countdown-Sekunden zwischen Clips |

Channel + App-Credentials werden server-seitig aufgelöst — es gibt **keine**
`client_id`/`client_secret`/`channel`-URL-Parameter mehr.

### Manueller Modus (ohne Server-Abruf)

```
https://overlays.stats-overlay.info/s/<token>/overlays/brb-pause.html?clips=SlugA,SlugB,SlugC
```

## 3. OBS Einrichtung

1. **Quelle hinzufügen** → Browser
2. **URL**: siehe oben
3. **Breite**: 1920 / **Höhe**: 1080
4. **Audio über OBS steuern** aktivieren (für Clip-Sound)
