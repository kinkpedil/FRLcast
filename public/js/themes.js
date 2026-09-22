// Overlay templates.
//
// A theme is a set of colour and shape tokens, nothing more. Every widget already draws
// itself from those tokens, so a template changes how the whole broadcast looks without
// any widget knowing that themes exist — and a widget added later inherits every theme
// for free.
//
// The visual definitions live in overlay.css under `html[data-theme="..."]`. This file is
// the catalogue: it exists so the panel can list them and so switching a theme can adopt
// its accent, which is the difference between one decision and two.

// `radius` lives here rather than in the stylesheet because the operator's own radius
// slider writes an inline style on the root element, which beats any rule a theme could
// declare. Adopting the value on switch keeps one source of truth and leaves the slider
// working afterwards.
export const THEMES = [
  {
    id: 'midnight',
    radius: 10,
    name: 'Midnight',
    accent: '#00e0a4',
    note: 'The default. Near-black panels, teal accent, quiet lines.'
  },
  {
    id: 'carbon',
    radius: 2,
    name: 'Carbon',
    accent: '#ffffff',
    note: 'Hard black, white accent, hairline rules. Reads as motorsport television.'
  },
  {
    id: 'neon',
    radius: 10,
    name: 'Neon',
    accent: '#ff2bd1',
    note: 'High contrast with a glow. Loud on a dark stream, and meant to be.'
  },
  {
    id: 'ice',
    radius: 14,
    name: 'Ice',
    accent: '#5ac8fa',
    note: 'Cool blues on deep navy. Calm, easy to read over bright gameplay.'
  },
  {
    id: 'sunset',
    radius: 12,
    name: 'Sunset',
    accent: '#ff9f0a',
    note: 'Warm amber on brown-black. Suits evening and drift events.'
  },
  {
    id: 'paper',
    radius: 6,
    name: 'Paper',
    accent: '#c2410c',
    note: 'Light panels with dark text — the one to use over dark gameplay.'
  },
  {
    id: 'mono',
    radius: 4,
    name: 'Mono',
    accent: '#e5e5e5',
    note: 'No colour at all. Driver colours still show, nothing else competes with them.'
  },
  {
    id: 'retro',
    radius: 0,
    name: 'Retro',
    accent: '#ffb000',
    note: 'Amber terminal. Monospace throughout, square corners, scanline-era.'
  },
  {
    id: 'bold',
    radius: 20,
    name: 'Bold',
    accent: '#ffd60a',
    note: 'Heavy opaque panels and big radii. Holds up on a small phone screen.'
  },
  {
    id: 'broadcast',
    radius: 6,
    name: 'Broadcast',
    accent: '#d4af37',
    note: 'Deep navy and gold. The classic championship-coverage look.'
  }
];

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
