'use strict';

const net = require('net');
const { MSG, MSG_NAMES, PROTOCOLS, encodeMessage, decodeJSON, decodeUdpPayload, MessageParser } = require('./protocol');
const { connectLocal } = require('./local-proxy');
const { UdpLocalProxy } = require('./local-udp-proxy');
const logger = require('./logger');

/**
 * Core tunnel client.
 * Connects to the GumBear server and manages the tunnel lifecycle.
 */
class TunnelClient {
  constructor(options) {
    this.serverHost = options.serverHost;
    this.serverPort = options.serverPort;
    this.apiKey = options.apiKey;
    this.localPort = options.localPort;
    this.protocol = options.protocol || PROTOCOLS.TCP;

    this._socket = null;
    this._parser = null;
    this._localConnections = new Map(); // connId -> localSocket
    this._udpProxy = null; // For UDP tunnels
    this._reconnectDelay = 1000;
    this._maxReconnectDelay = 30000;
    this._shouldReconnect = true;
    this._connected = false;
    this._tunnelInfo = null;
    this._heartbeatTimer = null;
    this._connectionCount = 0;
  }

  /**
   * Start the tunnel.
   */
  connect() {
    return new Promise((resolve, reject) => {
      this._shouldReconnect = true;

      this._socket = new net.Socket();
      this._parser = new MessageParser();

      this._socket.connect(this.serverPort, this.serverHost, () => {
        this._connected = true;
        this._reconnectDelay = 1000;

        logger.success(`Connected to ${this.serverHost}:${this.serverPort}`);

        // Authenticate
        this._socket.write(
          encodeMessage(MSG.AUTH, 0, {
            key: this.apiKey,
            version: '1.0.0',
          })
        );
      });

      this._socket.pipe(this._parser);

      this._parser.on('data', (message) => {
        this._handleMessage(message, resolve, reject);
      });

      this._parser.on('error', (err) => {
        logger.error(`Protocol error: ${err.message}`);
      });

      this._socket.on('error', (err) => {
        if (!this._connected) {
          logger.error(`Connection failed: ${err.message}`);
          reject(err);
          return;
        }
        logger.error(`Socket error: ${err.message}`);
      });

      this._socket.on('close', () => {
        this._connected = false;
        this._cleanup();

        if (this._shouldReconnect) {
          logger.warn(
            `Disconnected. Reconnecting in ${this._reconnectDelay / 1000}s...`
          );
          setTimeout(() => {
            this._reconnectDelay = Math.min(
              this._reconnectDelay * 2,
              this._maxReconnectDelay
            );
            this.connect().catch(() => {});
          }, this._reconnectDelay);
        }
      });
    });
  }

