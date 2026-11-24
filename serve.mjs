import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'], ['.wasm', 'application/wasm'], ['.png', 'image/png'],
  ['.gz', 'application/gzip'], ['.ttf', 'font/ttf'], ['.pfb', 'application/octet-stream'],
]);

export function serve(port = 0) {
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(resolve(root) + sep)) {
        response.writeHead(403).end();
        return;
      }
      const file = await stat(path);
      if (!file.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': mime.get(extname(path)) ?? 'application/octet-stream',
        'Content-Length': file.size,
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path).on('error', () => response.destroy()).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolveServer({ server, url: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await stat(new URL('./dist/index.html', import.meta.url));
    const { url } = await serve(Number(process.argv[2] || '4173'));
    console.log('文件工坊已启动。请在浏览器打开 ' + url);
  } catch (error) {
    console.error('无法启动文件工坊。请确认 dist 目录存在，且端口可用。', error.message);
    process.exitCode = 1;
  }
}
