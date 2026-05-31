#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const chalk = require('chalk');
const TunnelClient = require('../src/tunnel-client');
const { loadConfig, setConfig, CONFIG_FILE } = require('../src/config');
const logger = require('../src/logger');

const program = new Command();

program
  .name('gumbear')
  .description('🐻 GumBear Tunnel — Expose local services to the internet')
  .version('1.0.0');

// ──────────────────────────────────────
// gumbear tunnel <port>
// ──────────────────────────────────────
program
  .command('tunnel')
  .description('Tunnel a local port to the internet')
  .argument('<port>', 'Local port to tunnel')
  .option('-s, --server <host>', 'Server hostname', '')
  .option('-p, --server-port <port>', 'Server control port', '')
  .option('-k, --key <apiKey>', 'API key for authentication', '')
  .option('--protocol <proto>', 'Protocol: tcp, udp, http, https (default: tcp)', '')
  .option('--udp', 'Shorthand for --protocol udp')
  .option('--http', 'Shorthand for --protocol http')
  .action(async (port, options) => {
    const localPort = parseInt(port, 10);

    if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
      logger.error('Invalid port number. Must be between 1 and 65535.');
      process.exit(1);
    }

    // Determine protocol
    let protocol = 'tcp';
    if (options.udp) protocol = 'udp';
    else if (options.http) protocol = 'http';
    else if (options.protocol) {
      protocol = options.protocol.toLowerCase();
      if (!['tcp', 'udp', 'http', 'https'].includes(protocol)) {
        logger.error(`Invalid protocol: ${options.protocol}`);
        logger.info(`Supported: ${chalk.cyan('tcp')}, ${chalk.cyan('udp')}, ${chalk.cyan('http')}, ${chalk.cyan('https')}`);
        process.exit(1);
      }
    }

    const config = loadConfig();

    const serverHost = options.server || config.serverHost;
    const serverPort = parseInt(options.serverPort || config.serverPort, 10);
    const apiKey = options.key || config.apiKey || 'anonymous';

    logger.info(`Connecting to ${chalk.cyan(serverHost + ':' + serverPort)}...`);
    logger.info(`Protocol: ${chalk.cyan(protocol.toUpperCase())}`);
    logger.info(`Tunneling ${chalk.cyan('localhost:' + localPort)}\n`);

    const client = new TunnelClient({
      serverHost,
      serverPort,
      apiKey,
      localPort,
      protocol,
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log('');
      client.disconnect();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      client.disconnect();
      process.exit(0);
    });

    try {
      await client.connect();
    } catch (err) {
      logger.error(`Failed: ${err.message}`);
      process.exit(1);
    }
  });

// ──────────────────────────────────────
// gumbear config set-key <key>
// ──────────────────────────────────────
program
  .command('config')
  .description('Manage GumBear configuration')
  .argument('<action>', 'Action: set-key, set-server, show')
  .argument('[value]', 'Value to set')
  .action((action, value) => {
    switch (action) {
      case 'set-key':
        if (!value) {
          logger.error('Usage: gumbear config set-key <your-api-key>');
          process.exit(1);
        }
        setConfig('apiKey', value);
        logger.success(`API key saved to ${chalk.gray(CONFIG_FILE)}`);
        break;

      case 'set-server':
        if (!value) {
          logger.error('Usage: gumbear config set-server <host:port>');
          process.exit(1);
        }
        const parts = value.split(':');
        setConfig('serverHost', parts[0]);
        if (parts[1]) {
          setConfig('serverPort', parseInt(parts[1], 10));
        }
        logger.success(`Server set to ${chalk.cyan(value)}`);
        break;

      case 'show': {
        const config = loadConfig();
        console.log('');
        console.log(chalk.bold('  GumBear Configuration'));
        console.log(chalk.gray('  ─────────────────────'));
        console.log(`  Server:   ${chalk.cyan(config.serverHost + ':' + config.serverPort)}`);
        console.log(`  API Key:  ${config.apiKey ? chalk.green(config.apiKey.slice(0, 8) + '...') : chalk.red('Not set')}`);
        console.log(`  Config:   ${chalk.gray(CONFIG_FILE)}`);
        console.log('');
        break;
      }

      default:
        logger.error(`Unknown action: ${action}`);
        logger.info('Available: set-key, set-server, show');
        process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  console.log('');
  console.log(chalk.yellow('  🐻 GumBear Tunnel'));
  console.log('');
  console.log(`  ${chalk.bold('Quick start:')}`);
  console.log(`    ${chalk.cyan('gumbear config set-key')} ${chalk.gray('<your-api-key>')}`);
  console.log(`    ${chalk.cyan('gumbear tunnel')} ${chalk.gray('<port>')}`);
  console.log('');
  program.outputHelp();
}
