#!/usr/bin/env bash
# Runs inside archlinux:latest (started by build.sh). Builds the Electron app,
# then an archiso live image whose tty1 launches the unattended installer.
set -euo pipefail

echo "==> Installing build tools"
pacman -Syu --noconfirm --needed archiso nodejs npm git rsync zstd

echo "==> Building the app"
rsync -a --exclude node_modules --exclude dist --exclude release --exclude stb/out --exclude test/e2e/media /app/ /build/app/
cd /build/app
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npx vite build
npx electron-builder --linux dir --publish never
# Tarball keeps executable bits/setuid layout (archiso resets modes of airootfs files).
mkdir -p /build/payload
tar -C release/linux-unpacked -I 'zstd -19 -T0' -cf /build/payload/oled-iptv.tar.zst .

echo "==> Preparing archiso profile"
cp -r /usr/share/archiso/configs/releng /build/profile
rsync -a /kit/overlay/ /build/profile/
mkdir -p /build/profile/airootfs/opt/stb-payload
cp /build/payload/oled-iptv.tar.zst /build/profile/airootfs/opt/stb-payload/

# Extra live-environment packages the installer uses.
for p in arch-install-scripts gptfdisk dosfstools e2fsprogs iwd iw zstd; do
  grep -qx "$p" /build/profile/packages.x86_64 || echo "$p" >> /build/profile/packages.x86_64
done

# Branding + start installer on tty1 after the automatic root login.
sed -i \
  -e 's/^iso_name=.*/iso_name="oled-iptv-installer"/' \
  -e 's/^iso_label=.*/iso_label="OLEDIPTV_$(date --date="@${SOURCE_DATE_EPOCH:-$(date +%s)}" +%Y%m)"/' \
  -e 's/^iso_publisher=.*/iso_publisher="OLED IPTV"/' \
  -e 's/^iso_application=.*/iso_application="OLED IPTV set-top box installer"/' \
  /build/profile/profiledef.sh
cat >> /build/profile/airootfs/root/.zlogin <<'EOF'

# OLED IPTV: run the set-top-box installer once, on the first console.
if [[ "$(tty)" == /dev/tty1 && ! -e /tmp/.stb-started ]]; then
  touch /tmp/.stb-started
  bash /root/stb-install.sh
fi
EOF

echo "==> Building ISO"
mkarchiso -v -w /build/work -o /out /build/profile
chown "${HOST_UID:-0}:${HOST_GID:-0}" /out/*.iso
