#!/usr/bin/env bash
# Builds the ONYX set-top-box installer ISO.
# Runs on any Linux PC with Docker (e.g. your Xubuntu machine):
#   sudo apt install -y docker.io
#   sudo ./stb/build.sh
# Output: stb/out/oled-iptv-installer-*.iso  → write it to a USB stick.
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$KIT/.." && pwd)"
OUT="$KIT/out"
mkdir -p "$OUT"

if ! command -v docker >/dev/null; then
  echo "Docker is required:  sudo apt install -y docker.io" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]] && ! docker info >/dev/null 2>&1; then
  echo "Run with sudo (Docker needs root here):  sudo $0" >&2
  exit 1
fi

echo "==> Building inside an Arch Linux container (needs internet, ~15 min)…"
docker pull archlinux:latest
docker run --rm --privileged \
  -e HOST_UID="${SUDO_UID:-$(id -u)}" -e HOST_GID="${SUDO_GID:-$(id -g)}" \
  -e BUILD_ID="${BUILD_ID:-}" -e STB_REPO="${STB_REPO:-${GITHUB_REPOSITORY:-}}" \
  -v "$KIT":/kit:ro -v "$APP":/app:ro -v "$OUT":/out \
  archlinux:latest bash /kit/container-build.sh

# Hand the output folder back to the invoking user (it was created as root).
chown -R "${SUDO_UID:-$(id -u)}:${SUDO_GID:-$(id -g)}" "$OUT"

echo
echo "==> Done:"
ls -lh "$OUT"
cat <<'EOF'

Write it to a USB stick (replace sdX with your stick — check with `lsblk`!):
  sudo dd if=stb/out/<file>.iso of=/dev/sdX bs=4M status=progress oflag=sync
Or use balenaEtcher / Ventoy / GNOME Disks.
EOF
