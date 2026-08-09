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
| `clips` | nein | — | Feste Clip-Slugs (kommagetrennt) statt der zufälligen Auswahl |
| `count` | nein | `100` | Anzahl Clips (max 100) |
| `countdown` | nein | `5` | Countdown-Sekunden zwischen Clips |
| `endHold` | nein | `1.5` | Sekunden, die der letzte Frame nach Clip-Ende stehen bleibt, bevor ausgeblendet wird |

Channel + App-Credentials werden server-seitig aufgelöst — es gibt **keine**
`client_id`/`client_secret`/`channel`-URL-Parameter mehr.

### Feste Clip-Auswahl

```
https://overlays.stats-overlay.info/s/<token>/overlays/brb-pause.html?clips=SlugA,SlugB,SlugC
```

Auch hier läuft der Abruf über den Server (`/api/twitch/clips?slugs=…`) — nur er
kann die abspielbaren Clip-URLs beschaffen.

### Wenn das Bild fehlt und nur der Countdown läuft

Stellst du die Audio-Einstellung der Browser-Source um („Audio über OBS
steuern"), kann die Browser-Engine bis zum **Neustart von OBS** kein
Audio-Ausgabegerät mehr öffnen. Sie wirft dann beim Start jedes Clips sofort
`MEDIA_ERR_DECODE / AUDIO_RENDERER_ERROR` — das Video selbst ist in Ordnung.

Der Player fängt das ab und spielt den Clip beim zweiten Versuch stumm, damit
die Szene nicht ohne Bild durch die Clip-Liste rast. **Willst du den Ton
zurück, starte OBS neu.**

### Warum kein Twitch-iframe mehr

Die Overlays spielen Clips als natives `<video>` mit einer direkten,
signierten MP4-URL. Das offizielle `clips.twitch.tv`-Embed schiebt bei Kanälen
mit **Content Classification Labels** (z. B. „Drugs, Intoxication", „Violent and
Graphic Depictions") ein „Start Watching"-Interstitial davor, das auf einen Klick
wartet. In einer OBS-Browser-Source klickt niemand — der Clip bliebe für immer
stehen, während der Countdown weiterläuft. Ohne iframe entfällt das Gate, und
weitergeschaltet wird am echten Video-Ende statt per Timer.

## 3. OBS Einrichtung

1. **Quelle hinzufügen** → Browser
2. **URL**: siehe oben
3. **Breite**: 1920 / **Höhe**: 1080
4. **Audio über OBS steuern** aktivieren (für Clip-Sound)
