'use strict';

const TunnelManager = require('./tunnel-manager');
const { createControlServer } = require('./control-server');
const { createHttpProxy } = require('./http-proxy');
const config = require('./config');
const logger = require('./logger');

// ──────────────────────────────────────────────
// GumBear Tunnel Server — Entry Point
// ──────────────────────────────────────────────

logger.banner();

const tunnelManager = new TunnelManager();

// Start control server (clients connect here)
const controlServer = createControlServer(tunnelManager);

// Start HTTP proxy (subdomain-based routing)
const httpProxy = createHttpProxy(tunnelManager);

// Display configuration
logger.info(`Domain:        ${config.domain}`);
logger.info(`Control port:  ${config.controlPort}`);
logger.info(`HTTP port:     ${config.httpPort}`);
logger.info(`Port range:    ${config.portRangeMin}–${config.portRangeMax}`);
logger.info('');
logger.info('Waiting for tunnel clients...');

// Stats logging every 60s
setInterval(() => {
  const stats = tunnelManager.stats();
  if (stats.tunnels > 0) {
    logger.info(
      `Active: ${stats.tunnels} tunnel(s), ${stats.connections} connection(s)`
    );
  }
}, 60000);

// Graceful shutdown
function shutdown(signal) {
  logger.info(`\n${signal} received. Shutting down...`);

  controlServer.close();
  httpProxy.close();

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  logger.error(err.stack);
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err}`);
});
