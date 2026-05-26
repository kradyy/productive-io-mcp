import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const JSON_API_CONTENT_TYPE = "application/vnd.api+json";
const DEFAULT_BASE_URL = "https://api.productive.io/api/v2";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENDPOINT_INDEX_PATH = path.resolve(__dirname, "../data/endpoints.json");

let endpointIndexCache = null;

function envOrThrow(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function normalizePath(inputPath) {
  if (!inputPath || !inputPath.trim()) {
    throw new Error("Path cannot be empty");
  }

  const raw = inputPath.trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    const full = new URL(raw);
    return `${full.pathname}${full.search}`;
  }

  return raw.startsWith("/") ? raw : `/${raw}`;
}

function appendQueryParams(searchParams, query) {
  if (!query || typeof query !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) {
          continue;
        }
        searchParams.append(key, String(item));
      }
      continue;
    }

    searchParams.append(key, String(value));
  }
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  return text;
}

async function productiveRequest({ method, path: inputPath, query, body }) {
  const baseUrl = normalizeBaseUrl(process.env.PRODUCTIVE_BASE_URL || DEFAULT_BASE_URL);
  const token = envOrThrow("PRODUCTIVE_TOKEN");
  const organizationId = envOrThrow("PRODUCTIVE_ORGANIZATION_ID");

  const normalizedPath = normalizePath(inputPath);
  const url = new URL(baseUrl + normalizedPath);
  appendQueryParams(url.searchParams, query);

  const headers = {
    Accept: JSON_API_CONTENT_TYPE,
    "X-Auth-Token": token,
    "X-Organization-Id": organizationId,
  };

  const upperMethod = method.toUpperCase();
  if (["POST", "PATCH", "PUT", "DELETE"].includes(upperMethod)) {
    headers["Content-Type"] = JSON_API_CONTENT_TYPE;
  }

  const response = await fetch(url, {
    method: upperMethod,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const parsedBody = await parseResponseBody(response);
  const payload = {
    ok: response.ok,
    status: response.status,
    method: upperMethod,
    url: url.toString(),
    data: parsedBody,
  };

  if (!response.ok) {
    const error = new Error(`Productive API request failed with status ${response.status}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function loadEndpointIndex() {
  if (endpointIndexCache) {
    return endpointIndexCache;
  }

  const raw = await fs.readFile(ENDPOINT_INDEX_PATH, "utf-8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.endpoints)) {
    throw new Error(`Invalid endpoint index at ${ENDPOINT_INDEX_PATH}`);
  }

  endpointIndexCache = parsed;
  return endpointIndexCache;
}

function textResult(data, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function errorResult(error) {
  const payload = error && typeof error === "object" && "payload" in error ? error.payload : null;
  const message = error instanceof Error ? error.message : String(error);
  return textResult(
    {
      error: message,
      ...(payload ? { details: payload } : {}),
    },
    true,
  );
}

function buildServer() {
  const server = new McpServer({
    name: "productive-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "productive_health",
    {
      description: "Checks Productive API auth by fetching current organization list.",
    },
    async () => {
      try {
        const result = await productiveRequest({
          method: "GET",
          path: "/organizations",
          query: { "page[size]": 1 },
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "productive_list_documented_endpoints",
    {
      description: "Lists endpoints from the bundled Productive OpenAPI index.",
      inputSchema: {
        resource: z
          .string()
          .optional()
          .describe("Optional resource group filter, e.g. projects, tasks, time_entries"),
        method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]).optional(),
        search: z.string().optional().describe("Optional text filter on path"),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ resource, method, search, limit, offset }) => {
      try {
        const index = await loadEndpointIndex();
        let endpoints = index.endpoints;

        if (resource) {
          endpoints = endpoints.filter((entry) => entry.group === resource);
        }

        if (method) {
          endpoints = endpoints.filter((entry) => entry.methods.includes(method));
        }

        if (search) {
          const query = search.toLowerCase();
          endpoints = endpoints.filter((entry) => entry.path.toLowerCase().includes(query));
        }

        const total = endpoints.length;
        const rows = endpoints.slice(offset, offset + limit);

        return textResult({
          source: index.source,
          total,
          offset,
          limit,
          endpoints: rows,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "productive_request",
    {
      description: "Calls any Productive API endpoint with authenticated headers.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]),
        path: z
          .string()
          .describe("Path or full URL, e.g. /projects, /tasks/123, /time_entries?page[size]=5"),
        query: z
          .record(z.string(), z.any())
          .optional()
          .describe("Optional query object. Arrays become repeated query params."),
        body: z.any().optional().describe("Optional JSON:API body for write operations."),
      },
    },
    async ({ method, path: requestPath, query, body }) => {
      try {
        const result = await productiveRequest({
          method,
          path: requestPath,
          query,
          body,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const registerCollectionTool = (toolName, pathName, description) => {
    server.registerTool(
      toolName,
      {
        description,
        inputSchema: {
          query: z
            .record(z.string(), z.any())
            .optional()
            .describe(
              "Optional query object, e.g. {\"page[size]\": 25, \"filter[project_id]\": 12345}",
            ),
        },
      },
      async ({ query }) => {
        try {
          const result = await productiveRequest({
            method: "GET",
            path: pathName,
            query,
          });
          return textResult(result);
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  };

  registerCollectionTool("productive_list_projects", "/projects", "Lists projects.");
  registerCollectionTool("productive_list_tasks", "/tasks", "Lists tasks.");
  registerCollectionTool("productive_list_time_entries", "/time_entries", "Lists time entries.");
  registerCollectionTool("productive_list_people", "/people", "Lists people.");
  registerCollectionTool("productive_list_bookings", "/bookings", "Lists bookings.");
  registerCollectionTool(
    "productive_list_comments",
    "/comments",
    "Lists comments. Use query filters to scope by task/subtask context.",
  );

  server.registerTool(
    "productive_list_task_comments",
    {
      description: "Lists comments for a specific task id.",
      inputSchema: {
        task_id: z
          .union([z.string(), z.number().int()])
          .describe("Task id, e.g. 17987571 or \"17987571\"."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe("Max comments per page."),
        sort: z
          .enum(["created_at", "-created_at"])
          .default("-created_at")
          .describe("Sort order by creation timestamp."),
      },
    },
    async ({ task_id, page_size, sort }) => {
      try {
        const result = await productiveRequest({
          method: "GET",
          path: "/comments",
          query: {
            "filter[task_id][eq]": String(task_id),
            "page[size]": page_size,
            sort,
          },
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "productive_get_comment",
    {
      description: "Fetches one comment by id.",
      inputSchema: {
        id: z
          .union([z.string(), z.number().int()])
          .describe("Comment id, e.g. 123456 or \"123456\"."),
      },
    },
    async ({ id }) => {
      try {
        const result = await productiveRequest({
          method: "GET",
          path: `/comments/${id}`,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

export async function startServer() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  startServer().catch((error) => {
    console.error("Failed to start Productive MCP server:", error);
    process.exit(1);
  });
}
