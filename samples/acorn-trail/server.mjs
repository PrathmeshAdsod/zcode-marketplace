import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const resources = { '/': ['index.html', 'text/html'], '/game.js': ['game.js', 'text/javascript'], '/game.css': ['game.css', 'text/css'] };
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);

createServer(async (req, res) => {
  const resource = resources[req.url];
  if (!resource) { res.writeHead(404).end(); return; }
  const [file, type] = resource;
  res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(await readFile(new URL(file, import.meta.url)));
}).listen(port, host, () => console.log('Acorn Trail is ready at http://' + host + ':' + port));

