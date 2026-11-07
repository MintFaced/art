/* strips-blink: every //STRIP is a screen.
 *
 * One engine, ported from the signal study. Input: a design and the token's
 * random word. It runs inside the token (on-chain, inlined in animation_url),
 * on the design pages, and in MP4 exports.
 *
 * Two parts, kept apart so the app can use them on its own:
 *   schedule(word, traits, t)   pure: which fault is playing at time t, how far
 *   renderFrame(ctx, design, faultId, p, {t, mono})   draws that one frame
 *
 * t is wall-clock seconds since the token's mint block, so everyone looking at
 * a token sees the same fault at the same moment, and the frame is drawn from
 * a generator seeded by the moment too: nothing here calls Math.random().
 *
 * Time is cut into hours, each with its own seeded run of events, which is why
 * the timing never loops and why a token can be asked about any moment, however
 * old it is, without walking there from the start.
 */

const TAU = Math.PI * 2;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, x) => a + (b - a) * x;
const ease = (x) => (x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
function env(p, a, b) { a = a || .15; b = b || .15; return p < a ? p / a : (p > 1 - b ? (1 - p) / b : 1); }
function hashOf(id) { let s = 7; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) | 0; return s; }
const seeded = (id) => mulberry32(hashOf(id));

/* The current frame's generator. Reset by renderFrame. */
let R = mulberry32(1);

export const RED = '#D32011';

/* ---------- a design, from its bytes ---------- */

/** The packed design, as hex with or without its 0x. */
export function decodeDesign(hex) {
  const s = String(hex).replace(/^0x/, '');
  const at = (i) => parseInt(s.substr(i * 2, 2), 16);
  const portrait = at(0) === 1;
  const length = at(1) * 256 + at(2);
  const width = at(3) * 256 + at(4);
  const n = at(5);
  const colours = [];
  for (let i = 0; i < n; i++) colours.push('#' + s.substr((6 + 3 * i) * 2, 6).toUpperCase());
  const bands = [];
  for (let i = 6 + 3 * n; i * 2 < s.length; i++) {
    const c = at(i) >> 4;
    bands.push({ hex: c === 15 ? RED : colours[c], u: at(i) & 15 });
  }
  return { key: s, portrait, length, width, colours, bands };
}

/** The canvas a design wants: its own proportions, long edge `long`. */
export function sizeOf(design, long = 1200) {
  const w = design.portrait ? design.width : design.length;
  const h = design.portrait ? design.length : design.width;
  const k = long / Math.max(w, h);
  return { w: Math.max(2, Math.round(w * k)), h: Math.max(2, Math.round(h * k)) };
}

/* Every edge is the running total rounded once, so neighbouring bands meet on
   the exact pixel and the seams stay hard. */
function drawStrip(ctx, design, w, h) {
  const total = design.bands.reduce((s, b) => s + b.u, 0);
  const across = design.portrait ? w : h;
  let run = 0;
  for (const b of design.bands) {
    const a = Math.round((run / total) * across);
    run += b.u;
    const z = Math.round((run / total) * across);
    ctx.fillStyle = b.hex;
    if (design.portrait) ctx.fillRect(a, 0, z - a, h);
    else ctx.fillRect(0, h - z, w, z - a);
  }
}

/* ---------- pre-rendered sources per design and size ---------- */
const cache = new Map();
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function sources(design, w, h) {
  const key = design.key + w + 'x' + h; if (cache.has(key)) return cache.get(key);
  if (cache.size > 12) cache.clear();
  const base = mk(w, h), bx = base.getContext('2d', { willReadFrequently: true }); drawStrip(bx, design, w, h);
  const d = bx.getImageData(0, 0, w, h).data;
  const names = ['grey', 'r', 'g', 'b', 'poster', 'inv']; const out = {}; const ids = {};
  for (const n of names) { out[n] = mk(w, h); ids[n] = new ImageData(w, h); }
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], G = d[i + 1], B = d[i + 2], L = .299 * r + .587 * G + .114 * B;
    const g = ids.grey.data; g[i] = g[i + 1] = g[i + 2] = L; g[i + 3] = 255;
    ids.r.data[i] = r; ids.r.data[i + 3] = 255; ids.g.data[i + 1] = G; ids.g.data[i + 3] = 255; ids.b.data[i + 2] = B; ids.b.data[i + 3] = 255;
    const p = ids.poster.data; p[i] = (r >> 6) << 6; p[i + 1] = (G >> 6) << 6; p[i + 2] = (B >> 6) << 6; p[i + 3] = 255;
    const v = ids.inv.data; v[i] = 255 - r; v[i + 1] = 255 - G; v[i + 2] = 255 - B; v[i + 3] = 255;
  }
  for (const n of names) out[n].getContext('2d').putImageData(ids[n], 0, 0);
  const sm = mk(Math.ceil(w / 14), Math.ceil(h / 14)); sm.getContext('2d').drawImage(base, 0, 0, sm.width, sm.height);
  const blocky = mk(w, h), bk = blocky.getContext('2d'); bk.imageSmoothingEnabled = false; bk.drawImage(sm, 0, 0, w, h);
  /* The study's screen was always 2:1 and its unit S.h/600. A token can be any
     shape, so the unit comes from the short side of a 2:1 box that fits. */
  const S = Object.assign({ w, h, u: Math.min(h, w / 2) / 600, portrait: design.portrait, base, blocky }, out); cache.set(key, S); return S;
}

let NOISE, CLOUD, VBAND, TMP;
function textures() {
  if (NOISE) return;
  const r = mulberry32(20261105);
  NOISE = [];
  for (let n = 0; n < 5; n++) { const c = mk(192, 192), x = c.getContext('2d'), id = x.createImageData(192, 192), d = id.data; for (let y = 0; y < 192; y++) { let v = 0; for (let xx = 0; xx < 192; xx++) { if (xx % 2 === 0) v = r() * 255; const i = (y * 192 + xx) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } } x.putImageData(id, 0, 0); NOISE.push(c); }
  CLOUD = (function () { const c = mk(16, 8), x = c.getContext('2d'), id = x.createImageData(16, 8); for (let i = 0; i < id.data.length; i += 4) { const v = 60 + r() * 160; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } x.putImageData(id, 0, 0); return c; }());
  VBAND = (function () { const c = mk(64, 1), x = c.getContext('2d'), id = x.createImageData(64, 1); for (let i = 0; i < id.data.length; i += 4) { const v = 150 + r() * 105; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } x.putImageData(id, 0, 0); return c; }());
  TMP = mk(2, 2);
}

