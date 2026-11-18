import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../court-arrangement.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../court-arrangement.css", import.meta.url), "utf8");
const modal = html.slice(html.indexOf('<div id="courtArrangementModal"'), html.indexOf('<dialog id="sessionPlanDialog"'));
assert.doesNotMatch(modal, /caMeta|caBoardTab|caSettingsTab|role="tablist"/);
for (const [id, label, icon] of [["caCopy", "复制安排", "copy"], ["caSettingsToggle", "偏好与小团体", "sliders-horizontal"], ["caClose", "关闭场地安排", "x"]]) {
  const control = modal.match(new RegExp(`<button id="${id}"[^>]*>(.*?)<\\/button>`))[0];
  assert.match(control, new RegExp(`aria-label="${label}"`)); assert.match(control, new RegExp(`data-lucide="${icon}"`));
  assert.equal(control.replace(/<[^>]+>/g, "").trim(), "", "Header icon actions have no visible text labels");
}
assert.match(modal, /id="caInspector"[^>]*hidden/);
assert.match(modal, /id="caEditPerson"[^>]*aria-label="编辑选中人员"/);
assert.doesNotMatch(ui, /安排建议|流动人员 ·|按可去场地合并，不代表同一小团体|ca-bundle-head|ca-bundle-note|已独立摆放/);
assert.match(css, /\.modal\.ca-dialog\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
assert.match(css, /\.ca-workspace\s*\{[^}]*position: relative/);
assert.match(css, /\.ca-inspector\s*\{[^}]*position: absolute/);
assert.match(ui, /function hitBundle\(point, excludedPerson = null\)/);
assert.match(ui, /setPlacement\(d\.key,[\s\S]*?bundle\?\.allowed\)/);
assert.match(ui, /target \|\| bundle \? undefined/);
assert.match(ui, /bundleAllowed \? \[\.\.\.bundleAllowed\]/);
assert.match(ui, /if \(position\) current\.assignments\[key\]\.position = position/);
assert.match(ui, /suppressClickUntil = performance\.now\(\) \+ 350/);
assert.match(ui, /path\.setAttribute\("d", `M \$\{from\.x\} \$\{from\.y\} L \$\{to\.x\} \$\{to\.y\}`\)/);
assert.doesNotMatch(ui, /`M[^`]*(?:\bV\b|\bH\b)[^`]*`/);
// The actual edge calculation attaches straight links to borders, including horizontal/vertical/coincident layouts.
const source = ui.slice(ui.indexOf('const edge = (r, destination) => {'), ui.indexOf('        const from = edge('));
const edge = vm.runInNewContext(source + ';edge');
const box = { x: 10, y: 20, width: 100, height: 60 };
for (const [destination, expected] of [[{x:300,y:50},[110,50]], [{x:-100,y:50},[10,50]], [{x:60,y:200},[60,80]], [{x:60,y:-100},[60,20]], [{x:60,y:50},[60,50]]]) {
  const result = edge(box, destination); assert.deepEqual([result.x,result.y], expected);
}
console.log("Compact court UI passed: removed stats/tabs/advice, accessible icon actions, full-width canvas, optional personal editor, group-return drop targets, click isolation and finite straight border-to-border links.");
