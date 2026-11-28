// ONYX colour themes. Accents go on moving things (focus ring, selected pill,
// progress) — text stays neutral and LIVE is always red, so nothing coloured
// sits still on an OLED panel for hours.
export const THEMES = {
  amber: { name: 'Cinema Amber', accent: '#F59E0B', fill: 'rgba(245, 158, 11, 0.14)', badge: '#FDE68A', ink: '#000000' },
  cyan: { name: 'Ice Cyan', accent: '#06B6D4', fill: 'rgba(6, 182, 212, 0.14)', badge: '#67E8F9', ink: '#000000' },
  crimson: { name: 'Cinema Ruby', accent: '#E11D48', fill: 'rgba(225, 29, 72, 0.15)', badge: '#FB7185', ink: '#FFFFFF' },
  violet: { name: 'Electric Violet', accent: '#8B5CF6', fill: 'rgba(139, 92, 246, 0.15)', badge: '#C4B5FD', ink: '#FFFFFF' },
  mono: { name: 'Monochrome', accent: '#FFFFFF', fill: '#1F1F1F', badge: '#D4D4D8', ink: '#000000', glow: 'rgba(255, 255, 255, 0.25)' },

  // Bold themes: deep, saturated brand-style colours, a stronger glow and thicker
  // focus ring, plus a very dark wash of the colour behind the menus. The wash is
  // kept near black (≈2–3% brightness) so it's gentle on an OLED panel.
  red: {
    name: 'Studio Red',
    bold: true,
    accent: '#E50914',
    fill: 'rgba(229, 9, 20, 0.24)',
    badge: '#FF6B6B',
    ink: '#FFFFFF',
    glow: 'rgba(229, 9, 20, 0.55)',
    wash: '#1F0204',
  },
  green: {
    name: 'Arena Green',
    bold: true,
    accent: '#76B900',
    fill: 'rgba(118, 185, 0, 0.22)',
    badge: '#B6F04F',
    ink: '#000000',
    glow: 'rgba(118, 185, 0, 0.5)',
    wash: '#0B1500',
  },
  blue: {
    name: 'Royal Blue',
    bold: true,
    accent: '#0A5CFF',
    fill: 'rgba(10, 92, 255, 0.24)',
    badge: '#7AA7FF',
    ink: '#FFFFFF',
    glow: 'rgba(10, 92, 255, 0.55)',
    wash: '#020A1F',
  },
  purple: {
    name: 'Stream Purple',
    bold: true,
    accent: '#9146FF',
    fill: 'rgba(145, 70, 255, 0.24)',
    badge: '#C9A6FF',
    ink: '#FFFFFF',
    glow: 'rgba(145, 70, 255, 0.55)',
    wash: '#10051F',
  },
  orange: {
    name: 'Molten Orange',
    bold: true,
    accent: '#FF5A00',
    fill: 'rgba(255, 90, 0, 0.24)',
    badge: '#FFA366',
    ink: '#000000',
    glow: 'rgba(255, 90, 0, 0.5)',
    wash: '#1F0A00',
  },
};
export const DEFAULT_THEME = 'amber';

export function applyTheme(id) {
  const t = THEMES[id] || THEMES[DEFAULT_THEME];
  const s = document.documentElement.style;
  s.setProperty('--accent', t.accent);
  s.setProperty('--accent-fill', t.fill);
  s.setProperty('--accent-ink', t.ink);
  s.setProperty('--badge', t.badge);
  s.setProperty('--accent-glow', t.glow || 'transparent');
  s.setProperty('--ring-width', t.bold ? '3px' : '2px');
  s.setProperty('--bg-wash', t.wash ? `radial-gradient(120% 80% at 50% -10%, ${t.wash} 0%, #000 70%)` : 'none');
  document.documentElement.dataset.themeStyle = t.bold ? 'bold' : 'classic';
  document.documentElement.dataset.theme = id in THEMES ? id : DEFAULT_THEME;
}
