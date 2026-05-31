'use strict';

const dgram = require('dgram');
const { MSG, encodeMessage, encodeUdpPayload, decodeUdpPayload } = require('./protocol');
const logger = require('./logger');

/**
 * UDP local proxy.
 * Forwards UDP datagrams between the tunnel and the local UDP service.
 */
class UdpLocalProxy {
  constructor(localPort, controlSocket) {
    this.localPort = localPort;
    this.controlSocket = controlSocket;
    this.localSocket = dgram.createSocket('udp4');
    this._started = false;

    // Listen for responses from the local service
    this.localSocket.on('message', (msg, rinfo) => {
      logger.data(`UDP ← localhost:${this.localPort} (${msg.length} bytes)`);

      // Send response back through the tunnel
      // Package with the original remote client's address
      // (stored in the pending response map)
      if (this._lastRemoteAddr && this._lastRemotePort) {
        const udpPayload = encodeUdpPayload(
          this._lastRemoteAddr,
          this._lastRemotePort,
          msg
        );
        if (this.controlSocket && !this.controlSocket.destroyed) {
          this.controlSocket.write(
            encodeMessage(MSG.UDP_DATA, 0, udpPayload)
          );
        }
      }
    });

    this.localSocket.on('error', (err) => {
      logger.warn(`UDP local proxy error: ${err.message}`);
    });

    // Bind to a random port for sending
    this.localSocket.bind(0, '127.0.0.1', () => {
      this._started = true;
      const addr = this.localSocket.address();
      logger.data(`UDP local proxy bound to 127.0.0.1:${addr.port}`);
    });
  }

  /**
   * Forward an incoming UDP datagram to the local service.
   */
  forward(srcAddr, srcPort, data) {
    // Store remote address for routing the response back
    this._lastRemoteAddr = srcAddr;
    this._lastRemotePort = srcPort;

    this.localSocket.send(data, this.localPort, '127.0.0.1', (err) => {
      if (err) {
        logger.warn(`UDP forward to localhost:${this.localPort} failed: ${err.message}`);
      } else {
        logger.data(`UDP → localhost:${this.localPort} (${data.length} bytes)`);
      }
    });
  }

  /**
   * Close the local UDP socket.
   */
  close() {
    try {
      this.localSocket.close();
    } catch {
      // Ignore
    }
  }
}

module.exports = { UdpLocalProxy };
