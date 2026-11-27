#!/usr/bin/env bash
# OLED IPTV set-top box installer (runs in the live USB environment).
# Wipes ONE chosen disk and installs: minimal Arch + Intel VA-API + mpv +
# X11/Openbox/picom kiosk session that auto-starts the app on boot.
set -uo pipefail

FILES=/root/stb-files
PAYLOAD=/opt/stb-payload/oled-iptv.tar.zst
REPO_DIR=/opt/stb-repo # offline package repository shipped on the USB stick
MNT=/mnt
LOG=/root/stb-install.log
exec > >(tee -a "$LOG") 2>&1

# Big, readable console font on 4K TVs, and a left margin on every line so TVs
# that crop the picture edges (overscan) don't cut text off.
setfont ter-v32b 2>/dev/null || setfont ter-v28b 2>/dev/null || true
M='      '
indent() { sed -u "s/^/$M/"; }
c_b=$'\e[1m'; c_g=$'\e[32m'; c_r=$'\e[31m'; c_y=$'\e[33m'; c_0=$'\e[0m'
p()    { printf '%s%s\n' "$M" "$*"; }
say()  { printf '\n%s%s==>%s %s\n' "$M" "$c_g" "$c_0" "$*"; }
warn() { printf '%s%s!!%s %s\n' "$M" "$c_y" "$c_0" "$*"; }
die()  { printf '\n%s%sERROR:%s %s\n%sLog: %s\n%sType  bash /root/stb-install.sh  to try again.\n' "$M" "$c_r" "$c_0" "$*" "$M" "$LOG" "$M"; exit 1; }
ask()  { local __v; read -r -p "$M$1" __v; printf '%s' "$__v"; }
online() { ping -c1 -W3 archlinux.org >/dev/null 2>&1; }

clear
printf '\n\n'
indent <<EOF
${c_b}┌──────────────────────────────────────────────┐
│        OLED IPTV  ·  set-top box installer    │
└──────────────────────────────────────────────┘${c_0}
This will ERASE one disk and turn this PC into a dedicated
IPTV box that boots straight into the player.

Press Ctrl+C at any time to cancel and get a shell.
EOF
OFFLINE=0
[[ -f $REPO_DIR/stb.db ]] && OFFLINE=1

# ---------------------------------------------------------------- checks
[[ -d /sys/firmware/efi/efivars ]] || die "This PC booted in legacy BIOS mode. In the BIOS setup (F2 on Dell) set Boot Mode to UEFI, disable Secure Boot, and boot the USB again."
[[ -f $PAYLOAD ]] || die "App payload missing from the USB image ($PAYLOAD)."

