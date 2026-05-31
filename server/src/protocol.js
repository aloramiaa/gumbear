'use strict';

const { Transform } = require('stream');

// ──────────────────────────────────────────────
// Message Types
// ──────────────────────────────────────────────
const MSG = {
  AUTH:         0x01,
  AUTH_OK:      0x02,
  AUTH_FAIL:    0x03,
  TUNNEL_REQ:   0x10,
  TUNNEL_OK:    0x11,
  TUNNEL_FAIL:  0x12,
  NEW_CONN:     0x20,
  CONN_READY:   0x21,
  DATA:         0x30,
  CONN_CLOSE:   0x31,
  UDP_DATA:     0x40, // UDP datagram: payload = [srcPort(2)][dstPort(2)][data]
  UDP_READY:    0x41, // UDP tunnel ready acknowledgment
  HEARTBEAT:    0xFF,
};

// ──────────────────────────────────────────────
// Supported tunnel protocols
// ──────────────────────────────────────────────
const PROTOCOLS = {
  TCP:   'tcp',
  UDP:   'udp',
  HTTP:  'http',
  HTTPS: 'https',
};

const MSG_NAMES = {};
for (const [name, val] of Object.entries(MSG)) {
  MSG_NAMES[val] = name;
}

// Header: [Type(1)] [ConnID(4)] [Length(4)] = 9 bytes
const HEADER_SIZE = 9;

// Max payload size: 1MB
const MAX_PAYLOAD_SIZE = 1 * 1024 * 1024;

// ──────────────────────────────────────────────
// Encode a message into a framed Buffer
// ──────────────────────────────────────────────
function encodeMessage(type, connId, payload) {
  let payloadBuf;

  if (payload === undefined || payload === null) {
    payloadBuf = Buffer.alloc(0);
  } else if (Buffer.isBuffer(payload)) {
    payloadBuf = payload;
  } else if (typeof payload === 'object') {
    payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  } else if (typeof payload === 'string') {
    payloadBuf = Buffer.from(payload, 'utf8');
  } else {
    payloadBuf = Buffer.alloc(0);
  }

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(connId || 0, 1);
  header.writeUInt32BE(payloadBuf.length, 5);

  return Buffer.concat([header, payloadBuf]);
}

// ──────────────────────────────────────────────
// Decode a JSON payload from a message
// ──────────────────────────────────────────────
function decodeJSON(payload) {
  if (!payload || payload.length === 0) return {};
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return {};
  }
}

// ──────────────────────────────────────────────
// Message Parser — Transform stream
// Handles TCP chunking and reassembly
// ──────────────────────────────────────────────
class MessageParser extends Transform {
  constructor(options = {}) {
    super({ ...options, readableObjectMode: true });
    this._buffer = Buffer.alloc(0);
  }

  _transform(chunk, encoding, callback) {
    this._buffer = Buffer.concat([this._buffer, chunk]);

    while (this._buffer.length >= HEADER_SIZE) {
      const payloadLength = this._buffer.readUInt32BE(5);

      // Safety check
      if (payloadLength > MAX_PAYLOAD_SIZE) {
        this.destroy(new Error(`Payload too large: ${payloadLength} bytes`));
        return;
      }

      const totalLength = HEADER_SIZE + payloadLength;

      // Wait for full message
      if (this._buffer.length < totalLength) {
        break;
      }

      const type = this._buffer.readUInt8(0);
      const connId = this._buffer.readUInt32BE(1);
      const payload = this._buffer.slice(HEADER_SIZE, totalLength);

      this.push({ type, connId, payload });

      this._buffer = this._buffer.slice(totalLength);
    }

    callback();
  }

  _flush(callback) {
    if (this._buffer.length > 0) {
      callback(new Error(`Incomplete message data: ${this._buffer.length} bytes remaining`));
    } else {
      callback();
    }
  }
}

// ──────────────────────────────────────────────
// Utility: generate a random connection ID
// ──────────────────────────────────────────────
let _connIdCounter = 0;
function nextConnId() {
  _connIdCounter = (_connIdCounter + 1) & 0xFFFFFFFF;
  return _connIdCounter;
}

// ──────────────────────────────────────────────
// Utility: generate a random subdomain
// ──────────────────────────────────────────────
function generateSubdomain(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ──────────────────────────────────────────────
// UDP helpers: encode/decode UDP datagram payload
// Payload format: [srcPort(2)][dstPort(2)][addrLen(1)][addr][data]
// ──────────────────────────────────────────────
function encodeUdpPayload(srcAddr, srcPort, data) {
  const addrBuf = Buffer.from(srcAddr, 'utf8');
  const header = Buffer.alloc(5);
  header.writeUInt16BE(srcPort, 0);
  header.writeUInt16BE(0, 2); // reserved
  header.writeUInt8(addrBuf.length, 4);
  return Buffer.concat([header, addrBuf, data]);
}

function decodeUdpPayload(payload) {
  if (payload.length < 5) return null;
  const srcPort = payload.readUInt16BE(0);
  const addrLen = payload.readUInt8(4);
  if (payload.length < 5 + addrLen) return null;
  const srcAddr = payload.slice(5, 5 + addrLen).toString('utf8');
  const data = payload.slice(5 + addrLen);
  return { srcAddr, srcPort, data };
}

module.exports = {
  MSG,
  MSG_NAMES,
  HEADER_SIZE,
  MAX_PAYLOAD_SIZE,
  PROTOCOLS,
  encodeMessage,
  decodeJSON,
  MessageParser,
  nextConnId,
  generateSubdomain,
  encodeUdpPayload,
  decodeUdpPayload,
};
