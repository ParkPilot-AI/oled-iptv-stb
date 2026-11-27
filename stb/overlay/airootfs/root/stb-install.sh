#!/usr/bin/env bash
# OLED IPTV set-top box installer (runs in the live USB environment).
# Wipes ONE chosen disk and installs: minimal Arch + Intel VA-API + mpv +
# X11/Openbox/picom kiosk session that auto-starts the app on boot.
set -uo pipefail

FILES=/root/stb-files
PAYLOAD=/opt/stb-payload/oled-iptv.tar.zst
MNT=/mnt
LOG=/root/stb-install.log
exec > >(tee -a "$LOG") 2>&1

c_b=$'\e[1m'; c_g=$'\e[32m'; c_r=$'\e[31m'; c_y=$'\e[33m'; c_0=$'\e[0m'
say()  { printf '\n%s==>%s %s\n' "$c_g" "$c_0" "$*"; }
warn() { printf '%s!!%s %s\n' "$c_y" "$c_0" "$*"; }
die()  { printf '\n%sERROR:%s %s\nLog: %s\nType  bash /root/stb-install.sh  to try again.\n' "$c_r" "$c_0" "$*" "$LOG"; exit 1; }
ask()  { local __v; read -r -p "$1" __v; printf '%s' "$__v"; }
online() { ping -c1 -W3 archlinux.org >/dev/null 2>&1; }

clear
cat <<EOF
${c_b}
  ┌──────────────────────────────────────────────┐
  │        OLED IPTV  ·  set-top box installer    │
  └──────────────────────────────────────────────┘${c_0}
  This will ERASE one disk and turn this PC into a dedicated
  IPTV box that boots straight into the player.

  Press Ctrl+C at any time to cancel and get a shell.
EOF

# ---------------------------------------------------------------- checks
[[ -d /sys/firmware/efi/efivars ]] || die "This PC booted in legacy BIOS mode. In the BIOS setup (F2 on Dell) set Boot Mode to UEFI, disable Secure Boot, and boot the USB again."
[[ -f $PAYLOAD ]] || die "App payload missing from the USB image ($PAYLOAD)."

