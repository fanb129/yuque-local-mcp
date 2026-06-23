#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { findAllowedBook } from "./allowlist.js";
import { YuqueCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { YuqueBrowser } from "./yuqueBrowser.js";

const config = loadConfig();
const cache = new YuqueCache(config.cacheDir);
const yuque = new YuqueBrowser(config.browser, config.writeSafety);

const server = new McpServer({
  name: "yuque-local-mcp",
  version: "0.1.0",
  description:
    "Only access Yuque books configured in the local allowlist. Never use Yuque global search or modify unallowlisted books. Write tools require explicit user approval from the MCP host and, by default, human review in the browser before saving."
});

function text(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2)
      }
    ]
  };
}

server.registerTool(
  "yuque_allowed_books",
  {
    title: "List Allowed Yuque Books",
    description: "List the Yuque books this MCP server is allowed to access.",
    inputSchema: z.object({})
  },
  async () =>
    text({
      allowedBooks: config.allowedBooks.map(({ name, origin, group, book, bookId }) => ({
        name,
        origin,
        group,
        book,
        bookId
      }))
    })
);

server.registerTool(
  "yuque_open_login",
  {
    title: "Open Yuque Login",
    description:
      "Open a persistent local browser session so the user can log in to Yuque. The browser profile is reused by other tools.",
    inputSchema: z.object({
      origin: z.string().url().default("https://www.yuque.com")
    })
  },
  async ({ origin }) => {
    const url = await yuque.openForLogin(origin);
    return text({
      message: "Yuque browser opened. Log in manually if needed, then call read/create/update tools again.",
      url
    });
  }
);

server.registerTool(
  "yuque_read_doc",
  {
    title: "Read Yuque Document",
    description: "Read one document from an allowed Yuque book and cache the result locally.",
    inputSchema: z.object({
      url: z.string().url()
    })
  },
  async ({ url }) => {
    const allowed = findAllowedBook(url, config.allowedBooks);
    const doc = await yuque.readDoc(url, allowed);
    await cache.writeDoc(allowed, doc);
    return text(doc);
  }
);

server.registerTool(
  "yuque_get_toc",
  {
    title: "Get Yuque Book TOC",
    description: "Read the table of contents for an allowed Yuque book.",
    inputSchema: z.object({
      bookUrl: z.string().url()
    })
  },
  async ({ bookUrl }) => {
    const allowed = findAllowedBook(bookUrl, config.allowedBooks);
    const toc = await yuque.getToc(bookUrl, allowed);
    return text({
      book: allowed,
      toc
    });
  }
);

server.registerTool(
  "yuque_sync_book",
  {
    title: "Sync Yuque Book",
    description:
      "Read TOC and cache documents from an allowed Yuque book. This is intentionally bounded by maxDocs.",
    inputSchema: z.object({
      bookUrl: z.string().url(),
      maxDocs: z.number().int().min(1).max(50).default(20)
    })
  },
  async ({ bookUrl, maxDocs }) => {
    const allowed = findAllowedBook(bookUrl, config.allowedBooks);
    const toc = await yuque.getToc(bookUrl, allowed);
    const docs = toc.filter((entry) => entry.url).slice(0, maxDocs);
    const synced = [];
    const failed = [];

    for (const entry of docs) {
      try {
        const doc = await yuque.readDoc(entry.url!, allowed);
        await cache.writeDoc(allowed, doc);
        synced.push({ title: doc.title, url: doc.url });
      } catch (error) {
        failed.push({
          title: entry.title,
          url: entry.url,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return text({ synced, failed });
  }
);

server.registerTool(
  "yuque_search_cache",
  {
    title: "Search Local Yuque Cache",
    description:
      "Search only the local cache built from allowed Yuque books. This tool never performs Yuque global search.",
    inputSchema: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(20).default(10)
    })
  },
  async ({ query, limit }) => {
    const results = await cache.search(query, limit);
    return text({
      query,
      results: results.map((doc) => ({
        title: doc.title,
        url: doc.url,
        cachedAt: doc.cachedAt,
        preview: doc.text.slice(0, 500)
      }))
    });
  }
);

server.registerTool(
  "yuque_create_doc",
  {
    title: "Create Yuque Document",
    description:
      "Create a document in an allowed Yuque book through the local browser. Write tools should require MCP host approval.",
    inputSchema: z.object({
      bookUrl: z.string().url(),
      title: z.string().min(1),
      markdown: z.string().min(1),
      dryRun: z.boolean().default(false)
    })
  },
  async ({ bookUrl, title, markdown, dryRun }) => {
    const allowed = findAllowedBook(bookUrl, config.allowedBooks);
    const result = await yuque.createDoc({ bookUrl, allowed, title, markdown, dryRun });
    return text(result);
  }
);

server.registerTool(
  "yuque_update_doc",
  {
    title: "Update Yuque Document",
    description:
      "Replace or append document content in an allowed Yuque book through the local browser. A snapshot is saved before non-dry-run writes.",
    inputSchema: z.object({
      url: z.string().url(),
      markdown: z.string().min(1),
      mode: z.enum(["replace", "append"]).default("append"),
      dryRun: z.boolean().default(false)
    })
  },
  async ({ url, markdown, mode, dryRun }) => {
    const allowed = findAllowedBook(url, config.allowedBooks);
    let snapshotPath: string | undefined;

    if (!dryRun && config.writeSafety.snapshotBeforeWrite) {
      const before = await yuque.readDoc(url, allowed);
      snapshotPath = await cache.snapshotBeforeWrite(allowed, before);
      await cache.writeDoc(allowed, before);
    }

    const result = await yuque.updateDoc({ url, allowed, markdown, mode, dryRun });
    return text({ ...result, snapshotPath });
  }
);

process.on("SIGINT", async () => {
  await yuque.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await yuque.close();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
