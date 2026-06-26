// Minimal HTTP service for ${{ values.name }}. No external dependencies so the
// container image stays small and the build is fast. Replace this with your
// real application code.
const http = require('http');

const port = process.env.PORT || ${{ values.port }};

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ service: '${{ values.name }}', message: 'Hello from EKS' }));
});

server.listen(port, () => {
  console.log(`${{ values.name }} listening on :${port}`);
});
