const collator = new Intl.Collator("zh-Hans-CN-u-co-pinyin", { numeric: true, sensitivity: "base" });

const players = [
  { id: 1, name: "甲乙丙", gender: "女", level: "3级", affiliation: "球友" },
  { id: 2, name: "球友-柚子，柚子", gender: "男", level: "2级", affiliation: "球友" },
  { id: 3, name: "choi", gender: "男", level: "2.5级", affiliation: "特殊", participatesPayment: true },
  { id: 4, name: "达哥的领导，孙总，ben，孙锋", gender: "男", level: "3.5级", affiliation: "特殊", participatesPayment: false },
  { id: 5, name: "海尼克-徐攀，Baymax", gender: "男", level: "2级", affiliation: "特殊", participatesPayment: true },
  { id: 6, name: "海尼克-刘赵达，阿达，达哥", gender: "男", level: "4级", affiliation: "Hytronik" },
  { id: 7, name: "sun", gender: "男", level: "3级", affiliation: "球友" },
  { id: 8, name: "7点", gender: "男", level: "3.5级", affiliation: "球友" },
];

const paymentOrders = { "球友": [], "Hytronik": [] };
const CHAIN_NUMBER_PREFIX = /^\s*\d+\s*[\.、\):：-]\s*/;
const PLUS_LEVEL_LABELS = [["比赛级高手", "5级"], ["新手", "2级"], ["中手", "3级"], ["高手", "4级"]];
const PLUS_LEVEL_OPTIONS = [
  { label: "不详", level: "不详" },
  { label: "新手", level: "2级" },
  { label: "中手", level: "3级" },
  { label: "高手", level: "4级" },
  { label: "比赛级高手", level: "5级" },
];
const FEMALE_PAYMENT_CAP = 25;
const PAYMENT_CATEGORIES = ["male", "female", "child"];

const input = `1. choi
2. 达哥
3. 阿达+1
4. 阿达➕2
5. 🍭 甲乙丙
6. 柚子🍀
7. 达哥的领导
8. Baymax`;

function cleanChainLine(line) {
  return String(line || "").replace(CHAIN_NUMBER_PREFIX, "").trim();
}

function getChainInputLines(rawInput) {
  const lines = String(rawInput || "").split(/\r?\n/);
  const numberedLines = lines.filter((line) => CHAIN_NUMBER_PREFIX.test(line));
  return numberedLines.length ? numberedLines : lines;
}

function normalizeAlias(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function levelRank(level) {
  if (!level || level === "不详" || level === "等级不详") return -1;
  const number = Number.parseFloat(String(level).replace("级", ""));
  return Number.isFinite(number) ? number : -1;
}

function getLevelGroupLabel(level) {
  if (!level || level === "不详" || level === "等级不详") return "不详";
  const rank = levelRank(level);
  if (rank >= 0.5 && rank <= 2) return "新手";
  if (rank >= 2.5 && rank <= 3.5) return "中手";
  if (rank >= 4 && rank <= 5) return "高手";
  if (rank >= 6 && rank <= 9) return "比赛级高手";
  return "不详";
}

function splitAliases(name) {
  return String(name || "").split(/[,，]/).map((part) => part.trim()).filter(Boolean);
}

function firstName(name) {
  return splitAliases(name)[0] || "";
}

function buildAliasIndex() {
  return players.flatMap((player) => splitAliases(player.name).map((alias) => ({
    alias,
    normalized: normalizeAlias(alias),
    player,
  }))).filter((item) => item.normalized).sort((a, b) => b.normalized.length - a.normalized.length);
}

function findPlayerForLine(line, aliasIndex) {
  const normalized = normalizeAlias(removeChainAnnotations(line));
  const match = aliasIndex.find((item) => normalized.includes(item.normalized));
  return match?.player || null;
}

function removeChainAnnotations(value) {
  return String(value || "").replace(/\([^)]*\)|（[^）]*）/g, " ");
}

