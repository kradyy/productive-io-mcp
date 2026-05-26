# Productive MCP

MCP server for Productive API (`https://api.productive.io/api/v2`).

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
3. Fill in your values in `.env`:
   - `PRODUCTIVE_BASE_URL` (default: `https://api.productive.io/api/v2`)
   - `PRODUCTIVE_ORGANIZATION_ID`
   - `PRODUCTIVE_TOKEN`

## Connect to Claude

### Claude Code (recommended)

Add the server once:

```bash
claude mcp add productive --scope user \
  --env PRODUCTIVE_BASE_URL=https://api.productive.io/api/v2 \
  --env PRODUCTIVE_ORGANIZATION_ID=YOUR_ORG_ID \
  --env PRODUCTIVE_TOKEN=YOUR_TOKEN \
  -- node "/absolute/path/to/productive_mcp/src/index.js"
```

Verify:

```bash
claude mcp list
claude mcp get productive
```

### Claude Desktop

Edit `claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "productive": {
      "command": "node",
      "args": [
        "/absolute/path/to/productive_mcp/src/index.js"
      ],
      "env": {
        "PRODUCTIVE_BASE_URL": "https://api.productive.io/api/v2",
        "PRODUCTIVE_ORGANIZATION_ID": "YOUR_ORG_ID",
        "PRODUCTIVE_TOKEN": "YOUR_TOKEN"
      }
    }
  }
}
```

## Connect to Codex

Add the server once:

```bash
codex mcp add productive \
  --env PRODUCTIVE_BASE_URL=https://api.productive.io/api/v2 \
  --env PRODUCTIVE_ORGANIZATION_ID=YOUR_ORG_ID \
  --env PRODUCTIVE_TOKEN=YOUR_TOKEN \
  -- node "/absolute/path/to/productive_mcp/src/index.js"
```

Verify:

```bash
codex mcp list
codex mcp get productive
```

Remove later if needed:

```bash
codex mcp remove productive
```

## Why MCP Instead of Static JSON Instructions?

- A static JSON/instruction file is useful for documentation only.
- MCP is a running protocol server that exposes executable tools.
- If you want live authenticated API calls from Claude tools, use MCP.

## Tools

- `productive_health`
- `productive_list_documented_endpoints`
- `productive_request`
- `productive_list_projects`
- `productive_list_tasks`
- `productive_list_time_entries`
- `productive_list_people`
- `productive_list_bookings`

## Endpoint Source

`data/endpoints.json` is generated from Productive official OpenAPI spec:

- `https://developer.productive.io/reference/download_spec?format=json`

## Manual Run (Optional)

```bash
npm start
```

The server uses MCP stdio transport.

For normal MCP usage in Claude or Codex, you usually do **not** need to manually run `npm start`.
Your MCP client launches the server process itself from config.
Use `npm start` only when you want to run or debug the server manually.
