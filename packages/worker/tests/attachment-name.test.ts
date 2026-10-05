import { expect, test } from "bun:test";
import { sanitizeAttachmentFilename } from "../src/handlers/queue";

test("path components are stripped from an attachment name", () => {
  expect(sanitizeAttachmentFilename("../../etc/passwd", 0)).toBe("passwd");
  expect(sanitizeAttachmentFilename("C:\\Users\\me\\invoice.pdf", 0)).toBe("invoice.pdf");
  expect(sanitizeAttachmentFilename("folder/sub/report.xlsx", 0)).toBe("report.xlsx");
});

test("header-breaking characters are removed", () => {
  // A quote or newline in the name would let the file forge the Content-Disposition
  // header, so both are stripped rather than escaped.
  expect(sanitizeAttachmentFilename('evil"; filename="other.txt', 0)).toBe("evil; filename=other.txt");
  expect(sanitizeAttachmentFilename("line\r\nbreak.txt", 0)).toBe("linebreak.txt");
  // A backslash is both a Windows separator and a header risk, so it is treated as
  // a path separator and only the final component survives.
  expect(sanitizeAttachmentFilename('back\\slash"quote.txt', 0)).toBe("slashquote.txt");
});

test("a missing or unusable name falls back to an indexed one", () => {
  expect(sanitizeAttachmentFilename(undefined, 3)).toBe("attachment-3");
  expect(sanitizeAttachmentFilename("   ", 1)).toBe("attachment-1");
  expect(sanitizeAttachmentFilename("C:\\", 2)).toBe("attachment-2");
  expect(sanitizeAttachmentFilename(42, 0)).toBe("attachment-0");
});

test("long names are truncated but keep their extension visible", () => {
  const long = `${"a".repeat(200)}.pdf`;
  const out = sanitizeAttachmentFilename(long, 0);
  expect(out.length).toBe(120);
  expect(out.startsWith("aaaa")).toBe(true);
});

test("unicode names survive sanitising", () => {
  expect(sanitizeAttachmentFilename("发票-2026.pdf", 0)).toBe("发票-2026.pdf");
  expect(sanitizeAttachmentFilename("  报告  final.docx  ", 0)).toBe("报告 final.docx");
});
