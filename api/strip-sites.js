/* GET /api/strip-sites: the Strip Painting sites, as data/strip-sites.json has
 * them, with the counts worked out from them. Public and cached. A tenant is
 * named only where tenant_public is true; the editorial notes stay home. */
import sitesFile from '../data/strip-sites.json' with { type: 'json' };
import { counts } from '../strip-plan.js';

/* Where the pages and files of the later slices live (STRIP-RENT, STRIP-DOSSIER),
   null until each one is published. The page links to what is here and writes
   to the studio for what is not, so nothing ever links to a 404. */
export const LINKS = { rent: null, technical_sheet: null, dossier: null };

export function publicSites(file = sitesFile) {
  return file.sites.map(({ notes, tenant, tenant_public: tp, ...s }) => ({ ...s, tenant: tp ? tenant : null }));
}

export async function GET() {
  const sites = publicSites();
  return new Response(JSON.stringify({
    collection: 'strip-paintings',
    page: 'https://mintface.art/c/strip-paintings',
    statuses: ['installed', 'approved', 'proposed'],
    counts: counts(sites),
    sites,
    exhibited: sitesFile.exhibited || [],
    links: LINKS,
  }, null, 1), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600',
      'access-control-allow-origin': '*',
    },
  });
}
