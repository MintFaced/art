/* What the films are made of: the snapshot, the captures, the street and the
 * script, read at bundle time so a render is a pure function of these files. */
import snapshot from '../data/snapshot.json';
import captures from '../data/captures.json';
import script from '../script.json';

export const S: any = snapshot;
export const C: any = captures;
export const SCRIPT: any = script;

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const TOKENS: Record<string, string> = {
  site_no: String(S.strip.no),
  site_address: String(S.strip.address),
  site_street_no: String(S.strip.address).replace(/\D.*$/, ''),
  slider_min: String(S.slider.min),
  slider_max: String(S.slider.max),
  rate_unique: String(S.rates.unique_per_day),
  rate_edition: String(S.rates.edition_copy_per_day),
  locked_count: String(S.palette.length),
  locked_word: WORDS[S.palette.length] || String(S.palette.length),
};
/** A line of copy with its {tokens} filled from the snapshot. */
export const fill = (s: string) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (k in TOKENS ? TOKENS[k] : `{${k}}`));
export const film = (id: string) => SCRIPT.films[id];
export const beat = (id: string, i: number) => {
  const b = film(id).beats[i];
  return { ...b, type: fill(b.type), label: b.label ? fill(b.label) : undefined, corner: b.corner ? fill(b.corner) : undefined };
};
