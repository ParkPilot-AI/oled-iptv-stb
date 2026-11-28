// Human-readable names for mpv audio/subtitle tracks ("Audio: English · AC3 5.1 (2/3)").
// Pure: used by player.js after `cycle aid` / `cycle sid`. Tested in test/tracks.test.mjs.

const LANG = {
  en: 'English', eng: 'English', es: 'Spanish', spa: 'Spanish', fr: 'French', fre: 'French', fra: 'French',
  de: 'German', ger: 'German', deu: 'German', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese',
  nl: 'Dutch', dut: 'Dutch', nld: 'Dutch', pl: 'Polish', pol: 'Polish', tr: 'Turkish', tur: 'Turkish',
  ar: 'Arabic', ara: 'Arabic', hi: 'Hindi', hin: 'Hindi', ur: 'Urdu', urd: 'Urdu', ro: 'Romanian', rum: 'Romanian',
  ron: 'Romanian', el: 'Greek', gre: 'Greek', ell: 'Greek', sv: 'Swedish', swe: 'Swedish', ru: 'Russian', rus: 'Russian',
  ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
  da: 'Danish', dan: 'Danish', no: 'Norwegian', nor: 'Norwegian', fi: 'Finnish', fin: 'Finnish',
};
const CODEC = { ac3: 'AC3', eac3: 'E-AC3', aac: 'AAC', dts: 'DTS', truehd: 'TrueHD', mp3: 'MP3', opus: 'Opus', flac: 'FLAC', mp2: 'MP2', vorbis: 'Vorbis' };
const SUBCODEC = { subrip: 'SRT', ass: 'ASS', mov_text: 'Text', webvtt: 'WebVTT', hdmv_pgs_subtitle: 'PGS', dvd_subtitle: 'DVD', dvb_subtitle: 'DVB' };

function channels(n) {
  if (!n) return '';
  if (n === 1) return 'Mono';
  if (n === 2) return 'Stereo';
  if (n === 6) return '5.1';
  if (n === 8) return '7.1';
  return `${n}ch`;
}

const langName = (l) => (l ? LANG[String(l).toLowerCase()] || String(l).toUpperCase() : '');

/** "Audio: English · AC3 5.1 (2/3)" or "Subtitles: Off". type: 'audio' | 'sub'. */
export function describeTrack(trackList, type) {
  const list = (trackList || []).filter((t) => t.type === type);
  const label = type === 'audio' ? 'Audio' : 'Subtitles';
  const cur = list.find((t) => t.selected);
  if (!cur) return `${label}: ${list.length ? 'Off' : 'none in this stream'}`;
  const name = langName(cur.lang) || cur.title || `Track ${cur.id}`;
  const extra =
    type === 'audio'
      ? [CODEC[cur.codec] || (cur.codec || '').toUpperCase(), channels(cur['demux-channel-count'] || cur['audio-channels'])].filter(Boolean).join(' ')
      : [cur.forced ? 'Forced' : '', SUBCODEC[cur.codec] || ''].filter(Boolean).join(' ');
  const title = cur.title && langName(cur.lang) && !new RegExp(langName(cur.lang), 'i').test(cur.title) ? ` (${cur.title})` : '';
  const pos = list.length > 1 ? ` (${list.indexOf(cur) + 1}/${list.length})` : '';
  return `${label}: ${name}${title}${extra ? ` · ${extra}` : ''}${pos}`;
}