function parseChainLine(line, index, aliasIndex, overrideKey = "", override = null) {
  const plusMetadata = parsePlusEntryMetadata(cleanChainLine(line));
  const clean = plusMetadata.displayName;
  const player = findPlayerForLine(clean, aliasIndex);
  const knownLevel = player?.level || "不详";
  const detectedLevelText = plusMetadata.plusEntry ? plusMetadata.levelText : knownLevel;
  const detectedCategory = plusMetadata.plusEntry
    ? plusMetadata.category
    : (player?.gender === "女" ? "female" : "male");
  const levelText = plusMetadata.plusEntry && override?.levelText ? override.levelText : detectedLevelText;
  const detectedLevelGroupLabel = plusMetadata.plusEntry ? plusMetadata.levelGroupLabel : null;
  const levelGroupLabel = plusMetadata.plusEntry && override?.levelGroupLabel
    ? override.levelGroupLabel
    : detectedLevelGroupLabel;
  const legacyOverrideCategory = typeof override?.isFemale === "boolean"
    ? (override.isFemale ? "female" : "male")
    : null;
  const category = plusMetadata.plusEntry && PAYMENT_CATEGORIES.includes(override?.category)
    ? override.category
    : (plusMetadata.plusEntry && legacyOverrideCategory ? legacyOverrideCategory : detectedCategory);
  return {
    index,
    raw: line,
    clean,
    player,
    plusEntry: plusMetadata.plusEntry,
    overrideKey,
    detectedLevelText,
    detectedLevelGroupLabel,
    detectedCategory,
    levelText,
    levelGroupLabel,
    category,
    isFemale: category === "female",
    isChild: category === "child",
    sortRank: levelRank(levelText),
  };
}

function getChainEntryBaseName(entry) {
  const name = String(entry?.clean || "");
  return entry?.plusEntry ? name.replace(/[🌸👶]/gu, " ").replace(/\s+/g, " ").trim() : name;
}

function getChainEntryDisplayName(entry) {
  const name = getChainEntryBaseName(entry);
  if (entry?.isChild) return name.includes("👶") ? name : `${name}👶`;
  if (entry?.isFemale) return name.includes("🌸") ? name : `${name}🌸`;
  return name;
}

function parsePlusEntryMetadata(value) {
  const displayName = String(value || "");
  const plusMatch = displayName.match(/[+＋➕]\s*\d+/);
  if (!plusMatch) return { plusEntry: false, displayName, levelText: null, category: "male" };

  const suffixStart = (plusMatch.index || 0) + plusMatch[0].length;
  const suffix = displayName.slice(suffixStart);
  const levelMapping = PLUS_LEVEL_LABELS.find(([label]) => suffix.includes(label));
  let cleanedDisplayName = displayName;

  if (levelMapping) {
    const labelIndex = suffix.indexOf(levelMapping[0]);
    const absoluteIndex = suffixStart + labelIndex;
    cleanedDisplayName = `${displayName.slice(0, absoluteIndex)}${displayName.slice(absoluteIndex + levelMapping[0].length)}`.trim();
  }

  return {
    plusEntry: true,
    displayName: cleanedDisplayName,
    levelText: levelMapping?.[1] || "不详",
    levelGroupLabel: levelMapping?.[0] || "不详",
    category: suffix.includes("👶") ? "child" : (suffix.includes("🌸") ? "female" : "male"),
  };
}

function paymentDisplayName(player) {
  return firstName(player.name);
}

function shouldCountForPayment(entry) {
  if (!entry.clean) return false;
  if (entry.player?.affiliation === "特殊" && entry.player.participatesPayment === false) return false;
  return true;
}

function getPaymentGroup(player) {
  if (player?.affiliation === "特殊") return "special";
  if (player?.affiliation === "Hytronik") return "heineken";
  return "friends";
}

function ceilOneDecimal(value) {
  return Math.ceil((value + Number.EPSILON) * 10) / 10;
}

