'use strict';

const net = require('net');
const { generateSubdomain } = require('./protocol');
const config = require('./config');
const logger = require('./logger');

class TunnelManager {
  constructor() {
    // tunnelId -> { clientSocket, publicPort, subdomain, protocol, tcpServer, udpSocket, connections: Map }
    this._tunnels = new Map();
    // subdomain -> tunnelId
    this._subdomainIndex = new Map();
    // publicPort -> tunnelId
    this._portIndex = new Map();
    // Set of ports currently in use
    this._usedPorts = new Set();
  }

  /**
   * Allocate a random available port in the configured range.
   */
  async allocatePort() {
    const { portRangeMin, portRangeMax } = config;
    const range = portRangeMax - portRangeMin + 1;
    const maxAttempts = 100;

    for (let i = 0; i < maxAttempts; i++) {
      const port = portRangeMin + Math.floor(Math.random() * range);

      if (this._usedPorts.has(port)) continue;

      // Verify the port is actually free
      const available = await this._isPortAvailable(port);
      if (available) {
        this._usedPorts.add(port);
        return port;
      }
    }

    throw new Error('Could not allocate a free port after 100 attempts');
  }

  /**
   * Check if a port is available by trying to bind to it briefly.
   */
  _isPortAvailable(port) {
    return new Promise((resolve) => {
      const tester = net.createServer();
      tester.once('error', () => resolve(false));
      tester.listen(port, '0.0.0.0', () => {
        tester.close(() => resolve(true));
      });
    });
  }

  /**
   * Generate a unique subdomain.
   */
  allocateSubdomain() {
    let subdomain;
    let attempts = 0;
    do {
      subdomain = generateSubdomain(6);
      attempts++;
    } while (this._subdomainIndex.has(subdomain) && attempts < 100);

    if (this._subdomainIndex.has(subdomain)) {
      throw new Error('Could not generate unique subdomain');
    }

    return subdomain;
  }

  /**
   * Register a new tunnel.
   */
  register(tunnelId, clientSocket, publicPort, subdomain, protocol = 'tcp') {
    const tunnel = {
      tunnelId,
      clientSocket,
      publicPort,
      subdomain,
      protocol,  // 'tcp', 'udp', 'http', 'https'
      tcpServer: null,
      udpSocket: null,
      udpRemoteClients: null,
      connections: new Map(), // connId -> { publicSocket, localReady, buffer }
      createdAt: Date.now(),
    };

    this._tunnels.set(tunnelId, tunnel);
    this._subdomainIndex.set(subdomain, tunnelId);
    this._portIndex.set(publicPort, tunnelId);

    logger.tunnel(
      `Registered tunnel ${tunnelId} → :${publicPort} / ${subdomain}.${config.domain}`
    );

    return tunnel;
  }

  /**
   * Remove a tunnel and clean up all resources.
   */
  remove(tunnelId) {
    const tunnel = this._tunnels.get(tunnelId);
    if (!tunnel) return;

    // Close all active connections
    for (const [connId, conn] of tunnel.connections) {
      if (conn.publicSocket && !conn.publicSocket.destroyed) {
        conn.publicSocket.destroy();
      }
    }
    tunnel.connections.clear();

    // Close the TCP listener
    if (tunnel.tcpServer) {
      tunnel.tcpServer.close();
    }

    // Close the UDP socket
    if (tunnel.udpSocket) {
      try { tunnel.udpSocket.close(); } catch {}
    }
    if (tunnel.udpRemoteClients) {
      tunnel.udpRemoteClients.clear();
    }

    // Clean up indices
    this._subdomainIndex.delete(tunnel.subdomain);
    this._portIndex.delete(tunnel.publicPort);
    this._usedPorts.delete(tunnel.publicPort);
    this._tunnels.delete(tunnelId);

    logger.tunnel(`Removed tunnel ${tunnelId}`);
  }

  /**
   * Remove all tunnels for a given client socket.
   */
  removeByClient(clientSocket) {
    for (const [tunnelId, tunnel] of this._tunnels) {
      if (tunnel.clientSocket === clientSocket) {
        this.remove(tunnelId);
      }
    }
  }

  /**
   * Find tunnel by ID.
   */
  get(tunnelId) {
    return this._tunnels.get(tunnelId);
  }

  /**
   * Find tunnel by subdomain.
   */
  getBySubdomain(subdomain) {
    const tunnelId = this._subdomainIndex.get(subdomain);
    if (!tunnelId) return null;
    return this._tunnels.get(tunnelId);
  }

  /**
   * Find tunnel by public port.
   */
  getByPort(port) {
    const tunnelId = this._portIndex.get(port);
    if (!tunnelId) return null;
    return this._tunnels.get(tunnelId);
  }

  /**
   * Store a public connection for a tunnel.
   */
  addConnection(tunnelId, connId, publicSocket) {
    const tunnel = this._tunnels.get(tunnelId);
    if (!tunnel) return false;

    tunnel.connections.set(connId, {
      publicSocket,
      localReady: false,
      buffer: [],
    });

    return true;
  }

  /**
   * Mark a connection as ready (client connected to local service).
   */
  markConnectionReady(tunnelId, connId) {
    const tunnel = this._tunnels.get(tunnelId);
    if (!tunnel) return null;

    const conn = tunnel.connections.get(connId);
    if (!conn) return null;

    conn.localReady = true;

    // Flush buffered data
    const bufferedData = conn.buffer;
    conn.buffer = [];

    return { conn, bufferedData };
  }

  /**
   * Get a connection.
   */
  getConnection(tunnelId, connId) {
    const tunnel = this._tunnels.get(tunnelId);
    if (!tunnel) return null;
    return tunnel.connections.get(connId);
  }

  /**
   * Remove a connection.
   */
  removeConnection(tunnelId, connId) {
    const tunnel = this._tunnels.get(tunnelId);
    if (!tunnel) return;

    const conn = tunnel.connections.get(connId);
    if (conn && conn.publicSocket && !conn.publicSocket.destroyed) {
      conn.publicSocket.destroy();
    }
    tunnel.connections.delete(connId);
  }

  /**
   * Get stats.
   */
  stats() {
    let totalConnections = 0;
    const protocols = { tcp: 0, udp: 0, http: 0, https: 0 };
    for (const tunnel of this._tunnels.values()) {
      totalConnections += tunnel.connections.size;
      protocols[tunnel.protocol] = (protocols[tunnel.protocol] || 0) + 1;
    }
    return {
      tunnels: this._tunnels.size,
      connections: totalConnections,
      protocols,
    };
  }
}

module.exports = TunnelManager;
