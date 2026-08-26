/* The register, as every route reads it.
 *
 * Four routes need the same two facts about a wallet ... what to call it and
 * where its page is ... and each of them used to fetch data/collectors.json and
 * find() its way through the array. That file holds only the eight hundred
 * collectors with pages, so a wallet holding one edition copy spoke in Studio
 * under a short address even when it had an ENS name the register knew.
 *
 * So the lookup is written once, over the register rather than the index, and
 * it carries the self-set names from the store with it. Everywhere the register
 * speaks, it speaks with the same voice.
 */
import { registerIndex, naming, namesStore } from './names.js';
import { loadArtist, ARTIST_NAME } from './artist.js';
import { storeConfigured } from './kv.js';

/* The nightly half of it, held for a minute.
 *
 * data/collectors-register.json is three and a half thousand rows and is
 * rebuilt once a day, so fetching and indexing it per request is paying by the
 * keystroke for something that changes by the night ... and the @ autocomplete
 * in Studio asks a question of it every time somebody types a letter. A minute
 * is short enough that the morning after a rebuild nobody notices, and long
 * enough that a burst of typing costs one read.
 *
 * The names collectors chose are not in here and never will be. Those come from
 * the store on every call, because a name is set by a person pressing a button
 * and they should see it the moment they have.
 */
const NIGHTLY_MS = 60000;
const held = new Map();

/** Drop what is held. For the acceptance cases, which move a nightly file
 *  between one request and the next and cannot wait a minute to be believed. */
export function forgetRegister() { held.clear(); }

async function nightly(at, origin) {
  const now = Date.now();
  const cached = held.get(origin);
  if (cached && cached.until > now) return cached.value;
  const [register, artist] = await Promise.all([
    at(origin, 'data/collectors-register.json'),
    loadArtist(at, origin).catch(() => ({})),
  ]);
  const value = { rows: registerIndex(register), artist };
  held.set(origin, { value, until: now + NIGHTLY_MS });
  return value;
}

/**
 * @param at    (origin, path) => parsed json, the fetch the routes already have
 * @param pipe  the store, or null where a route has none configured
 */
export async function loadRegister(at, origin, pipe = null) {
  const [{ rows, artist }, self] = await Promise.all([
    nightly(at, origin),
    pipe && storeConfigured() ? namesStore(pipe).all().catch(() => ({})) : Promise.resolve({}),
  ]);
  /* The artist's wallets, named and pointed at the front door. He is kept out
     of the register on purpose ... TAO measures patronage and he is not his own
     patron ... which would otherwise leave him the one person in the room with
     no name and no link. */
  const special = Object.fromEntries(Object.keys(artist || {})
    .map((a) => [a, { name: ARTIST_NAME, url: 'https://mintface.art/' }]));
  return { ...naming(rows, self, special), artist, self };
}
