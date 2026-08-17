import { useState, useRef, useEffect, useCallback } from "react";

// ---------- constants ----------
const MEMORIAL = "#d32011";
const MEMORIAL_INDEX = 15; // 16th strip from bottom (0-based)
const MEMORIAL_H = 12;

const INTENSITY = {
  low:    { label: "Low",    strips: "~23", sizes: [24],         rate: 650,  daysPerM: 0.67, note: "24mm bands" },
  medium: { label: "Medium", strips: "~33", sizes: [24, 12],     rate: 800,  daysPerM: 0.83, note: "12 / 24mm" },
  high:   { label: "High",   strips: "55",  sizes: [24, 12, 6],  rate: 1000, daysPerM: 1.17, note: "6 / 12 / 24mm" },
};

// Strip Painting No. 1 palette + dominance weights (mm of colour on the wall)
const DEFAULT_PALETTE = [
  { hex: "#e16448", w: 120 }, { hex: "#82b2ce", w: 60 }, { hex: "#5fb25b", w: 60 },
  { hex: "#d5c089", w: 60 },  { hex: "#4c4040", w: 60 }, { hex: "#b4bbae", w: 36 },
  { hex: "#6d392e", w: 30 },  { hex: "#2f1f1d", w: 24 }, { hex: "#b87556", w: 24 },
  { hex: "#2a6529", w: 24 },  { hex: "#878082", w: 24 }, { hex: "#edbfb7", w: 18 },
];

// ---------- helpers ----------
const hex2 = (n) => n.toString(16).padStart(2, "0");
const rgbToHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const dist2 = (a, b) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
};
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// dominant colour extraction... downsample, bucket, take distinct top 12
function extractPalette(imgData) {
  const buckets = new Map();
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    const r = d[i] & 0xf0, g = d[i + 1] & 0xf0, b = d[i + 2] & 0xf0;
    const key = (r << 16) | (g << 8) | b;
    const cur = buckets.get(key);
    if (cur) { cur.n++; cur.r += d[i]; cur.g += d[i + 1]; cur.b += d[i + 2]; }
    else buckets.set(key, { n: 1, r: d[i], g: d[i + 1], b: d[i + 2] });
  }
  const sorted = [...buckets.values()]
    .map((v) => ({ rgb: [Math.round(v.r / v.n), Math.round(v.g / v.n), Math.round(v.b / v.n)], n: v.n }))
    .sort((a, b) => b.n - a.n);
  const picked = [];
  for (const c of sorted) {
    if (picked.length >= 12) break;
    if (picked.every((p) => dist2(p.rgb, c.rgb) > 1600)) picked.push(c);
  }
  const total = picked.reduce((s, p) => s + p.n, 0) || 1;
  return picked.map((p) => ({ hex: rgbToHex(...p.rgb), w: Math.max(1, Math.round((p.n / total) * 100)) }));
}

const lum = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];

// weighted pick... vib 0 = calm (dominance-led, occasional doubles), 1 = max contrast
function pickColour(palette, prevHex, rand, vib) {
  const allowDouble = prevHex && vib < 0.45 && rand() < 0.12; // calm end keeps No.1-style paired runs
  const pool = allowDouble ? palette : palette.filter((p) => p.hex !== prevHex);
  const list = pool.length ? pool : palette;
  if (!prevHex) {
    const total = list.reduce((s, p) => s + p.w, 0);
    let r = rand() * total;
    for (const p of list) { r -= p.w; if (r <= 0) return p; }
    return list[list.length - 1];
  }
  const prev = hexToRgb(prevHex);
  const scored = list.map((p) => {
    const rgb = hexToRgb(p.hex);
    const d = Math.sqrt(dist2(prev, rgb)) / 441.7;           // hue + tone distance 0..1
    const dl = Math.abs(lum(prev) - lum(rgb)) / 255;         // luminance jump 0..1
    const contrast = 0.5 * d + 0.5 * dl;
    return { p, score: p.w * (0.1 + (1 - vib) * 0.6 + vib * 4 * Math.pow(contrast, 2)) };
  });
  const total = scored.reduce((s, x) => s + x.score, 0);
  let r = rand() * total;
  for (const x of scored) { r -= x.score; if (r <= 0) return x.p; }
  return scored[scored.length - 1].p;
}

