# Changelog

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
