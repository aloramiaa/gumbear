'use strict';

const dgram = require('dgram');
const { MSG, encodeMessage, encodeUdpPayload, decodeUdpPayload } = require('./protocol');
const logger = require('./logger');

/**
 * Creates a UDP proxy server for a tunnel.
 * Listens on a public UDP port and forwards datagrams through the tunnel.
 *
 * UDP is connectionless — each datagram is independent.
 * We track source address:port to route responses back correctly.
 */
function createUdpProxy(tunnel, tunnelManager) {
  const udpSocket = dgram.createSocket('udp4');

  // Track remote clients by addr:port → rinfo
  // So we can send responses back to the correct client
  const remoteClients = new Map();

  udpSocket.on('message', (msg, rinfo) => {
    const clientKey = `${rinfo.address}:${rinfo.port}`;

    // Store remote client info for sending responses
    remoteClients.set(clientKey, rinfo);

    logger.conn(
      `UDP datagram from ${clientKey} on :${tunnel.publicPort} (${msg.length} bytes)`
    );

    // Encode the UDP payload with source address info
    const udpPayload = encodeUdpPayload(rinfo.address, rinfo.port, msg);

    // Send UDP_DATA to the tunnel client
    if (tunnel.clientSocket && !tunnel.clientSocket.destroyed) {
      tunnel.clientSocket.write(
        encodeMessage(MSG.UDP_DATA, 0, udpPayload)
      );
    }
  });

  udpSocket.on('error', (err) => {
    logger.error(`UDP proxy error on :${tunnel.publicPort}: ${err.message}`);
  });

  udpSocket.bind(tunnel.publicPort, '0.0.0.0', () => {
    logger.info(`UDP proxy listening on :${tunnel.publicPort}`);
  });

  // Attach remoteClients map to tunnel for response routing
  tunnel.udpRemoteClients = remoteClients;
  tunnel.udpSocket = udpSocket;

  return udpSocket;
}

/**
 * Handle UDP_DATA from client (response going back to the internet).
 */
function handleUdpDataFromClient(tunnel, payload) {
  const parsed = decodeUdpPayload(payload);
  if (!parsed) {
    logger.warn('Invalid UDP payload from client');
    return;
  }

  const { srcAddr, srcPort, data } = parsed;

  if (tunnel.udpSocket) {
    tunnel.udpSocket.send(data, srcPort, srcAddr, (err) => {
      if (err) {
        logger.debug(`UDP send error to ${srcAddr}:${srcPort}: ${err.message}`);
      }
    });
  }
}

module.exports = {
  createUdpProxy,
  handleUdpDataFromClient,
};