  /**
   * Handle incoming messages from the server.
   */
  _handleMessage(message, resolve, reject) {
    const { type, connId, payload } = message;

    // ── AUTH_OK ──
    if (type === MSG.AUTH_OK) {
      logger.success('Authenticated');

      // Now request a tunnel
      this._socket.write(
        encodeMessage(MSG.TUNNEL_REQ, 0, {
          localPort: this.localPort,
          protocol: this.protocol,
        })
      );
      return;
    }

    // ── AUTH_FAIL ──
    if (type === MSG.AUTH_FAIL) {
      const data = decodeJSON(payload);
      logger.error(`Authentication failed: ${data.reason || 'Unknown'}`);
      this._shouldReconnect = false;
      this._socket.destroy();
      if (reject) reject(new Error(data.reason));
      return;
    }

    // ── TUNNEL_OK ──
    if (type === MSG.TUNNEL_OK) {
      const data = decodeJSON(payload);
      this._tunnelInfo = data;
      const proto = data.protocol || this.protocol;

      // Display the beautiful tunnel info box
      const box = logger.banner();
      box.empty();
      if (proto === PROTOCOLS.UDP) {
        box.url('UDP: ', data.tcpAddr || `${data.domain}:${data.publicPort}`);
      } else {
        box.url('HTTP:', data.httpUrl || `http://${data.subdomain}.${data.domain}`);
        box.url('TCP: ', data.tcpAddr || `${data.domain}:${data.publicPort}`);
      }
      box.empty();
      box.separator();
      box.empty();
      box.info('Protocol:      ', proto.toUpperCase());
      box.info('Forwarding to →', `localhost:${this.localPort}`);
      box.info('Tunnel ID:     ', data.tunnelId);
      box.empty();
      box.end();

      logger.info('Ready for connections. Press Ctrl+C to stop.\n');

      // For UDP tunnels, set up the local UDP proxy
      if (proto === PROTOCOLS.UDP) {
        this._udpProxy = new UdpLocalProxy(this.localPort, this._socket);
        logger.success(`UDP proxy active → localhost:${this.localPort}`);
      }

      // Start heartbeat
      this._startHeartbeat();

      if (resolve) resolve(data);
      return;
    }

    // ── TUNNEL_FAIL ──
    if (type === MSG.TUNNEL_FAIL) {
      const data = decodeJSON(payload);
      logger.error(`Tunnel creation failed: ${data.reason || 'Unknown'}`);
      this._shouldReconnect = false;
      this._socket.destroy();
      if (reject) reject(new Error(data.reason));
      return;
    }

    // ── NEW_CONN ──
    if (type === MSG.NEW_CONN) {
      this._connectionCount++;
      const data = decodeJSON(payload);
      const cId = data.connId || connId;

      logger.data(`New connection #${cId} (total: ${this._connectionCount})`);

      // Connect to local service
      const localSocket = connectLocal(this.localPort, cId, this._socket);
      this._localConnections.set(cId, localSocket);

      localSocket.on('close', () => {
        this._localConnections.delete(cId);
      });

      localSocket.on('error', () => {
        this._localConnections.delete(cId);
      });
      return;
    }

    // ── DATA ──
    if (type === MSG.DATA) {
      const localSocket = this._localConnections.get(connId);
      if (localSocket && !localSocket.destroyed) {
        localSocket.write(payload);
      }
      return;
    }

    // ── CONN_CLOSE ──
    if (type === MSG.CONN_CLOSE) {
      const localSocket = this._localConnections.get(connId);
      if (localSocket && !localSocket.destroyed) {
        localSocket.destroy();
      }
      this._localConnections.delete(connId);
      return;
    }

    // ── HEARTBEAT ──
    if (type === MSG.HEARTBEAT) {
      // Respond to heartbeat
      if (this._socket && !this._socket.destroyed) {
        this._socket.write(encodeMessage(MSG.HEARTBEAT, 0));
      }
      return;
    }

    // ── UDP_DATA (incoming UDP datagram from server) ──
    if (type === MSG.UDP_DATA) {
      if (this._udpProxy) {
        const parsed = decodeUdpPayload(payload);
        if (parsed) {
          this._udpProxy.forward(parsed.srcAddr, parsed.srcPort, parsed.data);
        }
      }
      return;
    }
  }

  /**
   * Start heartbeat responses.
   */
  _startHeartbeat() {
    clearInterval(this._heartbeatTimer);
    this._heartbeatTimer = setInterval(() => {
      if (this._socket && !this._socket.destroyed) {
        this._socket.write(encodeMessage(MSG.HEARTBEAT, 0));
      }
    }, 15000);
  }

  /**
   * Clean up all local connections.
   */
  _cleanup() {
    clearInterval(this._heartbeatTimer);

    // Close UDP proxy if active
    if (this._udpProxy) {
      this._udpProxy.close();
      this._udpProxy = null;
    }

    for (const [connId, localSocket] of this._localConnections) {
      if (!localSocket.destroyed) {
        localSocket.destroy();
      }
    }
    this._localConnections.clear();
  }

  /**
   * Disconnect and stop reconnecting.
   */
  disconnect() {
    this._shouldReconnect = false;
    this._cleanup();

    if (this._socket && !this._socket.destroyed) {
      this._socket.destroy();
    }

    logger.info('Tunnel closed');
  }
}

module.exports = TunnelClient;
