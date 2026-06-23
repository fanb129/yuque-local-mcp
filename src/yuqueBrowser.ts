import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type {
  AllowedBook,
  BrowserConfig,
  ReadDocResult,
  TocEntry,
  YuquePageMetadata,
  WriteSafetyConfig
} from "./types.js";
import { assertPageStillAllowed } from "./allowlist.js";

const EDIT_BUTTONS = ["编辑", "Edit"];
const CREATE_BUTTONS = ["新建", "新建文档", "New"];
const SAVE_BUTTONS = ["保存", "发布", "更新", "完成", "Save", "Publish", "Update", "Done"];

export class YuqueBrowser {
  private context?: BrowserContext;

  constructor(
    private readonly browserConfig: BrowserConfig,
    private readonly writeSafety: WriteSafetyConfig
  ) {}

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
  }

  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    this.context = await chromium.launchPersistentContext(this.browserConfig.profileDir, {
      headless: this.browserConfig.headless,
      slowMo: this.browserConfig.slowMoMs,
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: false
    });
    this.context.setDefaultTimeout(this.browserConfig.defaultTimeoutMs);
    return this.context;
  }

  async openForLogin(origin: string): Promise<string> {
    const context = await this.getContext();
    const page = await context.newPage();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    return page.url();
  }

  async readDoc(url: string, allowed: AllowedBook): Promise<ReadDocResult> {
    const page = await this.openAllowedPage(url, allowed);
    const metadata = await this.getMetadata(page);
    assertPageStillAllowed(metadata, allowed);

    const text = await this.extractReadableText(page);
    const title = metadata.docTitle || metadata.title || (await page.title()) || url;
    const result: ReadDocResult = {
      url: page.url(),
      title,
      text,
      metadata,
      cachedAt: new Date().toISOString()
    };
    await page.close();
    return result;
  }

  async getToc(bookUrl: string, allowed: AllowedBook): Promise<TocEntry[]> {
    const page = await this.openAllowedPage(bookUrl, allowed);
    const metadata = await this.getMetadata(page);
    assertPageStillAllowed(metadata, allowed);

    const toc = await page.evaluate(() => {
      const data = (window as unknown as { appData?: { book?: { toc?: unknown[] } } }).appData;
      return data?.book?.toc || [];
    });
    await page.close();

    return (toc as Array<Record<string, unknown>>)
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        type: typeof entry.type === "string" ? entry.type : undefined,
        title: typeof entry.title === "string" ? entry.title : "",
        url: typeof entry.url === "string" ? new URL(`/${allowed.group}/${allowed.book}/${entry.url}`, allowed.origin).toString() : undefined,
        docId: typeof entry.doc_id === "number" ? entry.doc_id : undefined,
        level: typeof entry.level === "number" ? entry.level : undefined,
        visible: typeof entry.visible === "number" ? entry.visible : undefined
      }))
      .filter((entry) => entry.title);
  }

  async createDoc(args: {
    bookUrl: string;
    allowed: AllowedBook;
    title: string;
    markdown: string;
    dryRun: boolean;
  }): Promise<{ url?: string; message: string }> {
    if (args.dryRun) {
      return {
        message: `Dry run: would create "${args.title}" in ${args.allowed.name} (${args.allowed.group}/${args.allowed.book}).`
      };
    }

    const page = await this.openAllowedPage(args.bookUrl, args.allowed);
    const metadata = await this.getMetadata(page);
    assertPageStillAllowed(metadata, args.allowed);

    await this.openCreateDocument(page);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.locator("textarea.lake-title").first().waitFor({ state: "visible", timeout: 15000 });
    await this.fillLikelyTitle(page, args.title);
    await this.insertEditorText(page, args.markdown, "replace");

    if (this.writeSafety.requireHumanReviewInBrowser) {
      return {
        url: page.url(),
        message:
          "Content has been inserted in the Yuque browser window. Human review is required in browser before saving."
      };
    }

    await this.saveIfPossible(page);
    return { url: page.url(), message: "Document creation flow completed and save was attempted." };
  }

  async updateDoc(args: {
    url: string;
    allowed: AllowedBook;
    markdown: string;
    mode: "replace" | "append";
    dryRun: boolean;
  }): Promise<{ url?: string; message: string }> {
    if (args.dryRun) {
      return {
        message: `Dry run: would ${args.mode} content in ${args.url}. New content length: ${args.markdown.length} characters.`
      };
    }

    const page = await this.openAllowedPage(args.url, args.allowed);
    let metadata = await this.getMetadata(page);
    assertPageStillAllowed(metadata, args.allowed);

    await this.clickAnyVisible(page, EDIT_BUTTONS, "edit document");
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    metadata = await this.getMetadata(page);
    assertPageStillAllowed(metadata, args.allowed);

    await this.insertEditorText(page, args.markdown, args.mode);

    if (this.writeSafety.requireHumanReviewInBrowser) {
      return {
        url: page.url(),
        message:
          "Content has been inserted in the Yuque browser window. Human review is required in browser before saving."
      };
    }

    await this.saveIfPossible(page);
    return { url: page.url(), message: "Document update flow completed and save was attempted." };
  }

  private async openAllowedPage(url: string, allowed: AllowedBook): Promise<Page> {
    const context = await this.getContext();
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const status = response?.status();
    if (status && status >= 400) {
      const title = await page.title().catch(() => "");
      await page.close();
      throw new Error(`Yuque returned HTTP ${status}${title ? ` (${title})` : ""} for ${url}`);
    }
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const metadata = await this.getMetadata(page);
    assertPageStillAllowed(metadata, allowed);
    return page;
  }

  private async getMetadata(page: Page): Promise<YuquePageMetadata> {
    return page.evaluate(() => {
      const data = (window as unknown as { appData?: Record<string, unknown> }).appData || {};
      const group = data.group as Record<string, unknown> | undefined;
      const book = data.book as Record<string, unknown> | undefined;
      const doc = data.doc as Record<string, unknown> | undefined;

      return {
        title: document.title,
        url: location.href,
        groupLogin: typeof group?.login === "string" ? group.login : undefined,
        groupId: typeof group?.id === "number" ? group.id : undefined,
        bookSlug: typeof book?.slug === "string" ? book.slug : undefined,
        bookId: typeof book?.id === "number" ? book.id : undefined,
        bookName: typeof book?.name === "string" ? book.name : undefined,
        docId: typeof doc?.id === "number" ? doc.id : undefined,
        docSlug: typeof doc?.slug === "string" ? doc.slug : undefined,
        docTitle: typeof doc?.title === "string" ? doc.title : undefined
      };
    });
  }

  private async extractReadableText(page: Page): Promise<string> {
    const text = await page.evaluate(() => {
      const selectors = [
        "[data-card-name='doc']",
        ".lake-content",
        ".ne-viewer-body",
        ".doc-reader",
        "article",
        "main"
      ];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        const value = element?.textContent?.trim();
        if (value && value.length > 20) return value;
      }
      return document.body.innerText || "";
    });

    return text.replace(/\n{3,}/g, "\n\n").trim();
  }

  private async clickAnyVisible(page: Page, names: string[], action: string): Promise<void> {
    for (const name of names) {
      const candidates: Locator[] = [
        page.getByRole("button", { name, exact: false }),
        page.getByText(name, { exact: false })
      ];
      for (const candidate of candidates) {
        const count = await candidate.count().catch(() => 0);
        if (count === 0) continue;
        const first = candidate.first();
        if (await first.isVisible().catch(() => false)) {
          await first.click();
          return;
        }
      }
    }
    throw new Error(`Could not find a visible Yuque control for action: ${action}.`);
  }

  private async openCreateDocument(page: Page): Promise<void> {
    const directMenuItem = page.locator(".doc-action-menu-item-create_doc").first();
    if (await directMenuItem.isVisible().catch(() => false)) {
      await directMenuItem.click();
      return;
    }

    for (const name of CREATE_BUTTONS) {
      const button = page.getByRole("button", { name, exact: false }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        break;
      }
    }

    if (!(await directMenuItem.isVisible().catch(() => false))) {
      const sidebarPlus = page.locator(".ReaderLayout-module_searchNav_aebFB .larkui-popover-trigger").last();
      if (await sidebarPlus.isVisible().catch(() => false)) {
        await sidebarPlus.click();
        await page.waitForTimeout(500);
      }
    }

    if (!(await directMenuItem.isVisible().catch(() => false))) {
      const plusButtons = page.locator(".larkui-popover-trigger");
      const count = await plusButtons.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const button = plusButtons.nth(index);
        const box = await button.boundingBox().catch(() => null);
        if (!box) continue;
        if (box.x > 180 && box.x < 270 && box.y > 90 && box.y < 150) {
          await button.click();
          await page.waitForTimeout(500);
          break;
        }
      }
    }

    if (!(await directMenuItem.isVisible().catch(() => false))) {
      await page.mouse.click(235, 126);
      await page.waitForTimeout(500);
    }

    if (await directMenuItem.isVisible().catch(() => false)) {
      await directMenuItem.click();
      return;
    }

    const documentMenuItem = page.getByText("文档", { exact: true }).first();
    if (await documentMenuItem.isVisible().catch(() => false)) {
      await documentMenuItem.click();
      return;
    }

    throw new Error("Could not open Yuque create document menu item.");
  }

  private async fillLikelyTitle(page: Page, title: string): Promise<void> {
    const titleFields = [
      page.locator("textarea.lake-title").first(),
      page.getByPlaceholder(/标题|title/i),
      page.locator("textarea").first(),
      page.locator("input").first(),
      page.locator("[contenteditable='true']").first()
    ];

    for (const field of titleFields) {
      if (await field.isVisible().catch(() => false)) {
        await field.click();
        await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
        await page.keyboard.insertText(title);
        return;
      }
    }

    throw new Error("Could not find a likely title field in the Yuque editor.");
  }

  private async insertEditorText(page: Page, markdown: string, mode: "replace" | "append"): Promise<void> {
    const editor = await this.findEditor(page);
    try {
      await editor.click({ timeout: 5000 });
    } catch {
      await editor.focus();
    }

    if (mode === "replace") {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await page.keyboard.press("Backspace");
    } else {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
      await page.keyboard.insertText("\n\n");
    }

    await page.keyboard.insertText(markdown);
  }

  private async findEditor(page: Page): Promise<Locator> {
    const candidates = [
      page.locator("[contenteditable='true']").last(),
      page.locator(".ProseMirror").last(),
      page.locator(".lake-editor").last(),
      page.locator("textarea").last()
    ];

    for (const candidate of candidates) {
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }

    throw new Error("Could not find a visible editable Yuque document body.");
  }

  private async saveIfPossible(page: Page): Promise<void> {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S").catch(() => undefined);
    for (const name of SAVE_BUTTONS) {
      const button = page.getByRole("button", { name, exact: false }).first();
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => undefined);
        break;
      }
    }
    await page.waitForTimeout(2000);
  }
}
