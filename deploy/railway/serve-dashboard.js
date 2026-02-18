const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DIR = path.join(__dirname, 'dist');
const indexHtml = path.join(DIR, 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Startup diagnostics
console.log('=== SafeSchool Dashboard Starting ===');
console.log('PORT:', PORT);
console.log('DIR:', DIR);
console.log('__dirname:', __dirname);
console.log('cwd:', process.cwd());

if (fs.existsSync(DIR)) {
  const files = fs.readdirSync(DIR);
  console.log(`Files in ${DIR}: (${files.length} items)`);
  files.forEach(f => {
    const stat = fs.statSync(path.join(DIR, f));
    console.log(`  ${stat.isDirectory() ? '[DIR]' : `[${stat.size}B]`} ${f}`);
  });
  if (fs.existsSync(path.join(DIR, 'assets'))) {
    const assets = fs.readdirSync(path.join(DIR, 'assets'));
    console.log(`Assets: (${assets.length} items)`);
    assets.forEach(f => console.log(`  ${f}`));
  }
} else {
  console.error(`FATAL: ${DIR} does not exist!`);
  console.log('Contents of', __dirname, ':');
  fs.readdirSync(__dirname).forEach(f => console.log(`  ${f}`));
}

console.log('index.html exists:', fs.existsSync(indexHtml));
console.log('===');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // Health check
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      service: 'dashboard',
      port: PORT,
      hasIndex: fs.existsSync(indexHtml),
    }));
  }

  let filePath = path.join(DIR, url);
  let isSpaFallback = false;

  // SPA routing: serve index.html for non-file routes
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = indexHtml;
    isSpaFallback = true;
  }

  try {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filePath);
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    console.log(`${req.method} ${url} -> 200 ${contentType} ${content.length}B${isSpaFallback ? ' (SPA)' : ''}`);
  } catch (err) {
    console.error(`${req.method} ${url} -> 404 ERROR:`, err.message);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard ready at http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});
