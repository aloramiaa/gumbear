#!/bin/bash
# ──────────────────────────────────────────────────────────────────────
# 🐻 GumBear Tunnel — Absolute Premium Interactive Installer Script
# ──────────────────────────────────────────────────────────────────────
# Usage: curl -fsSL https://gumbear.alora.baby/install | bash
# ──────────────────────────────────────────────────────────────────────

set -eo pipefail

# ANSI color codes for styled terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Configurable constants
REPO_BASE="https://gumbear.alora.baby/download"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="gumbear"
VERSION="1.0.1"

# Pretty terminal banner
clear
echo -e "${YELLOW}${BOLD}"
echo "      🐻  GumBear Tunnel Installer  🐻"
echo "  ──────────────────────────────────────────"
echo -e "${NC}"

# Detect OS
OS_UNAME="$(uname -s)"
OS=""
case "${OS_UNAME}" in
  Linux*)   OS="linux";;
  Darwin*)  OS="macos";;
  MINGW*|MSYS*|CYGWIN*)  OS="windows";;
  *)        
    echo -e "${RED}${BOLD}  ✖ Error: Unsupported Operating System: ${OS_UNAME}${NC}"
    exit 1
    ;;
esac

# Detect Architecture
ARCH_UNAME="$(uname -m)"
ARCH=""
case "${ARCH_UNAME}" in
  x86_64|amd64)   ARCH="x64";;
  aarch64|arm64)  ARCH="arm64";;
  *)               
    echo -e "${RED}${BOLD}  ✖ Error: Unsupported architecture: ${ARCH_UNAME}${NC}"
    exit 1
    ;;
esac

# Adjust download URL and binary extensions for Windows
if [ "$OS" = "windows" ]; then
  DOWNLOAD_URL="${REPO_BASE}/windows-${ARCH}/gumbear-win.exe"
  BINARY_NAME="gumbear.exe"
else
  DOWNLOAD_URL="${REPO_BASE}/${OS}-${ARCH}/gumbear-${OS}"
fi

echo -e "  ${CYAN}ℹ${NC} Detected System: ${BOLD}${OS}-${ARCH}${NC}"
echo -e "  ${CYAN}ℹ${NC} Target Version:  ${BOLD}v${VERSION}${NC}"
echo -e "  ${CYAN}ℹ${NC} Download URL:    ${BLUE}${DOWNLOAD_URL}${NC}"
echo ""

# Check for curl/wget
DOWNLOAD_CMD=""
if command -v curl &> /dev/null; then
  DOWNLOAD_CMD="curl -fsSL"
elif command -v wget &> /dev/null; then
  DOWNLOAD_CMD="wget -qO-"
else
  echo -e "${RED}${BOLD}  ✖ Error: Neither curl nor wget found. Please install one and retry.${NC}"
  exit 1
fi

# Download to a secure temp file
TEMP_FILE=$(mktemp)
trap 'rm -f "$TEMP_FILE"' EXIT

echo -e "  ${YELLOW}⏳${NC} Downloading GumBear binary..."

if [ "$DOWNLOAD_CMD" = "curl -fsSL" ]; then
  curl -fsSL "${DOWNLOAD_URL}" -o "${TEMP_FILE}"
else
  wget -q "${DOWNLOAD_URL}" -O "${TEMP_FILE}"
fi

# Verify the download succeeded and has size
if [ ! -s "$TEMP_FILE" ]; then
  echo -e "${RED}${BOLD}  ✖ Error: Download failed or binary file is empty.${NC}"
  exit 1
fi

echo -e "  ${GREEN}✔${NC} Download completed successfully."

# Install phase
echo -e "  ${YELLOW}⏳${NC} Installing binary to ${INSTALL_DIR}..."

if [ -w "${INSTALL_DIR}" ]; then
  mv "${TEMP_FILE}" "${INSTALL_DIR}/${BINARY_NAME}"
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
else
  echo -e "  ${YELLOW}🔐${NC} Write permission required for ${INSTALL_DIR}. Requesting sudo privilege..."
  sudo mv "${TEMP_FILE}" "${INSTALL_DIR}/${BINARY_NAME}"
  sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
fi

echo ""
echo -e "${GREEN}${BOLD}  🎉 Installation Successful!${NC}"
echo -e "  ──────────────────────────────────────────"
echo -e "  🐻 ${BOLD}GumBear Tunnel v${VERSION}${NC} is now ready for use!"
echo ""
echo -e "  ${BOLD}Quick Start Guide:${NC}"
echo -e "    1. Start a local tunnel instantly (Anonymous Mode):"
echo -e "       ${CYAN}gumbear tunnel 3000${NC}"
echo ""
echo -e "    2. Start a UDP tunnel (Game servers, Wireguard, DNS):"
echo -e "       ${CYAN}gumbear tunnel 53 --udp${NC}"
echo ""
echo -e "    3. Connect to a custom server with your credentials (Optional):"
echo -e "       ${CYAN}gumbear config set-server gumbear.alora.baby:4444${NC}"
echo -e "       ${CYAN}gumbear config set-key <your-api-key>${NC}"
echo ""
echo -e "  For the complete user guide and advanced use cases, visit:"
echo -e "  ${BLUE}https://github.com/aloramiaa/gumbear${NC}"
echo ""
echo -e "  ${YELLOW}${BOLD}Happy tunneling!${NC}"
echo ""
