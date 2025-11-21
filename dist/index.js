#!/usr/bin/env node

// src/server.ts
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// src/services/BacklogClient.ts
import axios from "axios";
var BacklogClient = class {
  axiosInstance;
  config;
  constructor(config) {
    this.config = config;
    this.axiosInstance = axios.create({
      baseURL: `${config.baseUrl}/api/v2`,
      timeout: 3e4,
      params: {
        apiKey: config.apiKey
      }
    });
    this.axiosInstance.interceptors.request.use(
      (config2) => {
        return config2;
      },
      (error) => {
        console.error("Request error:", error);
        return Promise.reject(error);
      }
    );
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error("Response error:", error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }
  /**
   * Get project information by project key
   */
  async getProject() {
    try {
      const response = await this.axiosInstance.get(
        `/projects/${this.config.projectKey}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get project: ${error}`);
    }
  }
  /**
   * Get issue types for the project
   */
  async getIssueTypes() {
    try {
      const project = await this.getProject();
      const response = await this.axiosInstance.get(
        `/projects/${project.id}/issueTypes`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get issue types: ${error}`);
    }
  }
  /**
   * Get priorities (global, not project-specific)
   */
  async getPriorities() {
    try {
      const response = await this.axiosInstance.get(
        `/priorities`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get priorities: ${error}`);
    }
  }
  /**
   * Get list of issues for the project
   */
  async getIssues(params = {}) {
    try {
      const project = await this.getProject();
      const allIssues = [];
      let offset = 0;
      const limit = 100;
      while (true) {
        const queryParams = {
          projectId: [project.id],
          sort: "updated",
          order: "desc",
          count: limit,
          offset,
          ...params
        };
        const response = await this.axiosInstance.get(
          "/issues",
          { params: queryParams }
        );
        const issues = response.data;
        allIssues.push(...issues);
        if (issues.length < limit) {
          break;
        }
        offset += limit;
      }
      return allIssues;
    } catch (error) {
      throw new Error(`Failed to get issues: ${error}`);
    }
  }
  /**
   * Get a specific issue by issue key
   */
  async getIssue(issueKey) {
    try {
      const response = await this.axiosInstance.get(
        `/issues/${issueKey}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get issue ${issueKey}: ${error}`);
    }
  }
  /**
   * Create a new issue
   */
  async createIssue(issueData) {
    try {
      const createData = {
        projectId: (await this.getProject()).id,
        summary: issueData.summary,
        description: issueData.description || ""
      };
      if (issueData.issueTypeId) {
        createData.issueTypeId = issueData.issueTypeId;
      } else {
        const issueTypes = await this.getIssueTypes();
        const taskType = issueTypes.find((type) => type.name === "Task");
        if (taskType) {
          createData.issueTypeId = taskType.id;
        } else {
          createData.issueTypeId = issueTypes[0]?.id;
        }
      }
      if (issueData.priorityId) {
        createData.priorityId = issueData.priorityId;
      } else {
        const priorities = await this.getPriorities();
        const normalPriority = priorities.find((priority) => priority.name === "Normal");
        if (normalPriority) {
          createData.priorityId = normalPriority.id;
        } else {
          createData.priorityId = priorities[0]?.id;
        }
      }
      if (issueData.parentIssueId) {
        createData.parentIssueId = issueData.parentIssueId;
      }
      const response = await this.axiosInstance.post(
        "/issues",
        createData
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to create issue: ${error}`);
    }
  }
  /**
   * Update an existing issue
   */
  async updateIssue(issueKey, updates) {
    try {
      const updateData = {};
      if (!updates.summary && !updates.description) {
        throw new Error("No updates provided");
      }
      if (updates.summary) {
        updateData.summary = updates.summary;
      }
      if (updates.description !== void 0) {
        updateData.description = updates.description || "";
      }
      const response = await this.axiosInstance.patch(
        `/issues/${issueKey}`,
        updateData
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update issue ${issueKey}: ${error}`);
    }
  }
  /**
   * Get issues updated since a specific date
   */
  async getIssuesUpdatedSince(since) {
    const formattedDate = since.toISOString().split("T")[0];
    return this.getIssues({
      updatedSince: formattedDate,
      sort: "updated",
      order: "desc"
    });
  }
  /**
   * Test the connection and authentication
   */
  async testConnection() {
    try {
      await this.getProject();
      return true;
    } catch (error) {
      console.error("Connection test failed:", error);
      return false;
    }
  }
  /**
   * Get the base URL for creating issue links
   */
  getIssueUrl(issueKey) {
    return `${this.config.baseUrl}/view/${issueKey}`;
  }
  /**
   * Get project key
   */
  getProjectKey() {
    return this.config.projectKey;
  }
};

// src/services/TaskFileManager.ts
import { promises as fs } from "fs";
import * as path from "path";
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
var TaskFileManager = class {
  tasksDir;
  constructor(tasksDir = ".tasks") {
    if (path.isAbsolute(tasksDir)) {
      this.tasksDir = tasksDir;
    } else {
      this.tasksDir = path.resolve(process.cwd(), tasksDir);
    }
  }
  /**
   * Initialize the tasks directory and others subfolder
   */
  async initialize() {
    try {
      await ensureDir(this.tasksDir);
      await ensureDir(path.join(this.tasksDir, "others"));
    } catch (error) {
      throw new Error(`Failed to initialize tasks directory: ${error}`);
    }
  }
  /**
   * Find existing task file across all subfolders (including nested directories)
   */
  async findExistingTaskFile(issueKey) {
    try {
      return await this.searchTaskFileRecursively(this.tasksDir, issueKey);
    } catch (error) {
      return null;
    }
  }
  /**
   * Recursively search for a task file in a directory and its subdirectories
   */
  async searchTaskFileRecursively(dir, issueKey) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const found = await this.searchTaskFileRecursively(fullPath, issueKey);
          if (found) return found;
        } else if (entry.isFile() && entry.name === `${issueKey}.md`) {
          return fullPath;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }
  /**
   * Move a task file from one location to another
   */
  async moveTaskFile(issueKey, fromPath, toPath) {
    try {
      await ensureDir(path.dirname(toPath));
      const content = await fs.readFile(fromPath, "utf8");
      await fs.writeFile(toPath, content, "utf8");
      await fs.rm(fromPath);
      console.error(`Moved ${issueKey}: ${fromPath} \u2192 ${toPath}`);
    } catch (error) {
      console.error(`Failed to move ${issueKey} from ${fromPath} to ${toPath}:`, error);
    }
  }
  /**
   * Filter issues to exclude ignored issue types
   */
  filterIgnoredIssueTypes(issues, ignoreIssueTypes) {
    if (!ignoreIssueTypes || ignoreIssueTypes.length === 0) {
      return issues;
    }
    return issues.filter((issue) => !ignoreIssueTypes.includes(issue.issueType.name));
  }
  /**
   * Check if a folder name is a custom renamed parent folder (has suffix after issue key)
   */
  isCustomParentFolder(folderName) {
    const customParentPattern = /^[A-Z]+-\d+[-._].+/;
    return customParentPattern.test(folderName);
  }
  /**
   * Convert a Backlog issue to a task file
   */
  async issueToTaskFile(issue, baseUrl, allIssues = []) {
    const tags = [
      issue.issueType.name,
      issue.priority.name,
      issue.status.name,
      ...issue.category.map((cat) => cat.name),
      ...issue.versions.map((ver) => ver.name),
      ...issue.milestone.map((mil) => mil.name)
    ].filter((tag) => tag && tag.trim() !== "");
    return {
      issueKey: issue.issueKey,
      title: issue.summary,
      description: issue.description || "",
      status: issue.status.name,
      priority: issue.priority.name,
      assignee: issue.assignee?.name,
      created: issue.created,
      updated: issue.updated,
      dueDate: issue.dueDate,
      url: `${baseUrl}/view/${issue.issueKey}`,
      tags,
      filePath: ""
      // Will be set by caller
    };
  }
  /**
   * Generate markdown content for a task file
   */
  generateMarkdownContent(task) {
    let content = `# ${task.title}

`;
    if (task.description && task.description.trim() !== "") {
      content += task.description;
    }
    return content;
  }
  /**
   * Sync a single issue to a task file
   */
  async syncIssue(issue, baseUrl, allIssues = []) {
    try {
      const existingPath = await this.findExistingTaskFile(issue.issueKey);
      if (!existingPath) return;
      const task = await this.issueToTaskFile(issue, baseUrl, allIssues);
      task.filePath = existingPath;
      const markdownContent = this.generateMarkdownContent(task);
      await fs.writeFile(existingPath, markdownContent, "utf8");
    } catch (error) {
      throw new Error(`Failed to sync issue ${issue.issueKey}: ${error}`);
    }
  }
  /**
   * Match existing custom folders with their corresponding issues using tree structure
   */
  async matchCustomFoldersWithIssues(issueTreeMap) {
    const issueToFolderMap = /* @__PURE__ */ new Map();
    try {
      const existingFiles = await this.getExistingTaskFiles();
      for (const relativePath of existingFiles) {
        const fullPath = path.join(this.tasksDir, relativePath);
        const fileName = path.basename(fullPath, ".md");
        const folderPath = path.dirname(fullPath);
        if (fileName.match(/^[A-Z]+-\d+$/)) {
          issueToFolderMap.set(fileName, folderPath);
        }
      }
      for (const [issueKey, treeNode] of issueTreeMap) {
        if (issueToFolderMap.has(issueKey)) continue;
        const { issue, parent, children } = treeNode;
        if (parent) {
          let parentFolder = issueToFolderMap.get(parent.issueKey);
          if (!parentFolder) {
            const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory() && entry.name.startsWith(`${parent.issueKey}-`)) {
                parentFolder = path.join(this.tasksDir, entry.name);
                issueToFolderMap.set(parent.issueKey, parentFolder);
                break;
              }
            }
          }
          if (parentFolder) {
            issueToFolderMap.set(issueKey, parentFolder);
          } else {
            issueToFolderMap.set(issueKey, path.join(this.tasksDir, "others"));
          }
        } else if (children.length > 0) {
          let parentFolder;
          const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith(`${issueKey}-`)) {
              parentFolder = path.join(this.tasksDir, entry.name);
              break;
            }
          }
          if (!parentFolder) {
            parentFolder = path.join(this.tasksDir, issueKey);
          }
          issueToFolderMap.set(issueKey, parentFolder);
          for (const child of children) {
            if (!issueToFolderMap.has(child.issueKey)) {
              issueToFolderMap.set(child.issueKey, parentFolder);
            }
          }
        } else {
          issueToFolderMap.set(issueKey, path.join(this.tasksDir, "others"));
        }
      }
    } catch (error) {
      console.error("Error matching custom folders:", error);
    }
    return issueToFolderMap;
  }
  /**
   * Save the last sync timestamp and issue ID to key mappings to a file
   */
  async saveLastSyncTime(timestamp, issues = []) {
    try {
      const lastSyncFile = path.join(this.tasksDir, ".last-sync");
      const idToKeyMap = {};
      issues.forEach((issue) => {
        idToKeyMap[issue.id] = issue.issueKey;
      });
      const syncData = {
        timestamp,
        idToKeyMap
      };
      await fs.writeFile(lastSyncFile, JSON.stringify(syncData, null, 2), "utf8");
    } catch (error) {
      console.error("Failed to save last sync time:", error);
    }
  }
  /**
   * Load the last sync timestamp and issue ID to key mappings from file
   */
  async getLastSyncData() {
    try {
      const lastSyncFile = path.join(this.tasksDir, ".last-sync");
      const content = await fs.readFile(lastSyncFile, "utf8");
      try {
        const syncData = JSON.parse(content);
        if (typeof syncData === "string") {
          return {
            timestamp: syncData.trim(),
            idToKeyMap: {}
          };
        } else if (syncData && typeof syncData === "object") {
          return {
            timestamp: syncData.timestamp || null,
            idToKeyMap: syncData.idToKeyMap || {}
          };
        }
      } catch (parseError) {
        return {
          timestamp: content.trim(),
          idToKeyMap: {}
        };
      }
      return { timestamp: null, idToKeyMap: {} };
    } catch (error) {
      return { timestamp: null, idToKeyMap: {} };
    }
  }
  /**
   * Get the last sync timestamp only (for backward compatibility)
   */
  async getLastSyncTime() {
    const { timestamp } = await this.getLastSyncData();
    return timestamp;
  }
  /**
   * Get the tasks directory path
   */
  getTasksDirectory() {
    return this.tasksDir;
  }
  /**
   * Build a complete issue tree map with all issues and their relationships using ID to key mapping
   */
  buildIssueTreeMap(issues, idToKeyMap) {
    const issueMap = /* @__PURE__ */ new Map();
    const treeMap = /* @__PURE__ */ new Map();
    issues.forEach((issue) => {
      issueMap.set(issue.id, issue);
    });
    issues.forEach((issue) => {
      let parent;
      if (issue.parentIssueId) {
        parent = issueMap.get(issue.parentIssueId);
        if (!parent && idToKeyMap[issue.parentIssueId]) {
          const parentKey = idToKeyMap[issue.parentIssueId];
          parent = {
            id: issue.parentIssueId,
            issueKey: parentKey,
            // Add other required fields with defaults
            projectId: issue.projectId,
            keyId: 0,
            issueType: issue.issueType,
            summary: `Parent Issue ${parentKey}`,
            description: "",
            priority: issue.priority,
            status: issue.status,
            category: [],
            versions: [],
            milestone: [],
            createdUser: issue.createdUser,
            created: issue.created,
            customFields: [],
            attachments: [],
            sharedFiles: [],
            stars: []
          };
        }
      }
      const children = issues.filter((child) => child.parentIssueId === issue.id);
      treeMap.set(issue.issueKey, {
        issue,
        parent,
        children
      });
    });
    return treeMap;
  }
  /**
   * Sync multiple issues to task files with complete tree organization using ID mapping
   */
  async syncIssues(issues, baseUrl, ignoreIssueTypes) {
    const filteredIssues = this.filterIgnoredIssueTypes(issues, ignoreIssueTypes);
    if (filteredIssues.length < issues.length) {
      const ignoredCount = issues.length - filteredIssues.length;
      console.error(`Filtered out ${ignoredCount} issues with ignored types: ${ignoreIssueTypes?.join(", ")}`);
    }
    const { idToKeyMap } = await this.getLastSyncData();
    const issueTreeMap = this.buildIssueTreeMap(filteredIssues, idToKeyMap);
    const issueToFolderMap = await this.matchCustomFoldersWithIssues(issueTreeMap);
    let recoveredCount = 0;
    for (const issue of filteredIssues) {
      const existingPath = await this.findExistingTaskFile(issue.issueKey);
      const targetFolder = issueToFolderMap.get(issue.issueKey) || path.join(this.tasksDir, "others");
      const targetPath = path.join(targetFolder, `${issue.issueKey}.md`);
      if (!existingPath) {
        await ensureDir(targetFolder);
        const task = await this.issueToTaskFile(issue, baseUrl, filteredIssues);
        task.filePath = targetPath;
        const markdownContent = this.generateMarkdownContent(task);
        await fs.writeFile(targetPath, markdownContent, "utf8");
        recoveredCount++;
        console.error(`Recovered missing file: ${issue.issueKey}.md in ${path.basename(targetFolder)}/`);
      } else if (path.dirname(existingPath) !== targetFolder) {
        await this.moveTaskFile(issue.issueKey, existingPath, targetPath);
      } else {
        await this.syncIssue(issue, baseUrl, filteredIssues);
      }
    }
    if (recoveredCount > 0) {
      console.error(`Recovered ${recoveredCount} missing task files`);
    }
  }
  /**
   * Get list of existing task files across all subfolders (including nested directories)
   */
  async getExistingTaskFiles() {
    try {
      const allFiles = [];
      await this.collectTaskFilesRecursively(this.tasksDir, "", allFiles);
      return allFiles;
    } catch (error) {
      return [];
    }
  }
  /**
   * Recursively collect task files from a directory and its subdirectories
   */
  async collectTaskFilesRecursively(dir, relativePath, allFiles) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativeFilePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await this.collectTaskFilesRecursively(fullPath, relativeFilePath, allFiles);
        } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name.match(/^[A-Z]+-\d+\.md$/)) {
          allFiles.push(relativeFilePath);
        }
      }
    } catch (error) {
    }
  }
  /**
   * Check if a task file exists for an issue (search across all subfolders)
   */
  async taskFileExists(issueKey) {
    const existingPath = await this.findExistingTaskFile(issueKey);
    return existingPath !== null;
  }
  /**
   * Remove a task file (search across all subfolders)
   */
  async removeTaskFile(issueKey) {
    try {
      const existingPath = await this.findExistingTaskFile(issueKey);
      if (existingPath) {
        await fs.rm(existingPath);
      }
    } catch (error) {
      console.error(`Failed to remove task file for ${issueKey}:`, error);
    }
  }
  /**
   * Clean up task files for issues that no longer exist
   */
  async cleanupRemovedIssues(currentIssueKeys) {
    try {
      const existingFiles = await this.getExistingTaskFiles();
      const existingIssueKeys = existingFiles.map((file) => path.basename(file, ".md"));
      const removedIssueKeys = existingIssueKeys.filter(
        (key) => !currentIssueKeys.includes(key)
      );
      for (const issueKey of removedIssueKeys) {
        await this.removeTaskFile(issueKey);
      }
    } catch (error) {
      console.error("Failed to cleanup removed issues:", error);
    }
  }
  /**
   * Read and parse a task file to extract title and description
   */
  async readTaskFile(issueKey) {
    try {
      const taskFilePath = await this.findExistingTaskFile(issueKey);
      if (!taskFilePath) {
        return null;
      }
      const content = await fs.readFile(taskFilePath, "utf8");
      const lines = content.split("\n");
      const titleLine = lines.find((line) => line.startsWith("# "));
      const title = titleLine ? titleLine.replace("# ", "").trim() : "";
      const titleIndex = lines.findIndex((line) => line.startsWith("# "));
      let description = "";
      if (titleIndex !== -1) {
        const descriptionLines = lines.slice(titleIndex + 1);
        description = descriptionLines.join("\n").trim();
      }
      return { title, description };
    } catch (error) {
      console.error(`Failed to read task file for ${issueKey}:`, error);
      return null;
    }
  }
  /**
   * Find all parent task folders (folders with pattern PARENT-{number})
   */
  async findParentTaskFolders() {
    try {
      const parentFolders = [];
      const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const parentPattern = /^[A-Z]+-\d+$/;
          if (parentPattern.test(entry.name)) {
            parentFolders.push(entry.name);
          }
        }
      }
      return parentFolders;
    } catch (error) {
      console.error("Failed to find parent task folders:", error);
      return [];
    }
  }
  /**
   * Find temporary task files in a parent folder (files with pattern PARENT-{number}-{random})
   */
  async findTemporaryTaskFiles(parentFolder) {
    try {
      const parentFolderPath = path.join(this.tasksDir, parentFolder);
      const entries = await fs.readdir(parentFolderPath, { withFileTypes: true });
      const tempFiles = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const fileName = entry.name.replace(".md", "");
          const tempPattern = new RegExp(`^${parentFolder}-\\d+$`);
          if (tempPattern.test(fileName)) {
            const filePath = path.join(parentFolderPath, entry.name);
            const content = await fs.readFile(filePath, "utf8");
            const lines = content.split("\n");
            const titleLine = lines.find((line) => line.startsWith("# "));
            const title = titleLine ? titleLine.replace("# ", "").trim() : "";
            const titleIndex = lines.findIndex((line) => line.startsWith("# "));
            let description = "";
            if (titleIndex !== -1) {
              const descriptionLines = lines.slice(titleIndex + 1);
              description = descriptionLines.join("\n").trim();
            }
            tempFiles.push({
              fileName,
              filePath,
              content: { title, description }
            });
          }
        }
      }
      return tempFiles;
    } catch (error) {
      console.error(`Failed to find temporary task files in ${parentFolder}:`, error);
      return [];
    }
  }
  /**
   * Rename a task file from temporary name to real issue key
   */
  async renameTaskFile(oldFilePath, newIssueKey) {
    try {
      const newFilePath = path.join(path.dirname(oldFilePath), `${newIssueKey}.md`);
      await fs.rename(oldFilePath, newFilePath);
    } catch (error) {
      throw new Error(`Failed to rename task file from ${oldFilePath} to ${newIssueKey}: ${error}`);
    }
  }
  /**
   * Create a task file with the correct issue key and content
   */
  async createTaskFile(issueKey, parentFolder, title, description, baseUrl) {
    try {
      const parentFolderPath = path.join(this.tasksDir, parentFolder);
      const filePath = path.join(parentFolderPath, `${issueKey}.md`);
      await ensureDir(parentFolderPath);
      let content = `# ${title}

`;
      if (description && description.trim() !== "") {
        content += description;
      }
      await fs.writeFile(filePath, content, "utf8");
    } catch (error) {
      throw new Error(`Failed to create task file for ${issueKey}: ${error}`);
    }
  }
};