function formatMoney(value) {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function calculateLedgerAmount(groups, courtFee) {
  return Object.values(groups)
    .flat()
    .filter((row) => String(row.name || "").trim().toLowerCase() !== "choi")
    .reduce((sum, row) => sum + Number(row.amount || 0), 0) - courtFee;
}

function getEntryCategory(entry) {
  if (PAYMENT_CATEGORIES.includes(entry?.category)) return entry.category;
  if (entry?.isChild) return "child";
  if (entry?.isFemale) return "female";
  return "male";
}

function addPaymentLine(map, name, amount, note, slots, playerId, sequence, category = "male") {
  if (typeof category === "boolean") category = category ? "female" : "male";
  if (!PAYMENT_CATEGORIES.includes(category)) category = "male";
  const key = playerId ? `player:${playerId}` : `name:${name}`;
  const current = map.get(key) || {
    name,
    amount: 0,
    note: null,
    slots: 0,
    playerId: playerId || null,
    sequence,
    hasFemale: false,
    hasMale: false,
    hasChild: false,
    femaleSlots: 0,
    maleSlots: 0,
    childSlots: 0,
  };
  current.amount += amount;
  current.slots += slots;
  current.hasFemale = current.hasFemale || category === "female";
  current.hasMale = current.hasMale || category === "male";
  current.hasChild = current.hasChild || category === "child";
  current.femaleSlots += category === "female" ? slots : 0;
  current.maleSlots += category === "male" ? slots : 0;
  current.childSlots += category === "child" ? slots : 0;
  if (note) current.note = note;
  if (playerId && !current.playerId) current.playerId = playerId;
  current.sequence = Math.min(current.sequence, sequence);
  map.set(key, current);
}

function mapToPaymentRows(map, affiliation) {
  const rows = [...map.values()];
  if (!affiliation) return rows.sort((a, b) => collator.compare(a.name, b.name));

  const orderMap = new Map((paymentOrders[affiliation] || []).map((id, index) => [Number(id), index]));
  return rows.sort((a, b) => {
    const aOrder = a.playerId && orderMap.has(Number(a.playerId)) ? orderMap.get(Number(a.playerId)) : Number.MAX_SAFE_INTEGER;
    const bOrder = b.playerId && orderMap.has(Number(b.playerId)) ? orderMap.get(Number(b.playerId)) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a.sequence - b.sequence) || collator.compare(a.name, b.name);
  });
}

function calculatePayment(entries, courtFee, shuttlePrice, shuttleCount) {
  const payingEntries = entries.filter(shouldCountForPayment);
  const payerCount = payingEntries.length;
  const femaleCount = payingEntries.filter((entry) => getEntryCategory(entry) === "female").length;
  const childCount = payingEntries.filter((entry) => getEntryCategory(entry) === "child").length;
  const maleCount = payerCount - femaleCount - childCount;
  const nonFemaleWeight = maleCount + childCount * 0.5;
  const totalWeight = femaleCount + nonFemaleWeight;
  const totalCost = courtFee + shuttlePrice * shuttleCount;
  const perPerson = ceilOneDecimal(totalCost / Math.max(0.5, totalWeight));
  const femaleCapApplied = femaleCount > 0 && nonFemaleWeight > 0 && perPerson > FEMALE_PAYMENT_CAP;
  const femalePerPerson = femaleCapApplied ? FEMALE_PAYMENT_CAP : perPerson;
  const malePerPerson = femaleCapApplied
    ? ceilOneDecimal((totalCost - femalePerPerson * femaleCount) / nonFemaleWeight)
    : perPerson;
  const childPerPerson = ceilOneDecimal(malePerPerson * 0.5);
  const groups = { friends: new Map(), heineken: new Map(), special: new Map() };
  let sequence = 0;
  for (const entry of entries) {
    const player = entry.player;
    const entryCategory = getEntryCategory(entry);
    const canonicalName = player ? paymentDisplayName(player) : getChainEntryBaseName(entry);
    if (player?.affiliation === "特殊" && player.participatesPayment === false) {
      addPaymentLine(groups.special, canonicalName, 0, "不参与A钱", 0, player.id, sequence++, entryCategory);
      continue;
    }
    if (!shouldCountForPayment(entry)) continue;
    addPaymentLine(
      groups[getPaymentGroup(player)],
      canonicalName,
      entryCategory === "child" ? childPerPerson : (entryCategory === "female" ? femalePerPerson : malePerPerson),
      null,
      1,
      player?.id || null,
      sequence++,
      entryCategory
    );
  }
  return {
    payerCount,
    perPerson,
    femaleCount,
    maleCount,
    childCount,
    femalePerPerson,
    malePerPerson,
    childPerPerson,
    femaleCapApplied,
    friends: mapToPaymentRows(groups.friends, "球友"),
    heineken: mapToPaymentRows(groups.heineken, "Hytronik"),
    special: mapToPaymentRows(groups.special),
  };
}

