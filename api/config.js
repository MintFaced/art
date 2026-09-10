/* Public front-end config ... only what is safe to ship to a browser, and
 * read cross-origin by collectors.mintface.art the same way the register is.
 *
 * The WalletConnect (Reown) project id is public by design: it names the app to
 * the relay, it is not a secret and rides in the client bundle of every app
 * that uses WalletConnect. It lives in an env var so it is set per environment
 * rather than hard-coded. The var is NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID, one
 * id shared by both projects; the bare name is accepted as a fallback.
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const json = (b, s = 200, headers = {}) => new Response(JSON.stringify(b), {
  status: s,
  headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...CORS, ...headers },
});

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET() {
  return json({
    walletConnectProjectId:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ||
      process.env.WALLETCONNECT_PROJECT_ID ||
      null,
  });
}
