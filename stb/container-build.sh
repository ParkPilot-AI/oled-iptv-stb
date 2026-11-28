#!/usr/bin/env bash
# Runs inside archlinux:latest (started by build.sh). Builds the Electron app,
# then an archiso live image whose tty1 launches the unattended installer.
set -euo pipefail

echo "==> Installing build tools"
pacman -Syu --noconfirm --needed archiso nodejs npm git rsync zstd

echo "==> Building the app"
mkdir -p /build
rsync -a --exclude node_modules --exclude dist --exclude release --exclude stb/out --exclude test/e2e/media /app/ /build/app/
cd /build/app
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
# Latest list of official channel logos (falls back to the committed snapshot).
node scripts/update-tvlogos.mjs || echo "tv-logos refresh failed; using snapshot"
npx vite build
npx electron-builder --linux dir --publish never
# Build id lets the in-app updater tell versions apart.
BUILD_ID=${BUILD_ID:-$(date -u +%Y.%m.%d-%H%M)}
echo "$BUILD_ID" > release/linux-unpacked/stb-version.txt
# Box helpers travel with the app so "Update system" keeps them current too.
mkdir -p release/linux-unpacked/stb-system
# packages.txt lets 'stb-update run/provision' install packages added since the box was set up.
cp /kit/overlay/airootfs/root/stb-files/{stb-update,stb-audio.sh,nm-stb.conf,packages.txt,bluetooth-main.conf,portals.conf,openbox-rc.xml,onyx-open-url,onyx-browser.desktop,mimeapps.list} release/linux-unpacked/stb-system/
# Tarball keeps executable bits/setuid layout (archiso resets modes of airootfs files).
mkdir -p /build/payload
tar -C release/linux-unpacked -I 'zstd -19 -T0' -cf /build/payload/oled-iptv.tar.zst .
# Also publish the app on its own for one-button updates on installed boxes.
cp /build/payload/oled-iptv.tar.zst /out/oled-iptv-app.tar.zst
echo "$BUILD_ID" > /out/app-version.txt

echo "==> Preparing archiso profile"
cp -r /usr/share/archiso/configs/releng /build/profile
rsync -a /kit/overlay/ /build/profile/
# iwd deletes and re-creates the Wi-Fi interface, which breaks rtl8xxxu dongles
# (wlan0 vanishes). The installer uses NetworkManager instead, so never start iwd.
rm -f /build/profile/airootfs/etc/systemd/system/multi-user.target.wants/iwd.service
ln -sf /dev/null /build/profile/airootfs/etc/systemd/system/iwd.service
echo "${STB_REPO:-}" > /build/profile/airootfs/root/stb-files/update-repo
mkdir -p /build/profile/airootfs/opt/stb-payload
cp /build/payload/oled-iptv.tar.zst /build/profile/airootfs/opt/stb-payload/

# Live environment: swap the 'all firmware' meta package for the split
# packages a Dell OptiPlex needs (saves ~400 MB, keeping the ISO < 2 GB for
# GitHub releases), and add what the installer uses.
sed -i '/^linux-firmware/d' /build/profile/packages.x86_64
for p in arch-install-scripts gptfdisk dosfstools e2fsprogs iwd iw zstd terminus-font networkmanager wpa_supplicant \
         linux-firmware-intel linux-firmware-realtek linux-firmware-atheros linux-firmware-mediatek; do
  grep -qx "$p" /build/profile/packages.x86_64 || echo "$p" >> /build/profile/packages.x86_64
done

echo "==> Downloading the box's packages into an offline repository"
# Fresh pacman db → every dependency is downloaded, not just what's missing here.
# Downloads are signature-checked against the Arch keyring during this step.
mapfile -t PKGS < <(grep -v '^[[:space:]]*#' /kit/overlay/airootfs/root/stb-files/packages.txt | tr -s ' \t' '\n' | grep -v '^$')
mkdir -p /build/repo /build/blankdb
pacman -Sy --dbpath /build/blankdb --noconfirm >/dev/null
pacman -Sw --dbpath /build/blankdb --cachedir /build/repo --noconfirm "${PKGS[@]}"
repo-add -q /build/repo/stb.db.tar.gz /build/repo/*.pkg.tar.zst
rm -f /build/repo/*.sig
mkdir -p /build/profile/airootfs/opt
mv /build/repo /build/profile/airootfs/opt/stb-repo
du -sh /build/profile/airootfs/opt/stb-repo

# Branding + start installer on tty1 after the automatic root login.
sed -i \
  -e 's/^iso_name=.*/iso_name="oled-iptv-installer"/' \
  -e 's/^iso_label=.*/iso_label="OLEDIPTV_$(date --date="@${SOURCE_DATE_EPOCH:-$(date +%s)}" +%Y%m)"/' \
  -e 's/^iso_publisher=.*/iso_publisher="ONYX"/' \
  -e 's/^iso_application=.*/iso_application="ONYX set-top box installer"/' \
  /build/profile/profiledef.sh
cat >> /build/profile/airootfs/root/.zlogin <<'EOF'

# ONYX: run the set-top-box installer once, on the first console.
if [[ "$(tty)" == /dev/tty1 && ! -e /tmp/.stb-started ]]; then
  touch /tmp/.stb-started
  bash /root/stb-install.sh
fi
EOF

echo "==> Building ISO"
mkarchiso -v -w /build/work -o /out /build/profile
ls -l /out
chown "${HOST_UID:-0}:${HOST_GID:-0}" /out/*
