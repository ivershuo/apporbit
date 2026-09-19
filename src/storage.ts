import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function encodeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class DataStore {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new Error(`data path must be relative: ${relativePath}`);
    }
    const resolved = path.resolve(this.root, relativePath);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error(`data path escapes the output root: ${relativePath}`);
    }
    return resolved;
  }

  async readJson<T>(relativePath: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.resolve(relativePath), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async writeMutableJson(relativePath: string, value: unknown): Promise<void> {
    await this.#writeAtomic(relativePath, encodeJson(value));
  }

  async writeImmutableJson(relativePath: string, value: unknown): Promise<void> {
    await this.writeImmutableText(relativePath, encodeJson(value));
  }

  async writeImmutableText(relativePath: string, contents: string): Promise<void> {
    const destination = this.resolve(relativePath);
    try {
      const existing = await readFile(destination, "utf8");
      if (existing !== contents) {
        throw new Error(`immutable data conflict at ${relativePath}`);
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, { encoding: "utf8", flag: "wx" });
  }

  async #writeAtomic(relativePath: string, contents: string): Promise<void> {
    const destination = this.resolve(relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}-${crypto.randomUUID()}`;
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
  }
}
