# Backlog MCP Server

A Model Context Protocol (MCP) server for syncing Backlog issues to a local `.tasks` folder. This allows you to use Backlog issue management within your code editor through MCP-compatible tools like Cursor or Claude Desktop.

## Features

- 🔄 **Bidirectional Sync**: Download issues from Backlog and push local changes back
- 📝 **Simple Format**: Clean markdown files with just title and description
- 📁 **Flexible Organization**: Organize tasks in nested folders (sprint-3, backlog, etc.)
- 🕐 **Automatic Timestamps**: Incremental sync based on last update time
- 🔍 **Smart Updates**: Only syncs changed issues after initial sync
- 🔌 **MCP Compatible**: Works with Cursor, Claude Desktop, and other MCP clients

## Installation

### Option 1: NPM (Recommended)
```bash
npm install -g backlog-mcp
```

### Option 2: Local Development
```bash
git clone <repository-url>
cd backlog-mcp
npm install
npm run build
```

## Configuration

This server uses **environment variables** for configuration.

### Get Your Backlog API Key

1. Log in to your Backlog space
2. Go to Personal Settings > API
3. Generate a new API key
4. Copy the key for use in the configuration below

### Configuration Options

**Option 1: Environment Variables (Recommended)**

Set the following environment variables:

**Required:**
- `BACKLOG_API_KEY` - Your Backlog API key
- `BACKLOG_BASE_URL` - Your Backlog space URL (e.g., `https://yourspace.backlog.com`)
- `BACKLOG_PROJECT_KEY` - Your project key (e.g., `PROJ`)

**Optional:**
- `BACKLOG_TASKS_DIR` - Local tasks directory (defaults to `.tasks`)
- `BACKLOG_IGNORE_ISSUE_TYPES` - Comma-separated list of issue types to ignore (e.g., `Bug,Task`)

**Option 2: Configuration File**

Create a `config.json` file in your project root:

```json
{
  "apiKey": "your-backlog-api-key",
  "baseUrl": "https://yourspace.backlog.com",
  "projectKey": "YOUR_PROJECT_KEY",
  "tasksDir": ".tasks",
  "ignoreIssueTypes": ["Bug", "Task"]
}
```

## Usage with Cursor/Claude Desktop

Add to your MCP settings file:

### Using NPM Installation
```json
{
  "mcpServers": {
    "backlog-mcp": {
      "command": "npx",
      "args": [
        "-y", 
        "github.com:danglephuc/backlog-mcp"
      ],
      "env": {
        "BACKLOG_API_KEY": "your-api-key",
        "BACKLOG_BASE_URL": "https://yourspace.backlog.com",
        "BACKLOG_PROJECT_KEY": "YOUR_PROJECT_KEY"
      }
    }
  }
}
```

### Using Local Build
```json
{
  "mcpServers": {
    "backlog-mcp": {
      "command": "node",
      "args": ["/path/to/backlog-mcp/dist/index.js"],
      "env": {
        "BACKLOG_API_KEY": "your-api-key",
        "BACKLOG_BASE_URL": "https://yourspace.backlog.com",
        "BACKLOG_PROJECT_KEY": "YOUR_PROJECT_KEY"
      }
    }
  }
}
```

**Replace:**
- `your-api-key` with your Backlog API key
- `yourspace` with your Backlog space name
- `YOUR_PROJECT_KEY` with your project key (e.g., "PROJ")

## Available Tools

### sync-issues
Syncs issues from Backlog to local `.tasks` folder with automatic incremental updates.

**Parameters:** None (uses automatic timestamp tracking)

**Features:**
- First sync: Downloads all issues
- Subsequent syncs: Only downloads updated issues
- Preserves your folder organization

### update-issue
Pushes local changes back to Backlog.

**Parameters:**
- `issueKey` (required): Issue key (e.g., "PROJ-123")

**Example:** "Update task PROJ-123 to Backlog"

### get-issue
Gets details of a specific issue from local files.

**Parameters:**
- `issueKey` (required): Issue key (e.g., "PROJ-123")
- `parentIssue` (optional): If true, include all child issues when this is a parent issue/feature

**Features:**
- Reads from local `.tasks` folder 
- When `parentIssue=true`, returns the main issue plus all child issues in the same folder
- Useful for understanding the full scope of a feature with all its sub-tasks

**Examples:**
- Get single issue: "Get task PROJ-123"
- Get parent with all children: "Get feature PROJ-100 with all child issues"

### test-connection
Tests your Backlog API connection.

**Parameters:** None

### list-task-files
Lists all synced task files.

**Parameters:** None

## File Organization

### Smart Folder Structure
```
.tasks/
├── .last-sync           ← Automatic timestamp tracking
├── others/              ← New synced tasks go here
│   ├── PROJ-123.md
│   └── PROJ-124.md
├── sprint-3/            ← Organize however you want
│   ├── backend/
│   │   └── PROJ-125.md
│   └── frontend/
│       └── PROJ-126.md
└── backlog/
    ├── high-priority/
    │   └── PROJ-127.md
    └── PROJ-128.md
```

### How It Works
1. **Initial sync**: All issues go to `others/` folder
2. **Manual organization**: Move files to your preferred folders
3. **Subsequent syncs**: Updates issues wherever they are located
4. **New issues**: Always go to `others/` folder

### Simple File Format
```markdown
# Task Title

Task description content goes here.
All content after the title is treated as description.

## Sections
You can use any markdown formatting you want.

- Lists
- **Bold text**
- Links, etc.
```

## Workflow Example

1. **Sync issues**: `sync-issues` → Downloads to `others/` folder
2. **Organize**: Move `PROJ-123.md` to `sprint-3/backend/`
3. **Edit locally**: Modify title or description
4. **Push changes**: `update-issue` with `issueKey: PROJ-123`
5. **Next sync**: Updates `PROJ-123.md` in `sprint-3/backend/`, new issues go to `others/`



## Development

### Scripts
- `npm run build` - Build TypeScript
- `npm run dev` - Watch mode for development  
- `npm start` - Run built server

### Project Structure
```
src/
├── index.ts              # Entry point
├── server.ts             # MCP server and tools
├── services/
│   ├── BacklogClient.ts  # Backlog API client with pagination
│   └── TaskFileManager.ts # File management with nested search
├── types/
│   └── backlog.ts        # TypeScript types
└── utils/
    └── config.ts         # Configuration handling
```

## Troubleshooting

### Connection Issues
- **Invalid API Key**: Check your API key has proper permissions
- **Wrong Base URL**: Ensure URL matches your Backlog space
- **Project Access**: Verify you have access to the specified project

### MCP Protocol Issues  
- **JSON Parse Errors**: Ensure you're using the latest build
- **Tool Not Found**: Check server configuration in your MCP client
- **No Response**: Verify environment variables are set correctly

### File Issues
- **Missing Files**: Run `sync-issues` to download latest
- **Update Failed**: Check if issue exists in Backlog
- **Organization Lost**: Files stay where you put them across syncs

## License

MIT 