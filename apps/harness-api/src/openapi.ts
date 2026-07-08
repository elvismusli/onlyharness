export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "OnlyHarness API",
    version: "0.2.1",
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
          queryParam("job", "Job-to-be-done filter"),
          queryParam("outcome", "Legacy alias for job filter"),
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
    "/resources": {
      get: {
        summary: "Search mixed agent resources",
        description: "Search source-aware agent resources across skills, plugins, workflows, MCP servers, configs, guides, runtimes, directories and harness-format packages. `sourceCheckedAt` means upstream existence/activity was checked; it is not a Verified install badge.",
        parameters: [
          queryParam("q", "Search terms"),
          queryParam("type", "Resource type filter, for example skill, plugin, workflow, mcp_server, harness or directory"),
          queryParam("source", "Source platform filter, for example github or manual"),
          queryParam("installability", "Machine filter: open_only/upstream listing, importable, installable, verified"),
          queryParam("worksWith", "Compatibility filter: claude-code, codex, cursor, mcp, cli or github"),
          queryParam("license", "License status filter"),
          queryParam("sort", "Sort: popular, github-stars, new, source-checked, onlyharness"),
          queryParam("limit", "Maximum result count")
        ],
        responses: {
          "200": {
            description: "Mixed resource search results",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ResourceSearchResult" } } }
          }
        }
      }
    },
    "/resources/{id}": {
      get: {
        summary: "Resource detail",
        description: "Return one mixed resource. Resource ids containing slashes must be URL-encoded, for example github%3Aobra%2Fsuperpowers.",
        parameters: [pathParam("id")],
        responses: {
          "200": {
            description: "Resource detail with provenance, trust and actions",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Resource" } } }
          },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/resources/{id}/archive": {
      get: {
        summary: "Download hosted resource archive",
        description: "Return a tar.gz archive hosted by OnlyHarness for resources that have been materialized into OnlyHarness storage. Does not redirect to upstream GitHub.",
        parameters: [pathParam("id")],
        responses: {
          "200": {
            description: "Resource archive tarball",
            content: { "application/gzip": { schema: { type: "string", format: "binary" } } }
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "Resource is listed but archive is not hosted yet",
            content: { "application/json": { schema: { type: "object" } } }
          }
        }
      }
    },
    "/leaderboard": {
      get: {
        summary: "Top harnesses by qualified heat",
        parameters: [queryParam("limit", "Maximum result count")],
        responses: {
          "200": {
            description: "Leaderboard results. Items appear only after enough real social or verified install signals exist.",
            content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/RegistryItem" } }, minimumSignals: { type: "integer" } }, required: ["items", "minimumSignals"] } } }
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
            description: "The requested item cannot be pulled as files: either link-only directory or hosted execution not available.",
            content: { "application/json": { schema: { oneOf: [{ $ref: "#/components/schemas/DirectoryLinkOnly" }, { $ref: "#/components/schemas/HostedExecutionUnavailable" }] } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/repos/{owner}/{repo}/remixes": {
      post: {
        summary: "Create a local server-side remix draft",
        description: "Auth required. Pulls the source through the same archive gate, rejects paid/org/private/directory or unspecified-license sources, rewrites manifest provenance, removes eval artifacts, writes a free public local draft with evalStatus unknown, and records a source -> fork graph edge.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("owner"), pathParam("repo")],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  title: { type: "string" },
                  summary: { type: "string" },
                  sourceVersion: { type: "string" },
                  version: { type: "string", deprecated: true }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Local remix draft created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    owner: { type: "string" },
                    repo: { type: "string" },
                    item: { $ref: "#/components/schemas/RegistryItem" },
                    snapshotVersion: { type: "string" },
                    verified: { type: "boolean" },
                    remix: {
                      type: "object",
                      properties: {
                        owner: { type: "string" },
                        name: { type: "string" },
                        source: {
                          type: "object",
                          properties: {
                            owner: { type: "string" },
                            repo: { type: "string" },
                            version: { type: "string" }
                          },
                          required: ["owner", "repo", "version"]
                        },
                        forkGraph: {
                          type: "object",
                          properties: {
                            recorded: { type: "boolean" },
                            source: {
                              type: "object",
                              properties: {
                                owner: { type: "string" },
                                repo: { type: "string" },
                                version: { type: "string" }
                              },
                              required: ["owner", "repo", "version"]
                            },
                            fork: {
                              type: "object",
                              properties: {
                                owner: { type: "string" },
                                repo: { type: "string" },
                                version: { type: "string" }
                              },
                              required: ["owner", "repo"]
                            }
                          },
                          required: ["recorded", "source", "fork"]
                        }
                      },
                      required: ["owner", "name", "source", "forkGraph"]
                    }
                  },
                  required: ["owner", "repo", "item", "verified", "remix"]
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "402": {
            description: "Payment required before reading paid source files",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PaymentRequired" } } }
          },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/BadRequest" },
          "422": { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/repos/{owner}/{repo}/star": {
      post: {
        summary: "Star or unstar a harness",
        description: "Auth required. Records the caller's star server-side so browser and agent clients share the same heat signal path.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("owner"), pathParam("repo")],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StarRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "Star state recorded",
            content: { "application/json": { schema: { $ref: "#/components/schemas/StarResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" }
        }
      }
    },
    "/repos/{owner}/{repo}/thread": {
      get: {
        summary: "List harness thread posts",
        parameters: [pathParam("owner"), pathParam("repo")],
        responses: {
          "200": {
            description: "Thread posts",
            content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/ThreadItem" } } }, required: ["items"] } } }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      },
      post: {
        summary: "Create a harness thread post",
        description: "Auth required. Writes through the API social path instead of direct browser Supabase mutations.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("owner"), pathParam("repo")],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ThreadPostRequest" }
            }
          }
        },
        responses: {
          "201": {
            description: "Thread post created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ThreadPostResponse" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "503": { $ref: "#/components/responses/ServiceUnavailable" }
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
    "/prs/{owner}/{repo}/{number}/semantic-diff": {
      get: {
        summary: "Forge PR semantic diff status",
        description: "Org visibility is enforced. Real forge PR diffing is not connected yet; harness detail exposes a local maintainer-review preview under prReview instead.",
        parameters: [pathParam("owner"), pathParam("repo"), pathParam("number")],
        responses: {
          "501": {
            description: "Real forge PR semantic diff is not available yet",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    code: { type: "string", enum: ["PR_SEMANTIC_DIFF_NOT_AVAILABLE"] },
                    owner: { type: "string" },
                    repo: { type: "string" },
                    number: { type: "string" },
                    demo: { $ref: "#/components/schemas/MaintainerReviewPreview" },
                    next: { type: "string" }
                  },
                  required: ["error", "code", "owner", "repo", "number", "next"]
                }
              }
            }
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/billing/checkout": {
      post: {
        summary: "Create a manual checkout session for a paid harness",
        description: "Auth required. Creates a pending purchase through the manual checkout provider. Free harnesses return 400.",
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
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "The harness uses per_call pricing, but hosted execution is not live.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/HostedExecutionUnavailable" } } }
          }
        }
      }
    },
    "/billing/receipt": {
      get: {
        summary: "Read a checkout receipt",
        description: "Auth required. Returns the caller's own purchase receipt by provider_ref without mutating payment or entitlement state.",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "provider_ref",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Provider reference returned by checkout, for example manual_<uuid>."
          }
        ],
        responses: {
          "200": {
            description: "Purchase receipt",
            content: { "application/json": { schema: { $ref: "#/components/schemas/PurchaseReceipt" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/billing/escrow/receipt": {
      post: {
        summary: "Settle a gate escrow purchase from a signed receipt",
        description: "Auth required. Verifies a signed hh gate --receipt payload for the caller's reserved gate_escrow purchase. Passing receipts capture escrow; failing receipts refund escrow. Plain POST /receipts remains read-only.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  provider_ref: { type: "string" },
                  receipt: { $ref: "#/components/schemas/GateReceipt" }
                },
                required: ["provider_ref", "receipt"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Escrow settled",
            content: { "application/json": { schema: { $ref: "#/components/schemas/EscrowSettlement" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/billing/escrow/timeout": {
      post: {
        summary: "Refund an expired gate escrow reservation",
        description: "Auth required. Refunds the caller's reserved gate_escrow purchase only after the 72h receipt window expires.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  provider_ref: { type: "string" }
                },
                required: ["provider_ref"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Escrow timeout settled",
            content: { "application/json": { schema: { $ref: "#/components/schemas/EscrowSettlement" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/BadRequest" }
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
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    item: { $ref: "#/components/schemas/RegistryItem" },
                    output: { type: "string" },
                    snapshotVersion: { type: "string" },
                    warnings: { type: "array", items: { type: "string" } },
                    next: { type: "string" }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/imports/github-resource": {
      post: {
        summary: "Classify a GitHub resource",
        description: "Read-only classifier for GitHub resources. Uses GitHub API only, blocks unsafe hosts, redirects, traversal, symlinks and oversized responses. Upstream listing is allowed; re-hosting/packaging copied files remains blocked until license review passes.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  path: { type: "string" },
                  action: { type: "string", enum: ["classify"] }
                },
                required: ["url"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "GitHub resource classification",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    owner: { type: "string" },
                    repo: { type: "string" },
                    path: { type: "string" },
                    classification: { type: "string" },
                    detectedFiles: { type: "array", items: { type: "string" } },
                    unsafeFiles: { type: "array", items: { type: "string" } },
                    licenseStatus: { type: "string" },
                    licenseName: { type: "string" },
                    recommendedAction: { type: "string" },
                    conversionBlocked: { type: "string" },
                    archiveFetch: { type: "boolean", const: false }
                  },
                  required: ["url", "owner", "repo", "path", "classification", "detectedFiles", "unsafeFiles", "licenseStatus", "recommendedAction", "archiveFetch"]
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
          "413": { $ref: "#/components/responses/BadRequest" },
          "451": { $ref: "#/components/responses/Forbidden" },
          "502": { $ref: "#/components/responses/ServiceUnavailable" }
        }
      }
    },
    "/imports/harness-dir": {
      post: {
        summary: "Publish a verified harness directory",
        description: "Accepts bounded text files from hh publish <dir>. The server requires harness.yaml, .harnesshub/results.json, valid schema, passing security scan, and passing eval/gate before writing a public local harness.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  files: {
                    type: "array",
                    maxItems: 120,
                    items: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                        truncated: { type: "boolean" }
                      },
                      required: ["path", "content"]
                    }
                  }
                },
                required: ["files"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Verified published harness",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    item: { $ref: "#/components/schemas/RegistryItem" },
                    snapshotVersion: { type: "string" },
                    verified: { type: "boolean" },
                    gate: {
                      type: "object",
                      properties: {
                        score: { type: "number" },
                        risk: { type: "number" },
                        cost: { type: "number" },
                        failures: { type: "array", items: { type: "string" } }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "422": { $ref: "#/components/responses/BadRequest" }
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
    "/bounties": {
      get: {
        summary: "List local harness bounties",
        description: "Returns bounty work-state. Payment truth remains the linked gate_escrow purchase.",
        responses: {
          "200": {
            description: "Bounty list",
            content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/Bounty" } } }, required: ["items"] } } }
          }
        }
      },
      post: {
        summary: "Create a local harness bounty",
        description: "Auth required. Creates open bounty work-state; it does not move money.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/BountyCreate" } } }
        },
        responses: {
          "201": {
            description: "Bounty created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Bounty" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" }
        }
      }
    },
    "/bounties/{id}/claim": {
      post: {
        summary: "Claim an open bounty",
        description: "Auth required. The customer cannot claim their own bounty.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("id")],
        responses: {
          "200": {
            description: "Bounty claimed",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Bounty" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/bounties/{id}/deliver": {
      post: {
        summary: "Deliver a bounty with a signed gate receipt",
        description: "Auth required. Only the claimant can deliver, and the receipt must be a passed hh gate --receipt for the delivered harness/version.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("id")],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/BountyDeliver" } } }
        },
        responses: {
          "200": {
            description: "Bounty delivered",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Bounty" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/bounties/{id}/accept": {
      post: {
        summary: "Accept a delivered bounty and capture linked escrow",
        description: "Auth required. Only the customer can accept. The signed passed receipt, delivered target, gate_escrow target, amount and currency must all match. A bounty is marked paid only after the linked escrow purchase is captured.",
        security: [{ bearerAuth: [] }],
        parameters: [pathParam("id")],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/BountyAccept" } } }
        },
        responses: {
          "200": {
            description: "Bounty accepted and paid",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Bounty" } } }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/BadRequest" }
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
    "/orgs/{slug}/imports/harness-dir": {
      post: {
        summary: "Publish a verified harness directory into an organization namespace",
        description: "Requires ORGS_ENABLED=true and a Bearer org token with publish scope. Accepts the same bounded hh publish <dir> payload as /imports/harness-dir, then marks the manifest visibility: org before server-side validation, security scan, eval and gate checks.",
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
                  files: {
                    type: "array",
                    maxItems: 120,
                    items: {
                      type: "object",
                      properties: {
                        path: { type: "string" },
                        content: { type: "string" },
                        truncated: { type: "boolean" }
                      },
                      required: ["path", "content"]
                    }
                  }
                },
                required: ["files"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Verified org-private harness",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    item: { $ref: "#/components/schemas/RegistryItem" },
                    snapshotVersion: { type: "string" },
                    verified: { type: "boolean" },
                    gate: {
                      type: "object",
                      properties: {
                        score: { type: "number" },
                        risk: { type: "number" },
                        cost: { type: "number" },
                        failures: { type: "array", items: { type: "string" } }
                      }
                    }
                  }
                }
              }
            }
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "422": { $ref: "#/components/responses/UnprocessableEntity" }
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
        description: "JSON-RPC MCP endpoint with tools: search_harnesses, harness_detail, pull_instructions, pull_harness, search_resources, resource_detail, resource_use_instructions, search_docs, publish_markdown_to_harness.",
        responses: {
          "200": { description: "MCP JSON-RPC response over JSON or text/event-stream" }
        }
      }
    },
    "/events": {
      post: {
        summary: "Record a privacy-safe registry event",
        description: "Accepts whitelisted event kinds and drops prompts, paths, credentials and arbitrary metadata. Authenticated install events from client=claude-code count toward the works-in-Claude-Code confirms badge; passed gate events count toward registry runs and verification.lastVerifiedAt; suggested/accepted/applied events power the CLI autopilot funnel.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["view", "copy", "install", "pull", "checkout", "purchase", "suggested", "accepted", "applied", "eval", "gate", "escrow_reserved", "escrow_captured", "escrow_refunded"] },
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
    },
    "/receipts": {
      post: {
        summary: "Verify a signed gate receipt",
        description: "Validates an ed25519 hh gate --receipt payload. This endpoint is side-effect-free: it does not store receipts, grant entitlements, settle payments, or ingest prompts/local paths.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GateReceipt" }
            }
          }
        },
        responses: {
          "200": {
            description: "Gate receipt signature verified",
            content: { "application/json": { schema: { $ref: "#/components/schemas/GateReceiptVerification" } } }
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
      },
      ServiceUnavailable: {
        description: "Dependent service unavailable",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    },
    schemas: {
      Health: {
        type: "object",
        properties: {
          ok: { type: "boolean" }
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
          job: { type: "string" },
          outcome: { type: "string" },
          runtime: { type: "string" },
          forgeUrl: { type: "string", description: "Public repository or upstream URL when available. Local filesystem paths are never exposed." },
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
          compatibility: {
            type: "object",
            properties: {
              targets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    status: { type: "string", enum: ["planned", "available", "verified"] },
                    notes: { type: "string" },
                    last_verified_at: { type: "string", format: "date-time" }
                  },
                  required: ["status"]
                }
              }
            },
            required: ["targets"]
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
          signalCount: { type: "number" },
          heatQualified: { type: "boolean" },
          heat: { type: "number" },
          heatDelta: { type: "number" },
          freshness: { type: "string" },
          badge: { type: "string" },
          cliCommand: { type: "string" },
          updatedAt: { type: "string" }
        },
        required: ["owner", "name", "title", "summary", "tags", "contentType", "compatibility", "valid", "riskTier", "evalStatus", "contextCost", "standard", "cliCommand"]
      },
      ResourceSearchResult: {
        type: "object",
        properties: {
          resources: { type: "array", items: { $ref: "#/components/schemas/Resource" } },
          items: { type: "array", items: { $ref: "#/components/schemas/Resource" } },
          counts: {
            type: "object",
            properties: {
              externalSeed: { type: "integer" },
              internal: { type: "integer" },
              total: { type: "integer" }
            },
            required: ["externalSeed", "internal", "total"]
          }
        },
        required: ["resources", "items", "counts"]
      },
      Resource: {
        type: "object",
        properties: {
          id: { type: "string" },
          identity: { type: "object" },
          sourceCatalogId: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          summaryOriginal: { type: "string" },
          resourceType: { type: "string", enum: ["harness", "skill", "plugin", "workflow", "mcp_server", "service_endpoint", "agent_team", "subagent_pack", "command_pack", "config", "guide", "framework", "agent_runtime", "directory"] },
          sourcePlatform: { type: "string" },
          canonicalUrl: { type: "string" },
          mirror: {
            type: "object",
            properties: {
              platform: { type: "string", enum: ["github"] },
              owner: { type: "string" },
              repo: { type: "string" },
              fullName: { type: "string" },
              url: { type: "string" },
              cloneUrl: { type: "string" },
              defaultBranch: { type: "string" },
              defaultBranchOnly: { type: "boolean" },
              fork: { type: "boolean" },
              sourceUrl: { type: "string" },
              status: { type: "string", enum: ["ready", "pending", "failed"] },
              syncedAt: { type: "string" },
              error: { type: "string" }
            }
          },
          upstreamId: { type: "string" },
          upstreamOwner: { type: "string" },
          upstreamRepo: { type: "string" },
          creatorName: { type: "string" },
          licenseStatus: { type: "string", enum: ["permissive", "copyleft", "proprietary", "unknown", "blocked", "manual_review"] },
          licenseName: { type: "string" },
          sourceCheckedAt: { type: "string", description: "Date upstream existence/activity was checked. This is not product install verification." },
          sourceCheckMethod: { type: "string", enum: ["github_api", "marketplace_api", "manual_research"] },
          sourceCheckStatus: { type: "string", enum: ["active", "stale", "archived", "unavailable"] },
          lastSeenAt: { type: "string" },
          installability: { type: "string", enum: ["open_only", "importable", "installable", "verified"] },
          tags: { type: "array", items: { type: "string" } },
          worksWith: { type: "array", items: { type: "string", enum: ["claude-code", "codex", "cursor", "mcp", "cli", "github"] } },
          upstreamPopularity: { type: "object" },
          onlyHarnessSignals: { type: "object" },
          popularityScore: { type: "number" },
          popularityBreakdown: { type: "object" },
          trust: {
            type: "object",
            properties: {
              sourceChecked: { type: "boolean" },
              securityScan: { type: "string", enum: ["pass", "warn", "fail", "not_scanned"] },
              installVerifiedAt: { type: "string", description: "OnlyHarness install verification evidence, when present." },
              gateVerifiedAt: { type: "string" },
              riskTier: { type: "string" }
            }
          },
          actions: { type: "array", items: { type: "object" } },
          source: { type: "object" }
        },
        required: ["id", "identity", "title", "summary", "resourceType", "sourcePlatform", "canonicalUrl", "licenseStatus", "sourceCheckedAt", "sourceCheckStatus", "lastSeenAt", "installability", "tags", "worksWith", "popularityScore", "trust", "actions"]
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
          verification: {
            type: "object",
            properties: {
              lastVerifiedAt: { type: "string", format: "date-time" }
            }
          },
          example: { type: "object" },
          files: { type: "array", items: { type: "string" } },
          versions: { type: "array", items: { $ref: "#/components/schemas/ArchiveVersion" } },
          prReview: { $ref: "#/components/schemas/MaintainerReviewPreview" },
          readme: { type: "string" }
        }
      },
      MaintainerReviewPreview: {
        type: "object",
        description: "Generated local maintainer-review preview. It is not evidence of an open forge pull request when demo=true.",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          number: { type: ["integer", "null"] },
          title: { type: "string" },
          source: { type: "string", enum: ["local-demo", "forge-pr"] },
          demo: { type: "boolean" },
          status: { type: "string", enum: ["passed", "review", "failed"] },
          markdown: { type: "string" },
          next: { type: "string" },
          diff: {
            type: "object",
            properties: {
              riskDelta: { type: "number" },
              riskTier: { type: "string" },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    severity: { type: "string" },
                    area: { type: "string" },
                    message: { type: "string" }
                  },
                  required: ["severity", "area", "message"]
                }
              }
            },
            required: ["riskDelta", "riskTier", "changes"]
          }
        },
        required: ["owner", "repo", "number", "title", "source", "demo", "status", "markdown", "next", "diff"]
      },
      ArchiveVersion: {
        type: "object",
        properties: {
          version: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          snapshot: { type: "boolean" },
          current: { type: "boolean" },
          fileCount: { type: "number" }
        },
        required: ["version", "createdAt", "snapshot", "current", "fileCount"]
      },
      ThreadItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          author: { type: "string" },
          userId: { type: "string" },
          role: { type: "string" },
          kind: { type: "string", enum: ["question", "recipe", "result", "proposal", "bug/risk"] },
          body: { type: "string" },
          likes: { type: "number" },
          at: { type: "string" }
        },
        required: ["id", "author", "role", "kind", "body", "likes", "at"]
      },
      StarRequest: {
        type: "object",
        properties: {
          starred: { type: "boolean", description: "false removes the caller's star; omitted or true records a star." }
        }
      },
      StarResponse: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          starred: { type: "boolean" }
        },
        required: ["owner", "repo", "starred"]
      },
      ThreadPostRequest: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["question", "recipe", "result", "proposal", "bug/risk"] },
          body: { type: "string", minLength: 2, maxLength: 2000 }
        },
        required: ["body"]
      },
      ThreadPostResponse: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          item: { $ref: "#/components/schemas/ThreadItem" }
        },
        required: ["owner", "repo", "item"]
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
      HostedExecutionUnavailable: {
        type: "object",
        properties: {
          error: { type: "string", enum: ["Hosted execution not available"] },
          code: { type: "string", enum: ["HOSTED_EXECUTION_NOT_AVAILABLE"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          pricing: { type: "object" },
          next: { type: "string" }
        },
        required: ["error", "code", "owner", "repo", "version", "pricing", "next"]
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
      PurchaseReceipt: {
        type: "object",
        properties: {
          receipt_id: { type: "string" },
          purchase_id: { type: "string" },
          provider: { type: "string", enum: ["manual", "x402"] },
          provider_ref: { type: "string" },
          status: { type: "string", enum: ["pending", "paid", "reserved", "captured", "refunded", "failed"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          pricing_model: { type: "string", enum: ["free", "one_time", "subscription", "per_call", "gate_escrow"] },
          amount_usd: { type: "number" },
          currency: { type: "string" },
          subject: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["user", "wallet", "org"] },
              id: { type: "string" }
            },
            required: ["type", "id"]
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
          entitlement: {
            type: "object",
            properties: {
              granted: { type: "boolean" },
              kind: { type: "string", enum: ["one_time", "subscription", "escrow_reserved"] },
              expires_at: { type: ["string", "null"], format: "date-time" }
            },
            required: ["granted"]
          },
          escrow: {
            type: "object",
            properties: {
              expires_at: { type: ["string", "null"], format: "date-time" },
              receipt_hash: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{64}$" },
              captured_at: { type: ["string", "null"], format: "date-time" },
              refunded_at: { type: ["string", "null"], format: "date-time" }
            }
          }
        },
        required: ["receipt_id", "purchase_id", "provider", "provider_ref", "status", "owner", "repo", "version", "amount_usd", "currency", "subject", "created_at", "updated_at", "entitlement"]
      },
      EscrowSettlement: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [true] },
          status: { type: "string", enum: ["captured", "refunded", "already_captured", "already_refunded"] },
          owner: { type: "string" },
          repo: { type: "string" },
          version: { type: "string" },
          subject_id: { type: "string" },
          purchase_id: { type: "string" },
          receipt_hash: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
          escrow_expires_at: { type: ["string", "null"], format: "date-time" },
          reason: { type: "string", enum: ["receipt_passed", "receipt_failed", "timeout"] }
        },
        required: ["ok", "status", "owner", "repo", "version", "subject_id", "purchase_id", "reason"]
      },
      Bounty: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          spec: { type: "string" },
          budget_usd: { type: "number" },
          currency: { type: "string" },
          status: { type: "string", enum: ["open", "claimed", "delivered", "paid"] },
          customer_user_id: { type: "string" },
          claimant_user_id: { type: ["string", "null"] },
          delivered_harness: { type: ["string", "null"] },
          delivered_version: { type: ["string", "null"] },
          delivery_receipt_hash: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{64}$" },
          accepted_receipt_hash: { type: ["string", "null"], pattern: "^[a-fA-F0-9]{64}$" },
          payment_purchase_id: { type: ["string", "null"] },
          escrow_provider_ref: { type: ["string", "null"] },
          paid_at: { type: ["string", "null"], format: "date-time" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" }
        },
        required: ["id", "title", "spec", "budget_usd", "currency", "status", "customer_user_id", "created_at", "updated_at"]
      },
      BountyCreate: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 4, maxLength: 120 },
          spec: { type: "string", minLength: 20, maxLength: 20000 },
          budget_usd: { type: "number", exclusiveMinimum: 0 },
          currency: { type: "string", pattern: "^[A-Za-z]{3}$", default: "USD" }
        },
        required: ["title", "spec", "budget_usd"]
      },
      BountyDeliver: {
        type: "object",
        properties: {
          harness: { type: "string" },
          version: { type: "string" },
          receipt: { $ref: "#/components/schemas/GateReceipt" }
        },
        required: ["receipt"]
      },
      BountyAccept: {
        type: "object",
        properties: {
          provider_ref: { type: "string" },
          receipt: { $ref: "#/components/schemas/GateReceipt" }
        },
        required: ["provider_ref", "receipt"]
      },
      GateReceipt: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["onlyharness.gate_receipt.v1"] },
          algorithm: { type: "string", enum: ["ed25519"] },
          payload: { $ref: "#/components/schemas/GateReceiptPayload" },
          publicKey: { type: "string", description: "SPKI PEM public key derived from the local install key." },
          signature: { type: "string", description: "Base64 ed25519 signature over the stable JSON payload." }
        },
        required: ["type", "algorithm", "payload", "publicKey", "signature"]
      },
      GateReceiptPayload: {
        type: "object",
        properties: {
          harness: { type: "string", description: "Harness ref, for example harnesses/deep-market-researcher or @org/name." },
          version: { type: "string" },
          resultsHash: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
          verdict: { type: "string", enum: ["passed", "failed"] },
          at: { type: "string", format: "date-time" },
          gate: {
            type: "object",
            properties: {
              score: { type: "number" },
              risk: { type: "number" },
              cost: { type: "number" },
              failures: { type: "array", items: { type: "string" } }
            },
            required: ["score", "risk", "cost", "failures"]
          }
        },
        required: ["harness", "version", "resultsHash", "verdict", "at", "gate"]
      },
      GateReceiptVerification: {
        type: "object",
        properties: {
          ok: { type: "boolean", enum: [true] },
          receipt_hash: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
          harness: { type: "string" },
          version: { type: "string" },
          verdict: { type: "string", enum: ["passed", "failed"] },
          resultsHash: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
          at: { type: "string", format: "date-time" }
        },
        required: ["ok", "receipt_hash", "harness", "version", "verdict", "resultsHash", "at"]
      },
      PaymentWebhookResult: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          status: { type: "string", enum: ["paid", "already_paid", "reserved", "already_reserved", "already_captured", "already_refunded"] },
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