function noise(c, x, y, w, h, a) { if (a <= 0 || h <= 0) return; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.globalAlpha = Math.min(1, a); const n = NOISE[(R() * NOISE.length) | 0]; const ox = (R() * 192) | 0, oy = (R() * 192) | 0; for (let ty = y - oy; ty < y + h; ty += 192) for (let tx = x - ox; tx < x + w; tx += 192) c.drawImage(n, tx, ty); c.restore(); }
function black(c, S) { c.fillStyle = '#000'; c.fillRect(0, 0, S.w, S.h); }
function src(S, m) { return m ? S.grey : S.base; }
function seams(c, S, C, Rw, a) { const cw = S.w / C, ch = S.h / Rw, lw = Math.max(1, S.w / 600); c.fillStyle = 'rgba(0,0,0,' + a + ')'; for (let i = 1; i < C; i++) c.fillRect(i * cw, 0, lw, S.h); for (let j = 1; j < Rw; j++) c.fillRect(0, j * ch, S.w, lw); }
function rowShift(c, img, S, y0, y1, fn) { for (let y = Math.max(0, Math.floor(y0)); y < Math.min(S.h, y1); y += 2) { const dx = fn(y); c.drawImage(img, 0, y, S.w, 2, dx, y, S.w, 2); if (dx > 0) { c.fillStyle = '#000'; c.fillRect(0, y, dx, 2); } } }
function vband(c, S, y, bh, a) { const g = c.createLinearGradient(0, y, 0, y + bh); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.5, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, y, S.w, bh); }
/* No fonts to fetch: the token has to play with the network blocked. */
function font(c, S, px, weight, mono) { c.font = (weight || 500) + ' ' + Math.max(8, px * S.u) + 'px ' + (mono ? 'ui-monospace, Menlo, Consolas, monospace' : 'ui-sans-serif, system-ui, sans-serif'); }

