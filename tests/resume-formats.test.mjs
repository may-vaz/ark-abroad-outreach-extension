// Resume text fixtures in 7 common layouts → parseResume (no PDF step). See resume-pdf.test.mjs for the full pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseResume } from '../lib/resume-parse.js';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/resumes');
const expected = JSON.parse(fs.readFileSync(path.join(DIR, 'expected.json'), 'utf8'));
for (const [file, e] of Object.entries(expected)) {
  test(`resume format: ${file}`, () => {
    const r = parseResume(fs.readFileSync(path.join(DIR, file), 'utf8'));
    assert.equal(r.name, e.name);
    assert.deepEqual(r.pastCompanies, e.pastCompanies);
    assert.deepEqual(r.universities, e.universities);
    assert.equal(r.currentRole, e.currentRole);
    if (e.city) assert.equal(r.city, e.city);
    if (e.homeCountry) assert.equal(r.homeCountry, e.homeCountry);
    for (const sk of e.skillsInclude || []) assert.ok(r.skills.includes(sk), `${sk} in ${r.skills}`);
  });
}