// mulberry32 seeded rng so "regenerate" is reproducible per seed
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// generate strips bottom-up to exactly heightMM
function generateStrips(palette, intensityKey, heightMM, seed, vib) {
  const rand = mulberry32(seed);
  const sizes = INTENSITY[intensityKey].sizes;
  const maxW = Math.max(...palette.map((p) => p.w));
  const strips = [];
  let sum = 0;
  const minSize = Math.min(...sizes);
  while (sum < heightMM - 0.01) {
    const idx = strips.length;
    if (idx === MEMORIAL_INDEX && heightMM - sum >= MEMORIAL_H) {
      strips.push({ hex: MEMORIAL, h: MEMORIAL_H, memorial: true });
      sum += MEMORIAL_H;
      continue;
    }
    const prev = strips.length ? strips[strips.length - 1].hex : null;
    const c = pickColour(palette, prev, rand, vib);
    // dominant colours lean toward larger sizes
    const dominance = c.w / maxW;
    let h;
    if (sizes.length === 1) h = sizes[0];
    else {
      const roll = rand();
      if (dominance > 0.6) h = roll < 0.65 ? sizes[0] : sizes[1];
      else if (sizes.length === 3) h = roll < 0.15 ? sizes[0] : roll < 0.5 ? sizes[1] : sizes[2];
      else h = roll < 0.35 ? sizes[0] : sizes[1];
    }
    const remaining = heightMM - sum;
    if (h > remaining) h = remaining >= minSize ? minSize : remaining;
    if (remaining - h > 0 && remaining - h < minSize) h = remaining; // absorb remainder
    strips.push({ hex: c.hex, h });
    sum += h;
  }
  return strips;
}

const fmt = (n) => "$" + Math.round(n).toLocaleString("en-NZ");

