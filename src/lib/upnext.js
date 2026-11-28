// "Up next" card rules for episodes (shown by the playback overlay).

export const UP_NEXT_AT = 30; // seconds before the end
export const UP_NEXT_COUNTDOWN = 10;

/** Show the "Up next" card: an episode with a next one, in its last 30 s, not dismissed. */
export function upNextShown(st, dismissedKey) {
  if (!st || st.kind !== 'episode' || !st.next || st.error) return false;
  if (!(st.dur > 120) || dismissedKey === `${st.item.kind}:${st.item.id}`) return false;
  return st.dur - st.pos <= UP_NEXT_AT;
}
