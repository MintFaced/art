#!/usr/bin/env node
/* The runbook in contracts/README.md, rehearsed on a mainnet fork: the real
 * deploy script through `forge script --broadcast`, the real Manifold
 * implementation, the real VRF coordinator, then each step in order as the
 * MintFace wallet.
 *
 * Every other local chain here lifts the 24 KB contract limit, because the
 * full Manifold core needs it. This one doesn't, so a contract that has grown
 * past what mainnet will take fails here and not on the day.
 *
 * The deployer isn't the MintFace wallet, which is the harder of the two paths:
 * it's the one that leaves ownership to be finished by hand.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, decodeErrorResult, encodeFunctionData, http, parseAbi, parseEther, toHex } from 'viem';
import { mainnet } from 'viem/chains';
import { english, generateMnemonic, generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { artifact } from './chain.mjs';

const FORK = process.env.FORK_URL || 'https://ethereum-rpc.publicnode.com';
const PORT = Number(process.env.STRIPS_DEPLOY_PORT || 8549);
const RPC = `http://127.0.0.1:${PORT}`;
const CONTRACTS = fileURLToPath(new URL('../../contracts', import.meta.url));

const MANIFOLD_IMPL = '0x5133522ea5A0494EcB83F26311A095DDD7a9D4b6';
const COORDINATOR = '0xD7f86b4b8Cae7D942340FF628F82735b7a20893a';
const KEY_HASH = '0x3fd2fec10d06ee8f65e7f2e95f5c56511359ece3f33960ad8a866ae24a8ff10b';
const MINTFACE = '0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180';
const ESTATE = '0x6e420B64bb329bE84a6627c68A7BdFf825139773';
const ARTIST = '0xdD6B80649e8D472EB8fb52eb7eEcFd2Dc219AcE7';
/* Fresh keys, never anvil's own. A fork keeps mainnet's state, and those public
   accounts carry a sweeper's EIP-7702 code there: it answers onERC721Received
   by taking the token, then fails the mint with empty revert data. */
const DEPLOYER_KEY = generatePrivateKey();
const BUYER_KEY = generatePrivateKey();

process.env.STRIPS_RPC = RPC;
process.env.STRIPS_VOUCHER_KEY = `0x${'5a'.repeat(32)}`;

