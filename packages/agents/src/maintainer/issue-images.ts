/**
 * Screenshots in an issue (tracebacks, broken output) are shown to Muse Spark,
 * which reads images. Only GitHub-hosted images are used: the links come from
 * strangers' issue text, and our server never fetches them (the Meta Model API
 * does), so nothing in an issue can make the server request an internal address.
 */

import type { ChatMessage } from "../llm/meta-client.js";

const MAX_IMAGES = 4;
/** Where GitHub stores images pasted into issues. Exact hosts, https only. */
const ALLOWED = [
  { host: "github.com", path: /^\/user-attachments\/assets\// },
  { host: "user-images.githubusercontent.com", path: /^\// },
  { host: "private-user-images.githubusercontent.com", path: /^\// },
];

const isAllowed = (raw: string): boolean => {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ALLOWED.some((a) => url.hostname === a.host && a.path.test(url.pathname));
  } catch {
    return false;
  }
};

/** Image links in an issue body (markdown, <img> and bare attachment links), GitHub-hosted only, in order, at most four. */
export function issueImages(body: string): string[] {
  const found = [
    ...[...body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => ({ at: m.index ?? 0, url: m[1] })),
    ...[...body.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => ({ at: m.index ?? 0, url: m[1] })),
    // GitHub's uploader often inserts a bare attachment link, which it renders inline.
    ...[...body.matchAll(/https:\/\/github\.com\/user-attachments\/assets\/[0-9a-f-]{36}/gi)].map((m) => ({ at: m.index ?? 0, url: m[0] })),
  ]
    .sort((a, b) => a.at - b.at)
    .map((f) => f.url)
    .filter(isAllowed);
  return [...new Set(found)].slice(0, MAX_IMAGES);
}

/**
 * The images minus the one the API refused. Its error names the part
 * ("messages[1].content[2]"); part 0 is the text, so image i is part i + 1.
 * When it doesn't say which, none are kept.
 */
export function withoutRefusedImage(images: readonly string[], error: string): string[] {
  const part = error.match(/content\[(\d+)\]/);
  const index = part ? Number(part[1]) - 1 : -1;
  return index >= 0 && index < images.length ? images.filter((_, i) => i !== index) : [];
}

/** The same messages with the images attached to the last user message. */
export function withImages(messages: ChatMessage[], images: readonly string[]): ChatMessage[] {
  if (images.length === 0) return messages;
  const last = messages.map((m) => m.role).lastIndexOf("user");
  if (last === -1) return messages;
  return messages.map((m, i) => {
    if (i !== last) return m;
    const text = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
    return { ...m, content: [...text, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] };
  });
}