# ---------------------------------------------------------------- Wi-Fi
say "Network"
# Wi-Fi goes through NetworkManager (wpa_supplicant). iwd cannot scan with some
# Realtek USB dongles (rtl8xxxu, e.g. TP-Link TL-WN725N); this stack can.
# USB dongles must never be power-suspended either.
echo -1 > /sys/module/usbcore/parameters/autosuspend 2>/dev/null || true
for f in /sys/bus/usb/devices/*/power/control; do echo on > "$f" 2>/dev/null || true; done
systemctl stop iwd systemd-networkd 2>/dev/null || true
has_wifi() { for d in /sys/class/net/*; do [[ -d $d/wireless ]] && return 0; done; return 1; }
# If iwd ran earlier it may have removed the interface: reload the USB Wi-Fi drivers.
if ! has_wifi; then
  for m in rtl8xxxu r8188eu rtw88_8821cu rtw88_8822bu mt7601u mt76x2u ath9k_htc; do
    if lsmod | grep -q "^$m "; then modprobe -r "$m" 2>/dev/null; modprobe "$m" 2>/dev/null; fi
  done
  for _ in $(seq 1 10); do has_wifi && break; sleep 1; done
fi
install -Dm644 "$FILES/nm-stb.conf" /etc/NetworkManager/conf.d/stb.conf
systemctl restart NetworkManager 2>/dev/null || true
for _ in $(seq 1 20); do nmcli -t general status >/dev/null 2>&1 && break; sleep 1; done
nmcli radio wifi on 2>/dev/null || true
sleep 3
WIFI_DEV=$(for d in /sys/class/net/*; do [[ -d $d/wireless ]] && basename "$d"; done | head -n1)

# Rescan, print the list. Succeeds if at least one network was found.
scan_networks() {
  nmcli dev wifi rescan ifname "$WIFI_DEV" >/dev/null 2>&1
  sleep 8
  local out
  out=$(nmcli -f SSID,SECURITY,SIGNAL,BARS dev wifi list ifname "$WIFI_DEV" --rescan no 2>/dev/null | awk 'NR==1 || $1 != "--"')
  if (( $(grep -c . <<<"$out") > 1 )); then
    printf '%s\n' "$out" | sed -n '1,20p' | indent
    return 0
  fi
  return 1
}

if [[ -n $WIFI_DEV ]]; then
  drv=$(basename "$(readlink -f "/sys/class/net/$WIFI_DEV/device/driver")" 2>/dev/null)
  p "Wi-Fi adapter: $WIFI_DEV${drv:+ ($drv)}"
  [[ $OFFLINE == 1 ]] && p "(Packages are on this USB stick, so Wi-Fi is only set up for the box itself.)"
  p "Scanning for networks..."
  for attempt in 1 2 3 4 5 6; do
    if scan_networks; then
      if online; then
        SSID=$(ask "Wi-Fi network name for the box (Enter to skip, already online): ")
        [[ -z $SSID ]] && break
      else
        SSID=$(ask "Wi-Fi network name (exactly as shown, Enter to rescan, s to skip): ")
        [[ -z $SSID ]] && continue
      fi
    else
      warn "No networks found yet."
      SSID=$(ask "Press Enter to scan again, type your network name, or s to skip: ")
      [[ -z $SSID ]] && continue
    fi
    if [[ $SSID == s || $SSID == S ]]; then
      SSID=""
      break
    fi
    read -r -s -p "${M}Password for \"$SSID\" (Enter if none): " PSK; echo
    nmcli connection delete id "$SSID" >/dev/null 2>&1 || true
    if [[ -n $PSK ]]; then
      nmcli dev wifi connect "$SSID" password "$PSK" ifname "$WIFI_DEV" 2>&1 | indent
    else
      nmcli dev wifi connect "$SSID" ifname "$WIFI_DEV" 2>&1 | indent
    fi
    for _ in $(seq 1 25); do online && break; sleep 1; done
    if online; then p "${c_g}Connected.${c_0}"; break; fi
    warn "Could not connect (attempt $attempt/6). Check the name and password."
  done
  [[ -z ${SSID:-} ]] && p "Skipping Wi-Fi: you can connect later in the app (Settings > System > Wi-Fi)."
else
  warn "No Wi-Fi adapter found. Using Ethernet if plugged in."
  p "Tip: plug the USB Wi-Fi adapter in before booting the installer."
fi
# Ethernet (if plugged in) is handled by NetworkManager automatically.
for _ in $(seq 1 15); do online && break; sleep 1; done
if ! online; then
  if [[ $OFFLINE == 1 ]]; then
    warn "No internet right now. That's OK: everything installs from the USB stick."
  else
    die "No internet connection. Plug in Ethernet or re-run and check the Wi-Fi details."
  fi
fi

# The live USB picks mirrors at boot, before Wi-Fi was up: make sure we have some
# (used for the online fallback and copied to the box for future updates).
if online && ! grep -q '^Server' /etc/pacman.d/mirrorlist; then
  say "Selecting fast package mirrors"
  systemctl stop reflector.service 2>/dev/null || true
  timeout 90 reflector --protocol https --latest 15 --sort rate --save /etc/pacman.d/mirrorlist 2>/dev/null || true
  grep -q '^Server' /etc/pacman.d/mirrorlist ||
    echo 'Server = https://geo.mirror.pkgbuild.com/$repo/os/$arch' > /etc/pacman.d/mirrorlist
fi
timedatectl set-ntp true 2>/dev/null || true

# ---------------------------------------------------------------- disk
say "Choose the disk to ERASE"
# The USB stick we booted from must never be offered: find it via the mounted
# boot medium, or via the ISO label passed on the kernel command line.
boot_part=$(findmnt -no SOURCE /run/archiso/bootmnt 2>/dev/null)
if [[ -z $boot_part ]]; then
  label=$(sed -n 's/.*archisolabel=\([^ ]*\).*/\1/p' /proc/cmdline)
  [[ -n $label ]] && boot_part=$(blkid -L "$label" 2>/dev/null)
