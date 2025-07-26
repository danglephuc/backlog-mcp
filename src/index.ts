#!/usr/bin/env node

import { BacklogMcpServer } from './server.js';
import { loadConfig } from './utils/config.js';

async function main() {
  try {
    const config = await loadConfig();
    const server = new BacklogMcpServer(config);
    await server.start();
  } catch (error) {
    console.error('Failed to start Backlog MCP server:', error);
  }
}

main().catch(console.error);