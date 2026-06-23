export type AllowedBook = {
  name: string;
  origin: string;
  group: string;
  book: string;
  bookId?: number;
};

export type BrowserConfig = {
  headless: boolean;
  profileDir: string;
  defaultTimeoutMs: number;
  slowMoMs: number;
};

export type WriteSafetyConfig = {
  snapshotBeforeWrite: boolean;
  requireHumanReviewInBrowser: boolean;
};

export type YuqueMcpConfig = {
  browser: BrowserConfig;
  cacheDir: string;
  writeSafety: WriteSafetyConfig;
  allowedBooks: AllowedBook[];
};

export type ParsedYuqueUrl = {
  url: URL;
  origin: string;
  group: string;
  book: string;
  docSlug?: string;
};

export type YuquePageMetadata = {
  title?: string;
  url: string;
  groupLogin?: string;
  groupId?: number;
  bookSlug?: string;
  bookId?: number;
  bookName?: string;
  docId?: number;
  docSlug?: string;
  docTitle?: string;
};

export type TocEntry = {
  type?: string;
  title: string;
  url?: string;
  docId?: number;
  level?: number;
  visible?: number;
};

export type ReadDocResult = {
  url: string;
  title: string;
  text: string;
  metadata: YuquePageMetadata;
  cachedAt: string;
};
