// ONYX colour themes. Accents go on moving things (focus ring, selected pill,
// progress) — text stays neutral and LIVE is always red, so nothing coloured
// sits still on an OLED panel for hours.
export const THEMES = {
  amber: { name: 'Cinema Amber', accent: '#F59E0B', fill: 'rgba(245, 158, 11, 0.14)', badge: '#FDE68A', ink: '#000000' },
  cyan: { name: 'Ice Cyan', accent: '#06B6D4', fill: 'rgba(6, 182, 212, 0.14)', badge: '#67E8F9', ink: '#000000' },
  crimson: { name: 'Cinema Ruby', accent: '#E11D48', fill: 'rgba(225, 29, 72, 0.15)', badge: '#FB7185', ink: '#FFFFFF' },
  violet: { name: 'Electric Violet', accent: '#8B5CF6', fill: 'rgba(139, 92, 246, 0.15)', badge: '#C4B5FD', ink: '#FFFFFF' },
  mono: { name: 'Monochrome', accent: '#FFFFFF', fill: '#1F1F1F', badge: '#D4D4D8', ink: '#000000', glow: 'rgba(255, 255, 255, 0.25)' },
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
  document.documentElement.dataset.theme = id in THEMES ? id : DEFAULT_THEME;
}
