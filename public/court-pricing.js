(function attachBadmintonCourtPricing(root) {
  "use strict";

  // Counts display thirds as .333 / .666; never multiply those approximations by 70.
  function fromHours(hours) {
    return Math.floor(Math.max(0, hours) * 1000 / 3) / 1000;
  }

  function toHours(count) {
    if (!Number.isFinite(count) || count < 0) return null;
    const hours = Math.round(count * 3);
    const exact = hours / 3;
    return [exact, fromHours(hours), Math.round(exact * 1000) / 1000]
      .some((value) => Math.abs(count - value) < 1e-9) ? hours : null;
  }

  function isValidCount(count) {
    return Number.isFinite(count) && count > 0
      && (toHours(count) !== null || Number.isInteger(count * 2)); // Keep historical half courts editable.
  }

  function parts(row) {
    const price = Number(row.price);
    const count = Number(row.count);
    const hours = toHours(count);
    if (row.fallback || price !== 70 || hours === null) return [{ ...row }];
    const result = [];
    const full = Math.floor(hours / 3);
    const remainder = hours % 3;
    if (full) result.push({ price: 70, count: full });
    if (remainder) result.push({ price: remainder === 1 ? 24 : 47, count: 1, hours: remainder });
    return result;
  }

  function rowFee(row) {
    return parts(row).reduce((sum, part) => sum + Number(part.price) * Number(part.count), 0);
  }

  function sumCounts(rows) {
    const count = rows.reduce((sum, row) => {
      const hours = toHours(Number(row.count));
      return sum + (hours === null ? Number(row.count) : hours / 3);
    }, 0);
    return Math.abs(count * 3 - Math.round(count * 3)) < 1e-9
      ? fromHours(Math.round(count * 3)) : Math.round(count * 1000) / 1000;
  }

  function countForFee(fee) {
    if (!Number.isFinite(fee) || fee <= 0) return null;
    const full = Math.floor(fee / 70);
    const remainder = fee - full * 70;
    const extraHours = remainder === 0 ? 0 : remainder === 24 ? 1 : remainder === 47 ? 2 : null;
    return extraHours === null ? null : fromHours(full * 3 + extraHours);
  }

  root.BadmintonCourtPricing = Object.freeze({ fromHours, toHours, isValidCount, parts, rowFee, sumCounts, countForFee });
})(globalThis);
