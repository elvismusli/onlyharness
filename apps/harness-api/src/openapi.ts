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
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/repos/{owner}/{repo}/archive": {
      get: {
        summary: "Download harness files",
        parameters: [pathParam("owner"), pathParam("repo"), queryParam("version", "Optional immutable archive version")],
        responses: {
          "200": {
            description: "Archive payload",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Archive" } } }
          },
          "402": {
            description: "Payment required for a paid harness archive",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
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
    "/billing/checkout": {
      post: {
        summary: "Create a manual checkout session for a paid harness",
        description: "Auth required. Creates a pending purchase through the configured payment provider. Free harnesses return 400.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  owner: { type: "string" },
                  repo: { type: "string" },
                  version: { type: "string" },
                  ref: { type: "string" }
                },
                required: ["owner", "repo"]
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Checkout session created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CheckoutSession" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
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
    "/me/storefront": {
      get: {
        summary: "Return the authenticated user's creator storefront profile",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Storefront profile",
            content: { "application/json": { schema: { $ref: "#/components/schemas/StorefrontProfile" } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      },
      put: {
        summary: "Create or update the authenticated user's creator handle",
        description: "Creates a safe public handle/profile and a creator referral code. Email is never exposed.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  handle: { type: "string" },
                  display_name: { type: "string" },
                  bio: { type: "string" }
                },
                required: ["handle"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Updated storefront profile",
            content: { "application/json": { schema: { $ref: "#/components/schemas/StorefrontProfile" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "409": { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/storefront/{handle}": {
      get: {
        summary: "Public creator storefront by handle",
        description: "Returns only safe profile fields, creator referral code and currently published harnesses.",
        parameters: [pathParam("handle")],
        responses: {
          "200": {
            description: "Creator storefront",
            content: { "application/json": { schema: { $ref: "#/components/schemas/StorefrontPage" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/orgs/{slug}/bundle": {
      get: {
        summary: "Read an organization setup bundle",
        description: "Requires ORGS_ENABLED=true and a Bearer org token with setup or read scope. Returns pinned harness refs and safe config snippets for hh setup.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("slug")],
        responses: {
          "200": {
            description: "Organization setup bundle",
            content: { "application/json": { schema: { $ref: "#/components/schemas/OrgBundleResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/orgs/{slug}/imports/markdown-to-harness": {
      post: {
        summary: "Publish markdown into an organization namespace",
        description: "Requires ORGS_ENABLED=true and a Bearer org token with publish scope. The generated manifest is marked visibility: org.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("slug")],
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
            description: "Imported org harness",
            content: { "application/json": { schema: { type: "object", properties: { item: { $ref: "#/components/schemas/RegistryItem" }, output: { type: "string" }, snapshotVersion: { type: "string" } } } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/webhooks/payments": {
      post: {
        summary: "Settle a manual payment webhook",
        description: "Requires HARNESS_WEBHOOK_TOKEN via x-harness-token. Marks the purchase paid and grants entitlement idempotently.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  provider: { type: "string", enum: ["manual"] },
                  provider_ref: { type: "string" },
                  status: { type: "string", enum: ["paid", "succeeded"] }
                },
                required: ["provider_ref"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Payment settled",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentWebhookResult" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/mcp": {
      post: {
        summary: "MCP Streamable HTTP endpoint",
        description: "JSON-RPC MCP endpoint with tools: search_harnesses, harness_detail, pull_instructions, pull_harness, search_docs, publish_markdown_to_harness.",
        responses: {
          "200": { description: "MCP JSON-RPC response over JSON or text/event-stream" }
        }
      }
    },
    "/events": {
      post: {
        summary: "Record a privacy-safe registry event",
        description: "Accepts whitelisted event kinds and drops prompts, paths, credentials and arbitrary metadata.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["view", "copy", "install", "pull", "checkout", "purchase", "suggested", "applied"] },
                  owner: { type: "string" },
                  repo: { type: "string" },
                  version: { type: "string" },
                  target: { type: "string" },
                  client: { type: "string" }
                },
                required: ["kind"]
              }
            }
          }
        },
        responses: {
          "202": {
            description: "Event accepted",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" }
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
      Forbidden: {
        description: "Authorization was provided but is not allowed for this action",
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
          contextCost: { $ref: "#/components/schemas/ContextCost" },
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
        required: ["owner", "name", "title", "summary", "tags", "valid", "riskTier", "evalStatus", "contextCost", "standard", "cliCommand"]
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
          contextCost: { $ref: "#/components/schemas/ContextCost" },
          standard: { type: "string", enum: ["conformant", "partial"] },
          evalResult: { type: "object" },
          example: { type: "object" },
          files: { type: "array", items: { type: "string" } },
          readme: { type: "string" }
        }
      },
      ContextCost: {
        type: "object",
        description: "Deterministic estimate from markdown instruction files. It is not a measured LLM bill.",
        properties: {
          approxTokens: { type: "number" },
          files: { type: "number" },
          bytes: { type: "number" },
          status: { type: "string", enum: ["estimated"] }
        },
        required: ["approxTokens", "files", "bytes", "status"]
      },
      Archive: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          snapshot: { type: "boolean" },
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
        required: ["owner", "repo", "version", "snapshot", "files"]
      },
      PaymentRequired: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string", enum: ["PAYMENT_REQUIRED"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          pricing: { type: "object" },
          provider: { type: "string", enum: ["manual"] },
          checkout_url: { type: "string" },
          payments_enabled: { type: "boolean" },
          x402: { type: "object" },
          next: { type: "string" }
        },
        required: ["error", "code", "owner", "repo", "version", "pricing", "provider", "checkout_url", "payments_enabled", "x402", "next"]
      },
      CheckoutSession: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["manual"] },
          provider_ref: { type: "string" },
          checkout_url: { type: "string" },
          status: { type: "string", enum: ["pending"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          pricing: { type: "object" },
          next: { type: "string" }
        },
        required: ["provider", "provider_ref", "checkout_url", "status", "owner", "repo", "version", "pricing", "next"]
      },
      PaymentWebhookResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          status: { type: "string", enum: ["paid", "already_paid"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          subject_id: { type: "string" },
          purchase_id: { type: "string" }
        },
        required: ["ok", "status", "owner", "repo", "version", "subject_id"]
      },
      StorefrontProfile: {
        type: "object",
        properties: {
          user_id: { type: "string" },
          handle: { type: "string" },
          display_name: { type: "string" },
          bio: { type: "string" },
          referral_code: { type: "string" }
        },
        required: ["user_id", "handle", "display_name", "bio", "referral_code"]
      },
      StorefrontPage: {
        type: "object",
        properties: {
          profile: {
            type: "object",
            properties: {
              handle: { type: "string" },
              display_name: { type: "string" },
              bio: { type: "string" }
            },
            required: ["handle", "display_name", "bio"]
          },
          referralCode: { type: "string" },
          items: { type: "array", items: { $ref: "#/components/schemas/RegistryItem" } }
        },
        required: ["profile", "referralCode", "items"]
      },
      OrgBundleResponse: {
        type: "object",
        properties: {
          organization: {
            type: "object",
            properties: {
              slug: { type: "string" },
              name: { type: "string" },
              plan: { type: "string", enum: ["free", "team", "enterprise"] }
            },
            required: ["slug", "name", "plan"]
          },
          bundle: { $ref: "#/components/schemas/OrgBundle" }
        },
        required: ["organization", "bundle"]
      },
      OrgBundle: {
        type: "object",
        properties: {
          version: { type: "string" },
          harnesses: {
            type: "array",
            items: { $ref: "#/components/schemas/OrgBundleHarness" }
          },
          configs: {
            type: "array",
            items: { $ref: "#/components/schemas/OrgBundleConfig" }
          }
        },
        required: ["version", "harnesses", "configs"]
      },
      OrgBundleHarness: {
        type: "object",
        properties: {
          owner: { type: "string" },
          name: { type: "string" },
          version: { type: "string" },
          target: { type: "string" }
        },
        required: ["owner", "name"]
      },
      OrgBundleConfig: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
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