/* ---------- the faults, from the study ---------- */
const F={
 snow:{d:3,f(c,S,t,p,m){const a=.25+.75*env(p,.3,.3);black(c,S);c.globalAlpha=1-a*.8;c.drawImage(src(S,m),0,0);noise(c,0,0,S.w,S.h,a*.95)}},
 vroll:{d:2.4,f(c,S,t,p,m){black(c,S);const bar=S.h*.09,L=S.h+bar,y=-(p*L)+Math.sin(t*50)*S.h*.004;c.drawImage(src(S,m),0,y);c.drawImage(src(S,m),0,y+L)}},
 hhold:{d:3,f(c,S,t,p,m){black(c,S);const img=src(S,m),gap=S.w*.2,L=S.w+gap,slope=1.6+.6*Math.sin(p*TAU);for(let y=0;y<S.h;y+=2){const o=(((y*slope+t*S.w*.5)%L)+L)%L;c.drawImage(img,0,y,S.w,2,o,y,S.w,2);c.drawImage(img,0,y,S.w,2,o-L,y,S.w,2)}}},
 shrink:{d:3,f(c,S,t,p,m){black(c,S);const img=src(S,m),s=1-.3*Math.sin(Math.PI*p),cw=S.w*s,ch=S.h*s;c.drawImage(img,(S.w-cw)/2,(S.h-ch)/2,cw,ch);c.globalCompositeOperation="lighter";c.globalAlpha=.3*Math.sin(Math.PI*p);const s2=s*1.025;c.drawImage(img,(S.w-S.w*s2)/2,(S.h-S.h*s2)/2,S.w*s2,S.h*s2)}},
 dot:{d:3.6,seq:true,f(c,S,t,p,m){black(c,S);const img=src(S,m),w=S.w,h=S.h;
   if(p<.25){c.drawImage(img,0,0)}
   else if(p<.42){const q=ease((p-.25)/.17),ch=Math.max(1,h*lerp(1,.006,q));c.drawImage(img,0,(h-ch)/2,w,ch);c.globalAlpha=q*.85;c.fillStyle="#fff";c.fillRect(0,(h-ch)/2,w,ch)}
   else if(p<.56){const q=ease((p-.42)/.14),cw=Math.max(2,w*lerp(1,.004,q)),ch=Math.max(2,h*.008);c.fillStyle="#fff";c.fillRect((w-cw)/2,(h-ch)/2,cw,ch)}
   else if(p<.74){const q=(p-.56)/.18,r=h*.07*(1-q*.5),g=c.createRadialGradient(w/2,h/2,0,w/2,h/2,r);g.addColorStop(0,"rgba(255,255,255,"+(1-q)+")");g.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=g;c.fillRect(0,0,w,h)}
   else if(p>.9){const q=(p-.9)/.1;c.globalAlpha=q;c.drawImage(img,0,0);c.globalCompositeOperation="lighter";c.globalAlpha=(1-q)*.6;c.drawImage(img,0,0)}}},
 ghost:{d:3,f(c,S,t,p,m){const img=src(S,m);c.drawImage(img,0,0);const dy=S.h*(.018+.008*Math.sin(p*TAU));c.globalAlpha=.4;c.drawImage(img,S.w*.04,dy);c.globalAlpha=.18;c.drawImage(img,S.w*.08,dy*2.2)}},
 hum:{d:4,f(c,S,t,p,m){c.drawImage(src(S,m),0,0);for(let k=0;k<2;k++){const bh=S.h*.38,yc=((p+k*.5)%1)*S.h*1.5-S.h*.25;vband(c,S,yc-bh/2,bh,.55)}}},

 convergence:{d:3.5,f(c,S,t,p){black(c,S);const k=S.h*(.006+.02*Math.pow(Math.sin(p*Math.PI),2));c.globalCompositeOperation="lighter";c.drawImage(S.r,-k*.6,-k);c.drawImage(S.g,0,0);c.drawImage(S.b,k*.6,k*.9)}},
 purity:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);c.globalCompositeOperation="overlay";const spots=[[.12+.05*Math.sin(p*TAU),.2,"255,0,190"],[.86,.78+.05*Math.cos(p*TAU),"0,255,120"],[.55,.08,"255,170,0"]];for(const s of spots){const g=c.createRadialGradient(s[0]*S.w,s[1]*S.h,0,s[0]*S.w,s[1]*S.h,S.h*.75);g.addColorStop(0,"rgba("+s[2]+",.85)");g.addColorStop(1,"rgba("+s[2]+",0)");c.fillStyle=g;c.fillRect(0,0,S.w,S.h)}}},
 degauss:{d:2.6,f(c,S,t,p){black(c,S);const A=S.h*.07*Math.pow(1-p,1.5)*Math.min(1,p/.04),step=Math.max(2,Math.round(S.w/300));for(let x=0;x<S.w;x+=step){const dy=A*Math.sin(x/S.w*TAU*2.5+t*38)*Math.sin(t*22+x*.002);c.drawImage(S.base,x,0,step,S.h,x,dy,step,S.h)}if(p<.5){c.globalCompositeOperation="overlay";c.globalAlpha=(.5-p)*1.4;c.fillStyle="hsl("+((t*600)%360)+" 90% 55%)";c.fillRect(0,0,S.w,S.h)}}},
 gunloss:{d:4.5,f(c,S,t,p){black(c,S);c.globalCompositeOperation="lighter";const lost=Math.floor(p*3)%3;if(lost!==0)c.drawImage(S.r,0,0);if(lost!==1)c.drawImage(S.g,0,0);if(lost!==2)c.drawImage(S.b,0,0)}},
 vcollapse:{d:3,seq:true,f(c,S,t,p,m){black(c,S);const img=src(S,m),th=S.h*(.014+.006*Math.sin(t*31));let sy=th/S.h;if(p<.12)sy=lerp(1,sy,ease(p/.12));else if(p>.88)sy=lerp(sy,1,ease((p-.88)/.12));const ch=S.h*sy,y=(S.h-ch)/2;c.drawImage(img,0,y,S.w,ch);c.globalCompositeOperation="lighter";c.globalAlpha=.7;c.drawImage(img,0,y,S.w,ch);c.globalCompositeOperation="source-over";c.globalAlpha=1;const pad=S.h*.06,g=c.createLinearGradient(0,y-pad,0,y+ch+pad);g.addColorStop(0,"rgba(255,255,255,0)");g.addColorStop(.5,"rgba(255,255,255,.22)");g.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=g;c.fillRect(0,y-pad,S.w,ch+pad*2)}},
 hcollapse:{d:3,seq:true,f(c,S,t,p,m){black(c,S);const img=src(S,m),tw=S.w*(.008+.003*Math.sin(t*29));let sx=tw/S.w;if(p<.12)sx=lerp(1,sx,ease(p/.12));else if(p>.88)sx=lerp(sx,1,ease((p-.88)/.12));const cw=S.w*sx,x=(S.w-cw)/2;c.drawImage(img,x,0,cw,S.h);c.globalCompositeOperation="lighter";c.globalAlpha=.7;c.drawImage(img,x,0,cw,S.h)}},
 pincushion:{d:4,f(c,S,t,p,m){black(c,S);const img=src(S,m),k=.13*(.5+.5*Math.sin(p*TAU));if(S.portrait){/* bands stand up here, so the bow runs across them */const st=Math.max(2,Math.round(S.h/300));for(let y=0;y<S.h;y+=st){const u=(y+st/2-S.h/2)/(S.h/2),cw=S.w*(1+k*u*u);c.drawImage(img,0,y,S.w,st,(S.w-cw)/2,y,cw,st)}return}const step=Math.max(2,Math.round(S.w/300));for(let x=0;x<S.w;x+=step){const u=(x+step/2-S.w/2)/(S.w/2),ch=S.h*(1+k*u*u);c.drawImage(img,x,0,step,S.h,x,(S.h-ch)/2,step,ch)}}},
 scanflicker:{d:2,f(c,S,t,p,m){c.drawImage(src(S,m),0,0);c.fillStyle="rgba(0,0,0,.4)";const lh=Math.max(1,S.h/300),off=Math.floor(t*30)%2;for(let y=off*lh;y<S.h;y+=lh*2)c.fillRect(0,y,S.w,lh);c.fillStyle="rgba(0,0,0,"+(R()*.12)+")";c.fillRect(0,0,S.w,S.h)}},

 wires:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const A=S.h*.012*(1-p)*Math.sin(t*55),lw=Math.max(1,S.h/400);c.fillStyle="rgba(0,0,0,.6)";c.fillRect(0,S.h*.33+A,S.w,lw);c.fillRect(0,S.h*.67-A,S.w,lw)}},
 burnin:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);const u=S.u,a=.17+.05*Math.sin(p*TAU);c.fillStyle="rgba(0,0,0,"+a+")";c.fillRect(S.w-200*u,32*u,160*u,72*u);c.fillRect(0,S.h*.86,S.w,S.h*.08);c.fillStyle="rgba(255,255,255,"+a+")";font(c,S,40,600);c.textBaseline="middle";c.fillText("CH 3",S.w-180*u,68*u)}},
 bloom:{d:3,f(c,S,t,p){black(c,S);const s=.5-.5*Math.cos(p*TAU),sc=1+.03*s,cw=S.w*sc,ch=S.h*sc;c.drawImage(S.base,(S.w-cw)/2,(S.h-ch)/2,cw,ch);c.globalCompositeOperation="lighter";c.globalAlpha=.4*s;const s2=sc*1.05;c.drawImage(S.base,(S.w-S.w*s2)/2,(S.h-S.h*s2)/2,S.w*s2,S.h*s2)}},
 tilt:{d:4,f(c,S,t,p){black(c,S);const a=Math.sin(p*TAU)*2.4*Math.PI/180;c.translate(S.w/2,S.h/2);c.rotate(a);c.drawImage(S.base,-S.w/2,-S.h/2)}},

 tracking:{d:3.5,f(c,S,t,p,m){const img=src(S,m);c.drawImage(img,0,0);const bh=S.h*.15,y0=((p*1.15)%1)*(S.h+bh)-bh;rowShift(c,img,S,y0,y0+bh,()=>R()*S.w*.14);noise(c,0,y0,S.w,bh,.55);c.fillStyle="rgba(255,255,255,.85)";for(let i=0;i<6;i++)c.fillRect(R()*S.w,y0+R()*bh,S.w*(.05+R()*.25),Math.max(1,S.h/300))}},
 headswitch:{d:3,f(c,S,t,p,m){const img=src(S,m);black(c,S);c.drawImage(img,0,R()<.25?R()*S.h*.008:0);const y0=S.h*.92;rowShift(c,img,S,y0,S.h,y=>((y-y0)/(S.h-y0))*S.w*.08+R()*S.w*.03);noise(c,0,y0,S.w,S.h-y0,.35)}},
 chroma:{d:3.5,f(c,S,t,p){c.drawImage(S.base,0,0);const k=S.h*(.01+.012*Math.pow(Math.sin(p*TAU),2));c.globalCompositeOperation="screen";c.globalAlpha=.45;c.drawImage(S.r,S.w*.01,k);c.globalAlpha=.35;c.drawImage(S.b,-S.w*.006,-k*.7)}},
 bluescreen:{d:4,seq:true,f(c,S,t,p,m){const u=S.u;if(p<.1||p>.9){c.drawImage(src(S,m),0,0);if((p>.06&&p<.1)||(p>.9&&p<.94))noise(c,0,0,S.w,S.h,.7);return}c.fillStyle="#1434B4";c.fillRect(0,0,S.w,S.h);c.fillStyle="#fff";font(c,S,42,500,true);c.textBaseline="top";if(Math.floor(t*2)%2===0)c.fillText("PLAY ▶",48*u,40*u);c.fillText("SP",S.w-110*u,S.h-80*u)}},
 bars:{d:4,seq:true,f(c,S,t,p,m){if(p<.1||p>.9){c.drawImage(src(S,m),0,0);if((p>.06&&p<.1)||(p>.9&&p<.94))noise(c,0,0,S.w,S.h,.6);return}black(c,S);const bw=S.w/7,top=["#c0c0c0","#c0c000","#00c0c0","#00c000","#c000c0","#c00000","#0000c0"],mid=["#0000c0","#131313","#c000c0","#131313","#00c0c0","#131313","#c0c0c0"];top.forEach((col,i)=>{c.fillStyle=col;c.fillRect(i*bw,0,bw+1,S.h*.67)});mid.forEach((col,i)=>{c.fillStyle=col;c.fillRect(i*bw,S.h*.67,bw+1,S.h*.08)});let x=0;for(const s of [["#00214c",1.25],["#ffffff",1.25],["#32006a",1.25],["#131313",1.25],["#090909",.33],["#131313",.33],["#1d1d1d",.34],["#131313",1]]){c.fillStyle=s[0];c.fillRect(x,S.h*.75,bw*s[1]+1,S.h*.25);x+=bw*s[1]}}},
 tapecrease:{d:3,f(c,S,t,p,m){const img=src(S,m);c.drawImage(img,0,0);if(Math.sin(p*TAU*2)>.6){const y0=S.h*(.3+.4*R());rowShift(c,img,S,y0,y0+S.h*.05,()=>S.w*(.02+R()*.05))}const n=Math.floor(4+30*Math.pow(Math.sin(p*Math.PI),2));c.fillStyle="rgba(255,255,255,.9)";for(let i=0;i<n;i++)c.fillRect(R()*S.w,R()*S.h,S.w*(.02+R()*.2),Math.max(1,S.h/400)*(R()<.2?3:1))}},

 retention:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);c.globalCompositeOperation="multiply";c.globalAlpha=.24+.12*Math.sin(p*TAU);c.drawImage(S.grey,0,S.h*.055)}},
 contour:{d:3.5,f(c,S,t,p){c.drawImage(S.base,0,0);const e=env(p,.2,.2);c.globalAlpha=.85*e;c.drawImage(S.poster,0,0);noise(c,0,0,S.w,S.h,.1*e)}},
 deadline:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const lw=Math.max(1,S.h/300);c.fillStyle="#000";c.fillRect(0,S.h*.41,S.w,lw*2);if(Math.sin(t*7)>-.3){c.fillStyle="rgba(120,255,255,.9)";c.fillRect(0,S.h*.73,S.w,lw)}c.fillStyle="rgba(0,0,0,.6)";c.fillRect(S.w*.62,0,lw,S.h)}},
 buzzflicker:{d:2.5,f(c,S,t,p){c.drawImage(S.base,0,0);c.fillStyle="rgba(0,0,0,"+(R()*.32)+")";c.fillRect(0,0,S.w,S.h);const y=((t*2.3)%1)*S.h,bh=S.h*.1,g=c.createLinearGradient(0,y,0,y+bh);g.addColorStop(0,"rgba(255,255,255,0)");g.addColorStop(.5,"rgba(255,255,255,.12)");g.addColorStop(1,"rgba(255,255,255,0)");c.fillStyle=g;c.fillRect(0,y,S.w,bh)}},

 vlines:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const r=seeded("vlines"),cols=["#ff2bd6","#00ffd0","#ffffff","#00ff3c","#ffe600","#3a5bff","#000000"],lw=Math.max(1,S.w/600);for(let i=0;i<10;i++){const x=r()*S.w,col=cols[(r()*cols.length)|0],w2=lw*(1+((r()*3)|0)),fl=r()<.3;if(fl&&Math.sin(t*9+i)<0)continue;c.fillStyle=col;c.fillRect(x,0,w2,S.h)}}},
 hline:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const y0=Math.round(S.h*(.55+.01*Math.sin(t*3)));c.drawImage(S.base,0,y0,S.w,1,0,y0,S.w,S.h*.13);c.fillStyle="rgba(255,255,255,.85)";c.fillRect(0,y0,S.w,Math.max(1,S.h/300))}},
 deadpixels:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const r=seeded("px"),sz=Math.max(2,Math.round(S.w/300));for(let i=0;i<60;i++){c.fillStyle=r()<.7?"#000":["#fff","#f00","#0f0","#00f"][(r()*4)|0];c.fillRect(Math.round(r()*S.w),Math.round(r()*S.h),sz,sz)}c.fillStyle="#0f0";for(let i=0;i<9;i++)c.fillRect(S.w*.3+(i%3)*sz,S.h*.6+((i/3)|0)*sz,sz,sz);if(Math.sin(t*5)>0){c.fillStyle="#fff";c.fillRect(S.w*.7,S.h*.2,sz,sz)}}},
 bleed:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);c.globalCompositeOperation="screen";const a=.45+.1*Math.sin(p*TAU);for(const s of [[0,0,.5],[1,1,.55],[.5,0,.35],[1,.1,.4],[0,1,.35]]){const g=c.createRadialGradient(s[0]*S.w,s[1]*S.h,0,s[0]*S.w,s[1]*S.h,S.h*s[2]);g.addColorStop(0,"rgba(255,255,240,"+a+")");g.addColorStop(1,"rgba(255,255,240,0)");c.fillStyle=g;c.fillRect(0,0,S.w,S.h)}}},
 halfdark:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const a=.62+.08*Math.sin(t*11),x0=S.w*.5,e=S.w*.04,g=c.createLinearGradient(x0-e,0,x0+e,0);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,"rgba(0,0,0,"+a+")");c.fillStyle=g;c.fillRect(x0-e,0,e*2,S.h);c.fillStyle="rgba(0,0,0,"+a+")";c.fillRect(x0+e,0,S.w,S.h)}},
 crack:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);const r=seeded("crack"),cx=S.w*.66,cy=S.h*.4,R0=S.h*(.08+.5*ease(Math.min(1,p*1.3))),lw=Math.max(1,S.w/500),cols=["#ff00c8","#00f0ff","#ffffff","#ffee00"];c.globalAlpha=.85;for(let i=0;i<6;i++){c.fillStyle=cols[i%4];c.fillRect(cx+(r()-.5)*R0*2.2,0,lw*(1+(i%2)),S.h)}c.globalAlpha=1;c.strokeStyle="rgba(255,255,255,.75)";c.lineWidth=lw;for(let i=0;i<10;i++){const a=r()*TAU,len=R0*(1.5+r()*2.5);c.beginPath();c.moveTo(cx,cy);for(let s=1;s<=4;s++)c.lineTo(cx+Math.cos(a+(r()-.5)*.4)*len*s/4,cy+Math.sin(a+(r()-.5)*.4)*len*s/4);c.stroke()}c.beginPath();for(let i=0;i<=20;i++){const a=i/20*TAU,rr=R0*(.65+.45*r()),x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr*.8;if(i)c.lineTo(x,y);else c.moveTo(x,y)}c.closePath();c.fillStyle="#050505";c.fill();c.lineWidth=lw*3;c.strokeStyle="rgba(120,0,200,.6)";c.stroke()}},
 tcon:{d:4,seq:true,f(c,S,t,p){const ph=Math.floor(p*4);if(ph===0)c.drawImage(S.base,0,0);else if(ph===1){black(c,S);c.drawImage(S.base,0,0,S.w,S.h,0,0,S.w,S.h/2);c.drawImage(S.base,0,0,S.w,S.h,S.w*.04,S.h/2,S.w,S.h/2)}else if(ph===2)c.drawImage(S.inv,0,0);else c.drawImage(Math.floor(t*12)%2?S.poster:S.inv,0,0)}},
 ripple:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);c.globalCompositeOperation="overlay";for(let i=0;i<7;i++){const rr=(p*1.1+i*.07)*S.w*.55;if(rr<=0)continue;c.globalAlpha=Math.max(0,(1-p)*(.6-i*.06));c.strokeStyle="hsl("+((i*55+p*200)%360)+" 95% 55%)";c.lineWidth=S.h*.035;c.beginPath();c.arc(S.w*.36,S.h*.55,rr,0,TAU);c.stroke()}}},

 stripfail:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const zw=S.w/8;for(const z of [2,5]){const x=z*zw,a=z===5?.6+.3*Math.sin(t*13):.8,g=c.createLinearGradient(x-zw*.3,0,x+zw*1.3,0);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(.25,"rgba(0,0,0,"+a+")");g.addColorStop(.75,"rgba(0,0,0,"+a+")");g.addColorStop(1,"rgba(0,0,0,0)");c.fillStyle=g;c.fillRect(x-zw*.3,0,zw*1.6,S.h)}}},
 blooming:{d:4,f(c,S,t,p){c.drawImage(S.base,0,0);const s=.5+.5*Math.sin(p*TAU);c.globalCompositeOperation="screen";c.globalAlpha=.22*s+.08;c.drawImage(S.base,0,-S.h*.03,S.w,S.h*1.06);c.drawImage(S.base,0,S.h*.02,S.w,S.h*.96);c.globalCompositeOperation="source-over";c.globalAlpha=1;c.fillStyle="rgba(30,34,48,.12)";c.fillRect(0,0,S.w,S.h)}},
 pwm:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);for(let k=0;k<4;k++)vband(c,S,((t*.8+k/4)%1)*S.h*1.2-S.h*.1,S.h*.12,.42)}},
 dimzones:{d:4,f(c,S,t,p){c.drawImage(S.base,0,0);const r=seeded("zones"),C=12,R=6,zw=S.w/C,zh=S.h/R;for(let j=0;j<R;j++)for(let i=0;i<C;i++){const on=r()<.45,ph=r()*TAU;if(!on)continue;c.fillStyle="rgba(0,0,0,"+(.42*(.5+.5*Math.sin(t*2.6+ph)))+")";c.fillRect(i*zw,j*zh,zw+.5,zh+.5)}}},

 deadmodule:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const C=16,R=8,cw=S.w/C,ch=S.h/R;seams(c,S,C,R,.28);c.fillStyle="#000";for(const q of [[3,2],[11,5],[7,6],[14,1]])c.fillRect(q[0]*cw,q[1]*ch,cw,ch);const f=Math.floor(t*6)%3;if(f===0){c.fillStyle="#000";c.fillRect(5*cw,3*ch,cw,ch)}else if(f===1)noise(c,5*cw,3*ch,cw,ch,1)}},
 moduleshift:{d:4,f(c,S,t,p){c.drawImage(S.base,0,0);const C=16,R=8,cw=S.w/C,ch=S.h/R,r=seeded("mods");c.globalCompositeOperation="multiply";const tints=["rgba(255,220,160,.9)","rgba(170,200,255,.9)","rgba(255,190,220,.9)","rgba(200,255,200,.9)"];for(let k=0;k<9;k++){const i=(r()*C)|0,j=(r()*R)|0;c.fillStyle=tints[k%4];c.fillRect(i*cw,j*ch,cw,ch)}c.globalCompositeOperation="source-over";c.drawImage(S.base,9*cw,4*ch+ch*.5*Math.sin(t*1.7),cw,ch,9*cw,4*ch,cw,ch);seams(c,S,C,R,.2)}},
 scanrefresh:{d:2.5,f(c,S,t,p){c.drawImage(S.base,0,0);const y=p*S.h;c.fillStyle="rgba(0,0,0,.28)";c.fillRect(0,y,S.w,S.h-y);c.fillStyle="rgba(255,255,255,.35)";c.fillRect(0,y,S.w,Math.max(1,S.h/200));const st=Math.max(3,Math.round(S.w/240));c.fillStyle="rgba(0,0,0,.35)";for(let x=0;x<S.w;x+=st)c.fillRect(x,0,1,S.h);for(let yy=0;yy<S.h;yy+=st)c.fillRect(0,yy,S.w,1)}},
 seams:{d:4,f(c,S,t,p){black(c,S);const C=16,R=8,cw=S.w/C,ch=S.h/R,r=seeded("seams");for(let j=0;j<R;j++)for(let i=0;i<C;i++){const big=r()<.12,dx=(r()-.5)*(big?S.w*.012:S.w*.003),dy=(r()-.5)*(big?S.h*.03:S.h*.006)+(big?Math.sin(t*1.5+i)*S.h*.004:0);c.drawImage(S.base,i*cw,j*ch,cw,ch,i*cw+dx,j*ch+dy,cw,ch)}seams(c,S,C,R,.55)}},

 oledburn:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);const u=S.u,a=.18+.04*Math.sin(p*TAU);c.fillStyle="rgba(211,32,17,"+a+")";c.fillRect(0,S.h*.2,S.w,S.h*.035);c.fillStyle="rgba(0,0,0,"+(a*.8)+")";c.fillRect(0,0,S.w,S.h*.06);c.fillStyle="rgba(255,255,255,"+a+")";font(c,S,26,500,true);c.textBaseline="middle";c.fillText("12:00",S.w-110*u,S.h*.03)}},
 pinktint:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);c.globalCompositeOperation="multiply";c.globalAlpha=.55+.2*Math.sin(p*TAU);c.fillStyle="rgb(255,175,215)";c.fillRect(0,0,S.w,S.h);c.globalCompositeOperation="screen";c.globalAlpha=.12;c.fillStyle="rgb(255,80,170)";c.fillRect(0,0,S.w,S.h)}},
 greenline:{d:4,f(c,S,t,p){c.drawImage(S.base,0,0);const lw=Math.max(2,S.w/400);c.fillStyle="#39ff14";c.fillRect(S.w*.73,0,lw,S.h);if(Math.sin(t*1.3)>.2){c.fillStyle="#ff4fd8";c.fillRect(S.w*.31,0,lw*.7,S.h)}}},
 mura:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);c.fillStyle="rgba(0,0,0,"+(.55+.08*Math.sin(p*TAU))+")";c.fillRect(0,0,S.w,S.h);c.imageSmoothingEnabled=true;c.globalCompositeOperation="overlay";c.globalAlpha=.5;c.drawImage(CLOUD,0,0,S.w,S.h);c.globalCompositeOperation="multiply";c.globalAlpha=.2;c.drawImage(VBAND,0,0,S.w,S.h)}},
 blot:{d:5,f(c,S,t,p){c.drawImage(S.base,0,0);const r=seeded("blot"),cx=S.w*.12,cy=S.h*.86,R0=S.h*(.12+.55*ease(Math.min(1,p*1.25))),lw=Math.max(1,S.w/500);c.fillStyle="rgba(150,60,255,.75)";for(let i=0;i<3;i++)c.fillRect(cx+R0*(.2+r()*.6),0,lw,S.h);const pts=[];for(let i=0;i<14;i++){const a=i/14*TAU,rr=R0*(.7+.35*r());pts.push([cx+Math.cos(a)*rr,cy+Math.sin(a)*rr*.85])}c.beginPath();for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;if(i===0)c.moveTo(mx,my);c.quadraticCurveTo(b[0],b[1],(b[0]+pts[(i+2)%pts.length][0])/2,(b[1]+pts[(i+2)%pts.length][1])/2)}c.closePath();c.fillStyle="#020202";c.fill();c.lineWidth=lw*4;c.strokeStyle="rgba(40,255,140,.5)";c.stroke()}},
 lowflicker:{d:2,f(c,S,t,p){c.drawImage(S.base,0,0);c.fillStyle="rgba(0,0,0,"+(Math.floor(t*40)%3===0?.72:.46)+")";c.fillRect(0,0,S.w,S.h)}},

 macroblock:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const r=mulberry32(Math.floor(t*7)*977+13),bs=Math.max(8,Math.round(S.w/36)),C=Math.ceil(S.w/bs),R=Math.ceil(S.h/bs),dens=.35*env(p,.25,.25)+.05;for(let j=0;j<R;j++)for(let i=0;i<C;i++){if(r()>dens)continue;const k=r(),x=i*bs,y=j*bs;if(k<.6)c.drawImage(S.base,x,clamp(y+(r()-.5)*S.h*.4,0,S.h-bs),bs,bs,x,y,bs,bs);else if(k<.85)c.drawImage(S.blocky,x,y,bs,bs,x,y,bs,bs);else{c.fillStyle=r()<.5?"#13d36a":"#d313b8";c.globalAlpha=.85;c.fillRect(x,y,bs,bs);c.globalAlpha=1}}}},
 pixelate:{d:3.5,f(c,S,t,p){const f=1+38*Math.pow(env(p,.4,.2),1.4),sw=Math.max(2,Math.round(S.w/f)),sh=Math.max(1,Math.round(S.h/f));TMP.width=sw;TMP.height=sh;const tx=TMP.getContext("2d");tx.drawImage(S.base,0,0,sw,sh);c.imageSmoothingEnabled=false;c.drawImage(TMP,0,0,S.w,S.h)}},
 datamosh:{d:3.5,f(c,S,t,p){c.drawImage(S.base,0,0);const bs=Math.max(6,Math.round(S.w/30)),r=seeded("mosh"),e=env(p,.3,.2);for(let x=0;x<S.w;x+=bs){if(r()<.4){r();r();r();continue}const sy=r()*S.h,L=S.h*(.1+r()*.6)*e,ox=(r()-.5)*bs*.6;if(L>1)c.drawImage(S.base,x,sy,bs,2,x+ox,sy,bs,L)}}},
 sparkles:{d:3,f(c,S,t,p){c.drawImage(S.base,0,0);const n=Math.max(6,Math.round((30+250*env(p,.2,.2))*S.w*S.h/720000)),dot=Math.max(1,S.w/500)*2,lh=Math.max(1,S.h/400);for(let i=0;i<n;i++){c.fillStyle=R()<.7?"#fff":"hsl("+(R()*360)+" 100% 60%)";c.fillRect(R()*S.w,R()*S.h,R()<.15?S.w*(.01+R()*.03):dot,lh)}}},
 nosignal:{d:4,seq:true,f(c,S,t,p){const u=S.u;if(p<.08){c.drawImage(S.base,0,0);noise(c,0,0,S.w,S.h,p/.08*.6);return}black(c,S);if(p<.15)return;if(p>.88){if(p>.94){c.globalAlpha=(p-.94)/.06;c.drawImage(S.base,0,0)}return}const bw=320*u,bh=110*u,x=(S.w-bw)/2+Math.sin(t*.5)*20*u,y=(S.h-bh)/2;c.strokeStyle="rgba(255,255,255,.85)";c.lineWidth=Math.max(1,2*u);c.strokeRect(x,y,bw,bh);c.fillStyle="#fff";c.textAlign="center";c.textBaseline="middle";font(c,S,36,500);c.fillText("No signal",x+bw/2,y+bh*.42);c.globalAlpha=.7;font(c,S,20,400,true);c.fillText("HDMI 1",x+bw/2,y+bh*.75)}},

 /* pieces of the signature chain */
 _dark:{d:1,f(c,S){black(c,S)}},
 _on:{d:.4,f(c,S,t,p,m){c.drawImage(src(S,m),0,0);c.fillStyle="rgba(255,255,255,"+(1-p)*.8+")";c.fillRect(0,0,S.w,S.h)}},
 _lines:{d:1,f(c,S,t,p,m){black(c,S);const h2=S.h*ease(p),y=(S.h-h2)/2;c.drawImage(src(S,m),0,y,S.w,h2,0,y,S.w,h2);c.fillStyle="rgba(255,255,255,.5)";c.fillRect(0,y,S.w,Math.max(1,S.h/300));c.fillRect(0,y+h2,S.w,Math.max(1,S.h/300))}}
};

