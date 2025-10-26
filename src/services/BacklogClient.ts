import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { 
  BacklogConfig, 
  BacklogIssue, 
  BacklogProject, 
  BacklogIssueListParams,
  BacklogApiResponse 
} from '../types/backlog.js';

export class BacklogClient {
  private axiosInstance: AxiosInstance;
  private config: BacklogConfig;

  constructor(config: BacklogConfig) {
    this.config = config;
    
    // Create axios instance with base configuration
    this.axiosInstance = axios.create({
      baseURL: `${config.baseUrl}/api/v2`,
      timeout: 30000,
      params: {
        apiKey: config.apiKey
      }
    });

    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        // Request logging removed for MCP compatibility
        return config;
      },
      (error) => {
        console.error('Request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('Response error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get project information by project key
   */
  async getProject(): Promise<BacklogProject> {
    try {
      const response: AxiosResponse<BacklogProject> = await this.axiosInstance.get(
        `/projects/${this.config.projectKey}`
      );
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get project: ${error}`);
    }
  }

  /**
   * Get list of issues for the project
   */
  async getIssues(params: BacklogIssueListParams = {}): Promise<BacklogIssue[]> {
    try {
      // Get project info to get project ID
      const project = await this.getProject();
      
      const allIssues: BacklogIssue[] = [];
      let offset = 0;
      const limit = 100; // Backlog API max per request
      
      while (true) {
        // Set parameters for this page
        const queryParams = {
          projectId: [project.id],
          sort: 'updated',
          order: 'desc' as const,
          count: limit,
          offset: offset,
          ...params
        };

        const response: AxiosResponse<BacklogIssue[]> = await this.axiosInstance.get(
          '/issues',
          { params: queryParams }
        );
        
        const issues = response.data;
        allIssues.push(...issues);
        
        // If we got fewer issues than the limit, we've reached the end
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
  async getIssue(issueKey: string): Promise<BacklogIssue> {
    try {
      const response: AxiosResponse<BacklogIssue> = await this.axiosInstance.get(
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
  async createIssue(issueData: { 
    summary: string; 
    description?: string; 
    issueTypeId?: number; 
    priorityId?: number; 
    parentIssueId?: number;
  }): Promise<BacklogIssue> {
    try {
      const createData: any = {
        projectId: (await this.getProject()).id,
        summary: issueData.summary,
        description: issueData.description || ''
      };
      
      if (issueData.issueTypeId) {
        createData.issueTypeId = issueData.issueTypeId;
      }
      
      if (issueData.priorityId) {
        createData.priorityId = issueData.priorityId;
      }
      
      if (issueData.parentIssueId) {
        createData.parentIssueId = issueData.parentIssueId;
      }

      const response: AxiosResponse<BacklogIssue> = await this.axiosInstance.post(
        '/issues',
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
  async updateIssue(issueKey: string, updates: { summary?: string; description?: string }): Promise<BacklogIssue> {
    try {
      const updateData: any = {};
      
      // Ensure we have at least one field to update
      if (!updates.summary && !updates.description) {
        throw new Error('No updates provided');
      }
      
      if (updates.summary) {
        updateData.summary = updates.summary;
      }
      
      if (updates.description !== undefined) {
        // Backlog API sometimes requires description to be non-empty
        updateData.description = updates.description || '';
      }

      const response: AxiosResponse<BacklogIssue> = await this.axiosInstance.patch(
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
  async getIssuesUpdatedSince(since: Date): Promise<BacklogIssue[]> {
    // Format date as yyyy-MM-dd as required by Backlog API
    const formattedDate = since.toISOString().split('T')[0];
    return this.getIssues({
      updatedSince: formattedDate,
      sort: 'updated',
      order: 'desc'
    });
  }

  /**
   * Test the connection and authentication
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getProject();
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Get the base URL for creating issue links
   */
  getIssueUrl(issueKey: string): string {
    return `${this.config.baseUrl}/view/${issueKey}`;
  }

  /**
   * Get project key
   */
  getProjectKey(): string {
    return this.config.projectKey;
  }
} 