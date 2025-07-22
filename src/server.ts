import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BacklogClient } from './services/BacklogClient.js';
import { TaskFileManager } from './services/TaskFileManager.js';
import { BacklogConfig } from './types/backlog.js';
import { Config } from './utils/config.js';

export class BacklogMcpServer {
  private server: McpServer;
  private backlogClient: BacklogClient | null = null;
  private taskManager: TaskFileManager;
  private config: Config | undefined;

  constructor(config?: Config) {
    this.server = new McpServer({
      name: 'backlog-mcp',
      version: '1.0.0'
    });
    this.config = config;
    this.taskManager = new TaskFileManager(config?.tasksDir || '.tasks');
    this.setupTools();
    this.setupResources();
  }

  private setupTools(): void {
    // Sync issues tool
    this.server.registerTool(
      'sync-issues',
      {
        title: 'Sync Backlog Issues',
        description: 'Sync issues from Backlog to local .tasks folder',
        inputSchema: {}
      },
      async () => {
        try {
          // Use config from constructor instead of input
          if (!this.config) {
            return {
              content: [{
                type: 'text',
                text: 'Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided.'
              }],
              isError: true
            };
          }

          // Initialize Backlog client
          const config: BacklogConfig = { 
            apiKey: this.config.apiKey, 
            baseUrl: this.config.baseUrl, 
            projectKey: this.config.projectKey 
          };
          this.backlogClient = new BacklogClient(config);

          // Test connection
          const isConnected = await this.backlogClient.testConnection();
          if (!isConnected) {
            return {
              content: [{
                type: 'text',
                text: 'Failed to connect to Backlog. Please check your API key and base URL.'
              }]
            };
          }

          // Initialize task manager
          await this.taskManager.initialize();

          // Get last sync time from file
          const lastSyncTime = await this.taskManager.getLastSyncTime();
          const currentSyncTime = new Date().toISOString();

          // Get issues
          let issues;
          let syncMessage = '';
          if (lastSyncTime) {
            const sinceDate = new Date(lastSyncTime);
            issues = await this.backlogClient.getIssuesUpdatedSince(sinceDate);
            syncMessage = `Synced ${issues.length} issues updated since ${new Date(lastSyncTime).toLocaleString()}`;
          } else {
            issues = await this.backlogClient.getIssues();
            syncMessage = `Synced ${issues.length} issues (full sync - first time)`;
          }

          // Sync issues to task files
          await this.taskManager.syncIssues(issues, this.config.baseUrl);

          // Cleanup removed issues if doing a full sync (first time)
          if (!lastSyncTime) {
            const currentIssueKeys = issues.map(issue => issue.issueKey);
            await this.taskManager.cleanupRemovedIssues(currentIssueKeys);
          }

          // Save current sync time for next time
          await this.taskManager.saveLastSyncTime(currentSyncTime);

          return {
            content: [{
              type: 'text',
              text: `✅ ${syncMessage}\nSaved to: ${this.taskManager.getTasksDirectory()}\nNext sync will check for updates since: ${new Date(currentSyncTime).toLocaleString()}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error syncing issues: ${error}`
            }],
            isError: true
          };
        }
      }
    );

    // Get single issue tool
    this.server.registerTool(
      'get-issue',
      {
        title: 'Get Backlog Issue',
        description: 'Get details of a specific Backlog issue',
        inputSchema: {
          issueKey: z.string().describe('Issue key (e.g., PROJ-123)')
        }
      },
      async ({ issueKey }) => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: 'text',
                text: 'Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided.'
              }],
              isError: true
            };
          }

          const config: BacklogConfig = { 
            apiKey: this.config.apiKey, 
            baseUrl: this.config.baseUrl, 
            projectKey: this.config.projectKey 
          };
          const client = new BacklogClient(config);

          const issue = await client.getIssue(issueKey);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(issue, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error getting issue: ${error}`
            }],
            isError: true
          };
        }
      }
    );

    // Test connection tool
    this.server.registerTool(
      'test-connection',
      {
        title: 'Test Backlog Connection',
        description: 'Test connection to Backlog API',
        inputSchema: {}
      },
      async () => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: 'text',
                text: 'Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided.'
              }],
              isError: true
            };
          }

          const config: BacklogConfig = { 
            apiKey: this.config.apiKey, 
            baseUrl: this.config.baseUrl, 
            projectKey: this.config.projectKey 
          };
          const client = new BacklogClient(config);

          const isConnected = await client.testConnection();
          if (isConnected) {
            const project = await client.getProject();
            return {
              content: [{
                type: 'text',
                text: `✅ Successfully connected to Backlog!\nProject: ${project.name} (${project.projectKey})`
              }]
            };
          } else {
            return {
              content: [{
                type: 'text',
                text: '❌ Failed to connect to Backlog. Please check your credentials.'
              }],
              isError: true
            };
          }
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `❌ Connection test failed: ${error}`
            }],
            isError: true
          };
        }
      }
    );

    // Update issue tool
    this.server.registerTool(
      'update-issue',
      {
        title: 'Update Backlog Issue',
        description: 'Update a Backlog issue with changes from local task file',
        inputSchema: {
          issueKey: z.string().describe('Issue key (e.g., PROJ-123)')
        }
      },
      async ({ issueKey }) => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: 'text',
                text: 'Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided.'
              }],
              isError: true
            };
          }

          // Read the local task file
          const taskData = await this.taskManager.readTaskFile(issueKey);
          if (!taskData) {
            return {
              content: [{
                type: 'text',
                text: `❌ Local task file for ${issueKey} not found. Please ensure the file exists in your tasks directory.`
              }],
              isError: true
            };
          }

          // Initialize Backlog client
          const config: BacklogConfig = { 
            apiKey: this.config.apiKey, 
            baseUrl: this.config.baseUrl, 
            projectKey: this.config.projectKey 
          };
          const client = new BacklogClient(config);

          // Get the original issue to compare
          let originalIssue;
          try {
            originalIssue = await client.getIssue(issueKey);
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ Failed to fetch issue ${issueKey} from Backlog. Please check if the issue exists.`
              }],
              isError: true
            };
          }

          // Check what has changed
          const changes: { summary?: string; description?: string } = {};
          let changesList: string[] = [];

          if (taskData.title && taskData.title !== originalIssue.summary) {
            changes.summary = taskData.title;
            changesList.push(`Title: "${originalIssue.summary}" → "${taskData.title}"`);
          }

          // Compare descriptions, treating null/undefined as empty string
          const localDesc = taskData.description || '';
          const backlogDesc = originalIssue.description || '';
          
          if (localDesc !== backlogDesc) {
            // Safety check: if local is empty but Backlog has content, be careful
            if (!localDesc && backlogDesc) {
              // WARNING: Local description is empty but Backlog has content. Skipping description update to prevent data loss.
              changesList.push(`Description update skipped (would remove existing content)`);
            } else {
              changes.description = localDesc;
              if (localDesc && backlogDesc) {
                changesList.push(`Description updated`);
              } else if (localDesc && !backlogDesc) {
                changesList.push(`Description added`);
              }
            }
          }

          // If no changes, return early
          if (Object.keys(changes).length === 0) {
            return {
              content: [{
                type: 'text',
                text: `✅ No changes detected for ${issueKey}. Local task file matches Backlog issue.`
              }]
            };
          }

          // Update the issue
          const updatedIssue = await client.updateIssue(issueKey, changes);
          
          return {
            content: [{
              type: 'text',
              text: `✅ Successfully updated ${issueKey} in Backlog!\n\nChanges made:\n${changesList.map(change => `• ${change}`).join('\n')}\n\nView issue: ${client.getIssueUrl(issueKey)}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `❌ Failed to update issue ${issueKey}: ${error}`
            }],
            isError: true
          };
        }
      }
    );

    // List task files tool
    this.server.registerTool(
      'list-task-files',
      {
        title: 'List Task Files',
        description: 'List existing task files in .tasks directory',
        inputSchema: {}
      },
      async () => {
        try {
          const taskFiles = await this.taskManager.getExistingTaskFiles();
          const tasksDir = this.taskManager.getTasksDirectory();
          
          if (taskFiles.length === 0) {
            return {
              content: [{
                type: 'text',
                text: `No task files found in ${tasksDir}`
              }]
            };
          }

          return {
            content: [{
              type: 'text',
              text: `Found ${taskFiles.length} task files in ${tasksDir}:\n${taskFiles.map(file => `- ${file}`).join('\n')}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: 'text',
              text: `Error listing task files: ${error}`
            }],
            isError: true
          };
        }
      }
    );
  }

  private setupResources(): void {
    // Resource for task files
    this.server.registerResource(
      'task-file',
      new ResourceTemplate('task://{issueKey}', { list: undefined }),
      {
        title: 'Task File',
        description: 'Access task files by issue key',
        mimeType: 'text/markdown'
      },
      async (uri, { issueKey }) => {
        try {
          // Ensure issueKey is a string (could be string[] from URI parameters)
          const key = Array.isArray(issueKey) ? issueKey[0] : issueKey;
          const filePath = `${this.taskManager.getTasksDirectory()}/${key}.md`;
          const exists = await this.taskManager.taskFileExists(key);
          
          if (!exists) {
            throw new Error(`Task file for ${key} not found`);
          }

          // In a real implementation, you'd read the file content here
          // For now, we'll return a placeholder
          return {
            contents: [{
              uri: uri.href,
              text: `Task file for ${issueKey} located at ${filePath}`,
              mimeType: 'text/markdown'
            }]
          };
        } catch (error) {
          throw new Error(`Failed to read task file: ${error}`);
        }
      }
    );

    // Resource for tasks directory listing
    this.server.registerResource(
      'tasks-directory',
      'tasks://directory',
      {
        title: 'Tasks Directory',
        description: 'List all task files in the .tasks directory',
        mimeType: 'text/plain'
      },
      async (uri) => {
        try {
          const taskFiles = await this.taskManager.getExistingTaskFiles();
          const tasksDir = this.taskManager.getTasksDirectory();
          
          const content = taskFiles.length > 0 
            ? `Tasks directory: ${tasksDir}\n\nTask files:\n${taskFiles.map(file => `- ${file}`).join('\n')}`
            : `Tasks directory: ${tasksDir}\n\nNo task files found.`;

          return {
            contents: [{
              uri: uri.href,
              text: content,
              mimeType: 'text/plain'
            }]
          };
        } catch (error) {
          throw new Error(`Failed to list tasks directory: ${error}`);
        }
      }
    );
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
} 