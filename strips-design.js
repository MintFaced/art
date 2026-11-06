/* A //STRIP as bytes, and everything the chain says about it, in JavaScript.
 *
 * The on-chain renderer draws the still and reads the traits; this draws the
 * same still and reads the same traits, so the Maker can show exactly what will
 * be minted and the site can speak about a token without asking a node.
 * scripts/strips/test-chain.mjs holds the two together byte for byte.
 *
 * Nothing here lays a design out. It takes bands that already exist.
 */
import { decodeDesign, traitsOf, DISPLAYS, RHYTHMS } from './strips-blink.js';

export { decodeDesign, traitsOf };

export const RED_INDEX = 15;
export const STANDARD_RED_LINE = 16;
const RED = '#d32011';

const hex2 = (n) => n.toString(16).padStart(2, '0');
const hex4 = (n) => n.toString(16).padStart(4, '0');
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** The names the chain uses, in its order. */
export const DISPLAY_NAMES = ['Valve B&W', 'Colour CRT', 'Trinitron', 'VHS', 'Plasma', 'LCD', 'LED', 'LED wall', 'OLED', 'Digital signal'];
export const RHYTHM_NAMES = ['Calm', 'Restless', 'Haywire'];
export const FAULT_NAMES = {
  snow: 'Snow', vroll: 'Vertical roll', hhold: 'Horizontal hold', shrink: 'Picture shrink', dot: 'Switch-off dot', ghost: 'Ghosting', hum: 'Hum bars',
  convergence: 'Convergence drift', purity: 'Purity blotches', degauss: 'Degauss', gunloss: 'Gun loss', vcollapse: 'Vertical collapse', hcollapse: 'Horizontal collapse', pincushion: 'Pincushion', scanflicker: 'Interlace flicker',
  wires: 'Damper wires', burnin: 'Burn-in', bloom: 'Blooming', tilt: 'Tilt',
  tracking: 'Tracking', headswitch: 'Head switching', chroma: 'Chroma bleed', bluescreen: 'Blue screen', bars: 'Colour bars', tapecrease: 'Tape crease',
  retention: 'Image retention', contour: 'False contouring', deadline: 'Dead line', buzzflicker: 'Panel buzz',
  vlines: 'Vertical lines', hline: 'Row repeat', deadpixels: 'Dead pixels', bleed: 'Backlight bleed', halfdark: 'Half dark', crack: 'Cracked panel', tcon: 'Timing board fault', ripple: 'Pressure ripple',
  stripfail: 'LED strip failure', blooming: 'Halo blooming', pwm: 'PWM banding', dimzones: 'Zone pumping',
  deadmodule: 'Dead module', moduleshift: 'Module mismatch', scanrefresh: 'Scan refresh', seams: 'Cabinet seams',
  oledburn: 'Burn-in', pinktint: 'Pink tint', greenline: 'The green line', mura: 'Mura', blot: 'Panel damage', lowflicker: 'Low-light flicker',
  macroblock: 'Macroblocking', pixelate: 'Bandwidth drop', datamosh: 'Datamosh', sparkles: 'HDMI sparkles', nosignal: 'No signal',
};

/**
 * Pack a design. `colours` are hex strings; each band is {c, u}, c an index
 * into colours or RED_INDEX, u its height in relative units.
 */
export function pack({ portrait = false, length, width, colours, bands }) {
  let s = `0x${hex2(portrait ? 1 : 0)}${hex4(length)}${hex4(width)}${hex2(colours.length)}`;
  for (const c of colours) s += c.replace('#', '').toLowerCase();
  for (const b of bands) {
    /* A height past 15 would spill into the colour's bits and pack as a
       different design with no error, so it stops here. */
    if (!Number.isInteger(b.u) || b.u < 1 || b.u > 15) throw new Error(`a band's height is 1 to 15 units, not ${b.u}`);
    s += hex2((b.c << 4) | b.u);
  }
  return s;
}

/**
 * Pack strips as the layout hands them out, a colour and a measure each,
 * bottom first. The measures become relative units here and go no further.
 */
export function packStrips(strips, { length_cm, width_cm, orientation }, red) {
  const isRed = (hex) => hex.toUpperCase() === red.toUpperCase();
  const colours = [];
  for (const s of strips) {
    const hex = s.hex.toUpperCase();
    if (!isRed(hex) && !colours.includes(hex)) colours.push(hex);
  }
  const unit = strips.reduce((g, s) => gcd(g, s.mm), 0);
  return pack({
    portrait: orientation === 'portrait',
    length: length_cm,
    width: width_cm,
    colours,
    bands: strips.map((s) => ({ c: isRed(s.hex) ? RED_INDEX : colours.indexOf(s.hex.toUpperCase()), u: s.mm / unit })),
  });
}

/** Which band is the red line, counted from the bottom, the first being 1. */
export const redLineOf = (design) => design.bands.findIndex((b) => b.red) + 1;

function shape(hex) {
  const d = decodeDesign(hex);
  const s = String(hex).replace(/^0x/, '');
  const at = 6 + 3 * d.colours.length;
  const bands = [];
  for (let i = at; i * 2 < s.length; i++) {
    const b = parseInt(s.substr(i * 2, 2), 16);
    bands.push({ fill: (b >> 4) === RED_INDEX ? RED : d.colours[b >> 4].toLowerCase(), red: (b >> 4) === RED_INDEX, u: b & 15 });
  }
  return { ...d, bands, units: bands.reduce((n, b) => n + b.u, 0) };
}

/** The still, the same string StripsRenderer.still returns. */
export function stillSVG(hex) {
  const d = shape(hex);
  const across = d.width * d.units;
  const along = d.length * d.units;
  const [w, h] = d.portrait ? [across, along] : [along, across];
  let at = 0;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`;
  for (const b of d.bands) {
    const size = b.u * d.width;
    out += d.portrait
      ? `<rect x="${at}" width="${size}" height="${h}" fill="${b.fill}"/>`
      : `<rect y="${across - at - size}" width="${w}" height="${size}" fill="${b.fill}"/>`;
    at += size;
  }
  return `${out}</svg>`;
}

/** The attributes, the same list StripsRenderer.attributes returns. */
export function attributesOf(hex, { word = '', redeemed = false, no = 0, site = '' } = {}) {
  const d = shape(hex);
  const red = redLineOf(d);
  const out = [
    ['Length', `${d.length} cm`], ['Width', `${d.width} cm`], ['Orientation', d.portrait ? 'Portrait' : 'Landscape'],
    ['Colours', String(d.colours.length)], ['Red line', red === STANDARD_RED_LINE ? '16 (standard)' : String(red)],
  ];
  if (!word) out.push(['Signal', 'Tuning']);
  else {
    const t = traitsOf(word);
    out.push(['Display', DISPLAY_NAMES[t.display]]);
    for (const f of t.faults) out.push(['Faults', FAULT_NAMES[f]]);
    out.push(['Rhythm', RHYTHM_NAMES[t.rhythm]]);
  }
  out.push(['Redeemed', redeemed ? 'Yes' : 'No']);
  if (no) out.push(['No.', `No.${no} · ${site}`]);
  return out.map(([trait_type, value]) => ({ trait_type, value }));
}

export const displayNames = () => DISPLAYS.map((d, i) => ({ id: d.id, name: DISPLAY_NAMES[i], odds: d.odds }));
export const rhythmNames = () => RHYTHMS.map((r, i) => ({ id: r.id, name: RHYTHM_NAMES[i], odds: r.odds }));
