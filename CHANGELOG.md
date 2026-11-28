# Changelog

## 1.4.0

### New
- **Button hints** for the focused item (bottom right), named for the device you're using —
  "OK · Back · Info" on a remote, coloured "A · B · Y" on a controller — fading out after 5 s.
  **Navigation sounds** and **controller rumble** (row edges, dialogs), both switchable.
- **Smoother channel changes:** the last picture stays up, dimmed, with a small "Tuning to…"
  spinner until the next channel starts — no black screen. Typing a number shows
  "104 — BBC One HD" and tunes after 1.2 s.
- **Mini-player:** Back from live TV or a trailer keeps it playing in a corner while you
  browse; Play/Pause returns to full screen, Stop or Back from the side menu closes it.
- **Add a playlist from your phone:** scan the QR code on the playlist form and type the
  details on your phone.
- **Who's watching?** Household profiles with their own favourites, Continue Watching, recent
  searches and theme; Kids profiles without adult content; optional PIN per profile.
- **Up next** card in the last 30 s of an episode, with a 10-second countdown.
- **Trailer preview:** Info (Y) on any film or series poster plays the trailer in a floating
  window beside the grid.
- **Search shortcuts:** Trending tonight, Live sports, 4K movies, Recently added, plus recent
  searches.
- **Sleep:** stops playback (freeing the provider connection) and switches the picture off;
  any key wakes. Power/Standby keys and the Power-off dialog offer it too.
- **Background updates** (playlist, TV guide, logos) are shown in Settings → Library, and
  briefly after start-up.

### Changed
- Controller: **Y** is now Info / trailer preview and **Menu** is Favourite.
- Only one stream is ever open (full screen, mini-player or preview), so single-connection
  accounts are safe.
- The playlist picker is titled "Choose a playlist".

## 1.3.0

### New
- **Bold themes** (Settings → General → Theme): **Studio Red**, **Arena Green**, **Royal Blue**,
  **Stream Purple** and **Molten Orange**. Deeper, saturated colours with a stronger glow and a
  thicker focus ring; the current menu icon and selected tab take the colour, and a very dark
  wash of it sits behind the menus (kept near black to be kind to the OLED panel). The original
  five themes are unchanged.

## 1.2.4

### Fixed
- **GeForce NOW ran without the graphics chip** (stuck on its splash screen; log: "Could not
  get DRI3 device", "software renderer: llvmpipe"). The TV user wasn't in the `render` group
  that owns the GPU's render node. The update adds it and asks for a restart.

## 1.2.3

### Fixed
- **GeForce NOW *Log in* still did nothing.** The desktop portal that passes GeForce NOW's
  sign-in link on couldn't reach the TV display ("cannot open display"). The X session now
  shares its display with those background services, and updating fixes a running box too.

## 1.2.2

### Fixed
- **Box files arrive with the update that brings them.** The updater replaces itself during an
  update, but the old copy carried on and only installed the files it knew about — so new box
  files (such as the GeForce NOW sign-in handler in 1.2.1) only appeared on the *next* update.
  The old copy now hands over to the new one to finish.

## 1.2.1

### New
- **Use a game controller in ONYX.** Any controller the box can see — USB or Bluetooth —
  moves around the menus and controls playback: D-pad or left stick to move, **A** = OK
  (hold for Favourites), **B** = Back, **LB / RB** = previous / next tab or channel,
  **X** = play/pause, **Y** = favourite, **Menu** = info. Ignored while GeForce NOW is open.
- **USB controllers are recognised.** Settings → Controllers lists every connected controller
  under *Connected now*, the Games page shows it, and plugging one in shows a toast.

### Fixed
- **GeForce NOW sign-in on the box.** GeForce NOW signs in through the web browser, and the
  box has none, so *Log in* did nothing. Web links now open in a full-screen ONYX sign-in
  window that closes by itself once you're signed in (Esc closes it any time).
- "Finish installing the update" on a box whose updater is too old now says how to fix it
  instead of "Updater exited with code 2".

## 1.2.0

### New
- **Games (GeForce NOW).** Settings → General → *Show Games in sidebar* (off by default) adds
  **Games** between TV Shows and Favourites. **Play GeForce NOW** opens NVIDIA's official app
  full screen; playback stops and the screensaver pauses while it runs, and ONYX comes back,
  focused on Games, when you quit. On the box, **Install GeForce NOW** downloads NVIDIA's
  Flatpak with live progress and *Update system* keeps it current. On Windows it launches the
  installed app or opens NVIDIA's download page. Emergency exit: **Ctrl+Alt+Home** (or Home on
  the remote).
- **Bluetooth controllers.** Settings → Controllers pairs, connects, disconnects and forgets
  controllers with the remote, gamepads listed first. A toast says when a controller connects
  or disconnects, with its battery level. Without a Bluetooth adapter the options are greyed
  out; they switch on within seconds of plugging one in.

### Box
- New packages: bluez, bluez-utils, flatpak, xdg-desktop-portal-gtk; `bluetooth.service`
  enabled; BlueZ configured for controllers (`/etc/bluetooth/main.conf`).
- `stb-update` gains `provision`, `bt …` and `games …`. Boxes updated from 1.1.0 show
  **Finish installing the update** once (and in Settings → System) to add the new packages.

## 1.1.0

### New
- **Trailers.** Film and TV show pages get a **Trailer** button when TMDB lists an official
  trailer. It plays full screen in mpv in a second or two, straight from the video servers
  (via yt-dlp) — no YouTube page, no ads. Back, or the end of the trailer, returns to the page.
  Trailers don't count as watched and never appear in Continue Watching.
  Settings → Library → Trailers turns them off.
- **Adult channels hidden by default.** Settings → General → Parental: *Adult channels:
  Hidden / Shown*, with an optional 4-digit PIN needed to show them. When hidden they're gone
  from the guide, its channel types, All channels, Search, Home rows, Favourites and channel
  surfing, along with adult film/series categories.
- **Hold OK to favourite.** Holding OK on any channel, film or series card adds it to (or
  removes it from) Favourites, so a remote without an F key can do it too.
- **Named audio and subtitle tracks.** A and S now say what you switched to, e.g.
  "Audio: English · AC3 5.1 (2/3)" or "Subtitles: Off". A no longer switches the sound off.

### Changed
- **OK pauses films and episodes** (and shows the bar). Live TV is unchanged.
- **F on an episode** adds its series to Favourites instead of asking you to go to the
  series page.
- "Favourites" spelt the British way everywhere.
- Settings: *Refresh TV guide*, *Re-match channel logos* and *Clear cached data* show that
  they're working, ignore repeat presses and report errors. Version, mpv and yt-dlp are
  read-only lines that focus skips.
- The app is called **ONYX** throughout, including the Windows installer
  (`ONYX-1.1.0-x64.exe`). Your playlists, passwords, settings, favourites and watch progress
  stay where they were.

### Under the hood
- Releases are only published after the tests, lint and a renderer build pass; pull
  requests run the same checks.
- The demo data used for browser development is no longer shipped inside the app.
- The set-top box installs `yt-dlp`.
