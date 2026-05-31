'use strict';

const path = require('path');
const fs = require('fs');

// Load .env file if it exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const config = {
  // API key for authentication
  apiKey: process.env.API_KEY || 'change-me-to-a-secure-random-string',

  // Control server port
  controlPort: parseInt(process.env.CONTROL_PORT, 10) || 4444,

  // HTTP proxy port for subdomain routing
  httpPort: parseInt(process.env.HTTP_PORT, 10) || 80,

  // Domain for subdomain routing
  domain: process.env.DOMAIN || 'gumbear.alora.baby',

  // Port range for TCP tunnels
  portRangeMin: parseInt(process.env.PORT_RANGE_MIN, 10) || 10000,
  portRangeMax: parseInt(process.env.PORT_RANGE_MAX, 10) || 59999,

  // Log level
  logLevel: process.env.LOG_LEVEL || 'info',

  // Heartbeat interval (ms)
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL, 10) || 15000,

  // Heartbeat timeout (ms) — disconnect if no response
  heartbeatTimeout: parseInt(process.env.HEARTBEAT_TIMEOUT, 10) || 30000,
};

module.exports = config;
