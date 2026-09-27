import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { generateMigration } from '../prepare_migration.mjs';

const baseline = JSON.parse(await readFile('project-data.json', 'utf8'));
const snapshot = () => ({
  schema: baseline.project.schema,
  scorer: baseline.project.scorer,
  frames: baseline.project.frames.map(frame => ({
    key: frame.key,
    points: Object.fromEntries(baseline.project.bodyparts.map(part => [part, baseline.points[frame.key]?.[part] ?? null])),
  })),
});

test('migration includes only changes and initializes frame revision', () => {
  const edited = snapshot();
  edited.frames[0].points.nose = [12, 24];
  const result = generateMigration(baseline, edited, '2026-01-01T00:00:00.000Z');
  assert.equal(result.changedFrames, 1);
  assert.equal(result.changedPoints, 1);
  assert.match(result.sql, /INSERT INTO events .* 0, .*migration/);
  assert.match(result.sql, /INSERT INTO edits .*12, 24/);
});

test('migration rejects missing, duplicate, and out-of-bounds data', () => {
  const missing = snapshot();
  missing.frames.pop();
  assert.throws(() => generateMigration(baseline, missing));
  const duplicate = snapshot();
  duplicate.frames[1].key = duplicate.frames[0].key;
  assert.throws(() => generateMigration(baseline, duplicate));
  const invalid = snapshot();
  invalid.frames[0].points.nose = [baseline.project.frames[0].width, 0];
  assert.throws(() => generateMigration(baseline, invalid));
});