function paymentRowDisplayName(row) {
  const name = String(row?.name || "");
  if (row?.hasChild && !row?.hasFemale && !row?.hasMale) return name.includes("👶") ? name : `${name}👶`;
  if (row?.hasFemale && !row?.hasMale && !row?.hasChild) return name.includes("🌸") ? name : `${name}🌸`;
  return name;
}

function getPaymentRowHighlights(row, femaleCapApplied) {
  return {
    companion: Number(row?.slots) > 1,
    femaleCap: Boolean(femaleCapApplied && row?.slots > 0 && row?.hasFemale && !row?.hasMale && !row?.hasChild),
  };
}

function formatPaymentComposition(row) {
  const maleSlots = Number(row?.maleSlots) || 0;
  const femaleSlots = Number(row?.femaleSlots) || 0;
  const childSlots = Number(row?.childSlots) || 0;
  return [
    maleSlots > 0 ? `🍀x${maleSlots}` : "",
    femaleSlots > 0 ? `🌸x${femaleSlots}` : "",
    childSlots > 0 ? `👶x${childSlots}` : "",
  ].filter(Boolean).join("，");
}

const aliasIndex = buildAliasIndex();
const entries = getChainInputLines(input).map((line, index) => parseChainLine(line, index, aliasIndex)).filter((entry) => entry.clean);
const sorted = [...entries].sort((a, b) => (b.sortRank - a.sortRank) || (a.index - b.index));
const output = sorted.map((entry, index) => {
  return `${index + 1}. ${getChainEntryDisplayName(entry)}（${entry.levelText}）`;
});
const groupedOutput = sorted.map((entry, index) => {
  return `${index + 1}. ${getChainEntryDisplayName(entry)}（${entry.levelGroupLabel || getLevelGroupLabel(entry.levelText)}）`;
});
const groupedCounts = sorted.reduce((counts, entry) => {
  const group = entry.levelGroupLabel || getLevelGroupLabel(entry.levelText);
  counts.set(group, (counts.get(group) || 0) + 1);
  return counts;
}, new Map());
const femaleCount = sorted.filter((entry) => entry.isFemale).length;
const payment = calculatePayment(entries, 70, 11.3, 5);

console.log(output.join("\n"));
console.log(JSON.stringify({ payerCount: payment.payerCount, perPerson: formatMoney(payment.perPerson), friends: payment.friends, heineken: payment.heineken, special: payment.special }, null, 2));

if (payment.payerCount !== 7) throw new Error(`Expected payerCount 7, got ${payment.payerCount}`);
if (formatMoney(payment.perPerson) !== "18.1") throw new Error(`Expected 18.1, got ${formatMoney(payment.perPerson)}`);
if (formatMoney(payment.heineken.find((row) => row.name === "海尼克-刘赵达")?.amount || 0) !== "54.3") throw new Error("Expected 刘赵达 amount to be three shares");
if (payment.heineken.some((row) => row.name === "达哥的领导" || row.name === "海尼克-徐攀")) throw new Error("Expected special members to stay out of heineken group");
if (!payment.special.some((row) => row.name === "达哥的领导" && row.note === "不参与A钱")) throw new Error("Expected non-paying special row");
if (formatMoney(payment.special.find((row) => row.name === "海尼克-徐攀")?.amount || 0) !== "18.1") throw new Error("Expected paying special member amount");
if (formatMoney(calculateLedgerAmount({ friends: payment.friends, heineken: payment.heineken, special: payment.special }, 70)) !== "38.6") {
  throw new Error("Expected ledger amount to exclude choi and subtract court fee");
}
const choiCompanionEntries = ["choi", "choi+1", "甲乙丙"]
  .map((line, index) => parseChainLine(line, index, aliasIndex))
  .filter((entry) => entry.clean);
