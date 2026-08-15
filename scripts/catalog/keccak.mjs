import { keccak_256 } from 'js-sha3';
export const toUtf8Bytes = (s) => Buffer.from(s, 'utf8');
export const keccak256 = (input) => '0x' + keccak_256(Buffer.isBuffer(input) ? input : Buffer.from(input));
