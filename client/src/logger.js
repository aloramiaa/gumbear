'use strict';

const chalk = require('chalk');

const logger = {
  info(...args) {
    console.log(chalk.blue('  ℹ'), ...args);
  },

  success(...args) {
    console.log(chalk.green('  ✔'), ...args);
  },

  warn(...args) {
    console.log(chalk.yellow('  ⚠'), ...args);
  },

  error(...args) {
    console.error(chalk.red('  ✖'), ...args);
  },

  data(...args) {
    console.log(chalk.cyan('  ↔'), ...args);
  },

  dim(...args) {
    console.log(chalk.gray('   '), ...args);
  },

  banner() {
    console.log('');
    console.log(chalk.yellow('  ╔══════════════════════════════════════════════════╗'));
    console.log(chalk.yellow('  ║') + chalk.bold.white('  🐻 GumBear Tunnel                                ') + chalk.yellow('║'));
    console.log(chalk.yellow('  ╠══════════════════════════════════════════════════╣'));
    return {
      url(label, value) {
        const padded = `  ${label}  ${value}`;
        const padding = 50 - padded.length;
        console.log(
          chalk.yellow('  ║') +
            chalk.gray(`  ${label}  `) +
            chalk.bold.cyan(value) +
            ' '.repeat(Math.max(0, padding)) +
            chalk.yellow('║')
        );
      },
      info(label, value) {
        const padded = `  ${label}  ${value}`;
        const padding = 50 - padded.length;
        console.log(
          chalk.yellow('  ║') +
            chalk.gray(`  ${label}  `) +
            chalk.white(value) +
            ' '.repeat(Math.max(0, padding)) +
            chalk.yellow('║')
        );
      },
      separator() {
        console.log(chalk.yellow('  ╠══════════════════════════════════════════════════╣'));
      },
      empty() {
        console.log(chalk.yellow('  ║') + ' '.repeat(50) + chalk.yellow('║'));
      },
      end() {
        console.log(chalk.yellow('  ╚══════════════════════════════════════════════════╝'));
        console.log('');
      },
    };
  },

  connectionLog(connId, direction, bytes) {
    const dir = direction === 'in' ? chalk.green('←') : chalk.blue('→');
    console.log(
      chalk.gray(`  ${dir} conn #${connId}: ${bytes} bytes`)
    );
  },
};

module.exports = logger;
