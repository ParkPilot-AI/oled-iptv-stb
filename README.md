# ONYX — 10-foot Xtream Codes player for OLED TVs

A keyboard and D-pad driven IPTV player for a Windows or Linux mini PC connected to an OLED TV. The UI is built with Electron and React. Video plays through **mpv** with hardware decoding, so HEVC/H.265, 10-bit, AC3/EAC3 and `.ts` streams all play. Nothing in the app needs a mouse.

```
┌────────────┬──────────────────────────────────────────────────────────┐
│ O  (ONYX)  │  Selected programme · live progress · synopsis              │
│ Home       │  [All] [Favourites] [Sports] [News] … 11:30  12:00 ┊ 12:30  │
│ Live TV ◀  │  1 Metro HD  │ Antiques Hunt ▓▓┊▓▓│ Crime Files            │
│ Movies     │  2 Plus      │ Quiz ▓┊ │ News at Ten     │ Crime Files      │
│ TV Shows   │  3 Echo      │ Film: The Long Road                         │
│ Favourites │                                                             │
│ Search     │                                                             │
│ ⚙ Settings │                                                             │
└────────────┴──────────────────────────────────────────────────────────┘
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
* **Progress and favourites:** per-profile JSON documents written atomically (temp file + rename, debounced and flushed on quit). The player writes progress every 10 seconds and when playback stops. A title counts as watched at 92%.
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

* Pure `#000` backgrounds, `#0c0c0e` cards, `#F5F5F5` / `#8E8E93` text. The theme colour (Settings → General → Theme) only appears on things that move — the focus ring, the selected tab, progress — and LIVE is always red.
* The OSD and banners auto-hide after 4 seconds (configurable).
* If playback is paused for 3 minutes (configurable), a pure-black screensaver appears with a dim clock that jumps to a new spot every 20 seconds. The menu UI gets the same screensaver after 10 idle minutes.
* The whole UI shifts by 1–2 px every 2 minutes (every 1 minute on the OSD) to spread wear from static elements.
* The UI is sized in `rem` on a 1920×1080 grid with `font-size: 100vw/120`, so it looks the same at 1080p and 4K whatever Windows scaling is set to.

---

## 2. Project structure

```
electron/
  main.js              windows, IPC handlers, lifecycle (userData kept in "OLED IPTV", see paths.js)
  preload.cjs          sandboxed whitelist bridge → window.iptv
  paths.js             user-data folder (unchanged by the ONYX rename)
  xtream.js            API URLs, stream URLs, auth, payload normalisers, friendly network errors
  xmltv.js             streaming XMLTV parser + EPG index helpers
  catalog.js           worker orchestration, disk/memory caches, EPG queries, logos + channel types
  workers/catalog-worker.js
  mpv.js               mpv spawn + JSON IPC client + input.conf; resolveTool (mpv, yt-dlp)
  player.js            playback session: playlist, zapping, auto-advance, progress, retries, trailers
  mpvprops.js          picture/sound settings → mpv properties
  subs.js              subtitle choice + style       tracks.js   "Audio: English · AC3 5.1 (2/3)"
  audio.js             PipeWire outputs, system volume
  artwork.js           TMDB client + artwork cache   artmatch.js  title cleaning, logo matching, genres
  discover.js          TMDB trending/popular/top-rated/genre lists, recommendations
  trailers.js          TMDB trailer choice + yt-dlp stream resolution
  adult.js             adult-channel PIN (hashed)
  bluetooth.js         controller pairing via `stb-update bt …` (MAC-checked)
  games.js             GeForce NOW: launch (Flatpak / Windows .exe), hide + restore ONYX
  imageCache.js        imgcache:// protocol (download → resize → disk)
  store.js             profiles (encrypted), settings, per-profile docs
  data/tvlogos.json    index of official channel logos (scripts/update-tvlogos.mjs)
src/
  nav/spatial.js       focus engine          nav/keys.js   key map, handler stacks, long-press OK
  components/          Focusable, VirtualGrid, VirtualKeyboard/TextField (+ number pad), Cards,
                       Hub (spotlight carousel + rows), PillTabs, NavRail, Modal/Confirm/Toast,
                       NetworkSettings (Wi-Fi), SystemUpdate (+ JobModal, ProvisionRow),
                       ControllerSettings (Bluetooth pairing), AdultSettings, TrailerButton,
                       VolumeHud, Logo, Screensaver, Icons
  views/               Login, Home, LiveTV, Library (Movies/TV Shows), MovieDetail,
                       SeriesDetail, Favorites, Search, Games, Settings
  osd/                 OsdApp (player overlay), Bars (live banner, VOD bar), LiveNav (surf + glass guide)
  lib/                 api bridge (mockApi only in demo builds), store (+ adult filter), art,
                       discover, genres, theme, epg hooks, search, fav, controllers
test/                  unit tests + mpv IPC test; stb/ updater, Wi-Fi, Bluetooth and Games tests;
                       e2e/ mock Xtream server
stb/                   Arch set-top box: ISO build (build.sh, container-build.sh), installer,
                       box files (stb-update helper, NetworkManager, BlueZ, audio, openbox)
resources/mpv/         mpv.exe (and yt-dlp.exe) for Windows builds
```

