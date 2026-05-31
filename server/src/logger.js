'use strict';

const chalk = require('chalk');
const config = require('./config');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[config.logLevel] || LEVELS.info;

function timestamp() {
  const now = new Date();
  return chalk.gray(
    `[${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`
  );
}

const logger = {
  debug(...args) {
    if (currentLevel <= LEVELS.debug) {
      console.log(timestamp(), chalk.magenta('[DEBUG]'), ...args);
    }
  },

  info(...args) {
    if (currentLevel <= LEVELS.info) {
      console.log(timestamp(), chalk.blue('[INFO]'), ...args);
    }
  },

  tunnel(...args) {
    if (currentLevel <= LEVELS.info) {
      console.log(timestamp(), chalk.green('[TUNNEL]'), ...args);
    }
  },

  conn(...args) {
    if (currentLevel <= LEVELS.debug) {
      console.log(timestamp(), chalk.cyan('[CONN]'), ...args);
    }
  },

  warn(...args) {
    if (currentLevel <= LEVELS.warn) {
      console.warn(timestamp(), chalk.yellow('[WARN]'), ...args);
    }
  },

  error(...args) {
    if (currentLevel <= LEVELS.error) {
      console.error(timestamp(), chalk.red('[ERROR]'), ...args);
    }
  },

  banner() {
    console.log('');
    console.log(chalk.yellow('  ╔══════════════════════════════════════════╗'));
    console.log(chalk.yellow('  ║') + chalk.bold.white('  🐻 GumBear Tunnel Server                ') + chalk.yellow('║'));
    console.log(chalk.yellow('  ╚══════════════════════════════════════════╝'));
    console.log('');
  },
};

module.exports = logger;
