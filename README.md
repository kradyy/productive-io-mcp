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

## Run

```bash
npm start
```

The server uses MCP stdio transport.

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
