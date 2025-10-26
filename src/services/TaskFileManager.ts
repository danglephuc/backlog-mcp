import { promises as fs } from 'fs';
import * as path from 'path';
import { BacklogIssue } from '../types/backlog.js';

// Helper to ensure a directory exists (like fs-extra's ensureDir)
async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export interface TaskFile {
  issueKey: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignee?: string;
  created: string;
  updated?: string;
  dueDate?: string;
  url: string;
  tags: string[];
  filePath: string;
}

export class TaskFileManager {
  private tasksDir: string;

  constructor(tasksDir: string = '.tasks') {
    // For relative paths, resolve relative to current working directory (project root)
    // For absolute paths, use as-is
    if (path.isAbsolute(tasksDir)) {
      this.tasksDir = tasksDir;
    } else {
      // Use process.cwd() to ensure it's relative to the client's working directory
      this.tasksDir = path.resolve(process.cwd(), tasksDir);
    }
  }

  /**
   * Initialize the tasks directory and others subfolder
   */
  async initialize(): Promise<void> {
    try {
      await ensureDir(this.tasksDir);
      await ensureDir(path.join(this.tasksDir, 'others'));
    } catch (error) {
      throw new Error(`Failed to initialize tasks directory: ${error}`);
    }
  }

  /**
   * Find existing task file across all subfolders (including nested directories)
   */
  async findExistingTaskFile(issueKey: string): Promise<string | null> {
    try {
      return await this.searchTaskFileRecursively(this.tasksDir, issueKey);
    } catch (error) {
      return null;
    }
  }

