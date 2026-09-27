import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const quote = value => `'${value.replaceAll("'", "''")}'`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function generateMigration(baseline, snapshot, now = new Date().toISOString()) {
  const project = baseline.project;
  const parts = project.bodyparts;
  const sourceFrames = new Map(project.frames.map(frame => [frame.key, frame]));
  if (snapshot.schema !== project.schema || snapshot.scorer !== project.scorer ||
      !Array.isArray(snapshot.frames) || snapshot.frames.length !== sourceFrames.size ||
      sourceFrames.size !== project.frames.length) throw new Error('Snapshot does not match this project');

  const statements = [
    'CREATE TABLE IF NOT EXISTS edits (frame TEXT NOT NULL, part TEXT NOT NULL, x REAL, y REAL, updated_at TEXT NOT NULL, PRIMARY KEY(frame, part));',
    'CREATE TABLE IF NOT EXISTS events (frame TEXT NOT NULL, revision INTEGER NOT NULL, changes TEXT NOT NULL, actor TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(frame, revision));',
  ];
  const seen = new Set();
  let changedFrames = 0;
  let changedPoints = 0;
  for (const item of snapshot.frames) {
    const frame = sourceFrames.get(item?.key);
    if (!frame || seen.has(item.key) || !item.points || typeof item.points !== 'object' ||
        Array.isArray(item.points) || Object.keys(item.points).length !== parts.length ||
        parts.some(part => !Object.hasOwn(item.points, part))) throw new Error('Invalid or duplicate frame in snapshot');
    seen.add(item.key);
    const changes = {};
    for (const part of parts) {
      const value = item.points[part];
      if (value !== null && !(Array.isArray(value) && value.length === 2 &&
          value.every(Number.isFinite) && value[0] >= 0 && value[0] < frame.width &&
          value[1] >= 0 && value[1] < frame.height)) throw new Error(`Invalid coordinates: ${item.key} / ${part}`);
      if (!same(value, baseline.points[item.key]?.[part] ?? null)) changes[part] = value;
    }
    if (!Object.keys(changes).length) continue;
    changedFrames++;
    statements.push(`INSERT INTO events (frame, revision, changes, actor, updated_at) VALUES (${quote(item.key)}, 0, ${quote(JSON.stringify(changes))}, 'migration', ${quote(now)});`);
    for (const [part, value] of Object.entries(changes)) {
      changedPoints++;
      statements.push(`INSERT INTO edits (frame, part, x, y, updated_at) VALUES (${quote(item.key)}, ${quote(part)}, ${value?.[0] ?? 'NULL'}, ${value?.[1] ?? 'NULL'}, ${quote(now)});`);
    }
  }
  return { sql: statements.join('\n') + '\n', changedFrames, changedPoints };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshotPath = process.argv[2] || 'imports/live-backup.json';
  const outputPath = process.argv[3] || 'imports/migration.sql';
  const baseline = JSON.parse(await readFile('project-data.json', 'utf8'));
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const result = generateMigration(baseline, snapshot);
  await writeFile(outputPath, result.sql);
  console.log(`Validated ${snapshot.frames.length} frames. Prepared ${result.changedPoints} point changes on ${result.changedFrames} frames: ${outputPath}`);
}
