// Čtení sedmisegmentových číslic z oříznutého snímku displeje tonometru.
// Vstup: šedotónový obraz (Uint8Array, w*h). Výstup: {vals:[sys,dia,pul]} nebo {error}.
(function (root) {
  // segmenty: a,b,c,d,e,f,g
  const PATTERNS = {
    '1111110': 0, '0110000': 1, '1101101': 2, '1111001': 3, '0110011': 4,
    '1011011': 5, '1011111': 6, '1110000': 7, '1111111': 8, '1111011': 9, '1110011': 9
  };
  // obdélníky segmentů v normalizovaných souřadnicích číslice [u0,u1,v0,v1]
  const RECTS = {
    a: [0.22, 0.78, 0.00, 0.17], g: [0.22, 0.78, 0.415, 0.585], d: [0.22, 0.78, 0.83, 1.00],
    f: [0.00, 0.28, 0.10, 0.46], b: [0.72, 1.00, 0.10, 0.46],
    e: [0.00, 0.28, 0.54, 0.90], c: [0.72, 1.00, 0.54, 0.90]
  };
  const ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  function otsu(g) {
    const h = new Uint32Array(256); for (let i = 0; i < g.length; i++) h[g[i]]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
    let wB = 0, sB = 0, best = 0, t = 128;
    for (let i = 0; i < 256; i++) {
      wB += h[i]; if (!wB) continue; const wF = g.length - wB; if (!wF) break;
      sB += i * h[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return t;
  }

  function dilate(bin, w, h, r) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0; for (let k = -r; k <= r && !v; k++) { const xx = x + k; if (xx >= 0 && xx < w && bin[y * w + xx]) v = 1; } tmp[y * w + x] = v;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0; for (let k = -r; k <= r && !v; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x]) v = 1; } out[y * w + x] = v;
    }
    return out;
  }

  function components(bin, w, h) {
    const lab = new Int32Array(w * h), comps = [], stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!bin[i] || lab[i]) continue;
      const id = comps.length + 1, c = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
      stack.push(i); lab[i] = id;
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p / w) | 0;
        c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx; if (bin[q] && !lab[q]) { lab[q] = id; stack.push(q); }
        }
      }
      comps.push(c);
    }
    return comps;
  }

  // vyhodnotí jednu číslici v rámečku b; zkouší různé náklony (kurzíva)
  function decodeDigit(bin, w, b) {
    const W = b.x1 - b.x0 + 1, H = b.y1 - b.y0 + 1;
    let best = null;
    for (let s = 0; s <= 0.32; s += 0.02) {
      const Wd = W - s * H; if (Wd < H * 0.2) continue;
      const fills = [];
      for (const k of ORDER) {
        const [u0, u1, v0, v1] = RECTS[k]; let on = 0, tot = 0;
        for (let y = Math.floor(b.y0 + v0 * (H - 1)); y <= Math.ceil(b.y0 + v1 * (H - 1)); y++) {
          const shift = s * (b.y1 - y);
          for (let x = Math.floor(b.x0 + shift + u0 * (Wd - 1)); x <= Math.ceil(b.x0 + shift + u1 * (Wd - 1)); x++) {
            tot++; if (x >= 0 && x < w && bin[y * w + x]) on++;
          }
        }
        fills.push(tot ? on / tot : 0);
      }
      const bits = fills.map(f => f > 0.36 ? '1' : '0').join('');
      const digit = PATTERNS[bits];
      if (digit === undefined) continue;
      const onF = fills.filter((f, i) => bits[i] === "1"), offF = fills.filter((f, i) => bits[i] === "0");
      const conf = Math.min(...onF) - (offF.length ? Math.max(...offF) : 0);
      if (!best || conf > best.conf) best = { digit, conf };
    }
    return best;
  }

  function attempt(gray, w, h, r) {
    const t = otsu(gray), bin = new Uint8Array(w * h);
    for (let i = 0; i < bin.length; i++) bin[i] = gray[i] < t ? 1 : 0;
    const comps = components(r ? dilate(bin, w, h, r) : bin, w, h);
    // kandidáti na číslice
    let cand = comps.filter(c => { const ch = c.y1 - c.y0 + 1, cw = c.x1 - c.x0 + 1; return ch > h * 0.09 && ch < h * 0.4 && cw < ch * 1.0 && cw > ch * 0.12; });
    if (cand.length < 3) return { error: 'few' };
    // seskup do řádků podle svislého středu
    cand.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const rows = [];
    for (const c of cand) {
      const cy = (c.y0 + c.y1) / 2, ch = c.y1 - c.y0;
      const row = rows.find(rw => Math.abs(rw.cy - cy) < Math.max(rw.h, ch) * 0.4);
      if (row) { row.items.push(c); row.cy = row.items.reduce((a, i) => a + (i.y0 + i.y1) / 2, 0) / row.items.length; row.h = Math.max(row.h, ch); }
      else rows.push({ cy, h: ch, items: [c] });
    }
    // řádky s alespoň 2 číslicemi (ikony a značky jsou osamocené); 3 největší
    let good = rows.filter(rw => rw.items.length >= 2);
    if (good.length > 3) good = good.sort((a, b) => b.h * b.items.length - a.h * a.items.length).slice(0, 3);
    good.sort((a, b) => a.cy - b.cy);
    if (good.length < 3) return { error: 'rows', rows: good.length };
    const vals = [];
    for (const row of good) {
      row.items.sort((a, b) => a.x0 - b.x0);
      let s = '';
      for (const c of row.items) {
        // zpřesni rámeček na nedilatované pixely
        let x0 = c.x1, x1 = c.x0, y0 = c.y1, y1 = c.y0;
        for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (bin[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const b = { x0, x1, y0, y1 }, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        if (bw < bh * 0.42) { s += '1'; continue; }
        const d = decodeDigit(bin, w, b);
        if (!d) return { error: 'digit' };
        s += d.digit;
      }
      vals.push(+s);
    }
    return { vals };
  }
  function read(gray, w, h) {
    let last = { error: "none" };
    for (const r of [Math.max(1, Math.round(h * 0.01)), 1, 0]) { last = attempt(gray, w, h, r); if (last.vals) return last; }
    return last;
  }
  function binarize(gray, w, h) { const t = otsu(gray), b = new Uint8Array(w * h); for (let i = 0; i < b.length; i++) b[i] = gray[i] < t ? 1 : 0; return b; }
  root.Seg7 = { read, binarize };
  if (typeof module !== 'undefined') module.exports = root.Seg7;
})(typeof window !== 'undefined' ? window : globalThis);
