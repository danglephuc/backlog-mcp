import * as fs from 'fs-extra';
import * as path from 'path';
import { BacklogConfig } from '../types/backlog.js';

export interface Config extends BacklogConfig {
  tasksDir: string;
  ignoreIssueTypes?: string[];
}

/**
 * Load configuration from config.json file or environment variables
 */
export async function loadConfig(overrides?: Partial<Config>): Promise<Config> {
  // If overrides are provided and all required fields are present, use them
  if (overrides && overrides.apiKey && overrides.baseUrl && overrides.projectKey) {
    return {
      apiKey: overrides.apiKey,
      baseUrl: overrides.baseUrl,
      projectKey: overrides.projectKey,
      tasksDir: overrides.tasksDir || '.tasks',
      ignoreIssueTypes: overrides.ignoreIssueTypes || []
    };
  }
  // Try to load from config.json first
  const configPath = path.resolve('config.json');
  
  if (await fs.pathExists(configPath)) {
    try {
      const configData = await fs.readJson(configPath);
      
      return {
        apiKey: configData.apiKey,
        baseUrl: configData.baseUrl,
        projectKey: configData.projectKey,
        tasksDir: configData.tasksDir || '.tasks',
        ignoreIssueTypes: configData.ignoreIssueTypes || []
      };
    } catch (error) {
      console.warn('Failed to load config.json, falling back to environment variables');
    }
  }

  // Fall back to environment variables
  const apiKey = process.env.BACKLOG_API_KEY;
  const baseUrl = process.env.BACKLOG_BASE_URL;
  const projectKey = process.env.BACKLOG_PROJECT_KEY;
  const tasksDir = process.env.TASKS_DIR || '.tasks';
  const ignoreIssueTypes = process.env.IGNORE_ISSUE_TYPES ? process.env.IGNORE_ISSUE_TYPES.split(',').map(t => t.trim()) : [];

  if (!apiKey || !baseUrl || !projectKey) {
    throw new Error(
      'Missing required configuration. Please provide either:\n' +
      '1. A config.json file with apiKey, baseUrl, and projectKey\n' +
      '2. Environment variables: BACKLOG_API_KEY, BACKLOG_BASE_URL, BACKLOG_PROJECT_KEY'
    );
  }
  
  return {
    apiKey,
    baseUrl,
    projectKey,
    tasksDir,
    ignoreIssueTypes
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): void {
  if (!config.apiKey) {
    throw new Error('API key is required');
  }
  
  if (!config.baseUrl) {
    throw new Error('Base URL is required');
  }
  
  if (!config.projectKey) {
    throw new Error('Project key is required');
  }
  
  // Validate base URL format
  try {
    new URL(config.baseUrl);
  } catch (error) {
    throw new Error('Invalid base URL format');
  }
  
  // Validate base URL is Backlog domain
  if (!config.baseUrl.includes('backlog')) {
    console.warn('Base URL does not appear to be a Backlog domain');
  }
} 