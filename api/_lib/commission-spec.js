/* What a Strip Painting commission is, before it is anything else: the spec
 * a visitor chose, checked; the strips it paints as; and its price, worked
 * out here and nowhere else. The browser sends choices, never an amount.
 *
 * A site's palette is read from data/strip-palettes.json, so only its id is
 * trusted from the page. The collectors' palette moves as nudges lock, and a
 * photograph's exists nowhere but the visitor's browser, so for those two the
 * colours the visitor was shown come with the order. The price never depends
 * on the colours, which is why that is safe.
 */
import palettesFile from '../../data/strip-palettes.json' with { type: 'json' };
import { stripPrice, STRIP_ETH_NZD } from '../../strip-price.js';
import { layStrips } from './strip-render.js';

export const LENGTH = { min: 80, max: 240, step: 10 };
export const WIDTH = { min: 10, max: 120, step: 10 };
const ORIENT = ['portrait', 'landscape'];
const FRAMES = ['none', 'black', 'white'];
const DELIVERY = ['collect', 'shipped'];
const HEX = /^#[0-9A-F]{6}$/;

const stepped = (v, { min, max, step }) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max && n % step === 0 ? n : null;
};

/** A checked spec, or {error}. `colours` is required for collectors and photo. */
export function checkSpec(input = {}) {
  const length = stepped(input.length_cm, LENGTH);
  const width = stepped(input.width_cm, WIDTH);
  if (!length) return { error: `length_cm is ${LENGTH.min} to ${LENGTH.max} in steps of ${LENGTH.step}` };
  if (!width) return { error: `width_cm is ${WIDTH.min} to ${WIDTH.max} in steps of ${WIDTH.step}` };
  if (!ORIENT.includes(input.orientation)) return { error: 'orientation is portrait or landscape' };
  const frame = input.frame || 'none';
  if (!FRAMES.includes(frame)) return { error: 'frame is none, black or white' };
  const delivery = input.delivery || 'collect';
  if (!DELIVERY.includes(delivery)) return { error: 'delivery is collect or shipped' };

  const id = String(input.palette_id || '');
  let colours;
  const site = palettesFile.palettes.find((p) => p.id === id);
  if (site) colours = site.colours.map((c) => ({ hex: c.hex.toUpperCase(), w: c.w }));
  else if (id === 'collectors' || id === 'photo') {
    const given = Array.isArray(input.colours) ? input.colours : [];
    colours = given.map((c) => (typeof c === 'string' ? { hex: c, w: 10 } : c))
      .filter((c) => c && HEX.test(String(c.hex).toUpperCase()))
      .map((c) => ({ hex: String(c.hex).toUpperCase(), w: Math.min(1000, Math.max(1, Number(c.w) || 10)) }))
      .slice(0, 12);
    if (new Set(colours.map((c) => c.hex)).size < 4) return { error: 'four colours at the least' };
  } else return { error: 'no such palette' };

  return {
    spec: { length_cm: length, width_cm: width, orientation: input.orientation, frame, delivery, palette_id: id, colours },
  };
}

/** The strips the spec paints as, first to last across its width. */
export const stripsOf = (spec) => layStrips(spec.colours, spec.width_cm * 10);

/** NZD for the spec as it stands, delivery included. */
export const nzdOf = (spec) => stripPrice({
  lengthCm: spec.length_cm, widthCm: spec.width_cm, framed: spec.frame !== 'none', shipping: spec.delivery === 'shipped',
});

/* ETH at the fixed Strip Painting rate, exact in wei: NZD × 10^18 / 5,000. */
export const weiOf = (nzd) => (BigInt(Math.round(nzd)) * 10n ** 18n) / BigInt(STRIP_ETH_NZD);
export const ethText = (wei) => {
  const s = wei.toString().padStart(19, '0');
  const whole = s.slice(0, -18);
  const frac = s.slice(-18).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
};

/** "120 × 60 cm · landscape · black frame · shipped" */
export function specLine(spec) {
  const bits = [`${spec.length_cm} × ${spec.width_cm} cm`, spec.orientation];
  if (spec.frame !== 'none') bits.push(`${spec.frame} frame`);
  bits.push(spec.delivery === 'shipped' ? 'shipped worldwide, boxed' : 'collected from The Line');
  return bits.join(' · ');
}
