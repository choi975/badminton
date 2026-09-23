import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const paymentHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8").replaceAll("\r\n", "\n");

export function loadPaymentFunctions(names, dependencies = {}) {
  const constant = paymentHtml.match(/    const FEMALE_PAYMENT_DISCOUNT = [\d.]+;/)?.[0];
  assert.ok(constant, "Production discount constant must exist");
  const sources = names.map((name) => {
    const start = paymentHtml.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, `Missing production function: ${name}`);
    const end = paymentHtml.indexOf("\n    }", start);
    assert.ok(end > start, `Missing end of production function: ${name}`);
    return paymentHtml.slice(start, end + 6);
  });
  return new Function(...Object.keys(dependencies), `${constant}\n${sources.join("\n")}\nreturn { ${names.join(", ")} };`)(...Object.values(dependencies));
}