  /**
   * Recursively search for a task file in a directory and its subdirectories
   */
  private async searchTaskFileRecursively(dir: string, issueKey: string): Promise<string | null> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Recursively search in subdirectories
          const found = await this.searchTaskFileRecursively(fullPath, issueKey);
          if (found) return found;
        } else if (entry.isFile() && entry.name === `${issueKey}.md`) {
          // Found the task file
          return fullPath;
        }
      }
      
      return null; // Not found in this directory or its subdirectories
    } catch (error) {
      // Skip directories that can't be read
      return null;
    }
  }

  /**
   * Move a task file from one location to another
   */
  private async moveTaskFile(issueKey: string, fromPath: string, toPath: string): Promise<void> {
    try {
      // Ensure target directory exists
      await ensureDir(path.dirname(toPath));
      
      // Copy the file content
      const content = await fs.readFile(fromPath, 'utf8');
      await fs.writeFile(toPath, content, 'utf8');
      
      // Remove old file
      await fs.rm(fromPath);
      
      console.error(`Moved ${issueKey}: ${fromPath} → ${toPath}`);
    } catch (error) {
      console.error(`Failed to move ${issueKey} from ${fromPath} to ${toPath}:`, error);
    }
  }

  /**
   * Filter issues to exclude ignored issue types
   */
  private filterIgnoredIssueTypes(issues: BacklogIssue[], ignoreIssueTypes?: string[]): BacklogIssue[] {
    if (!ignoreIssueTypes || ignoreIssueTypes.length === 0) {
      return issues;
    }
    
    return issues.filter(issue => !ignoreIssueTypes.includes(issue.issueType.name));
  }

  /**
   * Check if a folder name is a custom renamed parent folder (has suffix after issue key)
   */
  private isCustomParentFolder(folderName: string): boolean {
    // Match pattern: PROJ-123-something or PROJ-123.something or PROJ-123_something
    const customParentPattern = /^[A-Z]+-\d+[-._].+/;
    return customParentPattern.test(folderName);
  }

  /**
   * Convert a Backlog issue to a task file
   */
  async issueToTaskFile(issue: BacklogIssue, baseUrl: string, allIssues: BacklogIssue[] = []): Promise<TaskFile> {
    const tags = [
      issue.issueType.name,
      issue.priority.name,
      issue.status.name,
      ...issue.category.map(cat => cat.name),
      ...issue.versions.map(ver => ver.name),
      ...issue.milestone.map(mil => mil.name)
    ].filter(tag => tag && tag.trim() !== '');

    return {
      issueKey: issue.issueKey,
      title: issue.summary,
      description: issue.description || '',
      status: issue.status.name,
      priority: issue.priority.name,
      assignee: issue.assignee?.name,
      created: issue.created,
      updated: issue.updated,
      dueDate: issue.dueDate,
      url: `${baseUrl}/view/${issue.issueKey}`,
      tags,
      filePath: '' // Will be set by caller
    };
  }

  /**
   * Generate markdown content for a task file
   */
  private generateMarkdownContent(task: TaskFile): string {
    let content = `# ${task.title}\n\n`;
    
    // Add description directly (everything after title)
    if (task.description && task.description.trim() !== '') {
      content += task.description;
    }
    
    return content;
  }

  /**
   * Sync a single issue to a task file
   */
  async syncIssue(issue: BacklogIssue, baseUrl: string, allIssues: BacklogIssue[] = []): Promise<void> {
    try {
      // Find existing file location
      const existingPath = await this.findExistingTaskFile(issue.issueKey);
      if (!existingPath) return; // File doesn't exist, will be handled by recovery

      const task = await this.issueToTaskFile(issue, baseUrl, allIssues);
      task.filePath = existingPath; // Use existing location
      const markdownContent = this.generateMarkdownContent(task);
      
      await fs.writeFile(existingPath, markdownContent, 'utf8');
    } catch (error) {
      throw new Error(`Failed to sync issue ${issue.issueKey}: ${error}`);
    }
  }

  /**
   * Match existing custom folders with their corresponding issues using tree structure
   */
  private async matchCustomFoldersWithIssues(issueTreeMap: Map<string, { issue: BacklogIssue, parent?: BacklogIssue, children: BacklogIssue[] }>): Promise<Map<string, string>> {
    const issueToFolderMap = new Map<string, string>();
    
    try {
      // First, scan for existing files and their folders
      const existingFiles = await this.getExistingTaskFiles();
      
      for (const relativePath of existingFiles) {
        const fullPath = path.join(this.tasksDir, relativePath);
        const fileName = path.basename(fullPath, '.md');
        const folderPath = path.dirname(fullPath);
        
        if (fileName.match(/^[A-Z]+-\d+$/)) {
          issueToFolderMap.set(fileName, folderPath);
        }
      }
      
      // Then, handle issues without existing files using tree relationships
      for (const [issueKey, treeNode] of issueTreeMap) {
        if (issueToFolderMap.has(issueKey)) continue; // Already has a location
        
        const { issue, parent, children } = treeNode;
        
        if (parent) {
          // This is a child issue - try to find parent's folder
          let parentFolder = issueToFolderMap.get(parent.issueKey);
          
          if (!parentFolder) {
            // Parent folder not found by exact match, search for custom parent folders
            const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory() && entry.name.startsWith(`${parent.issueKey}-`)) {
                parentFolder = path.join(this.tasksDir, entry.name);
                issueToFolderMap.set(parent.issueKey, parentFolder); // Cache for future use
                break;
              }
            }
          }
          
          if (parentFolder) {
            issueToFolderMap.set(issueKey, parentFolder);
          } else {
            // Parent folder not found, use others
            issueToFolderMap.set(issueKey, path.join(this.tasksDir, 'others'));
          }
        } else if (children.length > 0) {
          // This is a parent issue - check if any children have existing folders that match this parent
          let parentFolder: string | undefined;
          
          // Check if there's already a custom folder for this parent
          const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.startsWith(`${issueKey}-`)) {
              parentFolder = path.join(this.tasksDir, entry.name);
              break;
            }
          }
          
          if (!parentFolder) {
            // Create default parent folder
            parentFolder = path.join(this.tasksDir, issueKey);
          }
          
          issueToFolderMap.set(issueKey, parentFolder);
          
          // Also assign all children to the same folder
          for (const child of children) {
            if (!issueToFolderMap.has(child.issueKey)) {
              issueToFolderMap.set(child.issueKey, parentFolder);
            }
          }
        } else {
          // Standalone issue
          issueToFolderMap.set(issueKey, path.join(this.tasksDir, 'others'));
        }
      }
      
    } catch (error) {
      console.error('Error matching custom folders:', error);
    }
    
    return issueToFolderMap;
  }

  /**
   * Save the last sync timestamp and issue ID to key mappings to a file
   */
  async saveLastSyncTime(timestamp: string, issues: BacklogIssue[] = []): Promise<void> {
    try {
      const lastSyncFile = path.join(this.tasksDir, '.last-sync');
      
      // Create ID to key mapping from current issues
      const idToKeyMap: { [id: number]: string } = {};
      issues.forEach(issue => {
        idToKeyMap[issue.id] = issue.issueKey;
      });
      
      const syncData = {
        timestamp,
        idToKeyMap
      };
      
      await fs.writeFile(lastSyncFile, JSON.stringify(syncData, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save last sync time:', error);
    }
  }

  /**
   * Load the last sync timestamp and issue ID to key mappings from file
   */
  async getLastSyncData(): Promise<{ timestamp: string | null, idToKeyMap: { [id: number]: string } }> {
    try {
      const lastSyncFile = path.join(this.tasksDir, '.last-sync');
      const content = await fs.readFile(lastSyncFile, 'utf8');
      
      try {
        const syncData = JSON.parse(content);
        
        // Handle both old format (just timestamp) and new format (object with timestamp and mapping)
        if (typeof syncData === 'string') {
          // Old format - just timestamp
          return {
            timestamp: syncData.trim(),
            idToKeyMap: {}
          };
        } else if (syncData && typeof syncData === 'object') {
          // New format - object with timestamp and mapping
          return {
            timestamp: syncData.timestamp || null,
            idToKeyMap: syncData.idToKeyMap || {}
          };
        }
      } catch (parseError) {
        // File exists but invalid JSON, treat as old format
        return {
          timestamp: content.trim(),
          idToKeyMap: {}
        };
      }
      
      return { timestamp: null, idToKeyMap: {} };
    } catch (error) {
      // File doesn't exist or can't be read
      return { timestamp: null, idToKeyMap: {} };
    }
  }

  /**
   * Get the last sync timestamp only (for backward compatibility)
   */
  async getLastSyncTime(): Promise<string | null> {
    const { timestamp } = await this.getLastSyncData();
    return timestamp;
  }

  /**
   * Get the tasks directory path
   */
  getTasksDirectory(): string {
    return this.tasksDir;
  }

  /**
   * Build a complete issue tree map with all issues and their relationships using ID to key mapping
   */
  private buildIssueTreeMap(issues: BacklogIssue[], idToKeyMap: { [id: number]: string }): Map<string, { issue: BacklogIssue, parent?: BacklogIssue, children: BacklogIssue[] }> {
    const issueMap = new Map<number, BacklogIssue>();
    const treeMap = new Map<string, { issue: BacklogIssue, parent?: BacklogIssue, children: BacklogIssue[] }>();
    
    // Create lookup map with current issues
    issues.forEach(issue => {
      issueMap.set(issue.id, issue);
    });
    
    // Build tree structure
    issues.forEach(issue => {
      let parent: BacklogIssue | undefined;
      
      if (issue.parentIssueId) {
        // First try to find parent in current issues
        parent = issueMap.get(issue.parentIssueId);
        
        // If not found in current issues, check if we have the key from previous sync
        if (!parent && idToKeyMap[issue.parentIssueId]) {
          const parentKey = idToKeyMap[issue.parentIssueId];
          // Create a minimal parent object for reference
          parent = {
            id: issue.parentIssueId,
            issueKey: parentKey,
            // Add other required fields with defaults
            projectId: issue.projectId,
            keyId: 0,
            issueType: issue.issueType,
            summary: `Parent Issue ${parentKey}`,
            description: '',
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
          } as BacklogIssue;
        }
      }
      
      const children = issues.filter(child => child.parentIssueId === issue.id);
      
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
  async syncIssues(issues: BacklogIssue[], baseUrl: string, ignoreIssueTypes?: string[]): Promise<void> {
    // Filter out ignored issue types
    const filteredIssues = this.filterIgnoredIssueTypes(issues, ignoreIssueTypes);
    
    if (filteredIssues.length < issues.length) {
      const ignoredCount = issues.length - filteredIssues.length;
      console.error(`Filtered out ${ignoredCount} issues with ignored types: ${ignoreIssueTypes?.join(', ')}`);
    }
    
    // Get previous sync data for ID to key mapping
    const { idToKeyMap } = await this.getLastSyncData();
    
    // Build complete issue tree map with ID mapping
    const issueTreeMap = this.buildIssueTreeMap(filteredIssues, idToKeyMap);
    
    // Match existing custom folders with issues
    const issueToFolderMap = await this.matchCustomFoldersWithIssues(issueTreeMap);
    
    // Recover missing files and sync all issues
    let recoveredCount = 0;
    for (const issue of filteredIssues) {
      const existingPath = await this.findExistingTaskFile(issue.issueKey);
      const targetFolder = issueToFolderMap.get(issue.issueKey) || path.join(this.tasksDir, 'others');
      const targetPath = path.join(targetFolder, `${issue.issueKey}.md`);
      
      if (!existingPath) {
        // File missing - recover it
        await ensureDir(targetFolder);
        const task = await this.issueToTaskFile(issue, baseUrl, filteredIssues);
        task.filePath = targetPath; // Override with correct path
        const markdownContent = this.generateMarkdownContent(task);
        await fs.writeFile(targetPath, markdownContent, 'utf8');
        recoveredCount++;
        console.error(`Recovered missing file: ${issue.issueKey}.md in ${path.basename(targetFolder)}/`);
      } else if (path.dirname(existingPath) !== targetFolder) {
        // File exists but in wrong location - move it
        await this.moveTaskFile(issue.issueKey, existingPath, targetPath);
      } else {
        // File exists in correct location - just update content
        await this.syncIssue(issue, baseUrl, filteredIssues);
      }
    }
    
    if (recoveredCount > 0) {
      console.error(`Recovered ${recoveredCount} missing task files`);
    }
    
    // Create summary of organization
    // const parentGroups = this.organizeIssuesByParent(filteredIssues);
    // let parentFolders = 0;
    // let childIssues = 0;
    // let standaloneIssues = 0;
    
    // parentGroups.forEach((group, key) => {
    //   if (key === 'others') {
    //     standaloneIssues += group.children.length;
    //   } else {
    //     parentFolders++;
    //     childIssues += group.children.length;
    //     if (group.parent) childIssues++; // Count the parent issue itself
    //   }
    // });
  }

  /**
   * Get list of existing task files across all subfolders (including nested directories)
   */
  async getExistingTaskFiles(): Promise<string[]> {
    try {
      const allFiles: string[] = [];
      await this.collectTaskFilesRecursively(this.tasksDir, '', allFiles);
      return allFiles;
    } catch (error) {
      return [];
    }
  }

  /**
   * Recursively collect task files from a directory and its subdirectories
   */
  private async collectTaskFilesRecursively(dir: string, relativePath: string, allFiles: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativeFilePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        
        if (entry.isDirectory()) {
          // Recursively search in subdirectories
          await this.collectTaskFilesRecursively(fullPath, relativeFilePath, allFiles);
        } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name.match(/^[A-Z]+-\d+\.md$/)) {
          // Add task file to the list
          allFiles.push(relativeFilePath);
        }
      }
    } catch (error) {
      // Skip directories that can't be read
    }
  }

  /**
   * Check if a task file exists for an issue (search across all subfolders)
   */
  async taskFileExists(issueKey: string): Promise<boolean> {
    const existingPath = await this.findExistingTaskFile(issueKey);
    return existingPath !== null;
  }

  /**
   * Remove a task file (search across all subfolders)
   */
  async removeTaskFile(issueKey: string): Promise<void> {
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
  async cleanupRemovedIssues(currentIssueKeys: string[]): Promise<void> {
    try {
      const existingFiles = await this.getExistingTaskFiles();
      const existingIssueKeys = existingFiles.map(file => path.basename(file, '.md'));
      
      const removedIssueKeys = existingIssueKeys.filter(
        key => !currentIssueKeys.includes(key)
      );
      
      for (const issueKey of removedIssueKeys) {
        await this.removeTaskFile(issueKey);
      }
      
    } catch (error) {
      console.error('Failed to cleanup removed issues:', error);
    }
  }

  /**
   * Read and parse a task file to extract title and description
   */
  async readTaskFile(issueKey: string): Promise<{ title: string; description: string } | null> {
    try {
      const taskFilePath = await this.findExistingTaskFile(issueKey);
      if (!taskFilePath) {
        return null;
      }

      const content = await fs.readFile(taskFilePath, 'utf8');
      
      const lines = content.split('\n');
      
      // Extract title (first line starting with #)
      const titleLine = lines.find(line => line.startsWith('# '));
      const title = titleLine ? titleLine.replace('# ', '').trim() : '';
      
      // Extract description (everything after the title line)
      const titleIndex = lines.findIndex(line => line.startsWith('# '));
      let description = '';
      
      if (titleIndex !== -1) {
        // Get everything after the title line
        const descriptionLines = lines.slice(titleIndex + 1);
        description = descriptionLines.join('\n').trim();
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
  async findParentTaskFolders(): Promise<string[]> {
    try {
      const parentFolders: string[] = [];
      const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Check if folder name matches parent task pattern (e.g., SBK-2)
          const parentPattern = /^[A-Z]+-\d+$/;
          if (parentPattern.test(entry.name)) {
            parentFolders.push(entry.name);
          }
        }
      }
      
      return parentFolders;
    } catch (error) {
      console.error('Failed to find parent task folders:', error);
      return [];
    }
  }

  /**
   * Find temporary task files in a parent folder (files with pattern PARENT-{number}-{random})
   */
  async findTemporaryTaskFiles(parentFolder: string): Promise<{ fileName: string; filePath: string; content: { title: string; description: string } }[]> {
    try {
      const parentFolderPath = path.join(this.tasksDir, parentFolder);
      const entries = await fs.readdir(parentFolderPath, { withFileTypes: true });
      const tempFiles: { fileName: string; filePath: string; content: { title: string; description: string } }[] = [];
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const fileName = entry.name.replace('.md', '');
          // Check if file name matches temporary pattern (e.g., SBK-2-1, SBK-2-2)
          const tempPattern = new RegExp(`^${parentFolder}-\\d+$`);
          if (tempPattern.test(fileName)) {
            const filePath = path.join(parentFolderPath, entry.name);
            const content = await fs.readFile(filePath, 'utf8');
            
            // Extract title and description
            const lines = content.split('\n');
            const titleLine = lines.find(line => line.startsWith('# '));
            const title = titleLine ? titleLine.replace('# ', '').trim() : '';
            
            const titleIndex = lines.findIndex(line => line.startsWith('# '));
            let description = '';
            if (titleIndex !== -1) {
              const descriptionLines = lines.slice(titleIndex + 1);
              description = descriptionLines.join('\n').trim();
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
  async renameTaskFile(oldFilePath: string, newIssueKey: string): Promise<void> {
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
  async createTaskFile(issueKey: string, parentFolder: string, title: string, description: string, baseUrl: string): Promise<void> {
    try {
      const parentFolderPath = path.join(this.tasksDir, parentFolder);
      const filePath = path.join(parentFolderPath, `${issueKey}.md`);
      
      // Ensure parent folder exists
      await ensureDir(parentFolderPath);
      
      // Generate markdown content
      let content = `# ${title}\n\n`;
      if (description && description.trim() !== '') {
        content += description;
      }
      
      await fs.writeFile(filePath, content, 'utf8');
    } catch (error) {
      throw new Error(`Failed to create task file for ${issueKey}: ${error}`);
    }
  }
} 