import type { AllowedBook, ParsedYuqueUrl, YuquePageMetadata } from "./types.js";

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export function parseYuqueUrl(input: string): ParsedYuqueUrl {
  const url = new URL(input);
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length < 2) {
    throw new AccessDeniedError(`Yuque URL must include /group/book: ${input}`);
  }

  return {
    url,
    origin: url.origin,
    group: segments[0],
    book: segments[1],
    docSlug: segments[2]
  };
}

export function findAllowedBook(input: string, allowedBooks: AllowedBook[]): AllowedBook {
  const parsed = parseYuqueUrl(input);
  const match = allowedBooks.find(
    (book) =>
      book.origin === parsed.origin &&
      book.group === parsed.group &&
      book.book === parsed.book
  );

  if (!match) {
    throw new AccessDeniedError(
      `Access denied. URL is outside allowed Yuque books: ${parsed.origin}/${parsed.group}/${parsed.book}`
    );
  }

  return match;
}

export function assertPageStillAllowed(metadata: YuquePageMetadata, allowed: AllowedBook): void {
  const actualUrl = new URL(metadata.url);
  if (actualUrl.origin !== allowed.origin) {
    throw new AccessDeniedError(`Access denied after navigation. Unexpected origin: ${actualUrl.origin}`);
  }

  const pathSegments = actualUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (pathSegments[0] !== allowed.group || pathSegments[1] !== allowed.book) {
    throw new AccessDeniedError(
      `Access denied after navigation. Expected path /${allowed.group}/${allowed.book}, got ${actualUrl.pathname}.`
    );
  }

  if (metadata.groupLogin && metadata.groupLogin !== allowed.group) {
    throw new AccessDeniedError(
      `Access denied after page metadata check. Expected group ${allowed.group}, got ${metadata.groupLogin}.`
    );
  }

  if (metadata.bookSlug && metadata.bookSlug !== allowed.book) {
    throw new AccessDeniedError(
      `Access denied after page metadata check. Expected book ${allowed.book}, got ${metadata.bookSlug}.`
    );
  }

  if (allowed.bookId && metadata.bookId && metadata.bookId !== allowed.bookId) {
    throw new AccessDeniedError(
      `Access denied after page metadata check. Expected bookId ${allowed.bookId}, got ${metadata.bookId}.`
    );
  }
}

export function safeBookKey(book: AllowedBook): string {
  return `${book.origin.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]/g, "_")}__${book.group}__${book.book}`;
}
