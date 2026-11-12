import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/catalog-samples.json';
const read = async filename => JSON.parse(await readFile(filename, 'utf8'));
const catalog = await read(path);
const report = await read('.local/column-desk-release/inspect/report.json');
const buyer = await read('.local/column-desk-release/inspect/clean-install.json');
if (!report.corePassed || buyer.digest !== report.digest) throw new Error('The Docker and Chrome installs must match.');

const folder = '/samples/column-desk/inspect/';
const item = {
  id: 'column-desk-inspect', title: 'Column Desk Inspect', seller: 'Column Desk',
  categories: ['Developer tools', 'Automation'], stack: 'Node.js, Browser JavaScript',
  version: '1.0.0', amount: 0, sample: true, purchasable: false,
  summary: 'Inspect CSV structure on your device before a database or CRM import.',
  description: 'Open a UTF-8 CSV to spot blank or duplicate headers and inconsistent row widths. Preview the columns and export a structural report as JSON. Supports quoted commas and multiline fields.',
  cover: folder + 'cover.png', productVideo: folder + 'product.mp4', setupVideo: folder + 'setup.mp4',
  productTranscript: 'A vendor CSV opens in Chromium. Column Desk shows the inconsistent fourth record and exports the same finding to a JSON report.',
  setupTranscript: 'The recording shows the checksum, a fresh extraction, successful offline npm install and local server, then uploads a CSV and finds the broken row.',
  demo: folder + 'index.html', sampleDownload: folder + 'column-desk.zip',
  setup: 'Extract the ZIP. With Node.js 24 or newer, run npm ci --offline and npm start. Open http://127.0.0.1:4173 and choose a UTF-8 CSV.',
  costs: 'No API keys, paid services or hosting are needed to run the local workflow.',
  notices: 'Original code. MIT license. No third-party runtime dependencies.',
  support: 'For a setup issue, include your browser version and Node version. Keep the CSV private.',
  report, digest: report.digest,
};
await writeFile(path, JSON.stringify([item, ...catalog.filter(row => row.id !== item.id)], null, 2) + '\n');
await writeFile('docs/evidence/column-desk-inspect.json', JSON.stringify({ report, buyer }, null, 2) + '\n');
