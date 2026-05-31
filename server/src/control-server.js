'use strict';

const net = require('net');
const { MSG, MSG_NAMES, PROTOCOLS, encodeMessage, decodeJSON, MessageParser } = require('./protocol');
const { createTcpProxy, handleClientData, handleConnReady, handleConnClose } = require('./tcp-proxy');
const { createUdpProxy, handleUdpDataFromClient } = require('./udp-proxy');
const config = require('./config');
const logger = require('./logger');

let _tunnelIdCounter = 0;

/**
 * Creates the control server that clients connect to.
 * Handles authentication, tunnel creation, and message routing.
 */
function createControlServer(tunnelManager) {
  const server = net.createServer((clientSocket) => {
    const clientAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
    logger.info(`Client connected: ${clientAddr}`);

    let authenticated = false;
    let clientTunnelIds = [];
    let heartbeatTimer = null;
    let heartbeatTimeout = null;

    const parser = new MessageParser();
    clientSocket.pipe(parser);

    parser.on('data', async (message) => {
      const { type, connId, payload } = message;

      logger.debug(
        `← ${MSG_NAMES[type] || '??'} connId=${connId} len=${payload.length} from ${clientAddr}`
      );

      // ── AUTH ──
      if (type === MSG.AUTH) {
        authenticated = true;
        clientSocket.write(
          encodeMessage(MSG.AUTH_OK, 0, {
            message: 'Authenticated successfully',
          })
        );
        logger.info(`Client ${clientAddr} connected`);
        startHeartbeat();
        return;
      }

      // All other messages require auth
      if (!authenticated) {
        clientSocket.write(
          encodeMessage(MSG.AUTH_FAIL, 0, { reason: 'Not authenticated' })
        );
        return;
      }

      // ── TUNNEL_REQ ──
      if (type === MSG.TUNNEL_REQ) {
        try {
          const data = decodeJSON(payload);
          const protocol = data.protocol || PROTOCOLS.TCP;
          const publicPort = await tunnelManager.allocatePort();
          const subdomain = tunnelManager.allocateSubdomain();
          const tunnelId = `tun_${++_tunnelIdCounter}`;

          const tunnel = tunnelManager.register(
            tunnelId,
            clientSocket,
            publicPort,
            subdomain,
            protocol
          );

          // Create proxies based on protocol type
          if (protocol === PROTOCOLS.UDP) {
            // UDP-only tunnel
            createUdpProxy(tunnel, tunnelManager);
          } else {
            // TCP-based tunnel (tcp, http, https all use TCP proxy)
            tunnel.tcpServer = createTcpProxy(tunnel, tunnelManager);
          }

          clientTunnelIds.push(tunnelId);

          const responsePayload = {
            tunnelId,
            subdomain,
            publicPort,
            protocol,
            domain: config.domain,
            tcpAddr: `${config.domain}:${publicPort}`,
          };

          // Add HTTP URL for http/https/tcp protocols
          if (protocol !== PROTOCOLS.UDP) {
            responsePayload.httpUrl = `http://${subdomain}.${config.domain}`;
          }

          clientSocket.write(
            encodeMessage(MSG.TUNNEL_OK, 0, responsePayload)
          );

          logger.tunnel(
            `Created ${protocol.toUpperCase()} tunnel: ${subdomain}.${config.domain} (:${publicPort}) → client ${clientAddr}`
          );
        } catch (err) {
          clientSocket.write(
            encodeMessage(MSG.TUNNEL_FAIL, 0, { reason: err.message })
          );
          logger.error(`Tunnel creation failed: ${err.message}`);
        }
        return;
      }

      // ── CONN_READY ──
      if (type === MSG.CONN_READY) {
        // Find the tunnel that has this connection
        for (const tunnelId of clientTunnelIds) {
          const tunnel = tunnelManager.get(tunnelId);
          if (tunnel && tunnel.connections.has(connId)) {
            handleConnReady(tunnel, connId, tunnelManager);
            return;
          }
        }
        return;
      }

      // ── DATA ──
      if (type === MSG.DATA) {
        for (const tunnelId of clientTunnelIds) {
          const tunnel = tunnelManager.get(tunnelId);
          if (tunnel && tunnel.connections.has(connId)) {
            handleClientData(tunnel, connId, payload, tunnelManager);
            return;
          }
        }
        return;
      }

      // ── CONN_CLOSE ──
      if (type === MSG.CONN_CLOSE) {
        for (const tunnelId of clientTunnelIds) {
          const tunnel = tunnelManager.get(tunnelId);
          if (tunnel && tunnel.connections.has(connId)) {
            handleConnClose(tunnel, connId, tunnelManager);
            return;
          }
        }
        return;
      }

      // ── HEARTBEAT ──
      if (type === MSG.HEARTBEAT) {
        resetHeartbeatTimeout();
        return;
      }

      // ── UDP_DATA (from client, going back to the internet) ──
      if (type === MSG.UDP_DATA) {
        for (const tunnelId of clientTunnelIds) {
          const tunnel = tunnelManager.get(tunnelId);
          if (tunnel && tunnel.protocol === PROTOCOLS.UDP) {
            handleUdpDataFromClient(tunnel, payload);
            return;
          }
        }
        return;
      }
    });

    parser.on('error', (err) => {
      logger.error(`Protocol error from ${clientAddr}: ${err.message}`);
      cleanup();
    });

    clientSocket.on('error', (err) => {
      logger.warn(`Socket error from ${clientAddr}: ${err.message}`);
      cleanup();
    });

    clientSocket.on('close', () => {
      logger.info(`Client disconnected: ${clientAddr}`);
      cleanup();
    });

    function cleanup() {
      clearInterval(heartbeatTimer);
      clearTimeout(heartbeatTimeout);

      // Remove all tunnels for this client
      for (const tunnelId of clientTunnelIds) {
        tunnelManager.remove(tunnelId);
      }
      clientTunnelIds = [];

      if (!clientSocket.destroyed) {
        clientSocket.destroy();
      }
    }

    function startHeartbeat() {
      heartbeatTimer = setInterval(() => {
        if (clientSocket && !clientSocket.destroyed) {
          clientSocket.write(encodeMessage(MSG.HEARTBEAT, 0));
        }
      }, config.heartbeatInterval);

      resetHeartbeatTimeout();
    }

    function resetHeartbeatTimeout() {
      clearTimeout(heartbeatTimeout);
      heartbeatTimeout = setTimeout(() => {
        logger.warn(`Heartbeat timeout for ${clientAddr}`);
        cleanup();
      }, config.heartbeatTimeout);
    }
  });

  server.on('error', (err) => {
    logger.error(`Control server error: ${err.message}`);
  });

  server.listen(config.controlPort, '0.0.0.0', () => {
    logger.info(`Control server listening on :${config.controlPort}`);
  });

  return server;
}

module.exports = { createControlServer };
