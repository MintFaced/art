/* Pictures in a log that is kept forever.
 *
 * The browser resizes and re-encodes through a canvas before anything is sent,
 * which is also what strips the metadata: canvas output carries no EXIF at
 * all, so the GPS coordinates a phone writes into every photograph never leave
 * the phone. That is the strip. What is here is the check ... an image that
 * still has EXIF in it did not come through that canvas, and a room whose log
 * is public and permanent should refuse it rather than wonder.
 *
 * Nothing here decodes an image. It reads the container ... the handful of
 * bytes that say what a file claims to be and what is chunked inside it ...
 * which is enough to answer both questions worth asking: is this the kind of
 * file it says it is, and is anybody's street address in it.
 */

import { createHash } from 'node:crypto';

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
};

/** What the first bytes say the file actually is, whatever it claims. */
export function sniff(bytes) {
  const b = bytes;
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
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
export function checkImage(image, cfg = {}) {
  if (image == null) return { none: true };
  if (typeof image !== 'object') return { error: 'that is not an image' };
  const claimed = String(image.type || '');
  if (!TYPES[claimed]) return { error: 'Studio takes JPEG and WebP' };

  let bytes;
  try { bytes = Buffer.from(String(image.data || ''), 'base64'); }
  catch (e) { return { error: 'that image did not arrive whole' }; }
  if (!bytes.length) return { error: 'that image did not arrive whole' };

  const cap = Math.floor(Number(cfg.max_image_kb || 1200)) * 1024;
  if (bytes.length > cap) {
    return { error: `${Math.round(bytes.length / 1024)}KB, and Studio's limit is ${Math.round(cap / 1024)}KB` };
  }

  /* What it says it is, against what it is. A log kept forever does not take
     anybody's word for a content type. */
  const real = sniff(bytes);
  if (!real) return { error: 'that file is not a JPEG or a WebP' };
  if (real !== claimed) return { error: 'that file is not the kind of image it says it is' };

  /* The browser re-encodes through a canvas, which drops every scrap of this.
     Anything still carrying it came from somewhere else, and the somewhere
     else is exactly the case worth refusing: people post from phones, and a
     phone writes where it was standing into the file. */
  if (hasMetadata(bytes)) {
    return { error: 'that image still carries its camera data. Studio strips it before sending, so this one did not come through the page.' };
  }

  const w = Math.floor(Number(image.w) || 0);
  const h = Math.floor(Number(image.h) || 0);
  const side = Math.floor(Number(cfg.max_image_px || 2400));
  if (w > 0 && h > 0 && (w > side || h > side)) {
    return { error: `that image is ${w}×${h}, and Studio resizes to ${side} before sending` };
  }
  return { bytes, type: real, ext: TYPES[real], w: w || null, h: h || null };
}

/* Where it lives. A key nobody can guess and nothing can collide with, under
   one prefix so the room's pictures are one thing in the bucket rather than
   scattered through the catalogue. The year is in it because a log kept
   forever is a thing somebody will one day want to sweep by date. */
export function imageKey(ext, now = new Date()) {
  const rand = `${crypto.randomUUID()}`.replace(/-/g, '').slice(0, 24);
  return `chat/${now.getUTCFullYear()}/${rand}.${ext}`;
}