---

## 3. Setup and build

Requires Node 22+.

```bash
npm install
npm run dev          # Vite + Electron with hot reload
npm run dev:web      # UI only in a browser, with a 10k-channel demo backend (no mpv)
npm test             # unit tests + real-mpv IPC test (skipped if mpv/ffmpeg missing)
npm run lint         # ESLint (also run in CI before any release is published)
npm run format       # Prettier (single quotes, 160 columns)
npm run build:demo   # browser demo bundle (the Electron build never includes the demo data)
```

### Installing / bundling mpv

* **Windows (recommended for the OptiPlex):** download a current build from <https://github.com/shinchiro/mpv-winbuild-cmake/releases> (`mpv-x86_64-v3-*.7z`). Put `mpv.exe` in `resources/mpv/win/`, then run:
  ```bash
  npm run dist:win     # → release/ONYX-1.1.0-x64.exe (installer) + portable exe
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
| Arrows | Move focus | Live: ▲/▼ channel surf (tunes after 1.8 s or on OK), ◀ glass channel guide over the video · VOD: ◀▶ ±10 s (30 s when held), ▲▼ ±60 s |
| Enter (OK) | Select | Films/episodes: pause/play and show the bar · Live: show/hide the banner, confirm a typed channel number |
| Hold OK (~0.6 s) | Add/remove the focused card in Favourites | — |
| Esc / Backspace | Back one level (Back at the top level asks before exiting) | Close info/OSD, then stop |
| PageUp / PageDown (ChannelUp/Down) | Home & Movies/Series: cycle hub tabs · Live guide: page channels | Next / previous channel or episode (instant) |
| Space / MediaPlayPause | — | Play/pause |
| F | Add/remove the focused item in Favourites | Same for the playing channel or film; on an episode, its series |
| I | — | Stream info (resolution, codecs, fps, bitrates, HW decoding) |
| 0–9 | — | Jump to a channel number (Live) |
| A / S | — | Next audio track / subtitle track, named on screen ("Audio: English · AC3 5.1 (2/3)", "Subtitles: Off") |
| Volume Up / Down / Mute | Box volume | Box volume |
| Ctrl+Alt+Home / Home (XF86HomePage) | — | While GeForce NOW is open: close it and return to ONYX (box only) |

**Trailers:** film and series pages have a **Trailer** button when TMDB lists one. It plays full screen in mpv straight from YouTube's video servers through yt-dlp — no YouTube page, no ads — and Back (or the end) returns to the page. Needs a TMDB key and yt-dlp; Settings → Library → Trailers turns it off.

**Adult channels** are hidden by default (Settings → General → Parental), optionally behind a 4-digit PIN.

In text fields and on Search, typing on a physical keyboard goes straight in, and Backspace deletes a character (Esc still goes back).

---

**Settings** has six tabs (PgUp/PgDn to switch):

* **Picture**: brightness, contrast, colour and gamma sliders (◀ ▶), aspect ratio (original, 16:9, 4:3, 21:9, zoom or stretch to fill), upscaling quality, debanding, HDR-to-SDR tone mapping, deinterlacing and hardware decoding.
* **Sound**: output (TV over HDMI, a second HDMI port, the headphone jack, USB…), stereo downmix for TV speakers, Dolby/DTS passthrough for a soundbar or AV receiver, preferred audio language, night mode or even-volume levelling, and lip-sync delay.
* **Subtitles**: an on/off switch (off by default), preferred language, size and a dark box or outline style. **S** still switches tracks during playback.
* **General**, **Library** (playlists, refresh, TMDB key, artwork sources) and **System** (Wi-Fi, updates, version, **Power Off**).

Changes apply to what's playing. **Volume Up / Down / Mute** keys change the box's volume anywhere in the app, with an on-screen level indicator.

**Discovery (needs a TMDB key).** Home opens on a spotlight carousel of trending films and shows (◀ ▶ to browse, it also advances by itself), followed by Continue Watching, *Because you watched…* recommendations for your two most recent titles, Popular Movies and Popular TV Shows. Movies and TV Shows each get a **Discover** tab with a trending carousel and Popular, Top Rated and Most Liked rows (most liked = most votes on TMDB). Every TMDB list is matched against your provider's catalogue (by the provider's TMDB id when it sends one, otherwise by title and year), so you only see titles you can play. Lists are cached for 12 hours.

**Themes (Settings → General).** Cinema Amber (default; least blue light for dark rooms), Ice Cyan, Cinema Ruby, Electric Violet and Monochrome. The theme colours only moving things — the focus ring, the selected pill, progress bars — plus 4K/HDR badges; text stays neutral (#F5F5F5 / #8E8E93) and LIVE is always red, so nothing coloured sits still on the OLED panel.

**Genres.** With a TMDB key, Movies and TV Shows list genres in the top bar (Action, Comedy, Drama, Sci-Fi…). The Discover tab gains a poster row per genre; a genre tab shows that genre's trending carousel with Popular, Top Rated and Most Liked rows, all matched to your provider's catalogue.

**Controllers (Settings → Controllers).** Pair, connect, disconnect and forget Bluetooth game controllers with the remote: put the controller in pairing mode (Xbox: hold the pair button until the logo flashes fast; PlayStation: hold Share or Create + PS until the light flashes; others: see the controller manual), choose **Pair a controller**, then pick it from the list — controllers are listed first. Paired controllers reconnect on their own when switched on, and a toast says when one connects or disconnects (with battery level when it reports one). Without a Bluetooth adapter the options are greyed out and can't be selected; they enable themselves within a few seconds of plugging a USB adapter in. Works on the box; on Windows use Windows' own Bluetooth settings.

**Games (GeForce NOW).** Turn on **Settings → General → Show Games in sidebar** to add a **Games** item between TV Shows and Favourites. It opens NVIDIA's official GeForce NOW app full screen; ONYX steps aside (playback stops, the screensaver pauses) and comes back, focused on Games, when you quit it. On the box the first visit offers **Install GeForce NOW** (NVIDIA's Flatpak, about 1–2 GB, with live progress); **Update system** keeps it current. On Windows it launches the installed app or opens NVIDIA's download page. You need an NVIDIA account with a GeForce NOW membership and, ideally, a wired connection: NVIDIA recommends at least 25 Mbps for 1080p at 60 fps and 40 Mbps for 4K at 60 fps. If GeForce NOW ever gets stuck, **Ctrl+Alt+Home** on a keyboard (or the Home key on many air-mouse remotes) closes it.

## 5. Artwork

* **Channel logos:** official 512 px logos from [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos) first (about 10,000; the index ships in `electron/data/tvlogos.json` and is refreshed at build time — free for personal use, ask its maintainer before distributing), then the open [iptv-org](https://github.com/iptv-org/api) database, then the provider's own logo. Matching (EPG id, then name without "UK:", "HD", "+1"…, using the country prefix) runs in the background worker and is refreshed weekly. The same pass sorts channels into types for the guide.
* **Movie and series artwork** (posters, wide backdrops, title logos) comes from [TMDB](https://www.themoviedb.org). Enter your free API key under **Settings → Library**; the v3 key or the v4 read token works. The provider's TMDB id is used when it has one, otherwise the cleaned title and year. Results are cached on disk for 30 days (misses for 7). Trailer choices share that cache.
* Modes: *TMDB first* (default) / *Provider first* / *Off* for artwork; *Official logos* / *Provider first* / *Provider logos only* for channel logos.
* Attribution for TMDB, tv-logos and iptv-org is shown in Settings → Library.

## 6. Dedicated set-top box (Arch Linux)

`stb/` builds a USB installer that turns the PC into a boot-to-player appliance. See [stb/README.md](stb/README.md).

## 7. Notes and limits

* Catch-up (`tv_archive`) is parsed but has no UI yet.
* On Linux, the transparent OSD needs an X11 session with a compositor (Xfce/Xubuntu has one; the `stb/` image uses picom).
* Wayland compositors (GNOME/KDE Wayland, Hyprland) can refuse to keep the OSD above mpv. Use an X11 session. Key presses still reach the app if mpv takes focus.