const SIGNATURE = [{ id: 'hhold', d: 1.1 }, { id: 'snow', d: 1 }, { id: '_dark', d: .6 }, { id: '_on', d: .3 }, { id: '_dark', d: .45 }, { id: '_lines', d: .9 }];

/* ---------- displays, rhythms: the study's tables ---------- */
export const DISPLAYS = [
  { id: 'valve', odds: 8, frame: 'crt', mono: true, faults: ['snow', 'vroll', 'hhold', 'shrink', 'dot', 'ghost', 'hum'] },
  { id: 'crt', odds: 22, frame: 'crt', faults: ['convergence', 'purity', 'degauss', 'gunloss', 'vcollapse', 'hcollapse', 'pincushion', 'scanflicker'] },
  { id: 'trinitron', odds: 14, frame: 'trinitron', faults: ['wires', 'burnin', 'bloom', 'tilt'] },
  { id: 'vhs', odds: 14, frame: 'crt', faults: ['tracking', 'headswitch', 'chroma', 'bluescreen', 'bars', 'tapecrease'] },
  { id: 'plasma', odds: 7, frame: 'flat', faults: ['retention', 'contour', 'deadline', 'buzzflicker'] },
  { id: 'lcd', odds: 14, frame: 'flat', faults: ['vlines', 'hline', 'deadpixels', 'bleed', 'halfdark', 'crack', 'tcon', 'ripple'] },
  { id: 'led', odds: 9, frame: 'flat', faults: ['stripfail', 'blooming', 'pwm', 'dimzones'] },
  { id: 'ledwall', odds: 4, frame: 'wall', faults: ['deadmodule', 'moduleshift', 'scanrefresh', 'seams'] },
  { id: 'oled', odds: 6, frame: 'thin', faults: ['oledburn', 'pinktint', 'greenline', 'mura', 'blot', 'lowflicker'] },
  { id: 'digital', odds: 2, frame: 'flat', faults: ['macroblock', 'pixelate', 'datamosh', 'sparkles', 'nosignal'] },
];
export const RHYTHMS = [
  { id: 'calm', odds: 60, gap: [6, 14] },
  { id: 'restless', odds: 32, gap: [2.5, 7] },
  { id: 'haywire', odds: 8, gap: [.5, 2] },
];

