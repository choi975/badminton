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
const estimatorSource = resolve("data/booking-estimator.json");
const estimatorTarget = resolve("public/booking-estimator.json");
const workerEstimatorTarget = resolve("src/booking-estimator.txt");
const courtPricingSource = resolve("court-pricing.js");
const courtPricingTarget = resolve("public/court-pricing.js");
const workerCourtPricingTarget = resolve("src/court-pricing.txt");
const groupProbabilitySource = resolve("group-probability.js");
const groupProbabilityTarget = resolve("public/group-probability.js");
const workerGroupProbabilityTarget = resolve("src/group-probability.txt");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(resolve("level-groups.js"), resolve("public/level-groups.js"));
copyFileSync(resolve("level-groups.js"), resolve("src/level-groups.txt"));
copyFileSync(source, target);
copyFileSync(source, workerHtmlTarget);
copyFileSync(html2canvasSource, html2canvasTarget);
copyFileSync(html2canvasSource, workerHtml2canvasTarget);
copyFileSync(snapshotSource, snapshotTarget);
copyFileSync(snapshotSource, workerSnapshotTarget);
copyFileSync(estimatorSource, estimatorTarget);
copyFileSync(estimatorSource, workerEstimatorTarget);
copyFileSync(courtPricingSource, courtPricingTarget);
copyFileSync(courtPricingSource, workerCourtPricingTarget);
copyFileSync(groupProbabilitySource, groupProbabilityTarget);
copyFileSync(groupProbabilitySource, workerGroupProbabilityTarget);
console.log(`Synced ${source} -> ${target}`);
console.log(`Synced ${source} -> ${workerHtmlTarget}`);
console.log(`Synced ${html2canvasSource} -> ${html2canvasTarget}`);
console.log(`Synced ${html2canvasSource} -> ${workerHtml2canvasTarget}`);
console.log(`Synced ${snapshotSource} -> ${snapshotTarget}`);
console.log(`Synced ${snapshotSource} -> ${workerSnapshotTarget}`);
console.log(`Synced ${estimatorSource} -> ${estimatorTarget}`);
console.log(`Synced ${estimatorSource} -> ${workerEstimatorTarget}`);
console.log(`Synced ${groupProbabilitySource} -> ${groupProbabilityTarget}`);
console.log(`Synced ${groupProbabilitySource} -> ${workerGroupProbabilityTarget}`);
console.log(`Synced ${courtPricingSource} -> ${courtPricingTarget}`);
console.log(`Synced ${courtPricingSource} -> ${workerCourtPricingTarget}`);

copyFileSync(resolve("member-statistics.js"), resolve("public/member-statistics.js"));
copyFileSync(resolve("member-statistics.js"), resolve("src/member-statistics.txt"));

for (const name of ["forecast-worker", "forecast-client", "optimistic-sync"]) {
  copyFileSync(resolve(name + ".js"), resolve("public/" + name + ".js"));
  copyFileSync(resolve(name + ".js"), resolve("src/" + name + ".txt"));
}
