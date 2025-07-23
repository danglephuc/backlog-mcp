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
   * Organize issues by parent-child relationships and determine folder structure
   */
  private organizeIssuesByParent(issues: BacklogIssue[]): Map<string, { parent: BacklogIssue | null, children: BacklogIssue[] }> {
    const issueMap = new Map<number, BacklogIssue>();
    const issueKeyMap = new Map<number, string>();
    
    // Create maps for quick lookup
    issues.forEach(issue => {
      issueMap.set(issue.id, issue);
      issueKeyMap.set(issue.id, issue.issueKey);
    });
    
    const parentGroups = new Map<string, { parent: BacklogIssue | null, children: BacklogIssue[] }>();
    const processedIssues = new Set<number>();
    
    // Process all issues to find parent-child relationships
    issues.forEach(issue => {
      if (processedIssues.has(issue.id)) return;
      
      if (issue.parentIssueId) {
        // This is a child issue
        const parent = issueMap.get(issue.parentIssueId);
        if (parent) {
          const parentKey = parent.issueKey;
          if (!parentGroups.has(parentKey)) {
            parentGroups.set(parentKey, { parent, children: [] });
            processedIssues.add(parent.id);
          }
          parentGroups.get(parentKey)!.children.push(issue);
          processedIssues.add(issue.id);
        } else {
          // Parent not in current sync, treat as standalone
          parentGroups.set('others', { parent: null, children: [...(parentGroups.get('others')?.children || []), issue] });
          processedIssues.add(issue.id);
        }
      } else {
        // Check if this issue has children in the current sync
        const children = issues.filter(child => child.parentIssueId === issue.id);
        if (children.length > 0) {
          // This is a parent issue with children
          parentGroups.set(issue.issueKey, { parent: issue, children });
          processedIssues.add(issue.id);
          children.forEach(child => processedIssues.add(child.id));
        } else {
          // Standalone issue (no parent, no children)
          parentGroups.set('others', { parent: null, children: [...(parentGroups.get('others')?.children || []), issue] });
          processedIssues.add(issue.id);
        }
      }
    });
    
    return parentGroups;
  }

  /**
   * Move a task file from one location to another
   */
  private async moveTaskFile(issueKey: string, fromPath: string, toPath: string): Promise<void> {
    try {
      // Read the current file content
      const content = await fs.readFile(fromPath, 'utf8');
      
      // Ensure target directory exists
      await ensureDir(path.dirname(toPath));
      
      // Write to new location
      await fs.writeFile(toPath, content, 'utf8');
      
      // Remove old file
      await fs.rm(fromPath);
      
      console.error(`Moved ${issueKey}: ${fromPath} → ${toPath}`);
    } catch (error) {
      console.error(`Failed to move ${issueKey} from ${fromPath} to ${toPath}:`, error);
    }
  }

  /**
   * Detect if an issue's relationship status has changed and needs to be moved
   */
  private async detectRelationshipChanges(issues: BacklogIssue[]): Promise<void> {
    const parentGroups = this.organizeIssuesByParent(issues);
    
    for (const issue of issues) {
      const existingPath = await this.findExistingTaskFile(issue.issueKey);
      if (!existingPath) continue; // New issue, will be placed correctly
      
      const currentDir = path.dirname(existingPath);
      const currentDirName = path.basename(currentDir);
      const expectedFolderPath = await this.getIssueFolderPath(issue, issues);
      const expectedDirName = path.basename(expectedFolderPath);
      
      // Skip if already in the correct location
      if (currentDir === expectedFolderPath) continue;
      
      // Skip if current location is a custom parent folder that should be preserved
      if (this.isCustomParentFolder(currentDirName)) {
        // Check if this custom folder is still valid for the issue's relationships
        const issueKeyFromFolder = currentDirName.split(/[-._]/)[0] + '-' + currentDirName.split(/[-._]/)[1];
        
        // If this is a parent issue and the folder starts with its key, keep it
        if (issue.issueKey === issueKeyFromFolder) {
          const hasChildren = issues.some(child => child.parentIssueId === issue.id);
          if (hasChildren) continue; // Keep parent in its custom folder
        }
        
        // If this is a child issue and the folder matches its parent's key, keep it
        if (issue.parentIssueId) {
          const parent = issues.find(i => i.id === issue.parentIssueId);
          if (parent && parent.issueKey === issueKeyFromFolder) {
            continue; // Keep child in parent's custom folder
          }
        }
      }
      
      const newFilePath = path.join(expectedFolderPath, `${issue.issueKey}.md`);
      
      // Detect different types of relationship changes
      if (currentDirName === 'others' && expectedDirName !== 'others') {
        // Issue moved from others to a parent folder (became parent or child)
        await this.moveTaskFile(issue.issueKey, existingPath, newFilePath);
      } else if (currentDirName !== 'others' && expectedDirName === 'others') {
        // Issue moved from parent folder to others (lost parent/child status)
        await this.moveTaskFile(issue.issueKey, existingPath, newFilePath);
      } else if (currentDirName !== expectedDirName && currentDirName !== 'others' && expectedDirName !== 'others') {
        // Issue changed parent (moved between parent folders)
        await this.moveTaskFile(issue.issueKey, existingPath, newFilePath);
      }
    }
    
    // Clean up empty parent folders (except 'others' and custom folders)
    await this.cleanupEmptyParentFolders();
  }

  /**
   * Clean up empty parent folders that no longer have any issues
   */
  private async cleanupEmptyParentFolders(): Promise<void> {
    try {
      const entries = await fs.readdir(this.tasksDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'others') continue;
        
        const folderPath = path.join(this.tasksDir, entry.name);
        
        // Check if folder looks like a parent folder (starts with project key pattern)
        // But don't delete custom parent folders (those with suffixes)
        if (!entry.name.match(/^[A-Z]+-\d+/) || this.isCustomParentFolder(entry.name)) continue;
        
        try {
          const folderContents = await fs.readdir(folderPath);
          const hasTaskFiles = folderContents.some(file => file.endsWith('.md') && file.match(/^[A-Z]+-\d+\.md$/));
          
          if (!hasTaskFiles) {
            // Folder is empty of task files, remove it
            await fs.rmdir(folderPath);
            console.error(`Removed empty parent folder: ${entry.name}`);
          }
        } catch (error) {
          // Folder might not be empty due to other files, skip cleanup
        }
      }
    } catch (error) {
      console.error('Failed to cleanup empty parent folders:', error);
    }
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
   * Get the appropriate folder path for an issue based on parent-child relationships
   */
  private async getIssueFolderPath(issue: BacklogIssue, allIssues: BacklogIssue[]): Promise<string> {
    // Check if this issue already exists somewhere (preserve user organization for non-relationship changes)
    const existingPath = await this.findExistingTaskFile(issue.issueKey);
    if (existingPath) {
      const currentDir = path.dirname(existingPath);
      const currentDirName = path.basename(currentDir);
      
      // Preserve location if it's:
      // 1. A custom folder (not 'others' and doesn't match pure issue key pattern)
      // 2. A custom parent folder (issue key + suffix like GAKU-201-something)
      if (currentDirName !== 'others' && 
          (!currentDirName.match(/^[A-Z]+-\d+$/) || this.isCustomParentFolder(currentDirName))) {
        return currentDir; // Keep in custom folder like 'sprint-3' or 'GAKU-201-feature-name'
      }
    }
    
    // Determine folder based on parent-child relationship
    if (issue.parentIssueId) {
      // This is a child issue - find parent
      const parent = allIssues.find(i => i.id === issue.parentIssueId);
      if (parent) {
        // Check if parent already has a custom folder
        const parentExistingPath = await this.findExistingTaskFile(parent.issueKey);
        if (parentExistingPath) {
          const parentDir = path.dirname(parentExistingPath);
          const parentDirName = path.basename(parentDir);
          if (this.isCustomParentFolder(parentDirName)) {
            return parentDir; // Use existing custom parent folder
          }
        }
        return path.join(this.tasksDir, `${parent.issueKey}`);
      }
    } else {
      // Check if this issue has children
      const hasChildren = allIssues.some(child => child.parentIssueId === issue.id);
      if (hasChildren) {
        // This is a parent issue - check if it already has a custom folder
        if (existingPath) {
          const currentDir = path.dirname(existingPath);
          const currentDirName = path.basename(currentDir);
          if (this.isCustomParentFolder(currentDirName)) {
            return currentDir; // Keep existing custom parent folder
          }
        }
        // Create new parent folder with just the issue key
        return path.join(this.tasksDir, `${issue.issueKey}`);
      }
    }
    
    // Default to others folder for standalone issues
    return path.join(this.tasksDir, 'others');
  }

  /**
   * Convert a Backlog issue to a task file with proper file path based on parent-child relationships
   */
  private async issueToTaskFile(issue: BacklogIssue, baseUrl: string, allIssues: BacklogIssue[] = []): Promise<TaskFile> {
    // Get the appropriate folder for this issue
    const folderPath = await this.getIssueFolderPath(issue, allIssues);
    const filePath = path.join(folderPath, `${issue.issueKey}.md`);
    
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
   * Sync a single issue to a task file (in appropriate folder based on parent-child relationships)
   */
  async syncIssue(issue: BacklogIssue, baseUrl: string, allIssues: BacklogIssue[] = []): Promise<void> {
    try {
      const task = await this.issueToTaskFile(issue, baseUrl, allIssues);
      const markdownContent = this.generateMarkdownContent(task);
      
      // Ensure the directory exists for the file path
      await ensureDir(path.dirname(task.filePath));
      
      await fs.writeFile(task.filePath, markdownContent, 'utf8');
    } catch (error) {
      throw new Error(`Failed to sync issue ${issue.issueKey}: ${error}`);
    }
  }

  /**
   * Filter out issues with ignored issue types
   */
  private filterIgnoredIssueTypes(issues: BacklogIssue[], ignoreIssueTypes: string[] = []): BacklogIssue[] {
    if (!ignoreIssueTypes || ignoreIssueTypes.length === 0) {
      return issues;
    }
    
    // Convert to lowercase for case-insensitive matching
    const ignoredTypesLower = ignoreIssueTypes.map(type => type.toLowerCase());
    
    return issues.filter(issue => {
      const issueTypeName = issue.issueType.name.toLowerCase();
      return !ignoredTypesLower.includes(issueTypeName);
    });
  }

  /**
   * Detect and recover missing task files that should exist based on current issues
   */
  private async recoverMissingFiles(issues: BacklogIssue[], baseUrl: string): Promise<number> {
    let recoveredCount = 0;
    
    for (const issue of issues) {
      const existingPath = await this.findExistingTaskFile(issue.issueKey);
      
      if (!existingPath) {
        // File doesn't exist, but issue exists in Backlog - this might be accidentally deleted
        // Create the file in the appropriate location
        try {
          await this.syncIssue(issue, baseUrl, issues);
          recoveredCount++;
          console.error(`Recovered missing file: ${issue.issueKey}.md`);
        } catch (error) {
          console.error(`Failed to recover ${issue.issueKey}: ${error}`);
        }
      }
    }
    
    return recoveredCount;
  }

  /**
   * Match existing custom folders with issues and determine correct placement
   */
  private async matchCustomFoldersWithIssues(issueTreeMap: Map<string, { issue: BacklogIssue, parent?: BacklogIssue, children: BacklogIssue[] }>): Promise<Map<string, string>> {
    const issueToFolderMap = new Map<string, string>();
    
    // Get all existing task files and their current locations
    const existingFiles = await this.getExistingTaskFiles();
    
    // First pass: Map all existing files to their current locations
    const existingIssueLocations = new Map<string, string>();
    for (const relativeFilePath of existingFiles) {
      const issueKey = path.basename(relativeFilePath, '.md');
      const currentDir = path.dirname(path.join(this.tasksDir, relativeFilePath));
      existingIssueLocations.set(issueKey, currentDir);
    }
    
    // Second pass: Determine correct placement for ALL issues (existing and missing)
    for (const [issueKey, { issue, parent, children }] of issueTreeMap) {
      const currentLocation = existingIssueLocations.get(issueKey);
      let targetFolder: string;
      
      if (currentLocation) {
        // Issue file exists - determine if we should keep it here or move it
        const currentDirName = path.basename(currentLocation);
        
        // If it's in a custom folder (not 'others' and not a simple parent folder), preserve it
        if (currentDirName !== 'others' && !currentDirName.match(/^[A-Z]+-\d+$/)) {
          targetFolder = currentLocation; // Keep in custom folder like 'features/sprint-1/...'
        }
        // If it's in a custom parent folder, preserve it
        else if (this.isCustomParentFolder(currentDirName)) {
          targetFolder = currentLocation; // Keep in custom parent folder like 'GAKU-201-feature-name'
        }
        // Otherwise, determine folder based on relationships
        else {
          targetFolder = this.determineTargetFolderByRelationship(issue, parent, children, existingIssueLocations);
        }
      } else {
        // Issue file is missing - determine where it should be recovered
        if (parent) {
          // Child issue - find where parent is located
          const parentLocation = existingIssueLocations.get(parent.issueKey);
          if (parentLocation) {
            targetFolder = parentLocation; // Place child with parent
          } else {
            // Parent also missing or not in sync - use relationship logic
            targetFolder = this.determineTargetFolderByRelationship(issue, parent, children, existingIssueLocations);
          }
        } else if (children.length > 0) {
          // Parent issue - check if any children exist to determine location
          let childLocation: string | undefined;
          for (const child of children) {
            childLocation = existingIssueLocations.get(child.issueKey);
            if (childLocation) break;
          }
          
          if (childLocation) {
            targetFolder = childLocation; // Place parent with existing children
          } else {
            // No existing children - create new parent folder
            targetFolder = path.join(this.tasksDir, issue.issueKey);
          }
        } else {
          // Standalone issue - goes to others
          targetFolder = path.join(this.tasksDir, 'others');
        }
      }
      
      issueToFolderMap.set(issueKey, targetFolder);
    }
    
    return issueToFolderMap;
  }

  /**
   * Determine target folder based on issue relationships
   */
  private determineTargetFolderByRelationship(
    issue: BacklogIssue, 
    parent: BacklogIssue | undefined, 
    children: BacklogIssue[], 
    existingLocations: Map<string, string>
  ): string {
    if (parent) {
      // Child issue - should be with parent
      const parentLocation = existingLocations.get(parent.issueKey);
      if (parentLocation) {
        return parentLocation;
      } else {
        // Parent location unknown - use parent's default folder
        return path.join(this.tasksDir, parent.issueKey);
      }
    } else if (children.length > 0) {
      // Parent issue - should have its own folder
      return path.join(this.tasksDir, issue.issueKey);
    } else {
      // Standalone issue - goes to others
      return path.join(this.tasksDir, 'others');
    }
  }

  /**
   * Find if an issue exists in a custom folder
   */
  private findIssueInCustomFolder(issueKey: string, existingFiles: string[]): string | null {
    for (const relativeFilePath of existingFiles) {
      if (path.basename(relativeFilePath, '.md') === issueKey) {
        const currentDir = path.dirname(path.join(this.tasksDir, relativeFilePath));
        const currentDirName = path.basename(currentDir);
        
        // If it's in a custom folder, return that folder
        if (currentDirName !== 'others' && 
            (!currentDirName.match(/^[A-Z]+-\d+$/) || this.isCustomParentFolder(currentDirName))) {
          return currentDir;
        }
      }
    }
    return null;
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
    const parentGroups = this.organizeIssuesByParent(filteredIssues);
    let parentFolders = 0;
    let childIssues = 0;
    let standaloneIssues = 0;
    
    parentGroups.forEach((group, key) => {
      if (key === 'others') {
        standaloneIssues += group.children.length;
      } else {
        parentFolders++;
        childIssues += group.children.length;
        if (group.parent) childIssues++; // Count the parent issue itself
      }
    });
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
} 