/* ---------- traits: the same reading of the word as StripsTraits.sol ---------- */
const slice = (word, at) => Number((BigInt(word) >> BigInt(at)) & 0xFFFFFFFFn);
function byOdds(list, roll) { let run = 0; for (let i = 0; i < list.length; i++) { run += list[i].odds; if (roll < run) return i; } return list.length - 1; }

/** Everything the word decides. `word` is the 32-byte VRF word as hex. */
export function traitsOf(word) {
  const d = byOdds(DISPLAYS, slice(word, 0) % 100);
  const pool = DISPLAYS[d].faults.slice();
  const n = 2 + (slice(word, 32) % 3);
  const faults = [];
  for (let i = 0; i < n; i++) {
    const left = pool.length - i;
    const pick = slice(word, 64 + 32 * i) % left;
    faults.push(pool[pick]);
    pool[pick] = pool[left - 1];
  }
  const r = byOdds(RHYTHMS, slice(word, 192) % 100);
  return { display: d, rhythm: r, faults, mono: !!DISPLAYS[d].mono, frame: DISPLAYS[d].frame, timing: slice(word, 224) };
}

/* ---------- when things happen ---------- */
const HOUR = 3600;
const hours = new Map();
function eventsIn(traits, hour) {
  const key = traits.timing + ':' + traits.rhythm + ':' + traits.faults.join() + ':' + hour;
  const held = hours.get(key);
  if (held) return held;
  if (hours.size > 8) hours.clear();
  const r = mulberry32(Math.imul(traits.timing ^ Math.imul(hour + 1, 0x9E3779B1), 0x85EBCA6B));
  const [g0, g1] = RHYTHMS[traits.rhythm].gap;
  const out = [];
  let at = 0;
  for (;;) {
    at += g0 + r() * (g1 - g0);
    let run;
    /* about one fault in seven is the signature chain */
    if (r() < .14) run = SIGNATURE;
    else {
      const id = traits.faults[(r() * traits.faults.length) | 0], fd = F[id];
      run = [{ id, d: fd.seq ? fd.d : clamp(.8 + r() * 2.2, .6, fd.d) }];
    }
    if (at + run.reduce((s, e) => s + e.d, 0) >= HOUR) break;
    for (const e of run) { out.push({ id: e.id, at, d: e.d }); at += e.d; }
  }
  hours.set(key, out);
  return out;
}

