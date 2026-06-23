import fs from "node:fs/promises";
import path from "node:path";
import type { AllowedBook, ReadDocResult } from "./types.js";
import { safeBookKey } from "./allowlist.js";

export class YuqueCache {
  constructor(private readonly cacheDir: string) {}

  private bookDir(book: AllowedBook): string {
    return path.join(this.cacheDir, safeBookKey(book));
  }

  private docPath(book: AllowedBook, url: string): string {
    const encoded = Buffer.from(url).toString("base64url");
    return path.join(this.bookDir(book), `${encoded}.json`);
  }

  async writeDoc(book: AllowedBook, doc: ReadDocResult): Promise<void> {
    await fs.mkdir(this.bookDir(book), { recursive: true });
    await fs.writeFile(this.docPath(book, doc.url), JSON.stringify(doc, null, 2), "utf8");
  }

  async snapshotBeforeWrite(book: AllowedBook, doc: ReadDocResult): Promise<string> {
    const snapshotsDir = path.join(this.bookDir(book), "snapshots");
    await fs.mkdir(snapshotsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const encoded = Buffer.from(doc.url).toString("base64url");
    const snapshotPath = path.join(snapshotsDir, `${stamp}-${encoded}.json`);
    await fs.writeFile(snapshotPath, JSON.stringify(doc, null, 2), "utf8");
    return snapshotPath;
  }

  async search(query: string, limit: number): Promise<ReadDocResult[]> {
    const lower = query.toLowerCase();
    const results: Array<{ score: number; doc: ReadDocResult }> = [];

    let bookDirs: string[] = [];
    try {
      bookDirs = await fs.readdir(this.cacheDir);
    } catch {
      return [];
    }

    for (const bookDir of bookDirs) {
      const fullBookDir = path.join(this.cacheDir, bookDir);
      let entries: string[] = [];
      try {
        entries = await fs.readdir(fullBookDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        try {
          const raw = await fs.readFile(path.join(fullBookDir, entry), "utf8");
          const doc = JSON.parse(raw) as ReadDocResult;
          const titleScore = doc.title.toLowerCase().includes(lower) ? 10 : 0;
          const textScore = doc.text.toLowerCase().includes(lower) ? 1 : 0;
          const score = titleScore + textScore;
          if (score > 0) results.push({ score, doc });
        } catch {
          continue;
        }
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((result) => result.doc);
  }
}
