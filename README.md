# obs-stream-kit

Komplettes OBS Stream-Overlay-Set als statische HTML/CSS/JS Browser-Sources.

Purple/Gold Entry-Style — für den Twitch-Kanal [LuCKoR_HD](https://twitch.tv/LuCKoR_HD).

## Szenen

| Datei | Beschreibung |
|-------|-------------|
| `scenes/starting-soon.html` | Animierte Warteszene |
| `scenes/brb-pause.html` | Pause mit Twitch Clip-Player |
| `scenes/stream-ending.html` | Animierte Abschlussszene |
| `scenes/gameplay.html` | Gameplay Overlay mit Cam-Rahmen |
| `scenes/just-chatting.html` | Fullscreen-Kamera mit Chat-Bereich |

## Alerts

| Datei | Typ | Parameter |
|-------|-----|-----------|
| `alerts/follow.html` | Center-Stage (Gold) | `?username=X&message=Y` |
| `alerts/sub.html` | Center-Stage (Purple) | `?username=X&message=Y` |
| `alerts/resub.html` | Center-Stage (Purple) | `?username=X&months=N&message=Y` |
| `alerts/bits.html` | Center-Stage (Gold) | `?username=X&amount=N&message=Y` |
| `alerts/giftsub.html` | Fullscreen-Flash (Purple) | `?username=X&amount=N` |
| `alerts/raid.html` | Fullscreen-Flash (Gold) | `?username=X&viewers=N` |

## Widgets

| Datei | Beschreibung | Parameter |
|-------|-------------|-----------|
| `widgets/latest-follower.html` | Einflug-Box (Gold) | `?name=X` |
| `widgets/latest-sub.html` | Einflug-Box (Purple) | `?name=X` |
| `widgets/latest-tip.html` | Einflug-Box (Gold) | `?name=X&amount=Y` |
| `widgets/subgoal.html` | Fortschrittsbalken | `?current=N&goal=N` |

## Transition

| Datei | Beschreibung | OBS-Setup |
|-------|-------------|-----------|
| `transitions/stinger.html` | Partikel/Geometrie (1s) | Browser Transition Plugin, Duration: 1000ms, Transition Point: 350ms |

## Setup

1. Repo klonen
2. `assets/logo.png` mit deinem Logo ersetzen
3. In OBS: Browser-Source hinzufügen → lokale Datei auswählen
4. Alerts/Widgets: Streamer.bot konfigurieren für URL-Parameter + Source-Sichtbarkeit
