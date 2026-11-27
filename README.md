# OLED IPTV — 10-foot Xtream Codes player

A keyboard and D-pad driven IPTV player for a Windows or Linux mini PC connected to an OLED TV. The UI is built with Electron and React. Video plays through **mpv** with hardware decoding, so HEVC/H.265, 10-bit, AC3/EAC3 and `.ts` streams all play. Nothing in the app needs a mouse.

```
┌────────┬──────────────────────────────────────────────────────────┐
│ ● rail │  Selected programme · live progress · synopsis              │
│ Search │  [All] [Favourites] [UK News] …   11:30   12:00  ┊ 12:30    │
│ Home   │  1 Metro HD  │ Antiques Hunt ▓▓┊▓▓│ Crime Files          │
│ Live ◀ │  2 Plus      │ Quiz ▓┊ │ News at Ten     │ Crime Files    │
└────────┴──────────────────────────────────────────────────────────┘
```

---

## 1. Architecture plan

### Process and window model

| Piece | Role |
|---|---|
| **Electron main** (`electron/main.js`) | IPC surface, window lifecycle, power-save blocker during playback |
| **Worker thread** (`electron/workers/catalog-worker.js`) | Fetches all Xtream lists and stream-parses the XMLTV guide (often 50–300 MB, gzip detected by magic bytes). Neither the main loop nor the UI thread ever parses a large payload |
| **Main window** (`#000`, React) | Menus, guide and library. It is hidden while a video plays, so it does no painting during playback |
| **mpv process** (`electron/mpv.js`) | Its own borderless fullscreen window with `--hwdec=auto-safe` (D3D11VA on Windows, VA-API on Linux). The app controls it over JSON IPC (named pipe or Unix socket) |
| **OSD window** (`#osd`, React) | A transparent, always-on-top, focusable window drawn over mpv. It receives every key press during playback |

**Why not an HTML5 `<video>` tag?** Chromium can't play `.ts` containers, AC3/EAC3 audio, or HEVC on most systems. **Why not libmpv embedded through a native addon?** Native addons tie the build to one Electron ABI and need a C++ toolchain on every build machine. An mpv child process with a transparent overlay gives the same result: full hardware decoding and a custom OSD, with nothing to compile.

**Keeping key presses working:** if the mpv window ever takes focus, mpv's own `input.conf` (generated at runtime) turns each key into `script-message iptv-key <Key>`. The app receives that over IPC, passes the key to the OSD, and gives focus back to the OSD window. Keys therefore never get lost.

### Data flow

```
Xtream server ──HTTP──▶ worker thread ──slim JSON──▶ main (disk cache + memory EPG index)
                                                        │  IPC (structured clone)
                                                        ▼
                                  renderer: indexes by category, precomputes search keys
```

* **Catalog:** about 6 `player_api.php` calls. Each response is trimmed to the fields the UI uses and cached to `userData/profiles/<id>/catalog.json`. A cache older than the TTL is shown immediately and refreshed in the background (`catalog:updated`).
* **EPG:** `xmltv.php` is stream-parsed. Only channels in your playlist are kept, for a window from 3 hours ago to 36 hours ahead. The index is held in memory as `{channelId: [[start, stop, title, desc]…]}`, and now/next lookups use binary search. `get_short_epg` (base64 encoded) is the fallback when a channel has no XMLTV data.
* **Images:** the `imgcache://` protocol downloads each poster or logo once, shrinks it with `nativeImage`, stores it on disk (512 MB LRU), and serves it from disk afterwards. The renderer loads images lazily through one shared `IntersectionObserver`.
* **Progress and favorites:** per-profile JSON documents written atomically (temp file + rename, debounced and flushed on quit). The player writes progress every 10 seconds and when playback stops. A title counts as watched at 92%.
* **Credentials:** passwords are encrypted with Electron `safeStorage` (DPAPI on Windows, libsecret/kwallet on Linux). On a system with no keystore they are only obfuscated, and Settings shows this.

### Spatial navigation (`src/nav/spatial.js`)

A deterministic geometric engine that moves real DOM focus:

* Any `[data-focusable]` element is a focus target. The best candidate in the pressed direction is found by edge distance, with a heavy penalty for elements that don't overlap on the other axis.
* **Scopes:** modals and detail overlays push a scope, so nothing behind them can take focus. Closing the scope returns focus to the element that opened it.
* **Groups** (`data-focus-group`) remember their last focused child. Leaving and coming back to a column, row or the rail puts you where you were. `data-focus-default` sets the first-entry target (for example the active category).
* **Traps** (`data-focus-trap="up,down"`) stop Up/Down from leaving the end of a list sideways.
* **Overrides:** `data-nav-right=".selector"` handles the rare spots where geometry gives the wrong answer.
* **Recovery:** if the focused element disappears (virtualised list, view change), focus goes to the element closest to its last position.
* Key handlers and Back handlers are stacks ordered by priority. Modal (100) beats overlay (90), which beats view (0), which beats the shell (−100).

`VirtualGrid` draws only the visible rows plus a few extra, so 10,000 channels need about 20 DOM nodes. PageUp/PageDown jump a full page.

### OLED care

