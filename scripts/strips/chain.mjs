/* A local chain with the renderer on it, for the checks that compare JavaScript
 * against what Solidity really returns. Needs Foundry; `forge build` first.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createPublicClient, createWalletClient, http, parseEther, toHex } from 'viem';
import { foundry } from 'viem/chains';
import { mnemonicToAccount } from 'viem/accounts';

const ROOT = new URL('../../', import.meta.url);
export const ANVIL = process.env.ANVIL || `${homedir()}/.foundry/bin/anvil`;
const PORT = Number(process.env.STRIPS_ANVIL_PORT || 8547);
const RPC = `http://127.0.0.1:${PORT}`;

export const artifact = (name) => JSON.parse(readFileSync(new URL(`contracts/out/${name}.sol/${name}.json`, ROOT), 'utf8'));
export const engineBytes = () => readFileSync(new URL('contracts/build/engine.js.gz', ROOT));

export async function startChain() {
  const child = spawn(ANVIL, ['--port', String(PORT), '--silent', '--gas-limit', '1000000000', '--code-size-limit', '100000', '--hardfork', 'cancun'], { stdio: 'ignore' });
  const client = createPublicClient({ chain: foundry, transport: http(RPC, { timeout: 60000 }) });
  for (let i = 0; i < 100; i += 1) {
    try { await client.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const account = mnemonicToAccount('test test test test test test test test test test test junk');
  const wallet = createWalletClient({ account, chain: foundry, transport: http(RPC, { timeout: 60000 }) });
  const deploy = async (name, args = []) => {
    const a = artifact(name);
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    const r = await client.waitForTransactionReceipt({ hash });
    return { address: r.contractAddress, abi: a.abi, gas: r.gasUsed };
  };
  return { client, wallet, deploy, stop: () => child.kill() };
}

export async function deployRenderer(chain) {
  const engine = await chain.deploy('StripsEngine', [[toHex(engineBytes())]]);
  const renderer = await chain.deploy('StripsRenderer', [engine.address]);
  return { engine, renderer };
}

/** Everything but the wiring a test wants to do itself: the real Manifold core,
    Chainlink's coordinator mock, the ledger, the renderer and the extension. */
export async function deployStack(chain, { signer, estate = '0x6e420B64bb329bE84a6627c68A7BdFf825139773', payout = '0xd40B63bF04a44e43fBFE5784bCf22ACaAB34a180', snapshot = { root: `0x${'11'.repeat(32)}`, free_mints: 0n } }) {
  const { client, wallet, deploy } = chain;
  const owner = wallet.account;
  const core = await deploy('ERC721Creator', ['//STRIPS', 'STRIPS']);
  const coordinator = await deploy('VRFCoordinatorV2_5Mock', [100000000000000000n, 1000000000n, 4000000000000000n]);
  const send = async (c, functionName, args = [], extra = {}) => client.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...c, functionName, args, ...extra }) });
  const rcpt = await send(coordinator, 'createSubscription');
  const subId = BigInt(rcpt.logs[0].topics[1]);
  await send(coordinator, 'fundSubscription', [subId, parseEther('1000')]);
  await send(coordinator, 'fundSubscriptionWithNative', [subId], { value: parseEther('10') });
  const ledger = await deploy('TaoLedger', [owner.address, 2592000n]);
  const { renderer } = await deployRenderer(chain);
  const delegates = await deploy('TaoLedger', [owner.address, 2592000n]); // any contract; nobody delegates here
  const ext = await deploy('StripsExtension', [core.address, ledger.address, delegates.address, estate, payout, signer, renderer.address, coordinator.address,
    { keyHash: `0x${'01'.padStart(64, '0')}`, subId, confirmations: 3, callbackGas: 100000, native: true }]);
  await send(coordinator, 'addConsumer', [subId, ext.address]);
  await send(ledger, 'setMinter', [ext.address]);
  await send(core, 'registerExtension', [ext.address, '']);
  /* the mint can't open without a snapshot */
  await send(ledger, 'publishSnapshot', [snapshot.root, 1795000000n, BigInt(snapshot.free_mints), 'ar://table', 'Snapshot 1']);
  await send(ext, 'setMintOpen', [true]);
  return { core, coordinator, ledger, renderer, ext, send, owner, estate, payout };
}