fi
BOOT_DEV=$( [[ -n $boot_part ]] && lsblk -no PKNAME "$boot_part" 2>/dev/null | head -n1 )
[[ -z $BOOT_DEV && -n $boot_part ]] && BOOT_DEV=$(basename "$boot_part")
mapfile -t DISKS < <(lsblk -dpno NAME,TYPE,RM | awk '$2=="disk"{print $1}' | grep -v -e "^/dev/${BOOT_DEV:-none}$" -e '/dev/zram' -e '/dev/loop')
[[ ${#DISKS[@]} -gt 0 ]] || die "No internal disk found. In the BIOS, set SATA/NVMe mode to AHCI (not RAID)."
i=1
for d in "${DISKS[@]}"; do
  printf '%s  %d) %s  %s  %s\n' "$M" "$i" "$d" "$(lsblk -dno SIZE "$d")" "$(lsblk -dno MODEL "$d" | xargs)"
  i=$((i + 1))
done
if [[ ${#DISKS[@]} -eq 1 ]]; then
  DISK=${DISKS[0]}
else
  DISK=""
  while [[ -z $DISK ]]; do
    n=$(ask "Type the NUMBER of the disk to erase (1-${#DISKS[@]}): ")
    n=${n// /}
    if [[ $n =~ ^[0-9]+$ ]] && (( n >= 1 && n <= ${#DISKS[@]} )); then
      DISK=${DISKS[$((n - 1))]}
    else
      # Also accept a device name such as /dev/sda or sda.
      for d in "${DISKS[@]}"; do [[ $n == "$d" || "/dev/$n" == "$d" ]] && DISK=$d; done
      [[ -z $DISK ]] && warn "Not a valid choice — type 1 to ${#DISKS[@]}."
    fi
  done
fi
echo
p "${c_r}${c_b}ALL DATA on $DISK ($(lsblk -dno SIZE "$DISK")) will be permanently erased.${c_0}"
[[ $(ask "Type YES to continue: ") == YES ]] || die "Cancelled — nothing was changed."

# ---------------------------------------------------------------- settings
say "Settings (press Enter to accept the default in brackets)"
TZ_=$(ask "Time zone [Europe/London]: "); TZ_=${TZ_:-Europe/London}
[[ -f /usr/share/zoneinfo/$TZ_ ]] || { warn "Unknown time zone, using Europe/London"; TZ_=Europe/London; }
KB=$(ask "Keyboard layout [gb]: "); KB=${KB:-gb}
HOST=$(ask "Box name on the network [iptv-box]: "); HOST=${HOST:-iptv-box}
DEFAULT_REPO=$(cat /root/stb-files/update-repo 2>/dev/null)
echo
p "One-button updates download new app builds from a GitHub repository."
UPD_REPO=$(ask "GitHub repo for app updates [${DEFAULT_REPO:-none}]: "); UPD_REPO=${UPD_REPO:-$DEFAULT_REPO}
UPD_TOKEN=""
if [[ -n $UPD_REPO ]]; then
  p "If that repo is PRIVATE, paste a read-only GitHub token (fine-grained, Contents: read)."
  read -r -s -p "${M}GitHub token (Enter to skip): " UPD_TOKEN; echo
fi
p "A maintenance login 'tv' is created (Ctrl+Alt+F2 on the box)."
while true; do
  read -r -s -p "${M}Choose a password for user 'tv': " PW1; echo
  read -r -s -p "${M}Repeat password: " PW2; echo
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
mapfile -t PKGS < <(grep -v '^[[:space:]]*#' "$FILES/packages.txt" | tr -s ' \t' '\n' | grep -v '^$')
if [[ $OFFLINE == 1 ]]; then
  say "Installing system packages from the USB stick (no download needed)"
  # Packages were downloaded and signature-checked when the ISO was built.
  cat > /tmp/pacman-offline.conf <<CONF
[options]
Architecture = auto
SigLevel = Never
[stb]
Server = file://$REPO_DIR
CONF
  if ! pacstrap -C /tmp/pacman-offline.conf -K "$MNT" "${PKGS[@]}" 2>&1 | indent; then
    warn "Offline install failed, trying to download instead."
    online || die "Offline install failed and there is no internet connection."
    pacstrap -K "$MNT" "${PKGS[@]}" 2>&1 | indent || die "pacstrap failed (network or mirror problem). Re-run to retry."
  fi
else
  say "Installing system packages (a few minutes, depends on your connection)"
  pacstrap -K "$MNT" "${PKGS[@]}" 2>&1 | indent || die "pacstrap failed (network or mirror problem). Re-run to retry."
fi
[[ -x $MNT/usr/bin/pacman ]] || die "System packages did not install correctly (see $LOG)."
# Future updates (Settings → Update system) need online mirrors on the box.
if grep -q '^Server = http' /etc/pacman.d/mirrorlist; then
  cp /etc/pacman.d/mirrorlist "$MNT/etc/pacman.d/mirrorlist"
else
  printf '%s\n' 'Server = https://geo.mirror.pkgbuild.com/$repo/os/$arch' 'Server = https://mirror.rackspace.com/archlinux/$repo/os/$arch' > "$MNT/etc/pacman.d/mirrorlist"
fi

# ---------------------------------------------------------------- app
say "Installing OLED IPTV"
mkdir -p "$MNT/opt/oled-iptv"
tar -C "$MNT/opt/oled-iptv" -I zstd -xf "$PAYLOAD" || die "Could not unpack the app"
chown -R root:root "$MNT/opt/oled-iptv"
chown root:root "$MNT/opt/oled-iptv/chrome-sandbox" && chmod 4755 "$MNT/opt/oled-iptv/chrome-sandbox"
ln -sf /opt/oled-iptv/oled-iptv-player "$MNT/usr/local/bin/oled-iptv-player"

# ---------------------------------------------------------------- configure
say "Configuring the system"
genfstab -U "$MNT" >> "$MNT/etc/fstab"
echo "$HOST" > "$MNT/etc/hostname"
printf 'KEYMAP=%s\nFONT=ter-v32b\n' "${KB/gb/uk}" > "$MNT/etc/vconsole.conf"
mkdir -p "$MNT/etc/X11/xorg.conf.d"
cat > "$MNT/etc/X11/xorg.conf.d/00-keyboard.conf" <<EOF
Section "InputClass"
    Identifier "keyboard"
    MatchIsKeyboard "on"
    Option "XkbLayout" "$KB"
EndSection
EOF

# Network: NetworkManager handles Wi-Fi (wpa_supplicant) and Ethernet; DNS via
# systemd-resolved. The Wi-Fi profile made in the installer is copied over.
install -Dm644 "$FILES/nm-stb.conf" "$MNT/etc/NetworkManager/conf.d/stb.conf"
mkdir -p "$MNT/etc/NetworkManager/system-connections"
cp -a /etc/NetworkManager/system-connections/*.nmconnection "$MNT/etc/NetworkManager/system-connections/" 2>/dev/null || true
chmod 600 "$MNT"/etc/NetworkManager/system-connections/* 2>/dev/null || true

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

systemctl enable NetworkManager systemd-resolved systemd-timesyncd >/dev/null 2>&1
systemctl mask NetworkManager-wait-online.service systemd-networkd-wait-online.service >/dev/null 2>&1

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
options root=PARTUUID=$ROOT_UUID rw quiet loglevel=3 rd.udev.log_level=3 systemd.show_status=false vt.global_cursor_default=0 i915.fastboot=1 nowatchdog usbcore.autosuspend=-1
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

# One-button updater: root helper, a sudo rule that allows only it, and its config.
install -Dm755 -o root -g root "$FILES/stb-update" "$MNT/usr/local/sbin/stb-update"
install -Dm440 /dev/stdin "$MNT/etc/sudoers.d/20-stb-update" <<'SUDO'
tv ALL=(root) NOPASSWD: /usr/local/sbin/stb-update
SUDO
install -Dm600 /dev/stdin "$MNT/etc/stb/update.conf" <<CONF
# Used by /usr/local/sbin/stb-update (Settings → Update system).
REPO="$UPD_REPO"
GITHUB_TOKEN="$UPD_TOKEN"
CONF
touch "$H/.hushlogin"
arch-chroot "$MNT" chown -R tv:tv /home/tv

sync
umount -R "$MNT"

say "Done!"
indent <<EOF

${c_b}Remove the USB stick, then press Enter to reboot.${c_0}
The box will boot straight into OLED IPTV. Add your provider
on the first screen.

Maintenance: Ctrl+Alt+F2 → log in as 'tv'.  (Ctrl+Alt+F1 returns.)
EOF
read -r
reboot
