import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/desk.js', ['desk.js', 'text/javascript']],
  ['/csv.js', ['csv.js', 'text/javascript']],
  ['/edition.js', ['edition.js', 'text/javascript']],
]);
createServer(async (request, response) => {
  const file = files.get(request.url);
  if (!file || request.method !== 'GET') {
    response.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(new URL(file[0], import.meta.url));
    response.writeHead(200, {
      'Content-Type': file[1] + '; charset=utf-8',
      'Content-Security-Policy': "default-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    }).end(bytes);
  } catch {
    response.writeHead(500).end();
  }
}).listen(Number(process.env.PORT || 4173), '127.0.0.1', () => {
  console.log('Column Desk is ready at http://127.0.0.1:' + (process.env.PORT || 4173));
});
