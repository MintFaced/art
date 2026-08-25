/* The artist, and why every TAO gate has to know about him.
 *
 * TAO measures patronage, so the artist's own wallets are excluded from accrual
 * by design ... docs/TAO.md, item 4. mintface.eth holds no TAO, has never held
 * any, and never will. That is correct.
 *
 * Which means any gate written as `tao > 0` locks the artist out of his own
 * site, permanently, and does it silently: the wallet connects, the register
 * answers honestly with nought, and the door stays shut. It is not a threshold
 * he is one edition short of. It is a threshold he can never cross.
 *
 * So the rule lives here rather than in each feature, and every TAO gate on the
 * site comes through it. Written once, it is hard to forget; written per
 * feature, it was forgotten the first time it was written.
 */

const lower = (a) => String(a || '').toLowerCase();

/* The artist wears no number. A figure beside his name in the room would be a
   nought, and a nought there says the opposite of the truth. */
export const ARTIST_NAME = 'MintFace';

export async function loadArtist(at, origin) {
  const file = await at(origin, 'data/source/artist.json');
  return Object.fromEntries(Object.entries(file.wallets || {}).filter(([k]) => k.startsWith('0x')));
}

export const isArtist = (artist, address) => Boolean(artist && artist[lower(address)]);

/**
 * A TAO threshold, with the artist through it.
 * @returns { ok: true, role, name? } or { ok: false, why }
 */
export function taoGate({ artist, address, tao, min = 1, why }) {
  if (isArtist(artist, address)) return { ok: true, role: 'artist', name: ARTIST_NAME };
  const held = Math.floor(Number(tao) || 0);
  if (held >= Number(min)) return { ok: true, role: 'collector', tao: held };
  return { ok: false, role: null, tao: held, why };
}
