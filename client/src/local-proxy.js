'use strict';

const net = require('net');
const { MSG, encodeMessage } = require('./protocol');
const logger = require('./logger');

/**
 * Connect to the local service and pipe data through the tunnel.
 * 
 * @param {number} localPort - The local port to connect to
 * @param {number} connId - The connection ID assigned by the server
 * @param {net.Socket} controlSocket - The control connection to the server
 * @returns {net.Socket|null} The local socket, or null if connection failed
 */
function connectLocal(localPort, connId, controlSocket) {
  const localSocket = new net.Socket();

  localSocket.connect(localPort, '127.0.0.1', () => {
    // Tell server we're ready
    controlSocket.write(encodeMessage(MSG.CONN_READY, connId));

    logger.data(`Conn #${connId} → localhost:${localPort}`);
  });

  // Data from local service → send to server
  localSocket.on('data', (data) => {
    if (controlSocket && !controlSocket.destroyed) {
      controlSocket.write(encodeMessage(MSG.DATA, connId, data));
    }
  });

  localSocket.on('error', (err) => {
    logger.warn(`Local conn #${connId} error: ${err.message}`);

    // Notify server to close the public connection
    if (controlSocket && !controlSocket.destroyed) {
      controlSocket.write(encodeMessage(MSG.CONN_CLOSE, connId));
    }
  });

  localSocket.on('close', () => {
    // Notify server
    if (controlSocket && !controlSocket.destroyed) {
      controlSocket.write(encodeMessage(MSG.CONN_CLOSE, connId));
    }
  });

  return localSocket;
}

module.exports = { connectLocal };
