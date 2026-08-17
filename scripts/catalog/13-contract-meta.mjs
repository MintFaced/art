import { getJSON, BS, sleep } from './lib.mjs';
import fs from 'fs';
const list = [
  ['pixelarcade','0x97536ECC25Ae0A7ABAde7C2Bba1925CA6Eba30E8'],
  ['artificial-flowers','0xD64aC59835a9951f34472239ba70B44c5BEBe90d'],
  ['patrimora','0xEabffdE679Fe5F0b835771aeA36d90C1ce7502d8'],
  ['two-burdens','0xE1d1F99505A13d20B25D5Ef32280771d7Eb5ED09'],
  ['geodetic-ai','0x38bae13b27222900c32Ec28ab28b54Cd61196045'],
  ['roads-and-rivers','0x18bd004e13258F569ceDFbb537bA329e4730eE67'],
  ['geodetic-world','0xE16c77A770C6De5439F617e6E2F9fD46BB15D396'],
  ['geodetica','0xF6f44F3ddE8EA78A3F49F78EecA339FFA17B2933'],
  ['geodetic-onchain','0x7b5ccc13ffacf2bc8204be1359a3eea3cae4dce4'],
  ['visual-language','0x75e7c7c2e507e6d95c20bcde14135035e7e7a88a'],
  ['panoptic','0x3ee441f307c4bf147849d15457339d6116bb8373'],
  ['wallet','0x7f51b00487fb9de02fe64cd5b5df073ba62e681d'],
  ['10k-project','0xe5eb0070a13f868a72996a568e12d085413445b8'],
  ['10k-commemoration','0xe125091e7c669d47e374d7f23bc857789f701780'],
  ['geodetic-sculpture-gs1','0xA59f33d2b133De3F341c22f8feD38Ab8caeF1998'],
  ['geodetic-sculpture-mocs','0xe9d9CC9Cb7287b0cC4de6Edd9664A537B7aFa177'],
  ['seize-and-share','0xe63f4E6CE4110A2faD3DE9ed38e7eA5858EB953b'],
  ['emblem-vault','0x4C03BCAD293fb0562D26FAa7D90A0cb3Ea74c919'],
];
const out = {};
for (const [key, addr] of list) {
  const a = await getJSON(`${BS}/addresses/${addr}`);
  const t = await getJSON(`${BS}/tokens/${addr}`);
  let created = null, deployer = null;
  const txh = a.creation_transaction_hash || a.creation_tx_hash;
  if (txh) {
    const tx = await getJSON(`${BS}/transactions/${txh}`);
    created = tx.timestamp; deployer = tx.from?.hash;
  }
  out[key] = { address: addr, name: t.name, symbol: t.symbol, type: t.type, total_supply: t.total_supply, holders: t.holders || t.holders_count, deployed: created, deployer, deployer_ens: null, creation_tx: txh };
  console.log(key.padEnd(24), (t.name||'').padEnd(22), (t.type||'').padEnd(9), 'holders', String(t.holders||t.holders_count).padEnd(6), 'deployed', created, deployer);
  await sleep(150);
}
fs.writeFileSync('raw/contract-meta.json', JSON.stringify(out, null, 2));
