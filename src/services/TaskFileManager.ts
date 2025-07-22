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
    this.tasksDir = path.resolve(tasksDir);
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
   * Convert a Backlog issue to a task file with proper file path
   */
  private async issueToTaskFile(issue: BacklogIssue, baseUrl: string): Promise<TaskFile> {
    // Check if task file already exists in any subfolder
    const existingPath = await this.findExistingTaskFile(issue.issueKey);
    
    // Use existing path or default to 'others' folder
    const filePath = existingPath || path.join(this.tasksDir, 'others', `${issue.issueKey}.md`);
    
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
      filePath
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
   * Sync a single issue to a task file (in existing location or 'others' folder)
   */
  async syncIssue(issue: BacklogIssue, baseUrl: string): Promise<void> {
    try {
      const task = await this.issueToTaskFile(issue, baseUrl);
      const markdownContent = this.generateMarkdownContent(task);
      
      // Ensure the directory exists for the file path
      await ensureDir(path.dirname(task.filePath));
      
      await fs.writeFile(task.filePath, markdownContent, 'utf8');
    } catch (error) {
      throw new Error(`Failed to sync issue ${issue.issueKey}: ${error}`);
    }
  }

  /**
   * Sync multiple issues to task files
   */
  async syncIssues(issues: BacklogIssue[], baseUrl: string): Promise<void> {
    
    for (const issue of issues) {
      await this.syncIssue(issue, baseUrl);
    }
    
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
   * Save the last sync timestamp to a file
   */
  async saveLastSyncTime(timestamp: string): Promise<void> {
    try {
      const lastSyncFile = path.join(this.tasksDir, '.last-sync');
      await fs.writeFile(lastSyncFile, timestamp, 'utf8');
    } catch (error) {
      console.error('Failed to save last sync time:', error);
    }
  }

  /**
   * Load the last sync timestamp from file
   */
  async getLastSyncTime(): Promise<string | null> {
    try {
      const lastSyncFile = path.join(this.tasksDir, '.last-sync');
      const timestamp = await fs.readFile(lastSyncFile, 'utf8');
      return timestamp.trim();
    } catch (error) {
      // File doesn't exist or can't be read
      return null;
    }
  }

  /**
   * Get the tasks directory path
   */
  getTasksDirectory(): string {
    return this.tasksDir;
  }
} 