#!/bin/bash
# Setup script for claire gateway

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$GATEWAY_DIR")"
PLIST_NAME="claire.gateway.plist"
PLIST_SRC="$GATEWAY_DIR/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs/claire"

echo "Claire Gateway Setup"
echo "===================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    echo "Install with: brew install node"
    exit 1
fi

NODE_PATH=$(which node)
echo "Node.js found at: $NODE_PATH"

# Check for ANTHROPIC_API_KEY
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo ""
    echo "Warning: ANTHROPIC_API_KEY is not set"
    echo "Make sure it's set in your shell profile (~/.zshrc or ~/.bashrc)"
    echo ""
fi

# Create log directory
echo "Creating log directory: $LOG_DIR"
mkdir -p "$LOG_DIR"

# Install dependencies
echo ""
echo "Installing gateway dependencies..."
cd "$GATEWAY_DIR"
npm install

# Build TypeScript
echo ""
echo "Building gateway..."
npm run build

# Install CLI dependencies
echo ""
echo "Installing CLI dependencies..."
cd "$PROJECT_DIR/cli"
npm install

# Build CLI
echo ""
echo "Building CLI..."
npm run build

# Update plist with correct node path
echo ""
echo "Configuring launchd plist..."
sed -i '' "s|/usr/local/bin/node|$NODE_PATH|g" "$PLIST_SRC"

# Copy plist to LaunchAgents
echo "Installing launchd plist..."
cp "$PLIST_SRC" "$PLIST_DEST"

echo ""
echo "Setup complete!"
echo ""
echo "To start the gateway daemon:"
echo "  launchctl load ~/Library/LaunchAgents/$PLIST_NAME"
echo ""
echo "To stop the gateway daemon:"
echo "  launchctl unload ~/Library/LaunchAgents/$PLIST_NAME"
echo ""
echo "To run the CLI:"
echo "  cd $PROJECT_DIR/cli && npm start"
echo ""
echo "To view logs:"
echo "  tail -f $LOG_DIR/gateway.log"
echo ""