// ---------- component ----------
export default function StripConfigurator() {
  const [widthM, setWidthM] = useState(6);
  const [heightMM, setHeightMM] = useState(550);
  const [intensity, setIntensity] = useState("high");
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [imgUrl, setImgUrl] = useState(null);
  const [seed, setSeed] = useState(1);
  const [vib, setVib] = useState(0.7);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const fileRef = useRef(null);

  const strips = generateStrips(palette, intensity, heightMM, seed, vib);
  const conf = INTENSITY[intensity];
  const heightFactor = heightMM / 550;
  const total = conf.rate * widthM * heightFactor;
  const days = conf.daysPerM * widthM * heightFactor;

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    setImgUrl(url);
    const img = new Image();
    img.onload = () => {
      const cv = canvasRef.current;
      const scale = Math.min(1, 320 / img.width);
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      const data = ctx.getImageData(0, 0, cv.width, cv.height);
      const extracted = extractPalette(data);
      if (extracted.length >= 4) setPalette(extracted);
      setSeed((s) => s + 1);
    };
    img.src = url;
  };

  // tap the photo to sample a colour... replaces the least dominant swatch
  const onImgClick = (e) => {
    const cv = canvasRef.current;
    const img = imgRef.current;
    if (!cv || !img || !cv.width) return;
    const rect = img.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * cv.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * cv.height);
    const px = cv.getContext("2d").getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
    const hex = rgbToHex(px[0], px[1], px[2]);
    setPalette((p) => {
      if (p.some((c) => c.hex === hex)) return p;
      const next = [...p].sort((a, b) => b.w - a.w);
      if (next.length >= 12) next.pop();
      next.push({ hex, w: Math.max(8, Math.round(next[0].w * 0.4)) });
      return next;
    });
    setSeed((s) => s + 1);
  };

  const removeSwatch = (hex) => {
    setPalette((p) => (p.length > 4 ? p.filter((c) => c.hex !== hex) : p));
    setSeed((s) => s + 1);
  };

  const copySpec = async () => {
    const lines = [
      `MintFace Strip Painting ... configured spec`,
      `${widthM}m x ${heightMM}mm | intensity ${conf.label} (${conf.note}) | sequence ${Math.round(vib*100)}/100 calm-to-vibrant | ${strips.length} strips`,
      `price ${fmt(total)} NZD (${fmt(conf.rate)}/m at 550mm, height factor ${heightFactor.toFixed(2)}) | est ${days.toFixed(1)} days on site`,
      ``,
      `strips, bottom up:`,
      ...strips.map((s, i) => `${String(i + 1).padStart(2)}  ${s.hex}  ${String(s.h).padStart(2)}mm${s.memorial ? "  RED LINE (16th from bottom)" : ""}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const num = (v, fb) => { const n = parseFloat(v); return isNaN(n) || n <= 0 ? fb : n; };

  // preview... strips render top-down (last generated at top)
  const previewH = 170;
  const sumH = strips.reduce((s, x) => s + x.h, 0) || 1;

  const S = {
    page: { fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", background: "#fcfcfa", color: "#1a1a1a", minHeight: "100vh", padding: "28px 20px 60px" },
    wrap: { maxWidth: 880, margin: "0 auto" },
    mono: { fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace" },
    eyebrow: { fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#8a8a86", fontFamily: "ui-monospace, monospace" },
    h1: { fontSize: 26, fontWeight: 500, letterSpacing: "-0.01em", margin: "6px 0 2px" },
    label: { fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#8a8a86", fontFamily: "ui-monospace, monospace", display: "block", marginBottom: 8 },
    input: { fontFamily: "ui-monospace, monospace", fontSize: 15, padding: "9px 12px", border: "1px solid #ddddd8", borderRadius: 2, background: "#fff", width: 110, outline: "none" },
    card: { background: "#fff", border: "1px solid #e8e8e4", borderRadius: 3, padding: 20 },
    btn: { fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: "0.06em", padding: "9px 16px", border: "1px solid #1a1a1a", background: "#fff", color: "#1a1a1a", borderRadius: 2, cursor: "pointer" },
    btnDark: { fontFamily: "ui-monospace, monospace", fontSize: 12, letterSpacing: "0.06em", padding: "9px 16px", border: "1px solid #1a1a1a", background: "#1a1a1a", color: "#fff", borderRadius: 2, cursor: "pointer" },
  };

  return (
    <div style={S.page}>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <div style={S.wrap}>
        <div style={S.eyebrow}>MintFace ... Hastings CBD</div>
        <h1 style={S.h1}>Strip Painting Maker</h1>
        <div style={{ fontSize: 13, color: "#6b6b66", marginBottom: 26 }}>
          Design a colourway for your Strip Painting by MintFace. Colours are sampled from the neighbouring signs and the facade above after uploading a photo.
        </div>

        {/* preview */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", height: previewH, border: "1px solid #e0e0dc", borderRadius: 2, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
            {[...strips].reverse().map((s, i) => (
              <div key={i} style={{ background: s.hex, flexGrow: s.h, flexBasis: 0, position: "relative" }}>
                {s.memorial && (
                  <span style={{ ...S.mono, position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: "#fff", opacity: 0.85, letterSpacing: "0.1em" }}>
                    16
                  </span>
                )}
              </div>
            ))}
          </div>
          <div style={{ ...S.mono, fontSize: 11, color: "#a0a09a", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
            <span>{widthM}m × {heightMM}mm ... {strips.length} strips ... preview not to scale</span>
            <span style={{ color: MEMORIAL }}>the red line ... 16th from the bottom, always</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, margin: "14px 0 30px" }}>
          <button style={S.btn} onClick={() => setSeed((s) => s + 1)}>Regenerate pattern</button>
          <button style={S.btn} onClick={copySpec}>{copied ? "Copied" : "Copy spec"}</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, alignItems: "start" }}>
          {/* left column: dimensions + intensity */}
          <div style={{ ...S.card, display: "grid", gap: 22 }}>
            <div style={{ display: "flex", gap: 24 }}>
              <div>
                <label style={S.label}>Width ... metres</label>
                <input style={S.input} type="number" step="0.1" min="1" value={widthM}
                  onChange={(e) => setWidthM(num(e.target.value, 6))} />
              </div>
              <div>
                <label style={S.label}>Height ... mm</label>
                <input style={S.input} type="number" step="10" min="200" value={heightMM}
                  onChange={(e) => { setHeightMM(num(e.target.value, 550)); setSeed((s) => s + 1); }} />
              </div>
            </div>

            <div>
              <label style={S.label}>Strip intensity</label>
              <div style={{ display: "flex", border: "1px solid #ddddd8", borderRadius: 2, overflow: "hidden" }}>
                {Object.entries(INTENSITY).map(([k, v]) => (
                  <button key={k}
                    onClick={() => { setIntensity(k); setSeed((s) => s + 1); }}
                    style={{
                      flex: 1, padding: "10px 6px", cursor: "pointer", border: "none",
                      borderRight: k !== "high" ? "1px solid #ddddd8" : "none",
                      background: intensity === k ? "#1a1a1a" : "#fff",
                      color: intensity === k ? "#fff" : "#1a1a1a",
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{v.label}</div>
                    <div style={{ ...S.mono, fontSize: 10, opacity: 0.7, marginTop: 2 }}>{v.strips} strips ... {v.note}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={S.label}>Sequence ... calm to vibrant</label>
              <input type="range" min="0" max="100" value={Math.round(vib * 100)}
                onChange={(e) => setVib(parseInt(e.target.value, 10) / 100)}
                style={{ width: "100%", accentColor: "#1a1a1a" }} />
              <div style={{ ...S.mono, fontSize: 10, color: "#a0a09a", display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                <span>calm ... quiet runs, paired colours</span>
                <span>vibrant ... max contrast</span>
              </div>
            </div>

            {/* price */}
            <div style={{ borderTop: "1px solid #eeeee9", paddingTop: 16 }}>
              <label style={S.label}>Price ... NZD</label>
              <div style={{ ...S.mono, fontSize: 12, color: "#6b6b66", display: "grid", gap: 5 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>rate at 550mm height</span><span>{fmt(conf.rate)} / m</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>width</span><span>{widthM} m</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>height factor ({heightMM}/550)</span><span>× {heightFactor.toFixed(2)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>est. time on site</span><span>{days.toFixed(1)} days</span></div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 12, paddingTop: 12, borderTop: "1px solid #eeeee9" }}>
                <span style={{ fontSize: 13 }}>Total</span>
                <span style={{ ...S.mono, fontSize: 24, fontWeight: 500 }}>{fmt(total)}</span>
              </div>
            </div>
          </div>

          {/* right column: photo + palette */}
          <div style={{ ...S.card, display: "grid", gap: 16 }}>
            <div>
              <label style={S.label}>Site photo ... signs + facade</label>
              {imgUrl ? (
                <div>
                  <img ref={imgRef} src={imgUrl} alt="site" onClick={onImgClick}
                    style={{ width: "100%", borderRadius: 2, cursor: "crosshair", display: "block" }} />
                  <div style={{ ...S.mono, fontSize: 10, color: "#a0a09a", marginTop: 5 }}>
                    tap the photo to sample a colour ... tap a swatch to remove it
                  </div>
                </div>
              ) : (
                <button style={{ ...S.btn, width: "100%", padding: "26px 0", borderStyle: "dashed", color: "#6b6b66" }}
                  onClick={() => fileRef.current?.click()}>
                  Upload a photo of the site
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />
              {imgUrl && (
                <button style={{ ...S.btn, marginTop: 8, fontSize: 11, padding: "6px 12px" }} onClick={() => fileRef.current?.click()}>
                  Replace photo
                </button>
              )}
            </div>

            <div>
              <label style={S.label}>Palette ... {palette.length} colours + the red line</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {[...palette].sort((a, b) => b.w - a.w).map((c) => (
                  <div key={c.hex} onClick={() => removeSwatch(c.hex)} title="remove"
                    style={{ cursor: "pointer", textAlign: "center" }}>
                    <div style={{ width: 40, height: 40, background: c.hex, borderRadius: 2, border: "1px solid rgba(0,0,0,0.08)" }} />
                    <div style={{ ...S.mono, fontSize: 8, color: "#a0a09a", marginTop: 3 }}>{c.hex.slice(1)}</div>
                  </div>
                ))}
                <div style={{ textAlign: "center" }}>
                  <div style={{ width: 40, height: 40, background: MEMORIAL, borderRadius: 2, outline: "2px solid #1a1a1a", outlineOffset: 1 }} />
                  <div style={{ ...S.mono, fontSize: 8, color: MEMORIAL, marginTop: 3 }}>red line</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...S.mono, fontSize: 10, color: "#b5b5af", marginTop: 26, lineHeight: 1.7 }}>
          High $1,000/m ... Medium $800/m ... Low $650/m, scaled by height. Prices are indicative ... every commission is quoted after a site visit.
        </div>
      </div>
    </div>
  );
}
