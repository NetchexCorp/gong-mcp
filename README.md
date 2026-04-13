# Gong MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes Gong call intelligence data — users, calls, transcripts, CRM associations, and scorecards — over Streamable HTTP with API key authentication. Designed for deployment on Azure Container Apps.

## Tools

| Tool | Description |
|------|-------------|
| `list_users` | List all Gong users with pagination |
| `get_user` | Get details for a specific user by ID |
| `list_calls` | List calls within a date range |
| `get_call_details` | Get full call data including CRM context, participants, brief, highlights |
| `get_call_transcript` | Get timestamped speaker-attributed transcripts |
| `get_call_crm_associations` | Get manual Salesforce account/opportunity links |
| `list_scorecards` | List scorecard definitions |
| `get_call_scorecards` | Get answered scorecards with scores and reviewer info |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MCP_API_KEY` | Yes | API key for authenticating MCP clients |
| `GONG_ACCESS_KEY` | Yes | Gong API access key |
| `GONG_ACCESS_KEY_SECRET` | Yes | Gong API access key secret |
| `GONG_BASE_URL` | No | Gong API base URL (default: `https://us-11858.api.gong.io`) |
| `PORT` | No | HTTP port (default: `8080`) |

## Setup

Create a `.env` file in the project root:

```
MCP_API_KEY=<your-mcp-api-key>
GONG_ACCESS_KEY=<your-gong-access-key>
GONG_ACCESS_KEY_SECRET=<your-gong-access-key-secret>
GONG_BASE_URL=<your-gong-base-url>
```

## Run Locally

```bash
npm install
npm run build
npm start
```

The server starts at `http://localhost:8080/mcp` with a health check at `/health`.

## Docker

```bash
docker build -t gong-mcp .
docker run -p 8080:8080 --env-file .env gong-mcp
```

## Deploy to Azure Container Apps

The `deploy.sh` script reads secrets from `.env`, builds the Docker image via ACR, and creates/updates the Container App in the `doldata-rg` resource group.

```bash
az login
./deploy.sh
```

## Client Configuration (Claude Code / Claude Desktop)

```json
{
  "mcpServers": {
    "gong": {
      "type": "streamable-http",
      "url": "https://<your-app>.azurecontainerapps.io/mcp",
      "headers": {
        "x-api-key": "<your-mcp-api-key>"
      }
    }
  }
}
```

## Authentication

All requests to `/mcp` require an `x-api-key` header matching the `MCP_API_KEY` environment variable. The `/health` endpoint is unauthenticated.