* Pure `#000` backgrounds, `#121212` cards, `#F5F5F5` text, and a single accent colour you can change.
* The OSD and banners auto-hide after 4 seconds (configurable).
* If playback is paused for 3 minutes (configurable), a pure-black screensaver appears with a dim clock that jumps to a new spot every 20 seconds. The menu UI gets the same screensaver after 10 idle minutes.
* The whole UI shifts by 1–2 px every 2 minutes (every 1 minute on the OSD) to spread wear from static elements.
* The UI is sized in `rem` on a 1920×1080 grid with `font-size: 100vw/120`, so it looks the same at 1080p and 4K whatever Windows scaling is set to.

---

## 2. Project structure

```
electron/
  main.js              windows, IPC handlers, lifecycle
  preload.cjs          sandboxed whitelist bridge → window.iptv
  xtream.js            API URLs, stream URLs, auth, payload normalisers
  xmltv.js             streaming XMLTV parser + EPG index helpers
  catalog.js           worker orchestration, disk/memory caches, EPG queries
  workers/catalog-worker.js
  mpv.js               mpv spawn + JSON IPC client + input.conf
  player.js            playback session: playlist, zapping, auto-advance, progress, retries
  imageCache.js        imgcache:// protocol (download → resize → disk)
  store.js             profiles (encrypted), settings, per-profile docs
src/
  nav/spatial.js       focus engine          nav/keys.js   key map + handler stacks
  components/          Focusable, VirtualGrid, VirtualKeyboard/TextField, Cards,
                       NavRail, Modal/Confirm/Toast, Screensaver, Icons
  views/               Login, Home, LiveTV, Library (Movies/Series), MovieDetail,
                       SeriesDetail, Favorites, Search, Settings
  osd/OsdApp.jsx       player overlay (banner, VOD bar, stream info, digits, screensaver)
  lib/                 api bridge (+ mockApi for browser dev), store, epg hooks, search
test/                  unit tests + mpv IPC integration test; e2e/ mock Xtream server
resources/mpv/         put mpv.exe here for Windows builds
```

---

## 3. Setup and build

Requires Node 20+.

```bash
npm install
npm run dev          # Vite + Electron with hot reload
npm run dev:web      # UI only in a browser, with a 10k-channel demo backend (no mpv)
npm test             # unit tests + real-mpv IPC test (skipped if mpv/ffmpeg missing)
```

### Installing / bundling mpv

* **Windows (recommended for the OptiPlex):** download a current build from <https://github.com/shinchiro/mpv-winbuild-cmake/releases> (`mpv-x86_64-v3-*.7z`). Put `mpv.exe` in `resources/mpv/win/`, then run:
  ```bash
  npm run dist:win     # → release/OLED IPTV-1.0.0-x64.exe (installer) + portable exe
  ```
* **Linux:** install the system package (`sudo apt install mpv`). Run `npm run dist:linux` to build an AppImage and a `.deb` (the `.deb` declares mpv as a dependency).
* You can also point to any mpv binary under **Settings → Custom mpv path**.

The app runs mpv with `--no-config`, so a personal `mpv.conf` can't break playback.

### Trying it without a provider

```bash
test/e2e/make-media.sh            # creates test clips with ffmpeg
node test/e2e/mock-xtream.mjs     # 300 channels + EPG + 1 movie + 1 series
# In the app: server 127.0.0.1:8099, user u, password pw
```

### Running on the OptiPlex as a "TV appliance"

* Set **Start in fullscreen** (on by default). Create a shortcut to the app in `shell:startup` so it starts with Windows.
* Intel UHD 620/630 decodes HEVC 10-bit 4K in hardware. Under **Settings → Hardware decoding**, "Auto" chooses D3D11VA. Press **I** during playback: *HW decoding* should show `d3d11va` and CPU use should stay low.
* `IPTV_USER_DATA=D:\iptv-data` stores all data in a portable folder.

---

## 4. Keys

| Key | Menus | Playback |
|---|---|---|
| Arrows | Move focus | Live: ▲/▼ change channel · VOD: ◀▶ ±10 s (30 s when held), ▲▼ ±60 s |
| Enter | Select | Show/hide OSD · confirm a typed channel number |
| Esc / Backspace | Back one level (Back at the top level asks before exiting) | Close info/OSD, then stop |
| PageUp / PageDown (ChannelUp/Down) | Page through lists | Next / previous channel or episode |
| Space / MediaPlayPause | — | Play/pause |
| F | Toggle favorite on the focused item | Toggle favorite on the playing item |
| I | — | Stream info (resolution, codecs, fps, bitrates, HW decoding) |
| 0–9 | — | Jump to a channel number (Live) |
| A / S | — | Next audio track / subtitle track |

In text fields and on Search, typing on a physical keyboard goes straight in, and Backspace deletes a character (Esc still goes back).

---

## 5. Dedicated set-top box (Arch Linux)

`stb/` builds a USB installer that turns the PC into a boot-to-player appliance. See [stb/README.md](stb/README.md).

## 6. Notes and limits

* Catch-up (`tv_archive`) is parsed but has no UI yet.
* On Linux, the transparent OSD needs an X11 session with a compositor (Xfce/Xubuntu has one; the `stb/` image uses picom).
* Wayland compositors (GNOME/KDE Wayland, Hyprland) can refuse to keep the OSD above mpv. Use an X11 session. Key presses still reach the app if mpv takes focus.
