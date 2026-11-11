(function attachBadmintonCourtPricing(root) {
  "use strict";

  // Stored counts use three-hour equivalents (.333 / .666), not rounded fees.
  function fromHours(hours) {
    return Math.floor(Math.max(0, hours) * 1000 / 3) / 1000;
  }

  function toHours(count) {
    if (!Number.isFinite(count) || count < 0) return null;
    const hours = Math.round(count * 6) / 2;
    const exact = hours / 3;
    return [exact, fromHours(hours), Math.round(exact * 1000) / 1000]
      .some((value) => Math.abs(count - value) < 1e-9) ? hours : null;
  }

  function isValidHours(hours) {
    return Number.isFinite(hours) && hours >= 0 && Number.isInteger(hours * 2);
  }

  function isValidCount(count) {
    return Number.isFinite(count) && count > 0 && toHours(count) !== null;
  }

  function feeForHours(hours) {
    return isValidHours(hours) ? Math.ceil(70 * hours / 3) : null;
  }

  function parts(row) {
    const price = Number(row.price);
    const count = Number(row.count);
    const hours = toHours(count);
    // Explicit duration rows and historical custom/free prices retain their original units.
    if (row.fallback || row.hours !== undefined || price !== 70 || hours === null) return [{ ...row }];
    const result = [];
    const full = Math.floor(hours / 3);
    const remainder = hours % 3;
    if (full) result.push({ price: 70, count: full });
    if (remainder) result.push({ price: feeForHours(remainder), count: 1, hours: remainder });
    return result;
  }

  function rowFee(row) {
    return parts(row).reduce((sum, part) => sum + Number(part.price) * Number(part.count), 0);
  }

  function totalHours(rows) {
    const hours = rows.reduce((sum, row) => {
      const count = Number(row.count) || 0;
      const unitHours = Number(row.hours);
      return sum + (Number.isFinite(unitHours) && unitHours > 0
        ? count * unitHours : toHours(count) ?? count * 3);
    }, 0);
    return Math.round(hours * 1e9) / 1e9;
  }

  function sumCounts(rows) {
    const hours = totalHours(rows);
    return Math.abs(hours * 2 - Math.round(hours * 2)) < 1e-9
      ? fromHours(Math.round(hours * 2) / 2) : Math.round(hours * 1000 / 3) / 1000;
  }

  function countForFee(fee) {
    if (!Number.isFinite(fee) || fee <= 0) return null;
    const full = Math.floor(fee / 70);
    const remainder = fee - full * 70;
    const halfHours = [0, 12, 24, 35, 47, 59].indexOf(remainder);
    return halfHours < 0 ? null : fromHours(full * 3 + halfHours / 2);
  }

  root.BadmintonCourtPricing = Object.freeze({ fromHours, toHours, isValidHours, isValidCount, feeForHours, parts, rowFee, totalHours, sumCounts, countForFee });
})(globalThis);
