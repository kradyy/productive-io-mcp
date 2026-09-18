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
   - `PRODUCTIVE_DRAFT_ONLY` (default: `true`)

## Safety: draft-only writes

By default (unset, or anything other than the literal string `false`), every write this server
makes is blocked except creating or editing a comment — and those are always forced to
`draft: true`, even if the caller asks for `draft: false`. A draft is visible only to you in
Productive; nothing is ever posted or changed live without a human opening Productive and
clicking Post themselves.

This is enforced in `productiveRequest`, the single function every tool (including the raw
`productive_request` passthrough) calls, and it's gated by `.env`, not by a tool argument — so it
can't be flipped from inside a conversation with an agent. To allow full writes, set
`PRODUCTIVE_DRAFT_ONLY=false` in your `.env` and restart the server.

See `src/draft-only.test.mjs` for the guard's behavior spelled out as runnable checks.

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
- `productive_list_comments`
- `productive_list_task_comments`
- `productive_get_comment`
- `productive_get_attachment` — downloads a comment attachment; images are returned inline

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
