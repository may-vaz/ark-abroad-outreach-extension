// Full pipeline: real PDFs (3 layouts × 7 resume formats) → pdf.js text → parseResume.
// Needs pdfjs-dist in node (npm i -D pdfjs-dist@4). Skips if it isn't installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pdfToText } from '../lib/pdf-text.js';
import { parseResume } from '../lib/resume-parse.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const expected = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/resumes/expected.json'), 'utf8'));
let pdfjs = null;
try { pdfjs = await import(process.env.PDFJS || 'pdfjs-dist/legacy/build/pdf.mjs'); } catch { /* optional */ }

for (const style of ['simple', 'right-dates', 'two-column']) {
  for (const [file, e] of Object.entries(expected)) {
    const pdf = path.join(HERE, 'fixtures/resume-pdfs', file.replace('.txt', `.${style}.pdf`));
    test(`resume PDF ${style}: ${file}`, { skip: !pdfjs && 'pdfjs-dist not installed' }, async () => {
      const text = await pdfToText(pdfjs, new Uint8Array(fs.readFileSync(pdf)));
      const r = parseResume(text);
      const ctx = `\n--- extracted text ---\n${text}\n--- parsed ---\n${JSON.stringify(r, null, 1)}`;
      assert.equal(r.name, e.name, 'name' + ctx);
      assert.deepEqual(r.pastCompanies, e.pastCompanies, 'employers' + ctx);
      assert.deepEqual(r.universities, e.universities, 'education' + ctx);
      assert.equal(r.currentRole, e.currentRole, 'current role' + ctx);
      if (e.city) assert.equal(r.city, e.city, 'city' + ctx);
      if (e.homeCountry) assert.equal(r.homeCountry, e.homeCountry, 'country' + ctx);
    });
  }
}
