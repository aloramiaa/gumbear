# 🐻 GumBear Tunnel

A production-grade, self-hosted tunneling solution to expose your local services to the internet through your own VPS infrastructure. GumBear provides instant, high-performance tunneling for **all major protocols** — TCP, UDP, HTTP, and HTTPS.

**Like ngrok + frp, but 100% private and self-hosted.**

![GumBear Terminal Interface](https://i.ibb.co/wHK1Mbs/Screenshot-2026-05-31-192125.png)

## 🚀 Features

* **Multiplexed TCP**: Stream HTTP, SSH, and Database traffic instantly over a single persistent control channel with perfect WebSocket upgrade support.
* **Connectionless UDP**: Native support for massive UDP streams with dynamic source tracking. Perfect for game servers, WireGuard, and DNS.
* **Dynamic Subdomains**: HTTP traffic is automatically routed to beautifully generated subdomains (e.g., `xyz.gumbear.alora.baby`).
* **Anonymous Ready**: Drop friction. GumBear works instantly out-of-the-box without forcing complex API key registrations for your end users.
* **Zero Dependencies**: The client is packaged as a standalone binary via `pkg`. Users don't need Node.js installed to start tunneling.
* **100% Private**: No third-party rate limits, no premium paywalls, no bandwidth caps.

---

## ⚡ Quick Start (Client)

The easiest way to get started using a GumBear server.

### Install

```bash
# Linux / macOS (Zero dependencies)
curl -fsSL https://gumbear.alora.baby/install | bash

# Windows
# Download the latest .exe from the landing page.
```

### Usage

```bash
# ─── TCP / HTTP Tunnel (Default) ───
# Best for React dev servers, Web APIs, and typical TCP services
gumbear tunnel 3000

# ─── UDP Tunnel ───
# Best for Game Servers, DNS, and WireGuard
gumbear tunnel 53 --udp

# ─── Connecting to a Custom Server ───
gumbear config set-server your-vps.com:4444
gumbear config set-key your-secret-key
```

When a tunnel is established, GumBear will provide your active endpoints:
```
  ╔══════════════════════════════════════════════════╗
  ║  🐻 GumBear Tunnel                               ║
  ╠══════════════════════════════════════════════════╣
  ║  HTTP:  http://xyz.gumbear.alora.baby            ║
  ║  TCP:   gumbear.alora.baby:47832                 ║
  ╚══════════════════════════════════════════════════╝
```

---

## 🛠️ Server Deployment Guide

Want to run your own GumBear backend? It takes less than 5 minutes.

### 1. Prerequisites
- A Linux VPS (Ubuntu/Debian recommended) with a public IP.
- A registered domain name (e.g., `gumbear.example.com`).
- Node.js (v18+) and PM2 installed on the VPS.
- Nginx installed.

### 2. DNS Configuration
Point a wildcard A record and the root domain to your VPS IP address in your DNS provider:
```
*.gumbear.example.com  →  A  →  <YOUR_VPS_IP>
gumbear.example.com    →  A  →  <YOUR_VPS_IP>
```

### 3. Clone and Setup
```bash
git clone https://github.com/aloramiaa/gumbear.git
cd gumbear/server

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```
Edit `.env` and set `DOMAIN=gumbear.example.com` and `API_KEY=your_secret`.

### 4. Start the Backend
Start the Node.js tunnel manager using PM2 to keep it alive:
```bash
sudo npm install -g pm2
pm2 start src/index.js --name gumbear-server
pm2 save
pm2 startup
```

### 5. Nginx Reverse Proxy (Optional, but recommended)
Nginx is required if you want port `80` / `443` subdomain routing and a custom landing page.

Copy the provided Nginx template:
```bash
sudo cp ../gumbear-nginx.conf /etc/nginx/sites-available/gumbear
sudo ln -s /etc/nginx/sites-available/gumbear /etc/nginx/sites-enabled/
```
Edit `/etc/nginx/sites-available/gumbear` to match your domain name, then restart Nginx:
```bash
sudo systemctl restart nginx
```

### 6. Firewall Setup
Ensure your VPS firewall allows the necessary ports:
```bash
sudo ufw allow 80/tcp             # Nginx HTTP
sudo ufw allow 443/tcp            # Nginx HTTPS
sudo ufw allow 4444/tcp           # GumBear Control Channel
sudo ufw allow 10000:59999/tcp    # Dynamic TCP Tunnels
sudo ufw allow 10000:59999/udp    # Dynamic UDP Tunnels
```

---

## 🏗️ Building the Client

To build the standalone executables (`gumbear-linux`, `gumbear-macos`, `gumbear-win.exe`) from source:

```bash
cd client
npm install
npm run build
```

This uses `pkg` to bundle the Node.js runtime and your CLI code into single executables inside `client/dist`.

---

## 📜 License

MIT License. Built with ❤️ for the open internet.
