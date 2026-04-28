# plex-local-screen-mirror

A macOS menu-bar app that mirrors a Plex playback session running on a remote
device (TV, projector, phone) onto a second screen attached to your Mac, keeping
both screens in sync.

The intended use is when you want to watch a movie on a wireless screen — say a
projector on the wall or a TV on the other side of the room — while also seeing
the same picture on a portable monitor next to you. Both screens stay aligned
within fractions of a second without you doing anything during playback.

---

## Features

### Menu-bar control
Lives in the macOS menu bar. Grey circle when idle, green when syncing, red on
error. Click the icon to open a popover.

### Plex sign-in
One-time email + password sign-in to plex.tv on first launch. The token is
saved locally; sign-in screen never appears again unless you sign out.

### Active sessions list
Shows every Plex session currently playing across your devices. Pick the one
you want to mirror.

### Screen picker
Lists all displays connected to the Mac. Pick which one mpv should open
fullscreen on.

### Sync engine
- mpv launches at the same playback position as the chosen Plex session.
- Hardware-accelerated decode via Apple VideoToolbox; output capped at 1080p
  to keep wireless decode buffers and battery happy.
- Plex WebSocket events drive pause / resume / stop / buffering — no polling
  for state transitions.
- Continuous drift correction nudges mpv's playback **speed** (0.95×–1.05×)
  to gradually close any gap, instead of jarring seeks.
- Hard seek fallback if the gap exceeds 8 seconds (i.e. you seeked on the
  remote device).
- Dead-band of 500 ms ignores normal measurement noise so the system doesn't
  fight itself.

### Live sync-offset adjustment
Wireless devices have varying buffer/decode lag. While syncing, the popover
shows ± 250 ms nudge buttons; you tune mpv forward or back until both screens
look right by eye. The offset persists across sessions.

### Download from a friend's library
A separate window for downloading movies from any Plex server you've been
shared on. Pick the remote server, browse or search the library, choose which
local Plex section to save into, and watch the progress bar. The local Plex
library scan is triggered automatically on completion so the file is ready to
play right away.

### Self-contained
Single Electron app. No Python runtime, no daemon to start manually, no
config files to edit. Auto-runs in the background once installed.

---

## Requirements

- macOS (universal arm64 + x64 build)
- `mpv` installed (`brew install mpv`)
- Plex Media Server running locally
- A Plex account

## Run from source

```bash
npm install
npm run create-icons
npm start
```

## Build a `.app`

```bash
npm run build
```

Produces `dist/Sauna Plex-1.0.0-universal.dmg`.

## Layout

| Path | Purpose |
|---|---|
| `main.js` | Electron entry point — tray, IPC, window management |
| `preload.js` | contextBridge API for renderers |
| `src/plex.js` | Plex HTTP API wrapper |
| `src/mpv.js` | mpv subprocess + Unix-socket IPC |
| `src/sync.js` | State machine + drift correction |
| `src/download.js` | Streaming download with progress |
| `src/config.js` | JSON config persistence |
| `renderer/popover.{html,js}` | Menu-bar popover UI |
| `renderer/download.{html,js}` | Download window UI |
| `tests/` | Jest unit tests |
