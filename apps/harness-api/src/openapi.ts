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
            headers: {
              "PAYMENT-REQUIRED": {
                description: "Base64 JSON x402 v2 PaymentRequired payload when X402_ENABLED and X402_PAY_TO are configured.",
                schema: { type: "string" }
              }
            },
            content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } }
          },
          "409": {
            description: "The requested item is a link-only directory, not a runnable harness archive.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/DirectoryLinkOnly" } } }
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
    "/entitlements/check": {
      get: {
        summary: "Check whether a subject can access a harness",
        description: "Bot-facing read-only check. Requires ORGS_ENABLED=true and a Bearer org token with entitlements:read scope. The token authorizes the check but is never treated as a buyer entitlement.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "subject",
            in: "query",
            required: true,
            schema: { type: "string", pattern: "^(user|wallet|org):" },
            description: "Subject ref, for example user:<id>, wallet:<address> or org:<slug>."
          },
          {
            name: "harness",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Harness ref as owner/name, including @org/name for org-private harnesses."
          },
          queryParam("version", "Optional immutable archive version")
        ],
        responses: {
          "200": {
            description: "Entitlement decision",
            content: { "application/json": { schema: { $ref: "#/components/schemas/EntitlementCheck" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/community/invite-code": {
      post: {
        summary: "Create a short-lived community gate code",
        description: "Auth required. Verifies the current user's entitlement before minting a signed short-lived code that can be pasted into a Discord or Telegram gate bot.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  harness: { type: "string", description: "Harness ref as owner/name." },
                  owner: { type: "string" },
                  repo: { type: "string" },
                  version: { type: "string" },
                  ttl_seconds: { type: "integer", minimum: 60, maximum: 3600 }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Community invite code minted",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CommunityInviteCode" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "402": {
            description: "The authenticated user is not entitled to this paid harness",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
          },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/community/verify-code": {
      post: {
        summary: "Verify a community gate code",
        description: "Bot-facing verification. Requires ORGS_ENABLED=true and a Bearer org token with entitlements:read scope. The code is HMAC verified, checked for expiry, then entitlement is checked live before the bot grants access.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  code: { type: "string" }
                },
                required: ["code"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Community code decision",
            content: { "application/json": { schema: { $ref: "#/components/schemas/CommunityVerifyCode" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "410": {
            description: "Community code expired",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
          }
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
    "/orgs/{slug}/workspace": {
      get: {
        summary: "Read organization Network Neighborhood workspace",
        description: "Requires ORGS_ENABLED=true and a Bearer org token with read, setup or publish scope. Returns org-private registry cards, sanitized audit rows and aggregated permission risk.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("slug")],
        responses: {
          "200": {
            description: "Organization workspace",
            content: { "application/json": { schema: { $ref: "#/components/schemas/OrgWorkspaceResponse" } } }
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
        description: "Accepts whitelisted event kinds and drops prompts, paths, credentials and arbitrary metadata. Authenticated install events from client=claude-code count toward the works-in-Claude-Code confirms badge.",
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
          contentType: { type: "string", enum: ["harness", "directory"] },
          directory: {
            type: "object",
            properties: {
              url: { type: "string" },
              itemCount: { type: "integer", minimum: 0 },
              category: { type: "string" },
              notes: { type: "string" }
            }
          },
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
          installConfirms: { type: "number" },
          heat: { type: "number" },
          heatDelta: { type: "number" },
          freshness: { type: "string" },
          badge: { type: "string" },
          cliCommand: { type: "string" },
          updatedAt: { type: "string" }
        },
        required: ["owner", "name", "title", "summary", "tags", "contentType", "valid", "riskTier", "evalStatus", "contextCost", "standard", "cliCommand"]
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
          x402: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              requirements: {
                type: "array",
                items: { $ref: "#/components/schemas/X402PaymentRequirements" }
              },
              paymentRequired: {
                oneOf: [
                  { $ref: "#/components/schemas/X402PaymentRequired" },
                  { type: "null" }
                ]
              }
            },
            required: ["enabled", "requirements", "paymentRequired"]
          },
          next: { type: "string" }
        },
        required: ["error", "code", "owner", "repo", "version", "pricing", "provider", "checkout_url", "payments_enabled", "x402", "next"]
      },
      DirectoryLinkOnly: {
        type: "object",
        properties: {
          error: { type: "string", enum: ["Directory link only"] },
          code: { type: "string", enum: ["DIRECTORY_LINK_ONLY"] },
          owner: { type: "string" },
          repo: { type: "string" },
          url: { type: "string" },
          item_count: { type: "integer", minimum: 0 },
          category: { type: "string" },
          notes: { type: "string" },
          next: { type: "string" }
        },
        required: ["error", "code", "owner", "repo", "next"]
      },
      X402PaymentRequired: {
        type: "object",
        properties: {
          x402Version: { type: "integer", enum: [2] },
          error: { type: "string", enum: ["Payment required"] },
          resource: {
            type: "object",
            properties: {
              url: { type: "string" },
              description: { type: "string" },
              mimeType: { type: "string", enum: ["application/json"] }
            },
            required: ["url", "description", "mimeType"]
          },
          accepts: {
            type: "array",
            items: { $ref: "#/components/schemas/X402PaymentRequirements" }
          }
        },
        required: ["x402Version", "error", "resource", "accepts"]
      },
      X402PaymentRequirements: {
        type: "object",
        properties: {
          scheme: { type: "string", enum: ["exact"] },
          network: { type: "string" },
          asset: { type: "string" },
          amount: { type: "string", description: "USDC atomic units; 9000000 means $9.00 for six-decimal USDC." },
          payTo: { type: "string" },
          maxTimeoutSeconds: { type: "integer" },
          extra: {
            type: "object",
            properties: {
              name: { type: "string" },
              version: { type: "string" }
            },
            required: ["name", "version"]
          }
        },
        required: ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds", "extra"]
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
      EntitlementCheck: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          entitled: { type: "boolean" },
          status: { type: "string", enum: ["free", "entitled", "payment_required"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          subject_type: { type: "string", enum: ["user", "wallet", "org"] },
          subject_id: { type: "string" },
          pricing: { type: "object" }
        },
        required: ["ok", "entitled", "status", "owner", "repo", "version", "subject_type", "subject_id", "pricing"]
      },
      CommunityInviteCode: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          code: { type: "string" },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          subject_type: { type: "string", enum: ["user"] },
          subject_id: { type: "string" },
          expires_at: { type: "string", format: "date-time" },
          next: { type: "string" }
        },
        required: ["ok", "code", "owner", "repo", "version", "subject_type", "subject_id", "expires_at", "next"]
      },
      CommunityVerifyCode: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          allowed: { type: "boolean" },
          entitled: { type: "boolean" },
          status: { type: "string", enum: ["free", "entitled", "payment_required"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          subject_type: { type: "string", enum: ["user", "wallet", "org"] },
          subject_id: { type: "string" },
          pricing: { type: "object" }
        },
        required: ["ok", "allowed", "entitled", "status", "owner", "repo", "version", "subject_type", "subject_id", "pricing"]
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
      OrgWorkspaceResponse: {
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
          items: { type: "array", items: { $ref: "#/components/schemas/RegistryItem" } },
          permissions: { $ref: "#/components/schemas/OrgPermissionSummary" },
          audit: { type: "array", items: { $ref: "#/components/schemas/OrgAuditEntry" } }
        },
        required: ["organization", "items", "permissions", "audit"]
      },
      OrgPermissionSummary: {
        type: "object",
        properties: {
          totalHarnesses: { type: "integer", minimum: 0 },
          riskTiers: {
            type: "object",
            properties: {
              LOW: { type: "integer", minimum: 0 },
              MEDIUM: { type: "integer", minimum: 0 },
              HIGH: { type: "integer", minimum: 0 },
              CRITICAL: { type: "integer", minimum: 0 }
            },
            required: ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
          },
          maxRiskScore: { type: "integer", minimum: 0, maximum: 100 },
          maxRiskTier: { type: "string", enum: ["NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"] },
          permissionCounts: {
            type: "object",
            properties: {
              unrestrictedNetwork: { type: "integer", minimum: 0 },
              shell: { type: "integer", minimum: 0 },
              browser: { type: "integer", minimum: 0 },
              credentials: { type: "integer", minimum: 0 },
              externalSend: { type: "integer", minimum: 0 },
              moneyMovement: { type: "integer", minimum: 0 },
              userData: { type: "integer", minimum: 0 }
            },
            required: ["unrestrictedNetwork", "shell", "browser", "credentials", "externalSend", "moneyMovement", "userData"]
          },
          riskMarkdown: { type: "string" }
        },
        required: ["totalHarnesses", "riskTiers", "maxRiskScore", "maxRiskTier", "permissionCounts", "riskMarkdown"]
      },
      OrgAuditEntry: {
        type: "object",
        properties: {
          slug: { type: "string" },
          action: { type: "string" },
          token_name: { type: ["string", "null"] },
          subject: { type: ["string", "null"] },
          target: { type: ["string", "null"] },
          at: { type: "string", format: "date-time" }
        },
        required: ["slug", "action", "token_name", "subject", "target", "at"]
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
