import dotenv from "dotenv";
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

// Load .env from next to this file, not from process.cwd() — an MCP client typically spawns
// this server with its own cwd, not this repo's, so the plain "dotenv/config" default would
// silently miss the file (confirmed: it does, when cwd != this directory).
dotenv.config({ path: path.resolve(__dirname, "../.env") });

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

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const COMMENT_PATH_RE = /^\/comments(\/[^/?]+)?$/;
const COMMENT_WRITE_METHODS = new Set(["POST", "PATCH"]); // creating/editing a draft; never PUT/DELETE

// Safe by default: unset or anything other than the literal string "false" means draft-only.
// This is an env var read once at process start, not a tool parameter, so nothing inside a
// conversation can flip it — changing it requires editing .env and restarting the server.
export function isDraftOnlyMode() {
  const raw = process.env.PRODUCTIVE_DRAFT_ONLY;
  if (raw === undefined || raw.trim() === "") return true;
  return raw.trim().toLowerCase() !== "false";
}

// Single choke point: every tool (including the raw productive_request passthrough) calls
// productiveRequest, so this runs no matter which tool made the call.
export function enforceDraftOnly({ method, normalizedPath, body }) {
  if (!isDraftOnlyMode()) return body;
  const upperMethod = method.toUpperCase();
  if (!WRITE_METHODS.has(upperMethod)) return body; // GET is always fine

  const isCommentWrite = COMMENT_PATH_RE.test(normalizedPath) && COMMENT_WRITE_METHODS.has(upperMethod);
  if (!isCommentWrite) {
    throw new Error(
      `Blocked by PRODUCTIVE_DRAFT_ONLY: ${upperMethod} ${normalizedPath} is not allowed. ` +
        `Only creating or editing a comment as a draft is permitted while draft-only mode is on ` +
        `(set PRODUCTIVE_DRAFT_ONLY=false in .env and restart the server to lift this).`,
    );
  }

  // Force draft:true regardless of what was passed in, so a comment can never post live.
  const forced = body && typeof body === "object" ? structuredClone(body) : { data: { type: "comments" } };
  forced.data ||= { type: "comments" };
  forced.data.attributes = { ...(forced.data.attributes || {}), draft: true };
  return forced;
}

async function productiveRequest({ method, path: inputPath, query, body }) {
  const baseUrl = normalizeBaseUrl(process.env.PRODUCTIVE_BASE_URL || DEFAULT_BASE_URL);
  const token = envOrThrow("PRODUCTIVE_TOKEN");
  const organizationId = envOrThrow("PRODUCTIVE_ORGANIZATION_ID");

  const normalizedPath = normalizePath(inputPath);
  const safeBody = enforceDraftOnly({ method, normalizedPath, body });
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
    body: safeBody ? JSON.stringify(safeBody) : undefined,
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
      description: "Lists comments for a specific task id. Attachments (screenshots etc.) are included; pass an attachment id to productive_get_attachment to view it.",
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
            include: "attachments",
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
      description: "Fetches one comment by id, including its attachments.",
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
          query: { include: "attachments" },
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "productive_create_draft_comment",
    {
      description:
        "Creates a DRAFT comment on a task. Drafts are visible only to you in Productive and are " +
        "never posted — this tool always sets draft:true regardless of PRODUCTIVE_DRAFT_ONLY. Open " +
        "the task in Productive and click Post yourself when you're ready to send it.",
      inputSchema: {
        task_id: z
          .union([z.string(), z.number().int()])
          .describe("Task id to comment on, e.g. 20159260."),
        body: z.string().describe("Comment body (plain text or HTML)."),
      },
    },
    async ({ task_id, body }) => {
      try {
        const result = await productiveRequest({
          method: "POST",
          path: "/comments",
          body: {
            data: {
              type: "comments",
              attributes: { body, draft: true },
              relationships: {
                task: { data: { type: "tasks", id: String(task_id) } },
              },
            },
          },
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "productive_get_attachment",
    {
      description:
        "Downloads an attachment (e.g. a screenshot from a comment) by id. Images are returned inline so they can be viewed; other files are described. Optionally saves the file to save_to.",
      inputSchema: {
        id: z
          .union([z.string(), z.number().int()])
          .describe("Attachment id, e.g. 9462083 or \"9462083\"."),
        save_to: z.string().optional().describe("Optional absolute file path to save the downloaded file to."),
      },
    },
    async ({ id, save_to }) => {
      try {
        const meta = await productiveRequest({ method: "GET", path: `/attachments/${id}` });
        const attrs = meta.data?.data?.attributes || {};
        // files.productive.io serves the binary when the API token is passed as ?token=
        const url = new URL(attrs.url);
        url.searchParams.set("token", envOrThrow("PRODUCTIVE_TOKEN"));
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Attachment download failed with status ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (save_to) {
          await fs.writeFile(save_to, buffer);
        }
        const info = {
          id: String(id),
          name: attrs.name,
          content_type: attrs.content_type,
          size: buffer.length,
          ...(save_to ? { saved_to: save_to } : {}),
        };
        const content = [{ type: "text", text: JSON.stringify(info, null, 2) }];
        if ((attrs.content_type || "").startsWith("image/")) {
          content.push({ type: "image", data: buffer.toString("base64"), mimeType: attrs.content_type });
        }
        return { content, structuredContent: info };
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
