import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const paymentHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");

export function loadPaymentFunctions(names, dependencies = {}) {
  names = [...new Set(["isPaymentRuleValid", "normalizePaymentRule", ...names])];
  const sources = names.map((name) => {
    const start = paymentHtml.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, `Missing production function: ${name}`);
    const end = paymentHtml.indexOf("\n    }", start);
    assert.ok(end > start, `Missing end of production function: ${name}`);
    return paymentHtml.slice(start, end + 6);
  });
  return new Function(...Object.keys(dependencies), `${sources.join("\n")}\nreturn { ${names.join(", ")} };`)(...Object.values(dependencies));
}
