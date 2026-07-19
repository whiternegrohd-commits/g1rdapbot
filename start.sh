#!/bin/bash

# Discord Bot Start Script (Linux/VDS)

cd "$(dirname "$0")"

if [ ! -f ".env" ]; then
    echo "[ERROR] .env file not found!"
    echo "Please create .env file with:"
    echo "DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installing npm packages..."
    npm install
fi

echo ""
echo "Starting Discord Bot..."
echo ""

node src/index.js
