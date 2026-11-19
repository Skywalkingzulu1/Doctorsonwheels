const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 9100);

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((req, res) => {
    let pathname;

    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
    }

    if (pathname === '/') {
        pathname = '/docs/no_login.html';
    }

    const relativePath = pathname.replace(/^[/\\]+/, '');
    const filePath = path.join(root, relativePath);
    const relativeToRoot = path.relative(root, filePath);

    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });

        fs.createReadStream(filePath).pipe(res);
    });
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Doctors on Wheels is running at http://localhost:${port}/`);
    console.log('Keep this window open. Close it to stop the server.');
});