(function attachBadmintonLevelGroups(root) {
  "use strict";
  const ranks = Object.freeze([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9]);
  const defaults = Object.freeze([
    Object.freeze({ name: "新手", min: 0.5, max: 2 }),
    Object.freeze({ name: "中手", min: 2.5, max: 3.5 }),
    Object.freeze({ name: "高手", min: 4, max: 5 }),
    Object.freeze({ name: "比赛级高手", min: 6, max: 9 }),
  ]);
  const legacyLevels = Object.freeze({ 新手: 2, 中手: 3, 高手: 4, 比赛级高手: 6 });
  const reserved = new Set(["不详", "等级不详", "未分组"]);

  function validate(groups) {
    if (!Array.isArray(groups) || !groups.length || groups.length > ranks.length) {
      return { error: "请保留 1～14 个分组" };
    }
    const normalized = [];
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      const name = typeof group?.name === "string" ? group.name.trim() : "";
      if (!name || name.length > 20 || /[\r\n\t]/.test(name)) return { error: "分组名称需填写 1～20 个字符", index, field: "name" };
      if (reserved.has(name)) return { error: "“" + name + "”是系统保留名称，请换一个名称", index, field: "name" };
      if (normalized.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return { error: "分组名称不能重复", index, field: "name" };
      const { min, max } = group;
      if (!ranks.includes(min)) return { error: "请选择有效的起始等级", index, field: "min" };
      if (!ranks.includes(max)) return { error: "请选择有效的结束等级", index, field: "max" };
      if (min > max) return { error: "起始等级不能高于结束等级", index, field: "max" };
      const overlap = normalized.find(item => min <= item.max && max >= item.min);
      if (overlap) return { error: "“" + name + "”与“" + overlap.name + "”的等级范围重叠", index, field: "min" };
      normalized.push({ name, min, max });
    }
    return { groups: normalized };
  }

  function normalize(groups) {
    return validate(groups).groups || defaults.map(group => ({ ...group }));
  }

  function fromStored(value) {
    try { return normalize(JSON.parse(value)); } catch { return normalize(null); }
  }

  function getLabel(level, groups = defaults) {
    const rank = Number(String(level || "").replace(/级$/, ""));
    if (!ranks.includes(rank)) return "不详";
    return groups.find(group => rank >= group.min && rank <= group.max)?.name || "未分组";
  }

  function representativeLevel(group) {
    const legacy = legacyLevels[group.name];
    return (legacy >= group.min && legacy <= group.max ? legacy : group.min) + "级";
  }

  function options(groups = defaults) {
    return [{ label: "不详", level: "不详", text: "等级不详" }, ...groups.map(group => {
      const level = representativeLevel(group);
      return { label: group.name, level, text: group.name + "（" + level + "）" };
    }), ...ranks.filter(rank => getLabel(rank + "级", groups) === "未分组")
      .map(rank => ({ label: rank + "级", level: rank + "级", text: "未分组（" + rank + "级）" }))];
  }

  function annotationLabels(groups = defaults) {
    const labels = new Map(Object.entries(legacyLevels).map(([name, level]) => [name, level + "级"]));
    groups.forEach(group => labels.set(group.name, representativeLevel(group)));
    return [...labels.entries()].sort((a, b) => b[0].length - a[0].length);
  }

  function stats(entries, groups = defaults) {
    const counts = new Map();
    entries.forEach(entry => {
      const label = getLabel(entry.levelText, groups);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...groups].sort((a, b) => b.max - a.max).map(group => group.name)
      .concat(["未分组", "不详"]).filter(name => counts.has(name))
      .map(name => (name === "不详" ? "等级不详" : name) + "：" + counts.get(name) + "人");
  }

  root.BadmintonLevelGroups = Object.freeze({ ranks, defaults, validate, normalize, fromStored, getLabel, representativeLevel, options, annotationLabels, stats });
})(globalThis);
