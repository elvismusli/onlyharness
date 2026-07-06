export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "OnlyHarness API",
    version: "0.2.0",
    description: "Search, inspect, pull and publish reusable AI-agent harnesses."
  },
  servers: [
    { url: "https://onlyharness.com/api", description: "Production" },
    { url: "http://127.0.0.1:8787", description: "Local development" }
  ],
  paths: {
    "/healthz": {
      get: {
        summary: "Health check",
        responses: {
          "200": {
            description: "API health",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } }
          }
        }
      }
    },
    "/registry": {
      get: {
        summary: "Search harness registry",
        parameters: [
          queryParam("q", "Search terms"),
          queryParam("risk", "Risk tier filter"),
          queryParam("eval", "Eval status filter"),
          queryParam("runtime", "Runtime filter"),
          queryParam("outcome", "Outcome filter"),
          queryParam("sort", "Sort: trending, stars, forks, threads, new")
        ],
        responses: {
          "200": {
            description: "Registry search results",
            content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/RegistryItem" } } }, required: ["items"] } } }
          }
        }
      }
    },
    "/leaderboard": {
      get: {
        summary: "Top harnesses by heat",
        parameters: [queryParam("limit", "Maximum result count")],
        responses: {
          "200": {
            description: "Leaderboard results",
            content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/RegistryItem" } } }, required: ["items"] } } }
          }
        }
      }
    },
    "/repos/{owner}/{repo}/harness": {
      get: {
        summary: "Harness detail",
        parameters: [pathParam("owner"), pathParam("repo")],
        responses: {
          "200": {
            description: "Harness manifest, trust signals, examples, files and review preview",
            content: { "application/json": { schema: { $ref: "#/components/schemas/HarnessDetail" } } }
          },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/repos/{owner}/{repo}/archive": {
      get: {
        summary: "Download harness files",
        parameters: [pathParam("owner"), pathParam("repo")],
        responses: {
          "200": {
            description: "Archive payload",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Archive" } } }
          },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/repos/{owner}/{repo}/security-report": {
      get: {
        summary: "Static security report",
        parameters: [pathParam("owner"), pathParam("repo")],
        responses: {
          "200": {
            description: "Static security scanner verdict",
            content: { "application/json": { schema: { $ref: "#/components/schemas/SecurityReport" } } }
          },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/imports/markdown-to-harness": {
      post: {
        summary: "Publish markdown as an unverified harness scaffold",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  markdown: { type: "string", minLength: 20 }
                },
                required: ["markdown"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Imported harness",
            content: { "application/json": { schema: { type: "object", properties: { item: { $ref: "#/components/schemas/RegistryItem" }, output: { type: "string" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/mcp": {
      post: {
        summary: "MCP Streamable HTTP endpoint",
        description: "JSON-RPC MCP endpoint with tools: search_harnesses, harness_detail, pull_instructions, search_docs, publish_markdown_to_harness.",
        responses: {
          "200": { description: "MCP JSON-RPC response over JSON or text/event-stream" }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" }
    },
    responses: {
      BadRequest: {
        description: "Bad request",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      Unauthorized: {
        description: "Authorization required",
        headers: {
          "WWW-Authenticate": {
            schema: { type: "string" },
            description: "Bearer challenge with resource_metadata URL."
          }
        },
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      NotFound: {
        description: "Resource not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    },
    schemas: {
      Health: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          workspaceRoot: { type: "string" }
        },
        required: ["ok"]
      },
      RegistryItem: {
        type: "object",
        properties: {
          owner: { type: "string" },
          ownerLabel: { type: "string" },
          name: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          outcome: { type: "string" },
          runtime: { type: "string" },
          valid: { type: "boolean" },
          riskScore: { type: "number" },
          riskTier: { type: "string" },
          evalStatus: { type: "string" },
          evalScore: { type: "number" },
          standard: { type: "string", enum: ["conformant", "partial"] },
          stars: { type: "number" },
          forks: { type: "number" },
          threads: { type: "number" },
          runs: { type: "number" },
          heat: { type: "number" },
          heatDelta: { type: "number" },
          freshness: { type: "string" },
          badge: { type: "string" },
          cliCommand: { type: "string" },
          updatedAt: { type: "string" }
        },
        required: ["owner", "name", "title", "summary", "tags", "valid", "riskTier", "evalStatus", "standard", "cliCommand"]
      },
      HarnessDetail: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          manifest: { type: "object" },
          valid: { type: "boolean" },
          issues: { type: "array", items: { type: "object" } },
          risk: { type: "object" },
          security: { $ref: "#/components/schemas/SecurityReport" },
          standard: { type: "string", enum: ["conformant", "partial"] },
          evalResult: { type: "object" },
          example: { type: "object" },
          files: { type: "array", items: { type: "string" } },
          readme: { type: "string" }
        }
      },
      Archive: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                truncated: { type: "boolean" },
                content: { type: "string" }
              },
              required: ["path", "truncated", "content"]
            }
          }
        },
        required: ["owner", "repo", "files"]
      },
      SecurityReport: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["pass", "warn", "fail"] },
          scanner: { type: "string" },
          findings: { type: "array", items: { type: "object" } }
        }
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" }
        },
        required: ["error"]
      }
    }
  }
} as const;

function queryParam(name: string, description: string) {
  return {
    name,
    in: "query",
    required: false,
    schema: { type: "string" },
    description
  };
}

function pathParam(name: string) {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string" }
  };
}
