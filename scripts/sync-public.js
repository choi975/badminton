import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = resolve("index.html");
const target = resolve("public/index.html");
const workerHtmlTarget = resolve("src/index.html");
const html2canvasSource = resolve("node_modules/html2canvas/dist/html2canvas.min.js");
const html2canvasTarget = resolve("public/html2canvas.min.js");
const workerHtml2canvasTarget = resolve("src/html2canvas.txt");
const snapshotSource = resolve("data/bootstrap-snapshot.json");
const snapshotTarget = resolve("public/bootstrap-snapshot.json");
const workerSnapshotTarget = resolve("src/bootstrap-snapshot.txt");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
copyFileSync(source, workerHtmlTarget);
copyFileSync(html2canvasSource, html2canvasTarget);
copyFileSync(html2canvasSource, workerHtml2canvasTarget);
copyFileSync(snapshotSource, snapshotTarget);
copyFileSync(snapshotSource, workerSnapshotTarget);
console.log(`Synced ${source} -> ${target}`);
console.log(`Synced ${source} -> ${workerHtmlTarget}`);
console.log(`Synced ${html2canvasSource} -> ${html2canvasTarget}`);
console.log(`Synced ${html2canvasSource} -> ${workerHtml2canvasTarget}`);
console.log(`Synced ${snapshotSource} -> ${snapshotTarget}`);
console.log(`Synced ${snapshotSource} -> ${workerSnapshotTarget}`);
