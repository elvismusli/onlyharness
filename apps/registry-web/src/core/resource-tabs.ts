export const RESOURCE_TABS = ["All", "Skills", "Plugins", "Workflows", "MCP", "Runtimes", "Guides", "Harnesses"] as const;
export type ResourceTab = (typeof RESOURCE_TABS)[number];
