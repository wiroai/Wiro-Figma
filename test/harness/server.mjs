// A local page for trying the built plugin in a browser without Figma:
//
//   npm run harness             then open http://127.0.0.1:5178
//
// The page runs dist/code.js against a stand-in for the Figma plugin API and
// shows dist/ui.html in a sandboxed iframe (origin "null", like Figma's) with
// the Content-Security-Policy that manifest.json's networkAccess allows. When
// WIRO_API_KEY (and WIRO_API_SECRET) are set, the plugin starts connected;
// the key is handed to the page only and never printed.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.env.HARNESS_PORT) || 5178;

const files = {
  '/': ['test/harness/harness.html', 'text/html; charset=utf-8'],
  '/fake-figma.js': ['test/harness/fake-figma.js', 'text/javascript; charset=utf-8'],
  '/dist/code.js': ['dist/code.js', 'text/javascript; charset=utf-8'],
  '/dist/ui.html': ['dist/ui.html', 'text/html; charset=utf-8'],
  '/manifest.json': ['manifest.json', 'application/json'],
};

function credentials() {
  const apiKey = process.env.WIRO_API_KEY?.trim();
  if (!apiKey) return null;
  const apiSecret = process.env.WIRO_API_SECRET?.trim();
  return apiSecret ? { apiKey, apiSecret } : { apiKey };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/credentials.json') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(credentials()));
    return;
  }
  const entry = files[url.pathname];
  if (!entry) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('Not found');
    return;
  }
  try {
    const body = await readFile(path.join(root, entry[0]));
    response.writeHead(200, { 'Content-Type': entry[1] });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end(`Missing ${entry[0]}. Run npm run build first.`);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Plugin harness on http://127.0.0.1:${port} (${credentials() ? 'starts connected' : 'no API key set'})`);
});
