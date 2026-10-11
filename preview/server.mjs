import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png' };
http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if (url.pathname === '/') {res.writeHead(302,{Location:'/preview/'});res.end();return;}
    const pathname = decodeURIComponent(url.pathname === '/' || url.pathname === '/preview/' ? '/preview/index.html' : url.pathname);
    const file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) || !['.html','.css','.js','.svg','.png'].includes(extname(file)) || !['preview','public','assets'].some(dir => file.startsWith(resolve(root,dir)+sep))) {res.writeHead(403);res.end();return;}
    const data = await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store'});res.end(data);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(4173,'127.0.0.1',() => console.log('Gymbrain UI: http://127.0.0.1:4173/preview/'));
