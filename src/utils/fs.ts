import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function readTextIfExists(filePath: string): Promise<string | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readFile(filePath, "utf8");
}

export async function writeTextAtomic(filePath: string, content: string): Promise<void> {
  await ensureParentDir(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

export async function copyIfExists(fromPath: string, toPath: string): Promise<boolean> {
  if (!(await pathExists(fromPath))) {
    return false;
  }
  await ensureParentDir(toPath);
  await copyFile(fromPath, toPath);
  return true;
}
