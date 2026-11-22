// PDF → plain text with line breaks, using pdf.js text items. Shared by the side panel and the tests.
// - Items on the same baseline become one line; a wide horizontal gap becomes a tab, so right-aligned dates
//   ("Accenture        Jun 2021 – Present") stay separable from the company name.
// - Two-column layouts (sidebar resumes) are detected and read column by column, otherwise the left and
//   right columns get merged into nonsense lines.
export async function pdfToText(pdfjs, data, maxPages = 5) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const width = page.getViewport({ scale: 1 }).width;
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str || !it.str.trim()) continue;
      const [, , , , x, y] = it.transform;
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) rows.push(row = { y, parts: [] });
      row.parts.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    rows.forEach(r => r.parts.sort((a, b) => a.x - b.x));
    const split = findColumnSplit(rows, width);
    if (split) {
      const first = Math.max(0, rows.findIndex(r => r.parts.some(q => q.x >= split - 2)));
      const header = rows.slice(0, first), body = rows.slice(first);
      header.forEach(r => out.push(join(r.parts)));
      const left = [], right = [];
      for (const r of body) {
        const L = r.parts.filter(q => q.x < split - 2), R = r.parts.filter(q => q.x >= split - 2);
        if (L.length) left.push(join(L));
        if (R.length) right.push(join(R));
      }
      out.push(...right, ...left); // main column (usually experience) first, sidebar after
    } else rows.forEach(r => out.push(join(r.parts)));
    out.push('');
  }
  return out.join('\n');
}

function join(parts) {
  let line = '', end = null;
  for (const part of parts) {
    if (end !== null) line += part.x - end > 40 ? '\t' : (part.x - end > 1.5 && !line.endsWith(' ') && !part.s.startsWith(' ') ? ' ' : '');
    line += part.s; end = part.x + part.w;
  }
  return line;
}

// Column detection: a second column shows up as many line segments starting at the same x in the middle
// of the page, while (almost) no text crosses that x. Right-aligned dates start at varying x, so they don't qualify.
function findColumnSplit(rows, width) {
  const segs = [];
  for (const r of rows) r.parts.forEach((q, i) => {
    if (i === 0 || q.x - (r.parts[i - 1].x + r.parts[i - 1].w) > 12) segs.push(q);
  });
  const counts = new Map();
  for (const q of segs) {
    if (q.x <= width * 0.25 || q.x >= width * 0.7) continue;
    const k = Math.round(q.x / 4) * 4;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, n] of counts) if (n >= 4 && (!best || n > best.n)) best = { k, n };
  if (!best) return null;
  const split = best.k - 4;
  const crossing = rows.filter(r => r.parts.some(q => q.x < split - 4 && q.x + q.w > split + 8)).length;
  const leftRows = rows.filter(r => r.parts.some(q => q.x < split - 4)).length;
  return leftRows >= 3 && crossing / rows.length < 0.15 ? split : null;
}
