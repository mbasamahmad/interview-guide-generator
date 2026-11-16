import fs from "fs";
import path from "path";
import crypto from "crypto";

// Write to a temp file, then rename: a crash never leaves a half-written file.
export function writeTextAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, value: unknown) {
  writeTextAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

export function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
