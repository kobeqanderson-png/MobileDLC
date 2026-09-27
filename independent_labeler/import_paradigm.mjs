import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

const [sourceArg, paradigm, title, countArg = '20'] = process.argv.slice(2);
const count = Number(countArg);
if (!sourceArg || !/^[a-z][a-z0-9_-]*$/.test(paradigm || '') || !title ||
    !Number.isInteger(count) || count < 1 || count > 100)
  throw new Error('Usage: node import_paradigm.mjs <MP4-folder> <id> <name> [frames-per-video]');

const root = resolve('.');
const imports = resolve('imports');
const assets = resolve(imports, 'frame_snapshot', 'labeled-data');
if (!assets.startsWith(imports + sep)) throw new Error('Unsafe output path');
const source = resolve(sourceArg);
const dataPath = resolve('project-data.json');
const data = JSON.parse(await readFile(dataPath, 'utf8'));
if ((data.project.paradigms || []).some(item => item.id === paradigm) ||
    data.project.frames.some(item => item.paradigm === paradigm))
  throw new Error(`Paradigm already exists: ${paradigm}`);

const videos = (await readdir(source)).filter(name => /^Test \d+\.mp4$/i.test(name))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
if (!videos.length) throw new Error(`No Test N.mp4 videos found in ${source}`);
const existing = new Set(data.project.frames.map(item => item.key));
const plans = videos.map(video => {
  const folder = `${paradigm.toUpperCase()} ${basename(video, '.mp4')}`;
  const destination = resolve(assets, folder);
  if (!destination.startsWith(assets + sep)) throw new Error('Unsafe video output path');
  return { video, folder, destination };
});
for (const plan of plans) {
  try { await stat(plan.destination); throw new Error(`Output folder exists: ${plan.destination}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function command(program, args) {
  return new Promise((ok, fail) => {
    const child = spawn(program, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', fail);
    child.on('close', code => code === 0 ? ok(stdout) : fail(new Error(`${program} failed: ${stderr.slice(-1000)}`)));
  });
}

const stage = resolve(imports, `stage_${paradigm}_${Date.now()}`);
await mkdir(stage, { recursive: true });
const additions = [];
for (const plan of plans) {
  const info = JSON.parse(await command('ffprobe', ['-v', 'error', '-show_entries',
    'format=duration:stream=width,height', '-of', 'json', join(source, plan.video)]));
  const stream = info.streams?.find(item => item.width && item.height);
  const duration = Number(info.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid video: ${plan.video}`);
  const temp = resolve(stage, plan.folder);
  await mkdir(temp);
  await command('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(source, plan.video),
    '-vf', `fps=${count}/${duration}`, '-frames:v', String(count), '-compression_level', '6',
    join(temp, 'img%04d.png'), '-y']);
  const images = (await readdir(temp)).filter(name => /^img\d{4}\.png$/.test(name)).sort();
  if (images.length !== count) throw new Error(`Expected ${count} frames from ${plan.video}, found ${images.length}`);
  for (const name of images) {
    if ((await stat(join(temp, name))).size === 0) throw new Error(`Empty frame: ${plan.video}/${name}`);
    const key = `labeled-data/${plan.folder}/${name}`;
    if (existing.has(key)) throw new Error(`Duplicate frame key: ${key}`);
    existing.add(key);
    additions.push({ key, folder: plan.folder, name, width: stream.width, height: stream.height, paradigm });
  }
  console.log(`${plan.video}: ${images.length} frames (${stream.width}x${stream.height})`);
}

await copyFile(dataPath, resolve(imports, `project-data-before-${paradigm}-${Date.now()}.json`));
for (const plan of plans) await rename(resolve(stage, plan.folder), plan.destination);
data.project.paradigms ||= [{ id: 'sp1dlc', name: 'sp1DLC' }];
data.project.paradigms.push({ id: paradigm, name: title });
data.project.frames.push(...additions);
await writeFile(dataPath, JSON.stringify(data) + '\n');
console.log(`Added ${additions.length} unlabeled ${title} frames without changing existing keys or points.`);