let passes = 0; let fails = 0;
const str = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
const is = (name, got, want) => {
  const ok = str(got) === str(want);
  ok ? passes += 1 : fails += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${str(got)}\n     want ${str(want)}`}`);
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const anvil = spawn(`${homedir()}/.foundry/bin/anvil`, ['--fork-url', FORK, '--port', String(PORT), '--silent'], { stdio: 'ignore' });
const client = createPublicClient({ chain: mainnet, transport: http(RPC, { timeout: 120000 }) });
let host;
try {
  for (let i = 0; i < 300; i += 1) {
    try { await client.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  await client.request({ method: 'anvil_impersonateAccount', params: [MINTFACE] });
  await client.request({ method: 'anvil_setBalance', params: [MINTFACE, toHex(parseEther('100'))] });
  const mintface = createWalletClient({ account: MINTFACE, chain: mainnet, transport: http(RPC, { timeout: 120000 }) });
  const deployer = privateKeyToAccount(DEPLOYER_KEY);
  const buyerAccount = privateKeyToAccount(BUYER_KEY);
  for (const who of [deployer.address, buyerAccount.address]) await client.request({ method: 'anvil_setBalance', params: [who, toHex(parseEther('10'))] });
  const buyer = createWalletClient({ account: buyerAccount, chain: mainnet, transport: http(RPC, { timeout: 120000 }) });
  const done = (hash) => client.waitForTransactionReceipt({ hash });
  const CORE_ABI = parseAbi([
    'function registerExtension(address, string)', 'function setRoyalties(address[], uint256[])', 'function ownerOf(uint256) view returns (address)',
    'function royaltyInfo(uint256, uint256) view returns (address, uint256)', 'function tokenURI(uint256) view returns (string)',
  ]);
  const VRF_ABI = parseAbi(['function createSubscription() returns (uint256)', 'function fundSubscriptionWithNative(uint256) payable', 'function addConsumer(uint256, address)']);
  const ext = artifact('StripsExtension').abi;
  const ledger = artifact('TaoLedger').abi;
  /* what a call was refused with, by name: "it reverted" also passes for the wrong reason */
  const refusal = (from, tx, value = 0n) => client.call({ account: from, to: tx.to, data: tx.data, value }).then(() => 'allowed').catch((e) => {
    let c = e; let data = null;
    while (c) { if (typeof c.data === 'string' && c.data.length > 2) data = c.data; c = c.cause; }
    if (!data) return 'no reason given';
    try { const r = decodeErrorResult({ abi: [...ext, ...parseAbi(['error Error(string)'])], data }); return r.errorName === 'Error' ? r.args[0] : r.errorName; } catch { return data; }
  });

  console.log('\n— 1. the core —');
  const proxy = artifact('ERC1967Proxy');
  const init = encodeFunctionData({ abi: parseAbi(['function initialize(string, string)']), args: ['//STRIPS', 'STRIPS'] });
  const coreRcpt = await done(await mintface.deployContract({ abi: proxy.abi, bytecode: proxy.bytecode.object, args: [MANIFOLD_IMPL, init] }));
  const core = coreRcpt.contractAddress;
  await done(await mintface.writeContract({ address: core, abi: CORE_ABI, functionName: 'setRoyalties', args: [[MINTFACE], [500n]] }));
  is('it deployed from the MintFace wallet', coreRcpt.status, 'success');

  console.log('\n— 2. the subscription —');
  const sub = await done(await mintface.writeContract({ address: COORDINATOR, abi: VRF_ABI, functionName: 'createSubscription' }));
  const subId = BigInt(sub.logs[0].topics[1]);
  await done(await mintface.writeContract({ address: COORDINATOR, abi: VRF_ABI, functionName: 'fundSubscriptionWithNative', args: [subId], value: parseEther('1') }));
  is('it exists', subId > 0n, true);

  console.log('\n— 3 and 4. the voucher key and the deploy script —');
  const signer = privateKeyToAccount(process.env.STRIPS_VOUCHER_KEY).address;
  const script = (args, extra = {}) => spawnSync(`${homedir()}/.foundry/bin/forge`, ['script', 'script/Deploy.s.sol', '--rpc-url', RPC, ...args], {
    cwd: CONTRACTS, encoding: 'utf8', timeout: 300000, maxBuffer: 1 << 26,
    env: { ...process.env, CORE: core, OWNER: MINTFACE, ARTIST, PAYOUT: MINTFACE, ESTATE, VOUCHER_SIGNER: signer, VRF_SUB_ID: String(subId), VRF_COORDINATOR: COORDINATOR, VRF_KEY_HASH: KEY_HASH, ...extra },
  });

  /* A hardware wallet is the one route where the script's msg.sender isn't the
     signer. Mnemonics are the same class of signer, and need no device. */
  const phrase = generateMnemonic(english);
  const hardware = mnemonicToAccount(phrase).address;
  await client.request({ method: 'anvil_setBalance', params: [hardware, toHex(parseEther('10'))] });
  const signerArgs = ['--mnemonics', phrase, '--mnemonic-indexes', '0'];
  is('the deploy simulates with a hardware-class signer and --sender', script([...signerArgs, '--sender', hardware]).status, 0);
  is('and without --sender, which is how the old script failed', script(signerArgs).status, 0);

  const short = script(['--private-key', DEPLOYER_KEY], { CLAIM_WINDOW: '3600' });
  is('mainnet refuses any claim window but 30 days', [short.status !== 0, /30 days/.test(`${short.stdout}${short.stderr}`)], [true, true]);
  const nowhere = script(['--private-key', DEPLOYER_KEY], { CORE: '0x000000000000000000000000000000000000c0DE' });
  is('and a core that isn\'t there', [nowhere.status !== 0, /CORE has no code/.test(`${nowhere.stdout}${nowhere.stderr}`)], [true, true]);

  const forge = script(['--broadcast', '--private-key', DEPLOYER_KEY]);
  is('forge script finishes', forge.status, 0);
  if (forge.status !== 0) { console.log(String(forge.stdout).slice(-1500), String(forge.stderr).slice(-1500)); throw new Error('no deployment to rehearse'); }
  const printed = (name) => (new RegExp(`${name}\\s+(0x[0-9a-fA-F]{40})`).exec(forge.stdout) || [])[1];
  const addr = { engine: printed('engine'), renderer: printed('renderer'), ledger: printed('ledger'), extension: printed('extension') };
  is('it prints all four addresses', Object.values(addr).every(Boolean), true);
  for (const [name, a] of Object.entries(addr)) is(`${name} is on chain, under mainnet's size limit`, ((await client.getCode({ address: a })) || '0x').length > 2, true);

  const readExt = (functionName, args = []) => client.readContract({ address: addr.extension, abi: ext, functionName, args });
  const readLedger = (functionName, args = []) => client.readContract({ address: addr.ledger, abi: ledger, functionName, args });
  is('it set the estate', same(await readExt('estate'), ESTATE), true);
  is('and the payout', same(await readExt('payout'), MINTFACE), true);
  is('and the voucher signer', same(await readExt('voucherSigner'), signer), true);
  is('and the core', same(await readExt('core'), core), true);
  is('and ryanj.eth as the second free minter', same(await readExt('artist'), ARTIST), true);
  is('the claim window is 30 days', await readLedger('CLAIM_WINDOW'), 2592000n);
  is('the ledger\'s minter is the extension', same(await readLedger('minter'), addr.extension), true);
  is('both wait for the wallet', [same(await readExt('owner'), deployer.address), same(await readLedger('owner'), deployer.address)], [true, true]);
  await done(await mintface.writeContract({ address: addr.extension, abi: ext, functionName: 'acceptOwnership' }));
  await done(await mintface.writeContract({ address: addr.ledger, abi: ledger, functionName: 'acceptOwnership' }));
  is('and are the wallet\'s once it accepts', [same(await readExt('owner'), MINTFACE), same(await readLedger('owner'), MINTFACE)], [true, true]);

  console.log('\n— 5. connect —');
  await done(await mintface.writeContract({ address: COORDINATOR, abi: VRF_ABI, functionName: 'addConsumer', args: [subId, addr.extension] }));
  const reg = await done(await mintface.writeContract({ address: core, abi: CORE_ABI, functionName: 'registerExtension', args: [addr.extension, ''] }));
  is('the core takes the extension', reg.status, 'success');

  console.log('\n— 6. tell the site —');
  process.env.STRIPS_DEPLOYMENT = JSON.stringify({ chain_id: 1, core, extension: addr.extension, ledger: addr.ledger, renderer: addr.renderer, first_block: Number(coreRcpt.blockNumber) });
  const { deployed, prepareMint } = await import('../../api/_lib/strips.js');
  const { txFor } = await import('../../api/_lib/strips-console.js');
  const { tokenFor } = await import('../../api/_lib/strips-token.js');
  is('the site can see it', deployed(), true);

  console.log('\n— 7. snapshot 1 —');
  const { rootOf } = await import('../../api/_lib/strips-snapshot.js');
  const claimant = privateKeyToAccount(generatePrivateKey());
  const table = [{ wallet: claimant.address, tao_total: 420000, free_mints: 2 }, { wallet: `0x${'1'.repeat(40)}`, tao_total: 100000, free_mints: 1 }];
  const file = { id: 1, label: 'Snapshot 1', taken_at: 1793914285, root: rootOf(table), rows: table };
  let serving = null;
  host = createServer((req, res) => { const body = serving && (req.url === '/audit' ? { ok: true, root: file.root } : serving); res.statusCode = body ? 200 : 404; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body || {})); }).listen(0);
  await new Promise((ok) => host.once('listening', ok));
  process.env.STRIPS_SNAPSHOT_URL = `http://127.0.0.1:${host.address().port}/`;
  process.env.STRIPS_SNAPSHOT_AUDIT_URL = `http://127.0.0.1:${host.address().port}/audit`;
  process.env.STRIPS_ARWEAVE_GATEWAY = `http://127.0.0.1:${host.address().port}`;
  is('the console won\'t publish a table the site doesn\'t have', /isn't on the site/.test((await txFor('snapshot', { root: file.root, uri: 'ar://t' })).error), true);
  serving = file;
  const publish = await txFor('snapshot', { root: file.root, uri: 'ar://t' });
  await done(await mintface.sendTransaction({ to: publish.to, data: publish.data }));
  is('published, the ledger holds back what the table owes', await readLedger('unclaimedReserve'), 3n);

  console.log('\n— 9. open —');
  const design = { to: buyerAccount.address, length_cm: 120, width_cm: 60, orientation: 'landscape', colours: [{ hex: '#112233' }, { hex: '#445566' }, { hex: '#778899' }, { hex: '#AA00BB', amount: 'more' }] };
  const p = await prepareMint(design);
  const tryMint = (tx) => buyer.sendTransaction({ to: tx.to, data: tx.data, value: parseEther('0.009') });
  is('a mint before it opens is refused', await refusal(buyerAccount.address, p.tx, parseEther('0.009')), 'MintClosed');
  const open = await txFor('open', { open: true });
  is('the deployer can no longer open it', await refusal(deployer.address, open), 'Only callable by owner');
  await done(await mintface.sendTransaction({ to: open.to, data: open.data }));
  is('the wallet can', await readExt('mintOpen'), true);

  console.log('\n— the first mint —');
  const before = await client.getBalance({ address: MINTFACE });
  const mint = await done(await tryMint(p.tx));
  is('it goes through against the real coordinator', mint.status, 'success');
  is('the buyer holds it', same(await client.readContract({ address: core, abi: CORE_ABI, functionName: 'ownerOf', args: [1n] }), buyerAccount.address), true);
  is('the price reaches the payout', (await client.getBalance({ address: MINTFACE })) - before, parseEther('0.009'));
  const [to, cut] = await client.readContract({ address: core, abi: CORE_ABI, functionName: 'royaltyInfo', args: [1n, 10000n] });
  is('the royalty is 5% to mintface.eth', [same(to, MINTFACE), cut], [true, 500n]);
  const uri = await client.readContract({ address: core, abi: CORE_ABI, functionName: 'tokenURI', args: [1n], gas: 30_000_000n });
  const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
  is('its metadata is on chain', meta.name, '//STRIPS #1');
  const t = await tokenFor(1);
  is('and the site reads the token', [t.id, same(t.owner, buyerAccount.address)], [1, true]);
} catch (e) {
  fails += 1;
  console.log('FAIL', e.shortMessage || e.message);
} finally {
  host?.close();
  anvil.kill();
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
