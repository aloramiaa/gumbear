'use strict';

const net = require('net');
const { MSG, encodeMessage, nextConnId } = require('./protocol');
const logger = require('./logger');

/**
 * Creates a TCP proxy server for a tunnel.
 * Listens on a public port and pipes connections through the tunnel.
 */
function createTcpProxy(tunnel, tunnelManager) {
  const server = net.createServer((publicSocket) => {
    const connId = nextConnId();

    logger.conn(
      `New TCP connection #${connId} on :${tunnel.publicPort} from ${publicSocket.remoteAddress}`
    );

    // Store the connection
    tunnelManager.addConnection(tunnel.tunnelId, connId, publicSocket);

    // Tell the client about this new connection
    const msg = encodeMessage(MSG.NEW_CONN, connId, { connId });
    if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
      tunnel.clientSocket.write(msg);
    } else {
      publicSocket.destroy();
      tunnelManager.removeConnection(tunnel.tunnelId, connId);
      return;
    }

    // Buffer incoming data until the client is ready
    publicSocket.on('data', (data) => {
      const conn = tunnelManager.getConnection(tunnel.tunnelId, connId);
      if (!conn) {
        publicSocket.destroy();
        return;
      }

      if (!conn.localReady) {
        // Buffer data until client connects to local service
        conn.buffer.push(data);
      } else {
        // Pipe directly to client
        const dataMsg = encodeMessage(MSG.DATA, connId, data);
        if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
          tunnel.clientSocket.write(dataMsg);
        }
      }
    });

    publicSocket.on('error', (err) => {
      logger.debug(`TCP conn #${connId} error: ${err.message}`);
      // Notify client to close local connection
      if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
        tunnel.clientSocket.write(encodeMessage(MSG.CONN_CLOSE, connId));
      }
      tunnelManager.removeConnection(tunnel.tunnelId, connId);
    });

    publicSocket.on('close', () => {
      logger.conn(`TCP conn #${connId} closed on :${tunnel.publicPort}`);
      // Notify client
      if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
        tunnel.clientSocket.write(encodeMessage(MSG.CONN_CLOSE, connId));
      }
      tunnelManager.removeConnection(tunnel.tunnelId, connId);
    });

    // Timeout for connections waiting for CONN_READY
    setTimeout(() => {
      const conn = tunnelManager.getConnection(tunnel.tunnelId, connId);
      if (conn && !conn.localReady) {
        logger.warn(`TCP conn #${connId} timed out waiting for CONN_READY`);
        publicSocket.destroy();
        tunnelManager.removeConnection(tunnel.tunnelId, connId);
      }
    }, 10000); // 10s timeout
  });

  server.on('error', (err) => {
    logger.error(`TCP proxy error on :${tunnel.publicPort}: ${err.message}`);
  });

  server.listen(tunnel.publicPort, '0.0.0.0', () => {
    logger.info(`TCP proxy listening on :${tunnel.publicPort}`);
  });

  return server;
}

/**
 * Handle DATA message from client — write to the public socket.
 */
function handleClientData(tunnel, connId, data, tunnelManager) {
  const conn = tunnelManager.getConnection(tunnel.tunnelId, connId);
  if (!conn || !conn.publicSocket || conn.publicSocket.destroyed) {
    return;
  }
  conn.publicSocket.write(data);
}

/**
 * Handle CONN_READY message from client.
 * Flush any buffered data from the public socket.
 */
function handleConnReady(tunnel, connId, tunnelManager) {
  const result = tunnelManager.markConnectionReady(tunnel.tunnelId, connId);
  if (!result) return;

  const { conn, bufferedData } = result;

  logger.conn(`Conn #${connId} ready, flushing ${bufferedData.length} buffered chunks`);

  // Send all buffered data to client
  for (const chunk of bufferedData) {
    const dataMsg = encodeMessage(MSG.DATA, connId, chunk);
    if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
      tunnel.clientSocket.write(dataMsg);
    }
  }
}

/**
 * Handle CONN_CLOSE from client — close the public socket.
 */
function handleConnClose(tunnel, connId, tunnelManager) {
  tunnelManager.removeConnection(tunnel.tunnelId, connId);
}

module.exports = {
  createTcpProxy,
  handleClientData,
  handleConnReady,
  handleConnClose,
};
