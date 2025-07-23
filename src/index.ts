#!/usr/bin/env node

import { BacklogMcpServer } from './server.js';
import { loadConfig } from './utils/config.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const result: any = {};
  for (const arg of args) {
    if (arg.startsWith('--apiKey=')) result.apiKey = arg.slice('--apiKey='.length);
    if (arg.startsWith('--baseUrl=')) result.baseUrl = arg.slice('--baseUrl='.length);
    if (arg.startsWith('--projectKey=')) result.projectKey = arg.slice('--projectKey='.length);
    if (arg.startsWith('--tasksDir=')) result.tasksDir = arg.slice('--tasksDir='.length);
    if (arg.startsWith('--ignoreIssueTypes=')) {
      const types = arg.slice('--ignoreIssueTypes='.length);
      result.ignoreIssueTypes = types.split(',').map(t => t.trim()).filter(t => t.length > 0);
    }
  }
  return result;
}

async function main() {
  try {
    const overrides = parseArgs();
    const config = await loadConfig(overrides);
    const server = new BacklogMcpServer(config);
    await server.start();
  } catch (error) {
    console.error('Failed to start Backlog MCP server:', error);
  }
}

main().catch(console.error);