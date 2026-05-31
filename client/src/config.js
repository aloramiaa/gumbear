'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.gumbear');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  serverHost: 'gumbear.alora.baby',
  serverPort: 4444,
  apiKey: '',
};

/**
 * Load config from ~/.gumbear/config.json
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const saved = JSON.parse(raw);
      return { ...DEFAULTS, ...saved };
    }
  } catch {
    // Ignore corrupted config
  }
  return { ...DEFAULTS };
}

/**
 * Save config to ~/.gumbear/config.json
 */
function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Get a specific config value.
 */
function getConfig(key) {
  const config = loadConfig();
  return config[key];
}

/**
 * Set a specific config value.
 */
function setConfig(key, value) {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
  return config;
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfig,
  setConfig,
  CONFIG_DIR,
  CONFIG_FILE,
};
