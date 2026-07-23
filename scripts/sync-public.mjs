import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const sourceFile = resolve(workspaceRoot, "index.html");
const targetFile = resolve(workspaceRoot, "public", "index.html");

await mkdir(resolve(workspaceRoot, "public"), { recursive: true });
await copyFile(sourceFile, targetFile);

console.log(`Synced ${sourceFile} -> ${targetFile}`);