/**
 * What's on screen at t seconds after the mint block: {id, p, t}, with p how
 * far through the fault (0 to 1) and t the seconds since it began. Null means
 * the still is holding.
 */
export function schedule(word, traits, t) {
  if (t < 0) return null;
  const hour = Math.floor(t / HOUR);
  const at = t - hour * HOUR;
  const list = eventsIn(traits, hour);
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].at <= at) { found = m; lo = m + 1; } else hi = m - 1; }
  if (found < 0) return null;
  const e = list[found];
  if (at >= e.at + e.d) return null;
  return { id: e.id, p: (at - e.at) / e.d, t: at - e.at };
}

/* ---------- one frame ---------- */

/** The still, in colour or as a black and white set would show it. */
export function renderStill(ctx, design, mono) {
  textures();
  const S = sources(design, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(mono ? S.grey : S.base, 0, 0);
}

/**
 * One full frame of a fault. p runs 0 to 1. Pass {t} to place the frame in
 * time and {mono} for a black and white set; two calls with the same arguments
 * draw the same picture.
 */
export function renderFrame(ctx, design, faultId, p, { t, mono = false } = {}) {
  textures();
  const f = F[faultId];
  const time = t == null ? p * f.d : t;
  R = mulberry32(Math.imul(Math.floor(time * 24) + 1, 0x9E3779B1) ^ hashOf(faultId));
  const S = sources(design, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  f.f(ctx, S, time, p, mono);
  ctx.restore();
}

/** Snow over the still, for a token whose word hasn't landed. */
export function renderTuning(ctx, design, time) {
  textures();
  R = mulberry32(Math.floor(time * 24) + 1);
  const S = sources(design, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  black(ctx, S);
  ctx.globalAlpha = .45;
  ctx.drawImage(S.base, 0, 0);
  noise(ctx, 0, 0, S.w, S.h, .8);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  font(ctx, S, 44, 500, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TUNING', S.w / 2, S.h / 2);
  ctx.restore();
}

/* ---------- the screen ---------- */
const FRAMES = {
  crt: [26, 34, '30px/44px', 'repeating-linear-gradient(to bottom,rgba(0,0,0,.16) 0 1px,transparent 1px 3px),radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.5) 100%)'],
  trinitron: [22, 16, '8px', 'repeating-linear-gradient(to right,rgba(0,0,0,.07) 0 1px,transparent 1px 3px),radial-gradient(ellipse at center,transparent 62%,rgba(0,0,0,.32) 100%)'],
  flat: [12, 6, '2px', 'none'],
  thin: [4, 10, '7px', 'none'],
  wall: [0, 0, '0', 'repeating-linear-gradient(to right,rgba(0,0,0,.3) 0 1px,transparent 1px 6.25%),repeating-linear-gradient(to bottom,rgba(0,0,0,.3) 0 1px,transparent 1px 12.5%)'],
};

/**
 * A token, playing, in `host`. {design: hex, word: hex or '', minted: seconds}.
 * Returns stop(). `frame: false` leaves the bezel off.
 */
export function play(host, { design: hex, word, minted, frame = true, long = 1200 }) {
  const design = decodeDesign(hex);
  const traits = word ? traitsOf(word) : null;
  const { w, h } = sizeOf(design, long);
  const [pad, radius, glass, overlay] = FRAMES[frame && traits ? traits.frame : 'flat'];
  const doc = host.ownerDocument;
  const bezel = doc.createElement('div'), inner = doc.createElement('div'), canvas = doc.createElement('canvas'), film = doc.createElement('div');
  canvas.width = w; canvas.height = h;
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  film.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${overlay}`;
  inner.style.cssText = `position:relative;overflow:hidden;border-radius:${frame ? glass : 0};background:#000;line-height:0`;
  bezel.style.cssText = `background:${frame && pad ? '#1A1A18' : 'transparent'};border-radius:${frame ? radius : 0}px;padding:${frame ? pad : 0}px;box-sizing:border-box`;
  inner.append(canvas, film); bezel.append(inner);
  const box = doc.createElement('div');
  box.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%';
  box.append(bezel); host.append(box);
  if (host === doc.body) host.style.height = '100%';

  function fit() {
    const room = box.getBoundingClientRect();
    const p = frame ? pad * 2 : 0;
    const k = Math.min((room.width - p) / w, (room.height - p) / h);
    inner.style.width = `${Math.max(1, w * k)}px`;
    inner.style.height = `${Math.max(1, h * k)}px`;
  }
  fit();
  const view = doc.defaultView;
  view.addEventListener('resize', fit);

  const ctx = canvas.getContext('2d');
  const held = view.matchMedia && view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let paused = false, raf = 0;
  const mono = !!(traits && traits.mono);
  function draw() {
    const now = Date.now() / 1000;
    if (!traits) { renderTuning(ctx, design, now); return; }
    const e = schedule(word, traits, now - minted);
    if (e) renderFrame(ctx, design, e.id, e.p, { t: e.t, mono });
    else renderStill(ctx, design, mono);
  }
  function loop() { if (!paused) draw(); raf = view.requestAnimationFrame(loop); }
  if (held) {
    if (traits) renderStill(ctx, design, mono); else renderTuning(ctx, design, 0);
  } else {
    loop();
    canvas.addEventListener('click', () => { paused = !paused; });
  }
  return () => { view.cancelAnimationFrame(raf); view.removeEventListener('resize', fit); box.remove(); };
}
