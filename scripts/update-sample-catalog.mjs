import { readFile, writeFile } from 'node:fs/promises';

const report = JSON.parse(await readFile('.local/sample/report.json', 'utf8'));
const install = JSON.parse(await readFile('.local/sample/buyer-install.json', 'utf8'));
if (!report.corePassed || report.digest !== install.digest) throw new Error('Both isolated verification and buyer installation must pass with the same digest.');
const folder = '/samples/acorn/';
const acorn = {
  id: 'acorn-trail', title: 'Acorn Trail', seller: 'Zcode sample studio', categories: ['Games'], stack: 'Node.js, HTML Canvas',
  version: '1.0.0', amount: 0, sample: true, purchasable: false,
  summary: 'Collect three acorns and reach camp in a pixel art browser game that runs offline.',
  description: 'A short woodland adventure with original pixel art, keyboard controls and a complete playable loop. The public sample includes the entire Node.js server, browser game and artwork code.',
  cover: folder + 'cover.png', productVideo: folder + 'product.mp4', setupVideo: folder + 'setup.mp4',
  productTranscript: 'The title screen opens under a full moon. Press Enter to begin, hold the right arrow, collect all three acorns and reach camp. The status confirms Trail complete.',
  setupTranscript: 'The clean-install recording shows the exact archive checksum, extraction, the successful offline npm install and the local server address. The downloaded game opens in Chrome and completes the trail.',
  demo: folder + 'index.html', sampleDownload: folder + 'acorn-trail.zip',
  setup: 'Extract the ZIP into a fresh folder. Run npm ci --offline, then npm start with Node.js 24 or newer. Open http://127.0.0.1:4173 and press Enter.',
  costs: 'The core workflow requires no API keys, paid subscriptions or hosting. The isolated runner verified the documented desktop path.',
  notices: 'Original game art and code. No third-party runtime dependencies or assets.', support: 'For a problem running the sample, include your Node and browser versions in a support case.',
  report, digest: report.digest,
};
const fixture = {
  seller: 'Illustrative seller', version: '1.0.0', purchasable: false, fixture: true,
  cover: '', productVideo: '', setupVideo: '', productTranscript: '', setupTranscript: '',
  report: null, digest: null, support: 'Support terms are pending for this example.', notices: 'Illustrative inventory.',
};
const items = [
  acorn,
  { ...fixture, id: 'example-orbit', title: 'Orbit Rooms', summary: 'A multiplayer space puzzle with shared rooms and a compact browser client.',
    description: 'This example illustrates a hosted multiplayer listing and how to compare its operating requirements with an offline game.',
    categories: ['Games'], stack: 'Browser, WebSocket', amount: 4900,
    setup: 'Seller description assumes a hosted room server. Setup and multiplayer have no independent observation.',
    costs: 'The example architecture needs a hosted room server. Operating cost is unknown.' },
  { ...fixture, id: 'example-fieldnotes', title: 'Fieldnotes', summary: 'A warm, structured workspace concept for notes, tasks and lightweight planning.',
    description: 'This example illustrates a reusable notes workspace and shows how unknown persistence and setup appear in a shortlist.',
    categories: ['Web apps', 'UI kits'], stack: 'React, TypeScript', amount: 3500,
    setup: 'No independently reproduced installation.',
    costs: 'Hosting and persistence costs are unknown for this example.' },
];
await writeFile('src/catalog-samples.json', JSON.stringify(items, null, 2) + '\n');
await writeFile('docs/evidence/sample-run.json', JSON.stringify({ report, buyerInstall: install }, null, 2) + '\n');