const choiCompanionPayment = calculatePayment(choiCompanionEntries, 70, 11.3, 5);
const choiCompanionRow = choiCompanionPayment.special.find((row) => row.name === "choi");
if (choiCompanionRow?.slots !== 2) throw new Error("Expected choi and companion to share one payment row");
if (formatMoney(calculateLedgerAmount({
  friends: choiCompanionPayment.friends,
  heineken: choiCompanionPayment.heineken,
  special: choiCompanionPayment.special,
}, 70)) !== "-45.0") {
  throw new Error("Expected ledger amount to exclude choi's entire companion row");
}
if (formatMoney(payment.special.find((row) => row.name === "choi")?.amount || 0) !== "18.1") throw new Error("Expected choi to follow special payment settings and remain visible");
if (!output.some((line) => line.includes("甲乙丙🌸（3级）"))) throw new Error("Expected female flower suffix");
if (!groupedOutput.some((line) => line.includes("甲乙丙🌸（中手）"))) throw new Error("Expected grouped female output");
if (paymentRowDisplayName(payment.friends.find((row) => row.name === "甲乙丙")) !== "甲乙丙🌸") {
  throw new Error("Expected female payment row to include flower suffix");
}
if (femaleCount !== 1) throw new Error(`Expected female count 1, got ${femaleCount}`);
if (getLevelGroupLabel("2级") !== "新手") throw new Error("Expected 2级 to be 新手");
if (getLevelGroupLabel("2.5级") !== "中手") throw new Error("Expected 2.5级 to be 中手");
if (getLevelGroupLabel("3.5级") !== "中手") throw new Error("Expected 3.5级 to be 中手");
if (getLevelGroupLabel("4级") !== "高手") throw new Error("Expected 4级 to be 高手");
if (getLevelGroupLabel("5级") !== "高手") throw new Error("Expected 5级 to be 高手");
if (getLevelGroupLabel("6级") !== "比赛级高手") throw new Error("Expected 6级 to be 比赛级高手");
if (getLevelGroupLabel("不详") !== "不详") throw new Error("Expected unknown to stay unknown");
if (groupedCounts.get("高手") !== 1) throw new Error("Expected 高手 count 1");
if (groupedCounts.get("中手") !== 3) throw new Error("Expected 中手 count 3");
if (groupedCounts.get("新手") !== 2) throw new Error("Expected 新手 count 2");
if (groupedCounts.get("不详") !== 2) throw new Error("Expected unknown count 2");
if (shouldCountForPayment({ clean: "达哥的领导", player: players.find((player) => player.id === 4) })) throw new Error("Expected configured special member to be excluded");
if (!shouldCountForPayment({ clean: "sun", player: players.find((player) => player.id === 7) })) throw new Error("Expected unrelated sun member to participate");
if (findPlayerForLine("sun", buildAliasIndex())?.id !== 7) throw new Error("Expected sun to match the unrelated sun member");
if (findPlayerForLine("阿恒（7点半）", buildAliasIndex())) throw new Error("Expected Chinese time annotation not to match the 7点 member");
if (findPlayerForLine("阿恒 (7点半)", buildAliasIndex())) throw new Error("Expected ASCII time annotation not to match the 7点 member");
if (findPlayerForLine("7点", buildAliasIndex())?.id !== 8) throw new Error("Expected the actual 7点 member to keep matching");
if (findPlayerForLine("7点（7点半到）", buildAliasIndex())?.id !== 8) throw new Error("Expected the actual 7点 member with an annotation to keep matching");

const fullChainPaste = `#接龙
周五 19:00 EDC
本群活动说明
1. choi
2. 达哥
报名截止`;
const fullChainNames = getChainInputLines(fullChainPaste).map(cleanChainLine).filter(Boolean);
if (fullChainNames.join(",") !== "choi,达哥") {
  throw new Error(`Expected full-chain headers and notes to be ignored, got ${fullChainNames.join(",")}`);
}

const plainNameLines = getChainInputLines("choi\n达哥").map(cleanChainLine).filter(Boolean);
if (plainNameLines.join(",") !== "choi,达哥") {
  throw new Error(`Expected plain name input to stay supported, got ${plainNameLines.join(",")}`);
}

const annotatedFriendInput = `1. 甲乙丙+1🌸
2. 阿恒+2高手
3. 阿恒+3中手🌸
4. 阿恒+4新手
5. 阿恒+5`;
const annotatedEntries = getChainInputLines(annotatedFriendInput)
  .map((line, index) => parseChainLine(line, index, buildAliasIndex()))
  .filter((entry) => entry.clean);
