export interface BacklogConfig {
  apiKey: string;
  baseUrl: string;
  projectKey: string;
}

export interface BacklogIssue {
  id: number;
  projectId: number;
  issueKey: string;
  keyId: number;
  issueType: IssueType;
  summary: string;
  description: string;
  resolution?: Resolution;
  priority: Priority;
  status: Status;
  assignee?: User;
  category: Category[];
  versions: Version[];
  milestone: Version[];
  startDate?: string;
  dueDate?: string;
  estimatedHours?: number;
  actualHours?: number;
  parentIssueId?: number;
  createdUser: User;
  created: string;
  updatedUser?: User;
  updated?: string;
  customFields: CustomField[];
  attachments: Attachment[];
  sharedFiles: SharedFile[];
  stars: Star[];
}

export interface IssueType {
  id: number;
  projectId: number;
  name: string;
  color: string;
  displayOrder: number;
}

export interface Priority {
  id: number;
  name: string;
}

export interface Status {
  id: number;
  projectId: number;
  name: string;
  color: string;
  displayOrder: number;
}

export interface Resolution {
  id: number;
  name: string;
}

export interface User {
  id: number;
  userId: string;
  name: string;
  roleType: number;
  lang?: string;
  mailAddress: string;
  nulabAccount?: NulabAccount;
  keyword?: string;
}

export interface NulabAccount {
  nulabId: string;
  name: string;
  uniqueId: string;
}

export interface Category {
  id: number;
  name: string;
  displayOrder: number;
}

export interface Version {
  id: number;
  projectId: number;
  name: string;
  description?: string;
  startDate?: string;
  releaseDueDate?: string;
  archived: boolean;
  displayOrder: number;
}

export interface CustomField {
  id: number;
  typeId: number;
  name: string;
  description?: string;
  required: boolean;
  applicableIssueTypes: number[];
  allowAddItem: boolean;
  items: CustomFieldItem[];
  value?: any;
}

export interface CustomFieldItem {
  id: number;
  name: string;
  displayOrder: number;
}

export interface Attachment {
  id: number;
  name: string;
  size: number;
  createdUser: User;
  created: string;
}

export interface SharedFile {
  id: number;
  type: string;
  dir: string;
  name: string;
  size: number;
  createdUser: User;
  created: string;
  updatedUser?: User;
  updated?: string;
}

export interface Star {
  id: number;
  comment?: string;
  url: string;
  title: string;
  presenter: User;
  created: string;
}

export interface BacklogProject {
  id: number;
  projectKey: string;
  name: string;
  chartEnabled: boolean;
  useResolvedForChart: boolean;
  subtaskingEnabled: boolean;
  projectLeaderCanEditProjectLeader: boolean;
  useWiki: boolean;
  useFileSharing: boolean;
  useWikiTreeView: boolean;
  useSubversion: boolean;
  useGit: boolean;
  useOriginalImageSizeAtWiki: boolean;
  textFormattingRule: string;
  archived: boolean;
  displayOrder: number;
}

export interface BacklogIssueListParams {
  projectId?: number[];
  issueTypeId?: number[];
  categoryId?: number[];
  versionId?: number[];
  milestoneId?: number[];
  statusId?: number[];
  priorityId?: number[];
  assigneeId?: number[];
  createdUserId?: number[];
  resolutionId?: number[];
  parentChild?: number;
  attachment?: boolean;
  sharedFile?: boolean;
  sort?: string;
  order?: 'asc' | 'desc';
  offset?: number;
  count?: number;
  createdSince?: string;
  createdUntil?: string;
  updatedSince?: string;
  updatedUntil?: string;
  startDateSince?: string;
  startDateUntil?: string;
  dueDateSince?: string;
  dueDateUntil?: string;
  id?: number[];
  parentIssueId?: number[];
  keyword?: string;
}

export interface BacklogApiResponse<T> {
  data: T;
  status: number;
  statusText: string;
} 