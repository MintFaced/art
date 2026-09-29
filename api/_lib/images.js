/* Pictures in a log that is kept forever.
 *
 * THE SERVER STRIPS, EVERY TIME. A picture arrives as whatever the phone made
 * of it ... a HEIC straight off an iPhone, a JPEG with the street it was taken
 * on written into it, a PNG ... and every one of them is decoded here, turned
 * the right way up from its own orientation tag, resized to a long edge of
 * 2000, and written out as a fresh JPEG with no metadata at all, before a byte
 * of it reaches the bucket. Whatever the browser did or did not do, what the
 * log keeps carries no EXIF, no GPS and no camera.
 *
 * It used to be the other way round: the browser stripped through a canvas and
 * this file refused anything still carrying metadata. That refused real photos
 * from phones whose browsers could not decode them, which is the one case the
 * strip exists for.
 *
 * HEIC is decoded by libheif compiled to WebAssembly (heic-decode), because the
 * libvips sharp ships reads HEIF's AVIF flavour and not the HEVC one iPhones
 * write. libheif applies the file's own rotation as it decodes.
 */

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import heicDecode from 'heic-decode';

/* What a wallet signs when it signs a picture.
 *
 * Not the bytes ... a wallet prompt is not going to show somebody a megabyte
 * of base64 and they would not read it if it did. A fingerprint of them, which
 * is the same on both sides and changes completely if a single byte does. What
 * it buys is that the picture attached to a signature is the picture that goes
 * into the log: a page cannot sign the words with one photograph and send
 * another. */
export const imageFingerprint = (bytes) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16);

export const TYPES = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
};

/* What a picture may be on the way in: the four kinds a phone or a screenshot
   produces. What it is on the way out is always a JPEG. */
export const IN_MAX_BYTES = 12 * 1024 * 1024;
export const LONG_EDGE = 2000;
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

/** What the first bytes say the file actually is, whatever it claims. */
export function sniff(bytes) {
  const b = bytes;
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  /* ISO base media: a size, then 'ftyp', then the brand. HEIC and its
     relatives are HEIF, decoded by libheif rather than by sharp. */
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (HEIF_BRANDS.has(brand)) return 'image/heic';
  }
  return null;
}

/**
 * Any picture, as the log keeps it: upright, at most 2000 on its long edge,
 * sRGB, JPEG, and nothing in it but the picture.
 *
 * sharp writes no metadata unless it is asked to, and it is never asked here.
 * Transparency is laid on white, because a JPEG has none and a black ground
 * under a screenshot's corners is not what anybody sent.
 */
/**
 * Any picture this site takes, decoded and upright, as a sharp pipeline ready
 * for whatever is done to it next: HEIC through libheif, everything else
 * through libvips with its orientation applied. Nothing about the source
 * survives into whatever is written from it.
 */
export async function decodeImage(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!b.length) return { error: 'that image did not arrive whole' };
  if (b.length > IN_MAX_BYTES) {
    return { error: `${(b.length / 1048576).toFixed(1)}MB, and the limit is ${IN_MAX_BYTES / 1048576}MB` };
  }
  const kind = sniff(b);
  if (!kind) return { error: 'That is not a JPEG, PNG, WebP or HEIC picture' };
  try {
    if (kind === 'image/heic') {
      const { width, height, data } = await heicDecode({ buffer: b });
      return { img: sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }), kind, width, height };
    }
    /* Upright first, and measured upright: a crop drawn over the picture on
       a phone is drawn over it the right way up. */
    const upright = await sharp(b, { failOn: 'error' }).rotate().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = upright.info;
    return { img: sharp(upright.data, { raw: { width, height, channels } }), kind, width, height };
  } catch (e) {
    return { error: 'that picture would not open. Try another, or a screenshot of it.' };
  }
}

export async function processImage(bytes) {
  const d = await decodeImage(bytes);
  if (d.error) return { error: d.error === 'That is not a JPEG, PNG, WebP or HEIC picture' ? 'Studio takes JPEG, PNG, WebP and HEIC pictures' : d.error };
  const kind = d.kind;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  try {
    const out = await d.img
      .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { bytes: out.data, type: 'image/jpeg', ext: 'jpg', w: out.info.width, h: out.info.height, from: kind, in_bytes: b.length };
  } catch (e) {
    return { error: 'that picture would not open. Try another, or a screenshot of it.' };
  }
}

const ascii = (b, at, s) => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

/**
 * Whether this file still carries metadata a canvas would have dropped.
 *
 * JPEG is a chain of segments; EXIF rides in APP1 and a colour profile in
 * APP2, and both are walked here rather than searched for, because the string
 * "Exif" can appear in the compressed image data of a photograph of a sign.
 * WebP keeps its metadata in named RIFF chunks, which are walked the same way.
 */
export function hasMetadata(bytes) {
  const b = bytes;
  const kind = sniff(b);
  if (kind === 'image/jpeg') {
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return false;              // out of step: stop rather than guess
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xda || marker === 0xd9) return false;   // the pixels start here
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2) return false;
      // APP1 Exif, APP1 XMP, APP2 ICC ... anything a phone writes about itself
      if (marker === 0xe1 && (ascii(b, i + 4, 'Exif') || ascii(b, i + 4, 'http://ns.adobe.com/xap'))) return true;
      i += 2 + len;
    }
    return false;
  }
  if (kind === 'image/webp') {
    let i = 12;
    while (i + 8 <= b.length) {
      const tag = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
      const size = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24);
      if (tag === 'EXIF' || tag === 'XMP ') return true;
      if (size < 0) return false;
      i += 8 + size + (size % 2);
    }
    return false;
  }
  return false;
}

/**
 * What may go into the log, checked against what actually arrived.
 *
 * @param image  { data: base64, type, w, h } from the browser
 * @param cfg    the room's own config
 * @returns { bytes, type, ext, w, h } or { error }
 */
/**
 * The picture a message carries, from either way it can arrive: the file
 * itself (a multipart upload, the way the page sends it now) or base64 in the
 * JSON body (the older way, and the one a script can use). Either is decoded,
 * stripped and re-encoded by processImage before anything else sees it.
 *
 * `original` is the bytes as they came, which is what a signed message's
 * fingerprint is taken over: the sender can only fingerprint what they have.
 */
export async function checkImage(image, cfg = {}, upload = null) {
  let original = null;
  if (upload && upload.bytes && upload.bytes.length) original = upload.bytes;
  else if (image != null) {
    if (typeof image !== 'object') return { error: 'that is not an image' };
    try { original = Buffer.from(String(image.data || ''), 'base64'); }
    catch (e) { return { error: 'that image did not arrive whole' }; }
  }
  if (!original) return { none: true };
  const out = await processImage(original);
  if (out.error) return out;
  return { ...out, original };
}

/* Where it lives. A key nobody can guess and nothing can collide with, under
   one prefix so the room's pictures are one thing in the bucket rather than
   scattered through the catalogue. The year is in it because a log kept
   forever is a thing somebody will one day want to sweep by date. */
export function imageKey(ext, now = new Date()) {
  const rand = `${crypto.randomUUID()}`.replace(/-/g, '').slice(0, 24);
  return `chat/${now.getUTCFullYear()}/${rand}.${ext}`;
}
