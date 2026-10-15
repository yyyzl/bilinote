import type { Note } from "./tauri";

export function readableExcerpt(text: string): string {
  return text
    .replace(/^\s*#{1,6}\s+.*$/gm, "")
    .replace(
      /\[\d{1,2}:\d{2}(?::\d{2})?(?:\s*[-–]\s*\d{1,2}:\d{2}(?::\d{2})?)?\]/g,
      "",
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getNotePreview(note: Note): string {
  return (
    note.preview?.trim() ||
    readableExcerpt(note.transcript) ||
    "暂无可用转录内容"
  );
}
