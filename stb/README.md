# OLED IPTV set-top box (Arch Linux auto-installer)

This kit builds a USB installer. It erases the OptiPlex's internal disk and installs a minimal Arch Linux system that boots straight into OLED IPTV, with no desktop or login screen.

**What the finished box runs**

| Layer | Choice | Why |
|---|---|---|
| Boot | UEFI + systemd-boot, `timeout 0`, quiet kernel, `i915.fastboot` | No menus or text, and no flicker when the display mode is set |
| Login | getty auto-login on tty1 → `startx`, no display manager | Fastest path from power-on to the app |
| Session | Xorg + Openbox (no decorations, menus or shortcuts) + picom | picom is needed so the see-through player overlay can sit above mpv |
| Video | mpv + `intel-media-driver` (VA-API) + Mesa | Hardware decoding of HEVC and H.264, including 4K |
| Audio | PipeWire, switched to HDMI automatically at login | Sound comes out of the TV, not the headphone jack |
| Network | iwd (Wi-Fi + DHCP), systemd-networkd (Ethernet), systemd-resolved | Lightweight. Boot doesn't wait for the network |
| App | `/opt/oled-iptv`, restarted automatically if it exits or crashes | Behaves like an appliance |

---

## 1. Build the USB (on your Xubuntu PC)

```bash
sudo apt install -y docker.io
cd iptv-player
sudo ./stb/build.sh
```
This takes about 15 minutes and needs internet. It produces `stb/out/oled-iptv-installer-YYYY.MM.DD-x86_64.iso` (about 1.3 GB).

Write the ISO to a USB stick (any size, 4 GB or more). **Everything on the stick is erased.** Check the stick's device name with `lsblk` first:
```bash
sudo dd if=stb/out/oled-iptv-installer-*.iso of=/dev/sdX bs=4M status=progress oflag=sync
```
You can also use balenaEtcher.

## 2. Prepare the OptiPlex BIOS (press F2 at power-on)

- **Boot mode:** UEFI (not Legacy).
- **Secure Boot:** Disabled.
- **SATA/NVMe operation:** AHCI (not RAID). Otherwise the installer can't see the disk.
- *Optional:* Power Management → **AC Recovery: Power On**, so the box starts by itself when power returns.

## 3. Install

1. Plug in the USB stick, a keyboard and the TV. Power on and press **F12**, then pick the USB stick.
2. The installer starts by itself and asks for:
   - your **Wi-Fi** network name and password (you can scroll the list it shows),
   - which **disk to erase** (you must type `YES`),
   - time zone, keyboard layout and box name (Enter accepts the defaults: Europe/London, gb),
   - a **password** for the maintenance user `tv`.
3. Wait about 5–10 minutes while it downloads and installs. Remove the USB stick when asked, then press Enter.
4. The box reboots into OLED IPTV. Add your provider on the first screen.

If anything fails, the error is shown along with the log at `/root/stb-install.log`. Type `bash /root/stb-install.sh` to try again.

## 4. Living with it

| Task | How |
|---|---|
| Maintenance shell | **Ctrl+Alt+F2**, log in as `tv` (sudo works). **Ctrl+Alt+F1** goes back to the TV |
| System updates | `sudo pacman -Syu` from the maintenance shell, then reboot |
| Restart the app | In the app choose **Settings → Exit app**. It relaunches in 2 seconds |
| Change Wi-Fi | `iwctl station wlan0 connect "NewNetwork"` |
| Keep audio on the headphone jack | `echo STB_AUDIO=analog | sudo tee -a /etc/environment` |
| Logs | `/tmp/oled-iptv.log` (app), `/tmp/xsession.log` (X) |
| Update everything | **Settings → System → Update system**. One button updates the Arch packages (`pacman -Syu`) and the OLED IPTV app (from the newest GitHub release, checksum-verified, old version kept in `/opt/oled-iptv.old`). The app then restarts; a reboot is offered if a new kernel was installed. Log: `/var/log/stb-update.log` |
| Check hardware decoding | Press **I** while playing. *HW decoding* should say `vaapi` |

## 5. One-button updates

The installer sets up three things:

* `/usr/local/sbin/stb-update` — a small root helper (`check`, `run`, `reboot`).
* `/etc/sudoers.d/20-stb-update` — lets the `tv` user run **only** that helper as root, without a password.
* `/etc/stb/update.conf` — where app builds come from: `REPO="owner/repo"`, and `GITHUB_TOKEN=""` if the repo is private. Use a fine-grained token with *Contents: read-only* on that one repo.

Every push to `main` builds a release with the installer ISO, `oled-iptv-app.tar.zst`, `app-version.txt` and `SHA256SUMS`. The updater compares `app-version.txt` with `/opt/oled-iptv/stb-version.txt`.

**A box installed from an older ISO** (before the updater existed): reinstall from a newer ISO, or from the maintenance shell copy `stb/overlay/airootfs/root/stb-files/stb-update` to `/usr/local/sbin/`, then create the sudoers file and config shown above:
```bash
sudo pacman -S --needed pacman-contrib jq
sudo install -m755 stb-update /usr/local/sbin/stb-update
echo 'tv ALL=(root) NOPASSWD: /usr/local/sbin/stb-update' | sudo tee /etc/sudoers.d/20-stb-update && sudo chmod 440 /etc/sudoers.d/20-stb-update
printf 'REPO="ParkPilot-AI/oled-iptv-stb"\nGITHUB_TOKEN="<token>"\n' | sudo install -Dm600 /dev/stdin /etc/stb/update.conf
```

## 6. Status

The scripts pass lint checks and the app build steps are the same ones I tested elsewhere. **The ISO build and the install itself have not been run yet**, because Arch package mirrors aren't reachable from the environment where this kit was written. Expect to need a small fix or two on first use. The log file shows exactly where anything stopped.