const annotatedSorted = [...annotatedEntries].sort((a, b) => (b.sortRank - a.sortRank) || (a.index - b.index));
const annotatedExactOutput = annotatedSorted.map((entry) => `${entry.clean}（${entry.levelText}）`);
const annotatedGroupedOutput = annotatedSorted.map((entry) => `${entry.clean}（${getLevelGroupLabel(entry.levelText)}）`);
const annotatedFemaleCount = annotatedEntries.filter((entry) => entry.isFemale).length;

if (!annotatedExactOutput.includes("阿恒+2（4级）")) throw new Error("Expected 高手 friend to display as 4级 in exact mode");
if (!annotatedExactOutput.includes("阿恒+3🌸（3级）")) throw new Error("Expected 中手 friend to display as 3级 and female");
if (!annotatedExactOutput.includes("阿恒+4（2级）")) throw new Error("Expected 新手 friend to display as 2级 in exact mode");
if (!annotatedGroupedOutput.includes("阿恒+2（高手）")) throw new Error("Expected 高手 friend to display as 高手 in grouped mode");
if (!annotatedGroupedOutput.includes("阿恒+3🌸（中手）")) throw new Error("Expected 中手 friend to display as 中手 in grouped mode");
if (!annotatedGroupedOutput.includes("阿恒+4（新手）")) throw new Error("Expected 新手 friend to display as 新手 in grouped mode");
if (!annotatedExactOutput.includes("阿恒+5（不详）")) throw new Error("Expected unannotated friend to stay unknown");
if (annotatedFemaleCount !== 2) throw new Error(`Expected two annotated female friends, got ${annotatedFemaleCount}`);

const manuallyEditedFriend = parseChainLine(
  "阿达+1🌸高手",
  0,
  buildAliasIndex(),
  "阿达+1::0",
  { isFemale: false, levelText: "2级", levelGroupLabel: "新手" }
);
if (manuallyEditedFriend.isFemale) throw new Error("Expected manual gender override to replace flower detection");
if (manuallyEditedFriend.levelText !== "2级") throw new Error("Expected manual level override to replace text detection");
if (getChainEntryDisplayName(manuallyEditedFriend).includes("🌸")) {
  throw new Error("Expected manual male override to remove the source flower from output");
}
const manualCompetitionOption = PLUS_LEVEL_OPTIONS.find((option) => option.label === "比赛级高手");
if (manualCompetitionOption?.level !== "5级") throw new Error("Expected inline competition level to map to 5级");
const detectedCompetitionFriend = parseChainLine("甲乙丙+1比赛级高手", 0, buildAliasIndex());
if (detectedCompetitionFriend.levelText !== "5级" || detectedCompetitionFriend.levelGroupLabel !== "比赛级高手") {
  throw new Error("Expected competition friend annotation to map to 比赛级高手 / 5级");
}

