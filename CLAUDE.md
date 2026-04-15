# Stream Overlay Set

## Projekt
Komplettes OBS Stream-Overlay-Set als statische HTML/CSS/JS Browser-Sources.
Repo: github.com/devilsche/obs-stream-kit

## Was gebaut wird
- **Starting Soon** Szene (animiert)
- **BRB / Pause** Szene (mit integriertem Twitch Clip-Player, random Wiedergabe)
- **Stream Ending** Szene (animiert)
- **Gameplay Overlay** mit Kamera-Bereich (400px breit, 16:9 Seitenverhältnis)
- **Just Chatting Overlay** (Fullscreen-Kamera mit dezenter Deko)
- **Alert-Animationen**: New Follower, Sub, Resub, Gift Sub, Bits/Cheers, Raid
- **Übergänge / Stinger Transitions**

## Technisch
- Jede Szene/Alert = eine eigenständige HTML-Datei (OBS Browser-Source)
- Vanilla HTML/CSS/JS — kein Build-Tool, kein Framework
- 1920x1080 Canvas
- Transparenter Hintergrund wo nötig (für Overlays/Alerts)
- Animationen via CSS @keyframes + Web Animations API
- Twitch Clips via Twitch Embed API
- Konfigurierbar via URL-Parameter (Twitch-Username, Farben etc.)

## Design
- Stil: Entry-inspiriert — Purple (#5e2a79) / Gold (#f2b705), DM Sans Font
- Dark-Theme-Basis für Stream
- Animationen: smooth, nicht übertrieben, professionell
- Konsistenter Look über alle Szenen

## Twitch
- Twitch Username: LuCKoR_HD
- Clips über Twitch API / Embed laden

## Git
- Commit messages: Deutsch, Conventional Commits, KEIN Co-Authored-By
