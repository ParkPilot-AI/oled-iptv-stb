#!/bin/sh
# Make the TV's HDMI audio the default output.
# Override with STB_AUDIO=analog in /etc/environment to keep the headphone jack.
[ "${STB_AUDIO:-hdmi}" = "hdmi" ] || exit 0
# The user picked another output in the app (Settings → Audio output): leave it.
grep -Eqs '"audioDevice"[[:space:]]*:[[:space:]]*"pa:' "$HOME/.config/OLED IPTV/settings.json" && exit 0

# Wait up to 20 s for PipeWire's pulse server.
i=0
until pactl info >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 20 ] && exit 0; sleep 1
done

# Switch the first card that has an available HDMI profile to it.
pactl list cards | awk '
  /^[[:space:]]*Name: /         { card = $2 }
  /output:hdmi-stereo[^ ]*: .*available: yes/ && !done {
      p = $1; sub(/:$/, "", p); print card, p; done = 1 }
' | while read -r card profile; do
  pactl set-card-profile "$card" "$profile"
done

sleep 1
sink=$(pactl list short sinks | awk 'tolower($2) ~ /hdmi/ { print $2; exit }')
[ -n "$sink" ] && pactl set-default-sink "$sink"
exit 0
