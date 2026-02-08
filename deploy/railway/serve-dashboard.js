const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIR = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const indexHtml = path.join(DIR, 'index.html');

http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"status":"ok","service":"dashboard"}');
  }

  let filePath = path.join(DIR, url);

  // SPA routing: if file doesn't exist, serve index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = indexHtml;
  }

  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard serving on port ${PORT}`);
  console.log(`Files in ${DIR}:`);
  try {
    fs.readdirSync(DIR).forEach(f => console.log(`  ${f}`));
  } catch (e) {
    console.error(`ERROR: ${DIR} not found!`, e.message);
  }
});
