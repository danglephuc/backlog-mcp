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

This server uses **command-line arguments** for configuration. No config files needed!

### Get Your Backlog API Key

1. Log in to your Backlog space
2. Go to Personal Settings > API
3. Generate a new API key
4. Copy the key for use in the configuration below

## Usage with Cursor/Claude Desktop

Add to your MCP settings file:

### Using NPM Installation
```json
{
  "mcpServers": {
    "backlog-mcp": {
      "command": "backlog-mcp",
      "args": [
        "--apiKey=YOUR_API_KEY",
        "--baseUrl=https://yourspace.backlog.com",
        "--projectKey=YOUR_PROJECT_KEY",
        "--tasksDir=.tasks"
      ]
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
      "args": [
        "/path/to/backlog-mcp/dist/index.js",
        "--apiKey=YOUR_API_KEY",
        "--baseUrl=https://yourspace.backlog.com",
        "--projectKey=YOUR_PROJECT_KEY",
        "--tasksDir=.tasks"
      ]
    }
  }
}
```

**Replace:**
- `YOUR_API_KEY` with your Backlog API key
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
Gets details of a specific issue.

**Parameters:**
- `issueKey` (required): Issue key (e.g., "PROJ-123")

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

## Command Line Arguments

| Argument       | Required | Description                                    | Example                              |
|---------------|----------|------------------------------------------------|--------------------------------------|
| `--apiKey`    | Yes      | Your Backlog API key                          | `--apiKey=abc123...`                |
| `--baseUrl`   | Yes      | Your Backlog space URL                        | `--baseUrl=https://space.backlog.com` |
| `--projectKey`| Yes      | Project key in Backlog                        | `--projectKey=PROJ`                  |
| `--tasksDir`  | No       | Local tasks directory (default: `.tasks`)     | `--tasksDir=my-tasks`               |

## Development

### Scripts
- `npm run build` - Build TypeScript
- `npm run dev` - Watch mode for development  
- `npm start` - Run built server

### Project Structure
```
src/
├── index.ts              # Entry point with argument parsing
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
- **No Response**: Verify command-line arguments are correct

### File Issues
- **Missing Files**: Run `sync-issues` to download latest
- **Update Failed**: Check if issue exists in Backlog
- **Organization Lost**: Files stay where you put them across syncs

## License

MIT 