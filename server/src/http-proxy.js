'use strict';

const http = require('http');
const { MSG, encodeMessage, nextConnId } = require('./protocol');
const config = require('./config');
const logger = require('./logger');

/**
 * Creates an HTTP reverse proxy that routes based on subdomain.
 * Handles both regular HTTP and WebSocket upgrade requests.
 */
function createHttpProxy(tunnelManager) {
  const server = http.createServer((req, res) => {
    const host = req.headers.host || '';
    const subdomain = extractSubdomain(host);

    if (!subdomain) {
      // Root domain — serve a landing page or info
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getLandingPage());
      return;
    }

    const tunnel = tunnelManager.getBySubdomain(subdomain);
    if (!tunnel) {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(getErrorPage(subdomain));
      return;
    }

    if (!tunnel.clientSocket || tunnel.clientSocket.destroyed) {
      res.writeHead(502, { 'Content-Type': 'text/html' });
      res.end(getErrorPage(subdomain));
      return;
    }

    // Create a connection through the tunnel
    const connId = nextConnId();
    const socket = req.socket;

    logger.conn(`HTTP request ${req.method} ${req.url} via ${subdomain} → conn #${connId}`);

    // We need to reconstruct the raw HTTP request to send through the tunnel
    // because we're working at the TCP level
    const rawHeaders = rebuildRawRequest(req);

    tunnelManager.addConnection(tunnel.tunnelId, connId, socket);

    // Notify client about the new connection
    tunnel.clientSocket.write(encodeMessage(MSG.NEW_CONN, connId, { connId }));

    // Store raw request data in the buffer so it gets sent when CONN_READY
    const conn = tunnelManager.getConnection(tunnel.tunnelId, connId);
    if (conn) {
      conn.buffer.push(rawHeaders);
      conn.isHttp = true;
      conn.response = res;
    }

    // If the request has a body, buffer that too
    req.on('data', (chunk) => {
      const conn = tunnelManager.getConnection(tunnel.tunnelId, connId);
      if (!conn) return;

      if (!conn.localReady) {
        conn.buffer.push(chunk);
      } else {
        tunnel.clientSocket.write(encodeMessage(MSG.DATA, connId, chunk));
      }
    });

    req.on('end', () => {
      // Request body complete — nothing special needed since we're piping at TCP level
    });

    req.on('error', () => {
      tunnelManager.removeConnection(tunnel.tunnelId, connId);
    });

    // Don't let Node's HTTP server handle the response — we pipe raw data
    // Override the socket to prevent default response handling
  });

  // Handle WebSocket upgrade requests
  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host || '';
    const subdomain = extractSubdomain(host);

    if (!subdomain) {
      socket.destroy();
      return;
    }

    const tunnel = tunnelManager.getBySubdomain(subdomain);
    if (!tunnel || !tunnel.clientSocket || tunnel.clientSocket.destroyed) {
      socket.destroy();
      return;
    }

    const connId = nextConnId();

    logger.conn(`WebSocket upgrade via ${subdomain} → conn #${connId}`);

    tunnelManager.addConnection(tunnel.tunnelId, connId, socket);

    // Send NEW_CONN to client
    tunnel.clientSocket.write(encodeMessage(MSG.NEW_CONN, connId, { connId }));

    // Rebuild the upgrade request
    const rawUpgrade = rebuildRawRequest(req);
    const conn = tunnelManager.getConnection(tunnel.tunnelId, connId);
    if (conn) {
      conn.buffer.push(rawUpgrade);
      if (head && head.length > 0) {
        conn.buffer.push(head);
      }
    }

    // Once piping is established, handle socket data directly
    socket.on('data', (data) => {
      const conn = tunnelManager.getConnection(tunnel.tunnelId, connId);
      if (!conn) return;

      if (!conn.localReady) {
        conn.buffer.push(data);
      } else {
        tunnel.clientSocket.write(encodeMessage(MSG.DATA, connId, data));
      }
    });

    socket.on('error', () => {
      if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
        tunnel.clientSocket.write(encodeMessage(MSG.CONN_CLOSE, connId));
      }
      tunnelManager.removeConnection(tunnel.tunnelId, connId);
    });

    socket.on('close', () => {
      if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
        tunnel.clientSocket.write(encodeMessage(MSG.CONN_CLOSE, connId));
      }
      tunnelManager.removeConnection(tunnel.tunnelId, connId);
    });
  });

  server.on('error', (err) => {
    logger.error(`HTTP proxy error: ${err.message}`);
  });

  server.listen(config.httpPort, '0.0.0.0', () => {
    logger.info(`HTTP proxy listening on :${config.httpPort}`);
  });

  return server;
}