# ---------------------------------------------------------------- Wi-Fi
say "Network"
WIFI_DEV=$(for d in /sys/class/net/*; do [[ -d $d/wireless ]] && basename "$d"; done | head -n1)
if [[ -n $WIFI_DEV ]]; then
  echo "Wi-Fi adapter: $WIFI_DEV"
  for attempt in 1 2 3; do
    iwctl station "$WIFI_DEV" scan >/dev/null 2>&1; sleep 4
    echo; iwctl station "$WIFI_DEV" get-networks 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | sed -n '1,25p'
    if online; then
      SSID=$(ask "Wi-Fi network name for the box (Enter to skip — already online): ")
    else
      SSID=$(ask "Wi-Fi network name (exactly as shown above): ")
    fi
    [[ -z $SSID ]] && break
    read -r -s -p "Password for \"$SSID\": " PSK; echo
    if iwctl --passphrase "$PSK" station "$WIFI_DEV" connect "$SSID"; then
      for _ in $(seq 1 20); do online && break; sleep 1; done
    fi
    if online; then echo "${c_g}Connected.${c_0}"; break; fi
    warn "Could not connect (attempt $attempt/3). Check the name and password."
  done
else
  warn "No Wi-Fi adapter found — using Ethernet if plugged in."
fi
for _ in $(seq 1 15); do online && break; sleep 1; done
online || die "No internet connection. Plug in Ethernet or re-run and check the Wi-Fi details."

# The live USB picks mirrors at boot, before Wi-Fi was up: make sure we have some.
if ! grep -q '^Server' /etc/pacman.d/mirrorlist; then
  say "Selecting fast package mirrors"
  systemctl stop reflector.service 2>/dev/null || true
  timeout 90 reflector --protocol https --latest 15 --sort rate --save /etc/pacman.d/mirrorlist 2>/dev/null || true
  grep -q '^Server' /etc/pacman.d/mirrorlist ||
    echo 'Server = https://geo.mirror.pkgbuild.com/$repo/os/$arch' > /etc/pacman.d/mirrorlist
fi
timedatectl set-ntp true 2>/dev/null || true

# ---------------------------------------------------------------- disk
say "Choose the disk to ERASE"
BOOT_DEV=$(lsblk -no PKNAME "$(findmnt -no SOURCE /run/archiso/bootmnt 2>/dev/null)" 2>/dev/null || true)
mapfile -t DISKS < <(lsblk -dpno NAME,TYPE,RM | awk '$2=="disk"{print $1}' | grep -v -e "^/dev/${BOOT_DEV:-none}$" -e '/dev/zram' -e '/dev/loop')
[[ ${#DISKS[@]} -gt 0 ]] || die "No internal disk found. In the BIOS, set SATA/NVMe mode to AHCI (not RAID)."
i=1
for d in "${DISKS[@]}"; do
  printf '  %d) %s  %s  %s\n' "$i" "$d" "$(lsblk -dno SIZE "$d")" "$(lsblk -dno MODEL "$d" | xargs)"
  i=$((i + 1))
done
if [[ ${#DISKS[@]} -eq 1 ]]; then
  DISK=${DISKS[0]}
else
  n=$(ask "Number of the disk to use: ")
  [[ $n =~ ^[0-9]+$ ]] && (( n >= 1 && n <= ${#DISKS[@]} )) || die "Invalid choice."
  DISK=${DISKS[$((n - 1))]}
fi
echo
echo "${c_r}${c_b}ALL DATA on $DISK ($(lsblk -dno SIZE "$DISK")) will be permanently erased.${c_0}"
[[ $(ask "Type YES to continue: ") == YES ]] || die "Cancelled — nothing was changed."

# ---------------------------------------------------------------- settings
say "Settings (press Enter to accept the default in brackets)"
TZ_=$(ask "Time zone [Europe/London]: "); TZ_=${TZ_:-Europe/London}
[[ -f /usr/share/zoneinfo/$TZ_ ]] || { warn "Unknown time zone, using Europe/London"; TZ_=Europe/London; }
KB=$(ask "Keyboard layout [gb]: "); KB=${KB:-gb}
HOST=$(ask "Box name on the network [iptv-box]: "); HOST=${HOST:-iptv-box}
echo "A maintenance login 'tv' is created (Ctrl+Alt+F2 on the box)."
while true; do
  read -r -s -p "Choose a password for user 'tv': " PW1; echo
  read -r -s -p "Repeat password: " PW2; echo
  [[ -n $PW1 && $PW1 == "$PW2" ]] && break
  warn "Passwords empty or different, try again."
done

# ---------------------------------------------------------------- partition
say "Partitioning $DISK"
umount -R "$MNT" 2>/dev/null || true
wipefs -af "$DISK" >/dev/null || die "wipefs failed"
sgdisk -Z "$DISK" >/dev/null
sgdisk -n1:0:+1G -t1:ef00 -c1:STB_EFI -n2:0:0 -t2:8300 -c2:STB_ROOT "$DISK" >/dev/null || die "Partitioning failed"
partprobe "$DISK"; udevadm settle; sleep 2
EFI_PART=/dev/disk/by-partlabel/STB_EFI
ROOT_PART=/dev/disk/by-partlabel/STB_ROOT
[[ -e $EFI_PART && -e $ROOT_PART ]] || die "New partitions did not appear."
mkfs.fat -F32 -n STB_EFI "$EFI_PART" >/dev/null || die "mkfs.fat failed"
mkfs.ext4 -F -L STB_ROOT "$ROOT_PART" >/dev/null || die "mkfs.ext4 failed"
mount -o noatime "$ROOT_PART" "$MNT"
mount --mkdir "$EFI_PART" "$MNT/boot"

# ---------------------------------------------------------------- packages
say "Installing system packages (a few minutes, depends on your connection)"
PKGS=(
  base linux linux-firmware intel-ucode sudo
  iwd wireless-regdb
  mesa vulkan-intel intel-media-driver libva-utils
  xorg-server xorg-xinit xorg-xset openbox picom
  mpv ffmpeg
  pipewire pipewire-pulse pipewire-alsa wireplumber libpulse alsa-utils
  gtk3 nss alsa-lib libcups libxss libxtst at-spi2-core libdrm libxkbcommon libsecret
  noto-fonts ttf-dejavu
)
pacstrap -K "$MNT" "${PKGS[@]}" || die "pacstrap failed (network or mirror problem). Re-run to retry."

# ---------------------------------------------------------------- app
say "Installing OLED IPTV"
mkdir -p "$MNT/opt/oled-iptv"
tar -C "$MNT/opt/oled-iptv" -I zstd -xf "$PAYLOAD" || die "Could not unpack the app"
chown root:root "$MNT/opt/oled-iptv/chrome-sandbox" && chmod 4755 "$MNT/opt/oled-iptv/chrome-sandbox"
ln -sf /opt/oled-iptv/oled-iptv-player "$MNT/usr/local/bin/oled-iptv-player"

# ---------------------------------------------------------------- configure
say "Configuring the system"
genfstab -U "$MNT" >> "$MNT/etc/fstab"
echo "$HOST" > "$MNT/etc/hostname"
echo "KEYMAP=${KB/gb/uk}" > "$MNT/etc/vconsole.conf"
mkdir -p "$MNT/etc/X11/xorg.conf.d"
cat > "$MNT/etc/X11/xorg.conf.d/00-keyboard.conf" <<EOF
Section "InputClass"
    Identifier "keyboard"
    MatchIsKeyboard "on"
    Option "XkbLayout" "$KB"
EndSection
EOF

# Network: iwd handles Wi-Fi + DHCP; systemd-networkd handles Ethernet.
install -Dm644 "$FILES/iwd-main.conf" "$MNT/etc/iwd/main.conf"
install -Dm644 "$FILES/20-wired.network" "$MNT/etc/systemd/network/20-wired.network"
mkdir -p "$MNT/var/lib/iwd"
cp -a /var/lib/iwd/*.psk /var/lib/iwd/*.open "$MNT/var/lib/iwd/" 2>/dev/null || true
chmod 600 "$MNT"/var/lib/iwd/* 2>/dev/null || true

# Auto-login on tty1, no login banner.
install -Dm644 "$FILES/getty-autologin.conf" "$MNT/etc/systemd/system/getty@tty1.service.d/autologin.conf"

ROOT_UUID=$(blkid -s PARTUUID -o value "$ROOT_PART")
arch-chroot "$MNT" /bin/bash -e <<EOF
ln -sf /usr/share/zoneinfo/$TZ_ /etc/localtime
hwclock --systohc
sed -i 's/^#en_GB.UTF-8/en_GB.UTF-8/; s/^#en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
locale-gen >/dev/null
echo 'LANG=en_GB.UTF-8' > /etc/locale.conf

useradd -m -G wheel,video,audio,input -s /bin/bash tv
echo '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/10-wheel
chmod 440 /etc/sudoers.d/10-wheel

systemctl enable iwd systemd-networkd systemd-resolved systemd-timesyncd >/dev/null 2>&1
systemctl mask systemd-networkd-wait-online.service >/dev/null 2>&1

bootctl install >/dev/null 2>&1
EOF
[[ $? -eq 0 ]] || die "System configuration failed"
printf 'tv:%s\n' "$PW1" | arch-chroot "$MNT" chpasswd || die "Setting password failed"
ln -sf /run/systemd/resolve/stub-resolv.conf "$MNT/etc/resolv.conf"

# Bootloader: no menu, quiet boot straight into the box.
install -Dm644 "$FILES/loader.conf" "$MNT/boot/loader/loader.conf"
cat > "$MNT/boot/loader/entries/iptv.conf" <<EOF
title   OLED IPTV
linux   /vmlinuz-linux
initrd  /initramfs-linux.img
options root=PARTUUID=$ROOT_UUID rw quiet loglevel=3 rd.udev.log_level=3 systemd.show_status=false vt.global_cursor_default=0 i915.fastboot=1 nowatchdog
EOF
# Older mkinitcpio without the microcode hook: load it explicitly.
if ! grep -Eq '^HOOKS=.*\bmicrocode\b' "$MNT/etc/mkinitcpio.conf"; then
  sed -i 's|^initrd  /initramfs-linux.img|initrd  /intel-ucode.img\ninitrd  /initramfs-linux.img|' "$MNT/boot/loader/entries/iptv.conf"
fi
# Hide kernel messages on the console.
echo 'kernel.printk = 3 3 3 3' > "$MNT/etc/sysctl.d/20-quiet-printk.conf"

# Kiosk session for user tv.
H="$MNT/home/tv"
install -Dm644 "$FILES/bash_profile" "$H/.bash_profile"
install -Dm644 "$FILES/xinitrc" "$H/.xinitrc"
install -Dm755 "$FILES/openbox-autostart" "$H/.config/openbox/autostart"
install -Dm644 "$FILES/openbox-rc.xml" "$H/.config/openbox/rc.xml"
install -Dm644 "$FILES/picom.conf" "$H/.config/picom/picom.conf"
install -Dm755 "$FILES/stb-audio.sh" "$MNT/usr/local/bin/stb-audio"
touch "$H/.hushlogin"
arch-chroot "$MNT" chown -R tv:tv /home/tv

sync
umount -R "$MNT"

say "Done!"
cat <<EOF

  ${c_b}Remove the USB stick, then press Enter to reboot.${c_0}
  The box will boot straight into OLED IPTV. Add your provider
  on the first screen.

  Maintenance: Ctrl+Alt+F2 → log in as 'tv'.  (Ctrl+Alt+F1 returns.)
EOF
read -r
reboot
