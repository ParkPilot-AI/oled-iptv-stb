// Settings → mpv properties for picture and sound. Pure (tested in test/subs-audio.test.mjs);
// the player applies them at start-up and live whenever a setting changes.

const ASPECT = { auto: '-1', '16:9': '16:9', '4:3': '4:3', '21:9': '2.35:1' };
const SCALE = { fast: 'bilinear', standard: 'spline36', high: 'ewa_lanczossharp' };
const TONEMAP = { auto: 'auto', natural: 'bt.2390', bright: 'hable' };
// Night mode: gentle compressor + make-up gain so dialogue stays audible at low volume.
const NIGHT_AF = 'lavfi=[acompressor=threshold=-24dB:ratio=4:attack=20:release=250:makeup=6]';
const LEVEL_AF = 'lavfi=[dynaudnorm=f=300:g=21:p=0.9]';

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

export function videoProps(s = {}) {
  const aspect = s.aspect || 'auto';
  return {
    brightness: clampInt(s.brightness, -50, 50),
    contrast: clampInt(s.contrast, -50, 50),
    saturation: clampInt(s.saturation, -50, 50),
    gamma: clampInt(s.gamma, -50, 50),
    'video-aspect-override': ASPECT[aspect] || '-1',
    keepaspect: aspect !== 'stretch',
    panscan: aspect === 'zoom' ? 1 : 0,
    scale: SCALE[s.upscaling] || SCALE.standard,
    deband: !!s.deband,
    'tone-mapping': TONEMAP[s.toneMapping] || 'auto',
    deinterlace: s.deinterlace ? 'yes' : 'no',
  };
}

export function audioProps(s = {}) {
  return {
    'audio-delay': clampInt(s.audioDelayMs, -1000, 1000) / 1000,
    af: s.nightMode === 'night' ? NIGHT_AF : s.nightMode === 'level' ? LEVEL_AF : '',
    'audio-spdif': s.passthrough ? 'ac3,eac3,dts,dts-hd,truehd' : '',
    'audio-channels': s.speakers === 'stereo' ? 'stereo' : 'auto-safe',
    alang: s.audioLang && s.audioLang !== 'auto' ? langList(s.audioLang) : '',
  };
}

// Track language codes vary (en / eng / English); mpv matches any in the list.
const ALIASES = {
  en: 'en,eng', es: 'es,spa', fr: 'fr,fre,fra', de: 'de,ger,deu', it: 'it,ita', pt: 'pt,por', nl: 'nl,dut,nld',
  pl: 'pl,pol', tr: 'tr,tur', ar: 'ar,ara', hi: 'hi,hin', ur: 'ur,urd', ro: 'ro,rum,ron', el: 'el,gre,ell', sv: 'sv,swe',
};
export const langList = (code) => ALIASES[code] || code;

/** Video settings that are changed back to normal by "Reset picture". */
export const PICTURE_DEFAULTS = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
  aspect: 'auto',
  upscaling: 'standard',
  deband: false,
  toneMapping: 'auto',
  deinterlace: false,
};