// src/server.ts
var BacklogMcpServer = class {
  server;
  backlogClient = null;
  taskManager;
  config;
  constructor(config) {
    this.server = new McpServer({
      name: "backlog-mcp",
      version: "1.0.0"
    });
    this.config = config;
    this.taskManager = new TaskFileManager(config?.tasksDir || ".tasks");
    this.setupTools();
    this.setupResources();
  }
  setupTools() {
    this.server.registerTool(
      "sync-issues",
      {
        title: "Sync Backlog Issues",
        description: "Sync issues from Backlog to local .tasks folder",
        inputSchema: {}
      },
      async () => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: "text",
                text: "Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided."
              }],
              isError: true
            };
          }
          const config = {
            apiKey: this.config.apiKey,
            baseUrl: this.config.baseUrl,
            projectKey: this.config.projectKey
          };
          this.backlogClient = new BacklogClient(config);
          const isConnected = await this.backlogClient.testConnection();
          if (!isConnected) {
            return {
              content: [{
                type: "text",
                text: "Failed to connect to Backlog. Please check your API key and base URL."
              }]
            };
          }
          await this.taskManager.initialize();
          const lastSyncTime = await this.taskManager.getLastSyncTime();
          const currentSyncTime = (/* @__PURE__ */ new Date()).toISOString();
          let issues;
          let syncMessage = "";
          if (lastSyncTime) {
            const sinceDate = new Date(lastSyncTime);
            issues = await this.backlogClient.getIssuesUpdatedSince(sinceDate);
            syncMessage = `Synced ${issues.length} issues updated since ${new Date(lastSyncTime).toLocaleString()}`;
          } else {
            issues = await this.backlogClient.getIssues();
            syncMessage = `Synced ${issues.length} issues (full sync - first time)`;
          }
          await this.taskManager.syncIssues(issues, this.config.baseUrl, this.config.ignoreIssueTypes);
          if (!lastSyncTime) {
            const currentIssueKeys = issues.map((issue) => issue.issueKey);
            await this.taskManager.cleanupRemovedIssues(currentIssueKeys);
          }
          await this.taskManager.saveLastSyncTime(currentSyncTime, issues);
          let message = `\u2705 ${syncMessage}`;
          if (this.config.ignoreIssueTypes && this.config.ignoreIssueTypes.length > 0) {
            message += `
Ignored issue types: ${this.config.ignoreIssueTypes.join(", ")}`;
          }
          message += `
Saved to: ${this.taskManager.getTasksDirectory()}`;
          message += `
Next sync will check for updates since: ${new Date(currentSyncTime).toLocaleString()}`;
          return {
            content: [{
              type: "text",
              text: message
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error syncing issues: ${error}`
            }],
            isError: true
          };
        }
      }
    );
    this.server.registerTool(
      "get-issue",
      {
        title: "Get Backlog Issue",
        description: "Get details of a specific Backlog issue",
        inputSchema: {
          issueKey: z.string().describe("Issue key (e.g., PROJ-123)")
        }
      },
      async ({ issueKey }) => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: "text",
                text: "Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided."
              }],
              isError: true
            };
          }
          const config = {
            apiKey: this.config.apiKey,
            baseUrl: this.config.baseUrl,
            projectKey: this.config.projectKey
          };
          const client = new BacklogClient(config);
          const issue = await client.getIssue(issueKey);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(issue, null, 2)
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error getting issue: ${error}`
            }],
            isError: true
          };
        }
      }
    );
    this.server.registerTool(
      "test-connection",
      {
        title: "Test Backlog Connection",
        description: "Test connection to Backlog API",
        inputSchema: {}
      },
      async () => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: "text",
                text: "Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided."
              }],
              isError: true
            };
          }
          const config = {
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
                type: "text",
                text: `\u2705 Successfully connected to Backlog!
Project: ${project.name} (${project.projectKey})`
              }]
            };
          } else {
            return {
              content: [{
                type: "text",
                text: "\u274C Failed to connect to Backlog. Please check your credentials."
              }],
              isError: true
            };
          }
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `\u274C Connection test failed: ${error}`
            }],
            isError: true
          };
        }
      }
    );
    this.server.registerTool(
      "update-issues",
      {
        title: "Update Backlog Issues",
        description: "Update Backlog issues with changes from local task files",
        inputSchema: {
          issueKeys: z.array(z.string()).describe('Array of issue keys (e.g., ["PROJ-123", "PROJ-124"])')
        }
      },
      async ({ issueKeys }) => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: "text",
                text: "Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided."
              }],
              isError: true
            };
          }
          if (!issueKeys || issueKeys.length === 0) {
            return {
              content: [{
                type: "text",
                text: "\u274C No issue keys provided. Please specify at least one issue key."
              }],
              isError: true
            };
          }
          const config = {
            apiKey: this.config.apiKey,
            baseUrl: this.config.baseUrl,
            projectKey: this.config.projectKey
          };
          const client = new BacklogClient(config);
          const results = [];
          let successCount = 0;
          let errorCount = 0;
          for (const issueKey of issueKeys) {
            try {
              const taskData = await this.taskManager.readTaskFile(issueKey);
              if (!taskData) {
                results.push(`\u274C ${issueKey}: Local task file not found`);
                errorCount++;
                continue;
              }
              let originalIssue;
              try {
                originalIssue = await client.getIssue(issueKey);
              } catch (error) {
                results.push(`\u274C ${issueKey}: Failed to fetch from Backlog`);
                errorCount++;
                continue;
              }
              const changes = {};
              let changesList = [];
              if (taskData.title && taskData.title !== originalIssue.summary) {
                changes.summary = taskData.title;
                changesList.push(`Title updated`);
              }
              const localDesc = taskData.description || "";
              const backlogDesc = originalIssue.description || "";
              if (localDesc !== backlogDesc) {
                if (!localDesc && backlogDesc) {
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
              if (Object.keys(changes).length === 0) {
                results.push(`\u23ED\uFE0F  ${issueKey}: No changes detected`);
                continue;
              }
              await client.updateIssue(issueKey, changes);
              results.push(`\u2705 ${issueKey}: ${changesList.join(", ")}`);
              successCount++;
            } catch (error) {
              results.push(`\u274C ${issueKey}: Update failed - ${error}`);
              errorCount++;
            }
          }
          const summary = `\u{1F4CA} Summary: ${successCount} updated, ${errorCount} errors, ${issueKeys.length - successCount - errorCount} skipped`;
          return {
            content: [{
              type: "text",
              text: `${summary}

${results.join("\n")}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `\u274C Failed to update issues: ${error}`
            }],
            isError: true
          };
        }
      }
    );
    this.server.registerTool(
      "list-task-files",
      {
        title: "List Task Files",
        description: "List existing task files in .tasks directory",
        inputSchema: {}
      },
      async () => {
        try {
          const taskFiles = await this.taskManager.getExistingTaskFiles();
          const tasksDir = this.taskManager.getTasksDirectory();
          if (taskFiles.length === 0) {
            return {
              content: [{
                type: "text",
                text: `No task files found in ${tasksDir}`
              }]
            };
          }
          return {
            content: [{
              type: "text",
              text: `Found ${taskFiles.length} task files in ${tasksDir}:
${taskFiles.map((file) => `- ${file}`).join("\n")}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Error listing task files: ${error}`
            }],
            isError: true
          };
        }
      }
    );
    this.server.registerTool(
      "bulk-create-tasks",
      {
        title: "Bulk Create Tasks",
        description: "Create Backlog issues from local temporary task files in parent folders",
        inputSchema: {}
      },
      async () => {
        try {
          if (!this.config) {
            return {
              content: [{
                type: "text",
                text: "Server configuration not found. Please ensure apiKey, baseUrl, and projectKey are provided."
              }],
              isError: true
            };
          }
          const config = {
            apiKey: this.config.apiKey,
            baseUrl: this.config.baseUrl,
            projectKey: this.config.projectKey
          };
          this.backlogClient = new BacklogClient(config);
          const isConnected = await this.backlogClient.testConnection();
          if (!isConnected) {
            return {
              content: [{
                type: "text",
                text: "Failed to connect to Backlog. Please check your API key and base URL."
              }],
              isError: true
            };
          }
          await this.taskManager.initialize();
          const parentFolders = await this.taskManager.findParentTaskFolders();
          if (parentFolders.length === 0) {
            return {
              content: [{
                type: "text",
                text: "No parent task folders found. Parent folders should follow the pattern PARENT-{number} (e.g., SBK-2)."
              }]
            };
          }
          const results = [];
          let totalCreated = 0;
          let totalErrors = 0;
          for (const parentFolder of parentFolders) {
            results.push(`
\u{1F4C1} Processing parent folder: ${parentFolder}`);
            const tempFiles = await this.taskManager.findTemporaryTaskFiles(parentFolder);
            if (tempFiles.length === 0) {
              results.push(`  \u23ED\uFE0F  No temporary task files found in ${parentFolder}`);
              continue;
            }
            results.push(`  \u{1F4C4} Found ${tempFiles.length} temporary task files`);
            let parentIssueId;
            try {
              const parentIssue = await this.backlogClient.getIssue(parentFolder);
              parentIssueId = parentIssue.id;
              results.push(`  \u{1F517} Found parent issue: ${parentIssue.summary} (ID: ${parentIssueId})`);
            } catch (error) {
              results.push(`  \u26A0\uFE0F  Parent issue ${parentFolder} not found in Backlog, creating as standalone issues`);
            }
            for (const tempFile of tempFiles) {
              try {
                const { fileName, filePath, content } = tempFile;
                const issueData = {
                  summary: content.title || `Task from ${fileName}`,
                  description: content.description || "",
                  parentIssueId
                };
                const createdIssue = await this.backlogClient.createIssue(issueData);
                await this.taskManager.renameTaskFile(filePath, createdIssue.issueKey);
                await this.taskManager.createTaskFile(
                  createdIssue.issueKey,
                  parentFolder,
                  content.title || createdIssue.summary,
                  content.description || createdIssue.description || "",
                  this.config.baseUrl
                );
                results.push(`  \u2705 Created ${createdIssue.issueKey}: ${createdIssue.summary}`);
                totalCreated++;
              } catch (error) {
                results.push(`  \u274C Failed to create issue for ${tempFile.fileName}: ${error}`);
                totalErrors++;
              }
            }
          }
          const summary = `
\u{1F4CA} Summary: ${totalCreated} issues created, ${totalErrors} errors`;
          return {
            content: [{
              type: "text",
              text: `\u{1F680} Bulk Create Tasks Complete${summary}

${results.join("\n")}`
            }]
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `\u274C Failed to bulk create tasks: ${error}`
            }],
            isError: true
          };
        }
      }
    );
  }
  setupResources() {
    this.server.registerResource(
      "task-file",
      new ResourceTemplate("task://{issueKey}", { list: void 0 }),
      {
        title: "Task File",
        description: "Access task files by issue key",
        mimeType: "text/markdown"
      },
      async (uri, { issueKey }) => {
        try {
          const key = Array.isArray(issueKey) ? issueKey[0] : issueKey;
          const filePath = `${this.taskManager.getTasksDirectory()}/${key}.md`;
          const exists = await this.taskManager.taskFileExists(key);
          if (!exists) {
            throw new Error(`Task file for ${key} not found`);
          }
          return {
            contents: [{
              uri: uri.href,
              text: `Task file for ${issueKey} located at ${filePath}`,
              mimeType: "text/markdown"
            }]
          };
        } catch (error) {
          throw new Error(`Failed to read task file: ${error}`);
        }
      }
    );
    this.server.registerResource(
      "tasks-directory",
      "tasks://directory",
      {
        title: "Tasks Directory",
        description: "List all task files in the .tasks directory",
        mimeType: "text/plain"
      },
      async (uri) => {
        try {
          const taskFiles = await this.taskManager.getExistingTaskFiles();
          const tasksDir = this.taskManager.getTasksDirectory();
          const content = taskFiles.length > 0 ? `Tasks directory: ${tasksDir}

Task files:
${taskFiles.map((file) => `- ${file}`).join("\n")}` : `Tasks directory: ${tasksDir}

No task files found.`;
          return {
            contents: [{
              uri: uri.href,
              text: content,
              mimeType: "text/plain"
            }]
          };
        } catch (error) {
          throw new Error(`Failed to list tasks directory: ${error}`);
        }
      }
    );
  }
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
};

// src/utils/config.ts
import * as fs2 from "fs-extra";
import * as path2 from "path";
async function loadConfig() {
  const configPath = path2.resolve("config.json");
  if (await fs2.pathExists(configPath)) {
    try {
      const configData = await fs2.readJson(configPath);
      return {
        apiKey: configData.apiKey,
        baseUrl: configData.baseUrl,
        projectKey: configData.projectKey,
        tasksDir: configData.tasksDir || ".tasks",
        ignoreIssueTypes: configData.ignoreIssueTypes || []
      };
    } catch (error) {
      console.warn("Failed to load config.json, falling back to environment variables");
    }
  }
  const apiKey = process.env.BACKLOG_API_KEY;
  const baseUrl = process.env.BACKLOG_BASE_URL;
  const projectKey = process.env.BACKLOG_PROJECT_KEY;
  const tasksDir = process.env.BACKLOG_TASKS_DIR || process.env.TASKS_DIR || ".tasks";
  const ignoreIssueTypes = process.env.BACKLOG_IGNORE_ISSUE_TYPES ? process.env.BACKLOG_IGNORE_ISSUE_TYPES.split(",").map((t) => t.trim()) : [];
  if (!apiKey || !baseUrl || !projectKey) {
    throw new Error(
      "Missing required configuration. Please provide either:\n1. A config.json file with apiKey, baseUrl, and projectKey\n2. Environment variables: BACKLOG_API_KEY, BACKLOG_BASE_URL, BACKLOG_PROJECT_KEY\nOptional environment variables: BACKLOG_TASKS_DIR, BACKLOG_IGNORE_ISSUE_TYPES"
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

// src/index.ts
async function main() {
  try {
    const config = await loadConfig();
    const server = new BacklogMcpServer(config);
    await server.start();
  } catch (error) {
    console.error("Failed to start Backlog MCP server:", error);
  }
}
main().catch(console.error);
//# sourceMappingURL=index.js.map