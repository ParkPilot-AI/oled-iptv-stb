# Bundled mpv

`electron-builder` copies `resources/mpv/<os>/` into the packaged app as `resources/mpv/`.

**Windows** – put `mpv.exe` here in `win/` (from a current build such as
https://github.com/shinchiro/mpv-winbuild-cmake/releases — the `mpv-x86_64-v3-*.7z`
archive suits any 7th-gen+ Intel Core i3; extract only `mpv.exe`).

**Linux** – leave `linux/` empty to use the system mpv (`sudo apt install mpv`,
or `dnf install mpv`), or drop a static mpv binary there.

Lookup order at runtime: Settings → "Custom mpv path" → bundled → `PATH`.

**yt-dlp (trailers)** is found the same way: `yt-dlp.exe` (Windows) or `yt-dlp`
(Linux) next to mpv here, otherwise on `PATH` (the set-top box installs the Arch
`yt-dlp` package). Settings → System shows which one is used, or "yt-dlp not found",
in which case the Trailer button is hidden.