const cappedEntries = [
  { clean: "男甲", player: null, isFemale: false },
  { clean: "男乙", player: null, isFemale: false },
  { clean: "男丙", player: null, isFemale: false },
  { clean: "女丁", player: null, isFemale: true },
];
const cappedPayment = calculatePayment(cappedEntries, 115, 0, 0);
if (!cappedPayment.femaleCapApplied) throw new Error("Expected female payment cap to apply");
if (formatMoney(cappedPayment.femalePerPerson) !== "25.0") throw new Error("Expected capped female share 25.0");
if (formatMoney(cappedPayment.malePerPerson) !== "30.0") throw new Error("Expected remaining cost to be split as 30.0 per male");
const cappedFemaleRow = cappedPayment.friends.find((row) => row.name === "女丁");
if (formatMoney(cappedFemaleRow?.amount || 0) !== "25.0") throw new Error("Expected female row amount 25.0");
if (paymentRowDisplayName(cappedFemaleRow) !== "女丁🌸") throw new Error("Expected capped female row flower suffix");
if (!getPaymentRowHighlights(cappedFemaleRow, cappedPayment.femaleCapApplied).femaleCap) {
  throw new Error("Expected capped female row highlight");
}
if (!getPaymentRowHighlights({ slots: 3, hasFemale: false, hasMale: true }, false).companion) {
  throw new Error("Expected multi-slot payment row highlight");
}
if (getPaymentRowHighlights({ slots: 1, hasFemale: true, hasMale: true }, true).femaleCap) {
  throw new Error("Expected mixed-gender payment row not to use female-cap highlight");
}
const compositionMap = new Map();
addPaymentLine(compositionMap, "带人测试", 50, null, 1, 99, 0, false);
addPaymentLine(compositionMap, "带人测试", 25, null, 1, 99, 1, true);
const compositionRow = [...compositionMap.values()][0];
if (compositionRow.slots !== 2) throw new Error("Expected composition to include the player and companion");
if (formatPaymentComposition(compositionRow) !== "🍀x1，🌸x1") {
  throw new Error(`Expected mixed payment composition, got ${formatPaymentComposition(compositionRow)}`);
}
if (formatPaymentComposition({ maleSlots: 2, femaleSlots: 0 }) !== "🍀x2") {
  throw new Error("Expected zero female count to be hidden");
}
if (formatPaymentComposition({ maleSlots: 0, femaleSlots: 3 }) !== "🌸x3") {
  throw new Error("Expected zero male count to be hidden");
}
if (formatMoney(cappedPayment.friends.reduce((sum, row) => sum + row.amount, 0)) !== "115.0") {
  throw new Error("Expected capped payment rows to cover the full cost");
}

const childEntry = parseChainLine("阿达+1👶", 0, buildAliasIndex());
if (!childEntry.isChild || childEntry.category !== "child") throw new Error("Expected baby suffix to detect child category");
if (getChainEntryDisplayName(childEntry) !== "阿达+1👶") throw new Error("Expected child output to include baby suffix");

const childExampleEntries = [
  { clean: "成年男性", player: null, category: "male" },
  { clean: "成年女性", player: null, category: "female" },
  { clean: "孩子", player: null, category: "child" },
];
const childExamplePayment = calculatePayment(childExampleEntries, 100, 0, 0);
if (!childExamplePayment.femaleCapApplied) throw new Error("Expected female cap in the 100 yuan child example");
if (childExamplePayment.maleCount !== 1 || childExamplePayment.femaleCount !== 1 || childExamplePayment.childCount !== 1) {
  throw new Error("Expected one male, one female, and one child payer");
}
if (formatMoney(childExamplePayment.malePerPerson) !== "50.0") throw new Error("Expected adult male to pay 50.0");
if (formatMoney(childExamplePayment.femalePerPerson) !== "25.0") throw new Error("Expected adult female to pay 25.0");
if (formatMoney(childExamplePayment.childPerPerson) !== "25.0") throw new Error("Expected child to pay half the adult male share");
const childRow = childExamplePayment.friends.find((row) => row.name === "孩子");
if (formatMoney(childRow?.amount || 0) !== "25.0") throw new Error("Expected child row amount 25.0");
if (paymentRowDisplayName(childRow) !== "孩子👶") throw new Error("Expected child payment row to include baby suffix");
if (formatMoney(childExamplePayment.friends.reduce((sum, row) => sum + row.amount, 0)) !== "100.0") {
  throw new Error("Expected child example payment rows to cover 100.0");
}

const childCompositionMap = new Map();
addPaymentLine(childCompositionMap, "亲子测试", 50, null, 1, 100, 0, "male");
addPaymentLine(childCompositionMap, "亲子测试", 25, null, 1, 100, 1, "child");
if (formatPaymentComposition([...childCompositionMap.values()][0]) !== "🍀x1，👶x1") {
  throw new Error("Expected child companion composition");
}

paymentOrders["Hytronik"] = [8, 7];
const orderMap = new Map();
addPaymentLine(orderMap, "后入群", 1, null, 1, 7, 0);
addPaymentLine(orderMap, "先入群", 1, null, 1, 8, 1);
addPaymentLine(orderMap, "陌生人", 1, null, 1, null, 2);
const orderedNames = mapToPaymentRows(orderMap, "Hytronik").map((row) => row.name).join(",");
if (orderedNames !== "先入群,后入群,陌生人") throw new Error(`Expected saved payment order, got ${orderedNames}`);
