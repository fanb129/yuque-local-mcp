import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { YuqueMcpConfig } from "./types.js";

const ConfigSchema = z.object({
  browser: z
    .object({
      headless: z.boolean().default(false),
      profileDir: z.string().default("~/.yuque-local-mcp/profile"),
      defaultTimeoutMs: z.number().int().positive().default(30000),
      slowMoMs: z.number().int().min(0).default(0)
    })
    .default({
      headless: false,
      profileDir: "~/.yuque-local-mcp/profile",
      defaultTimeoutMs: 30000,
      slowMoMs: 0
    }),
  cacheDir: z.string().default("~/.yuque-local-mcp/cache"),
  writeSafety: z
    .object({
      snapshotBeforeWrite: z.boolean().default(true),
      requireHumanReviewInBrowser: z.boolean().default(true)
    })
    .default({
      snapshotBeforeWrite: true,
      requireHumanReviewInBrowser: true
    }),
  allowedBooks: z
    .array(
      z.object({
        name: z.string().min(1),
        origin: z.string().url(),
        group: z.string().min(1),
        book: z.string().min(1),
        bookId: z.number().int().positive().optional()
      })
    )
    .min(1)
});

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  return parsed.origin;
}

export function loadConfig(): YuqueMcpConfig {
  const configPath =
    process.env.YUQUE_MCP_CONFIG ||
    process.env.YUQUE_CONFIG ||
    path.resolve(process.cwd(), "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Missing config file: ${configPath}. Copy config.example.json to config.json and set YUQUE_MCP_CONFIG if needed.`
    );
  }

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  const parsed = ConfigSchema.parse(raw);

  const profileDir = expandHome(process.env.YUQUE_PROFILE_DIR || parsed.browser.profileDir);
  const cacheDir = expandHome(process.env.YUQUE_CACHE_DIR || parsed.cacheDir);
  const headless =
    process.env.YUQUE_HEADLESS === undefined
      ? parsed.browser.headless
      : process.env.YUQUE_HEADLESS === "1" || process.env.YUQUE_HEADLESS === "true";

  return {
    browser: {
      ...parsed.browser,
      headless,
      profileDir,
      slowMoMs: parsed.browser.slowMoMs,
      defaultTimeoutMs: parsed.browser.defaultTimeoutMs
    },
    cacheDir,
    writeSafety: parsed.writeSafety,
    allowedBooks: parsed.allowedBooks.map((book) => ({
      ...book,
      origin: normalizeOrigin(book.origin)
    }))
  };
}
