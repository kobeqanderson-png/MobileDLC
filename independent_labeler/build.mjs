import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import QRCode from 'qrcode';

const data = JSON.parse(await readFile('project-data.json', 'utf8'));
data.project.paradigms ||= [{ id: 'sp1dlc', name: 'sp1DLC' }];
const paradigms = new Set(data.project.paradigms.map(item => item.id));
if (!paradigms.size || paradigms.size !== data.project.paradigms.length ||
    data.project.paradigms.some(item => !/^[a-z][a-z0-9_-]*$/.test(item.id) || !item.name))
  throw new Error('Invalid paradigm list');
const frameKeys = new Set();
for (const frame of data.project.frames) {
  frame.paradigm ||= 'sp1dlc';
  if (!paradigms.has(frame.paradigm) || frameKeys.has(frame.key) ||
      frame.key !== `labeled-data/${frame.folder}/${frame.name}` ||
      !/^[^/\\]+\.(png|jpe?g|tiff?)$/i.test(frame.name) ||
      !Number.isInteger(frame.width) || frame.width < 1 || !Number.isInteger(frame.height) || frame.height < 1)
    throw new Error(`Invalid frame: ${frame.key}`);
  frameKeys.add(frame.key);
}
const shareUrl = 'https://mobile-dlc-labeler.mobile-dlc-independent-labeler.workers.dev/';
const worker = await readFile('worker/index.js', 'utf8');
const client = {
  html: await readFile('public/index.html', 'utf8'),
  script: await readFile('public/app.js', 'utf8'),
  style: await readFile('public/style.css', 'utf8'),
  login: await readFile('public/login.html', 'utf8'),
};
const dist = resolve('dist');
const assets = resolve('dist/assets');
if (!assets.startsWith(dist + sep)) throw new Error('Unsafe asset output path');
await rm(assets, { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await cp('imports/frame_snapshot', resolve(assets, 'frames'), { recursive: true });
await QRCode.toFile(resolve(assets, 'share-qr.png'), shareUrl, { width: 800, margin: 3, errorCorrectionLevel: 'H' });
await writeFile('dist/server/index.js', `const PROJECT_DATA = ${JSON.stringify(data)};\nconst CLIENT = ${JSON.stringify(client)};\n${worker}`);
console.log(`Built ${data.project.frames.length} frames with protected assets.`);
