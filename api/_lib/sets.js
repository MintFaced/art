/* Set definitions, read from data/sets.json so that the set builder and the
 * collector meters cannot drift apart. The file is the truth; this module is
 * only the door into it.
 *
 * SET keeps the shape api/set.js and api/checkout-set.js already expect, so the
 * commerce path is unchanged by the meters existing.
 */
import defs from '../../data/sets.json' with { type: 'json' };

export const SETS = defs.sets;
export const SETS_CONFIRMED = defs.confirmed === true;

const commerce = defs.sets.find((s) => s.key === defs.commerce_set);
if (!commerce) throw new Error(`data/sets.json: commerce_set "${defs.commerce_set}" is not one of the sets`);

export const SET = {
  slug: commerce.key,
  title: commerce.title,
  slots: commerce.slots.map((s) => ({ key: s.key, title: s.title, ...(s.only ? { only: s.only } : {}) })),
};