/**
 * Extract subdomain from Host header.
 * e.g., "a7x9k2.gumbear.alora.baby" → "a7x9k2"
 */
function extractSubdomain(host) {
  // Remove port if present
  const hostname = host.split(':')[0];
  const domain = config.domain;

  if (!hostname.endsWith('.' + domain)) {
    return null;
  }

  const subdomain = hostname.slice(0, -(domain.length + 1));

  // Only return if it's a simple subdomain (no dots)
  if (subdomain && !subdomain.includes('.')) {
    return subdomain;
  }

  return null;
}

/**
 * Rebuild a raw HTTP request from the parsed req object.
 */
function rebuildRawRequest(req) {
  let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;

  const rawHeaders = req.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    raw += `${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`;
  }
  raw += '\r\n';

  return Buffer.from(raw, 'utf8');
}

/**
 * Landing page for the root domain.
 */
function getLandingPage() {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GumBear Tunnel — Ultra-Fast Localhost Port Forwarding</title>
  
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;700;800;900&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --bg: #030305;
      --bg-panel: rgba(15, 15, 20, 0.4);
      --border: rgba(255, 255, 255, 0.08);
      --border-highlight: rgba(255, 255, 255, 0.15);
      --text: #ededed;
      --text-muted: #888888;
      
      --accent: #f59e0b;
      --accent-glow: rgba(245, 158, 11, 0.3);
      --accent-dim: rgba(245, 158, 11, 0.1);
      
      --gradient-text: linear-gradient(135deg, #fceabb 0%, #f8b500 100%);
      --blur: blur(20px);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      line-height: 1.6;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }

    h1, h2, h3, h4, .brand {
      font-family: 'Outfit', sans-serif;
      letter-spacing: -0.02em;
    }

    /* Animated Background Orbs */
    .bg-orbs {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: -1; overflow: hidden;
    }
    .orb {
      position: absolute; border-radius: 50%; filter: blur(80px);
      opacity: 0.15; animation: float 20s infinite ease-in-out alternate;
    }
    .orb-1 { width: 600px; height: 600px; background: #f59e0b; top: -10%; left: -10%; }
    .orb-2 { width: 500px; height: 500px; background: #ea580c; bottom: -20%; right: -10%; animation-delay: -5s; }
    
    @keyframes float {
      0% { transform: translate(0, 0) scale(1); }
      100% { transform: translate(50px, 50px) scale(1.1); }
    }

    .container {
      max-width: 1200px; margin: 0 auto; padding: 0 2rem; position: relative; z-index: 10;
    }

    /* Glass Header */
    header {
      position: sticky; top: 0; z-index: 100;
      background: rgba(3, 3, 5, 0.6); backdrop-filter: var(--blur);
      border-bottom: 1px solid var(--border); padding: 1rem 0;
    }
    .nav { display: flex; justify-content: space-between; align-items: center; max-width: 1200px; margin: 0 auto; padding: 0 2rem; }
    .brand { font-size: 1.5rem; font-weight: 800; color: #fff; text-decoration: none; display: flex; align-items: center; gap: 0.5rem; }
    .nav-links a { color: var(--text-muted); text-decoration: none; margin-left: 2rem; font-weight: 500; font-size: 0.95rem; transition: color 0.2s; }
    .nav-links a:hover { color: #fff; }
    
    .btn-outline {
      border: 1px solid var(--border); background: rgba(255,255,255,0.03); padding: 0.5rem 1rem; border-radius: 8px; transition: all 0.2s;
    }
    .btn-outline:hover { background: rgba(255,255,255,0.08); border-color: var(--border-highlight); color: #fff; }

    /* Hero Section */
    .hero { text-align: center; padding: 8rem 0 6rem; }
    .hero h1 {
      font-size: 4.5rem; font-weight: 900; line-height: 1.1; margin-bottom: 1.5rem;
      background: var(--gradient-text); -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .hero p { font-size: 1.25rem; color: var(--text-muted); max-width: 600px; margin: 0 auto 3rem; }

    /* Terminal UI */
    .terminal-container { max-width: 650px; margin: 0 auto; perspective: 1000px; }
    .terminal {
      background: #0a0a0c; border: 1px solid #222; border-radius: 12px; box-shadow: 0 20px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
      overflow: hidden; text-align: left; transform: rotateX(2deg); transition: transform 0.3s ease;
    }
    .terminal:hover { transform: rotateX(0deg) translateY(-5px); box-shadow: 0 30px 60px rgba(245,158,11,0.1), 0 0 0 1px rgba(245,158,11,0.3); }
    .terminal-header { background: #111; padding: 0.75rem 1rem; display: flex; gap: 0.5rem; border-bottom: 1px solid #222; }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot.red { background: #ff5f56; } .dot.yellow { background: #ffbd2e; } .dot.green { background: #27c93f; }
    .terminal-body { padding: 1.5rem; display: flex; align-items: center; justify-content: space-between; }
    .terminal-code { font-family: 'Menlo', monospace; color: #fff; font-size: 1.1rem; }
    .terminal-code span { color: var(--accent); }
    
    .copy-btn {
      background: var(--text); color: #000; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 600; cursor: pointer; transition: all 0.2s;
    }
    .copy-btn:hover { background: var(--accent); }

    /* Features Grid */
    .section-title { font-size: 2.5rem; font-weight: 800; margin-bottom: 3rem; text-align: center; }
    .features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; margin-bottom: 6rem; }
    @media (max-width: 900px) { .features-grid { grid-template-columns: 1fr; } }
    
    .card {
      background: var(--bg-panel); backdrop-filter: var(--blur); border: 1px solid var(--border);
      border-radius: 16px; padding: 2rem; transition: all 0.3s ease;
    }
    .card:hover { border-color: var(--border-highlight); transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .card .icon { font-size: 2rem; margin-bottom: 1rem; }
    .card h3 { font-size: 1.25rem; margin-bottom: 0.75rem; color: #fff; }
    .card p { color: var(--text-muted); font-size: 0.95rem; }

    /* Bento Grid (Setup & Downloads) */
    .bento { display: grid; grid-template-columns: 1.5fr 1fr; gap: 1.5rem; margin-bottom: 6rem; }
    @media (max-width: 900px) { .bento { grid-template-columns: 1fr; } }
    
    .bento-card { background: var(--bg-panel); backdrop-filter: var(--blur); border: 1px solid var(--border); border-radius: 20px; padding: 2.5rem; }
    .bento-card h2 { font-size: 1.75rem; margin-bottom: 2rem; color: #fff; }

    /* Interactive Builder inside Setup */
    .builder-ui {
      background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem;
    }
    .builder-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
    .builder-col { flex: 1; display: flex; flex-direction: column; gap: 0.5rem; }
    .builder-col label { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; }
    .builder-input {
      background: rgba(255,255,255,0.05); border: 1px solid var(--border); color: #fff; padding: 0.75rem 1rem; border-radius: 8px;
      font-size: 1rem; outline: none; transition: border 0.2s;
    }
    .builder-input option {
      background: #111;
      color: #fff;
    }
    .builder-input:focus { border-color: var(--accent); }
    .builder-result {
      background: #000; border: 1px solid #333; padding: 1rem; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;
    }
    .builder-result code { font-family: 'Menlo', monospace; color: var(--accent); font-size: 1.1rem; }
    .builder-result button { background: #fff; color: #000; border: none; padding: 0.5rem 1rem; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .builder-result button:hover { background: var(--accent); }

    /* Timeline */
    .timeline { position: relative; padding-left: 1.5rem; }
    .timeline::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.1); }
    .timeline-item { position: relative; margin-bottom: 2rem; }
    .timeline-item:last-child { margin-bottom: 0; }
    .timeline-item::before {
      content: ''; position: absolute; left: -1.5rem; top: 0.25rem; transform: translateX(-50%); width: 12px; height: 12px;
      border-radius: 50%; background: var(--bg); border: 2px solid var(--accent); box-shadow: 0 0 10px var(--accent-glow);
    }
    .timeline-item h4 { font-size: 1.1rem; color: #fff; margin-bottom: 0.5rem; }
    .timeline-item p { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 0.5rem; }
    .timeline-item code { background: rgba(0,0,0,0.3); padding: 0.2rem 0.4rem; border-radius: 4px; font-family: monospace; color: #fff; }

    /* Downloads */
    .dl-list { display: flex; flex-direction: column; gap: 1rem; }
    .dl-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1.25rem 1.5rem; background: rgba(255,255,255,0.03); border: 1px solid var(--border); border-radius: 12px;
      text-decoration: none; color: #fff; transition: all 0.2s;
    }
    .dl-item:hover { background: var(--accent-dim); border-color: var(--accent); transform: translateY(-2px); }
    .dl-item .info { display: flex; align-items: center; gap: 1rem; }
    .dl-item .icon { font-size: 1.75rem; }
    .dl-item .name { font-weight: 600; font-size: 1.05rem; }
    .dl-item .sub { display: block; font-size: 0.8rem; color: var(--text-muted); font-weight: 400; }
    .dl-item .arrow { color: var(--accent); font-weight: bold; }

    /* Footer */
    footer { text-align: center; padding: 4rem 0; color: var(--text-muted); font-size: 0.9rem; border-top: 1px solid var(--border); margin-top: 4rem; }
    footer a { color: #fff; text-decoration: none; transition: color 0.2s; }
    footer a:hover { color: var(--accent); }
    
    /* Animation classes */
    .fade-up { opacity: 0; transform: translateY(20px); animation: fadeUp 0.8s forwards; }
    @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
    .delay-1 { animation-delay: 0.1s; }
    .delay-2 { animation-delay: 0.2s; }
  </style>
</head>
<body>

  <div class="bg-orbs">
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
  </div>

  <header>
    <div class="nav">
      <a href="#" class="brand">🐻 GumBear</a>
      <div class="nav-links">
        <a href="#features">Features</a>
        <a href="#setup">Docs</a>
        <a href="https://github.com/aloramiaa/gumbear" target="_blank" class="btn-outline">GitHub</a>
      </div>
    </div>
  </header>

  <main class="container">
    
    <!-- Hero -->
    <section class="hero fade-up">
      <h1>Expose Localhost<br>to the World.</h1>
      <p>Secure, high-performance port forwarding for TCP and UDP. Instant setup, zero dependencies, and self-hosted on your own infrastructure.</p>
      
      <div class="terminal-container fade-up delay-1">
        <div class="terminal">
          <div class="terminal-header">
            <div class="dot red"></div><div class="dot yellow"></div><div class="dot green"></div>
          </div>
          <div class="terminal-body">
            <div class="terminal-code"><span>$</span> curl -fsSL https://gumbear.alora.baby/install | bash</div>
            <button class="copy-btn" id="hero-copy" onclick="copyHero()">Copy</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section id="features" class="fade-up delay-2">
      <h2 class="section-title">Engineered for Performance</h2>
      <div class="features-grid">
        <div class="card">
          <div class="icon">🚀</div>
          <h3>Multiplexed TCP</h3>
          <p>Stream HTTP, SSH, and Database traffic instantly over a single persistent control channel with perfect WebSocket support.</p>
        </div>
        <div class="card">
          <div class="icon">⚡</div>
          <h3>Connectionless UDP</h3>
          <p>Native support for massive UDP streams with dynamic source tracking. Perfect for Minecraft, WireGuard, and DNS.</p>
        </div>
        <div class="card">
          <div class="icon">🎭</div>
          <h3>Anonymous Ready</h3>
          <p>Remove friction for your users. GumBear works instantly out-of-the-box without forcing complex API key registrations.</p>
        </div>
        <div class="card">
          <div class="icon">🌐</div>
          <h3>Dynamic Subdomains</h3>
          <p>HTTP traffic is automatically routed to beautiful subdomains, giving your local apps a premium public URL instantly.</p>
        </div>
        <div class="card">
          <div class="icon">📦</div>
          <h3>Zero Dependencies</h3>
          <p>Pre-compiled standalone binaries mean you don't even need Node.js installed to start tunneling.</p>
        </div>
        <div class="card">
          <div class="icon">🛡️</div>
          <h3>100% Private</h3>
          <p>Like ngrok, but you own the data. No third-party rate limits, no premium paywalls, no bandwidth caps.</p>
        </div>
      </div>
    </section>

    <!-- Bento Box -->
    <section id="setup" class="bento fade-up">
      
      <!-- Interactive Setup -->
      <div class="bento-card">
        <h2>Quick Start Guide</h2>
        
        <div class="builder-ui">
          <div class="builder-row">
            <div class="builder-col">
              <label>Local Port</label>
              <input type="number" class="builder-input" id="b-port" value="3000" min="1" max="65535" oninput="updateCmd()">
            </div>
            <div class="builder-col">
              <label>Protocol</label>
              <select class="builder-input" id="b-proto" onchange="updateCmd()">
                <option value="tcp">TCP / HTTP</option>
                <option value="udp">UDP</option>
              </select>
            </div>
          </div>
          <div class="builder-result">
            <code id="b-cmd">gumbear tunnel 3000</code>
            <button id="b-copy" onclick="copyCmd()">Copy</button>
          </div>
        </div>

        <div class="timeline">
          <div class="timeline-item">
            <h4>Install the Client</h4>
            <p>Use the bash installer or download a binary directly.</p>
          </div>
          <div class="timeline-item">
            <h4>Start Tunneling</h4>
            <p>Run your generated command to instantly bind to the public internet.</p>
          </div>
          <div class="timeline-item">
            <h4>Connect Custom Server (Optional)</h4>
            <p>Want to use your own domain? <code>gumbear config set-server your-vps.com:4444</code></p>
          </div>
        </div>
      </div>

      <!-- Downloads -->
      <div class="bento-card">
        <h2>Direct Downloads</h2>
        <p style="color: var(--text-muted); margin-bottom: 2rem;">Standalone executables (v1.0.1)</p>
        
        <div class="dl-list">
          <a href="/download/linux-x64/gumbear-linux" class="dl-item">
            <div class="info">
              <div class="icon">🐧</div>
              <div>
                <div class="name">Linux</div>
                <div class="sub">x64 Binary</div>
              </div>
            </div>
            <div class="arrow">↓</div>
          </a>
          <a href="/download/macos-x64/gumbear-macos" class="dl-item">
            <div class="info">
              <div class="icon">🍏</div>
              <div>
                <div class="name">macOS</div>
                <div class="sub">Apple Silicon & Intel</div>
              </div>
            </div>
            <div class="arrow">↓</div>
          </a>
          <a href="/download/windows-x64/gumbear-win.exe" class="dl-item">
            <div class="info">
              <div class="icon">🪟</div>
              <div>
                <div class="name">Windows</div>
                <div class="sub">.exe Executable</div>
              </div>
            </div>
            <div class="arrow">↓</div>
          </a>
        </div>
      </div>

    </section>

  </main>

  <footer>
    <div class="container">
      🐻 GumBear Tunnel &copy; <span id="year"></span> — Built with ❤️ for the open internet.<br>
      <a href="https://github.com/aloramiaa/gumbear" target="_blank" style="margin-top: 1rem; display: inline-block;">View on GitHub</a>
    </div>
  </footer>

  <script>
    document.getElementById('year').textContent = new Date().getFullYear();
    
    function copyHero() {
      navigator.clipboard.writeText('curl -fsSL https://gumbear.alora.baby/install | bash').then(() => {
        const btn = document.getElementById('hero-copy');
        btn.textContent = 'Copied!';
        btn.style.background = '#10b981';
        btn.style.color = '#fff';
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.style.background = '#fff';
          btn.style.color = '#000';
        }, 2000);
      });
    }

    function updateCmd() {
      const port = document.getElementById('b-port').value || '3000';
      const proto = document.getElementById('b-proto').value;
      const cmdEl = document.getElementById('b-cmd');
      
      let cmd = 'gumbear tunnel ' + port;
      if (proto === 'udp') cmd += ' --udp';
      cmdEl.textContent = cmd;
    }

    function copyCmd() {
      const cmd = document.getElementById('b-cmd').textContent;
      navigator.clipboard.writeText(cmd).then(() => {
        const btn = document.getElementById('b-copy');
        btn.textContent = 'Copied!';
        btn.style.background = '#10b981';
        btn.style.color = '#fff';
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.style.background = '#fff';
          btn.style.color = '#000';
        }, 2000);
      });
    }
  </script>
</body>
`;
}

function getErrorPage(subdomain) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tunnel Not Found — GumBear</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container { text-align: center; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 1rem; color: #e94560; }
    p { font-size: 1.1rem; color: #b8b8d4; }
    .subdomain { color: #e94560; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐻 Tunnel Not Found</h1>
    <p>The tunnel <span class="subdomain">${subdomain}</span> is not active or has been closed.</p>
  </div>
</body>
</html>`;
}

module.exports = { createHttpProxy, extractSubdomain };
