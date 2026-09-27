import QRCode from 'qrcode';

const raw = process.argv[2];
if (!raw) throw new Error('Usage: npm run qr -- https://your-labeler-url');
const url = new URL(raw);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
  throw new Error('Use the clean HTTPS address of the deployed labeler');
const destination = process.argv[3] || 'Share_Independent_Labeler_QR.png';
await QRCode.toFile(destination, url.origin + '/', { width: 800, margin: 3, errorCorrectionLevel: 'H' });
console.log(`Saved QR for ${url.origin}/ to ${destination}`);
