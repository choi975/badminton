import assert from "node:assert/strict";

function getBestPartnerIdsMap(sessions) {
  const partnerCounts = new Map();
  for (const session of sessions) {
    const playerIds = [...new Set((session.players || [])
      .map((row) => row.playerId)
      .filter((playerId) => playerId !== null && playerId !== undefined)
      .map(Number)
      .filter(Number.isFinite))];
    playerIds.forEach((playerId) => {
      const counts = partnerCounts.get(playerId) || new Map();
      playerIds.forEach((partnerId) => {
        if (partnerId !== playerId) counts.set(partnerId, (counts.get(partnerId) || 0) + 1);
      });
      partnerCounts.set(playerId, counts);
    });
  }

  return new Map([...partnerCounts.entries()].map(([playerId, counts]) => {
    const highestCount = Math.max(0, ...counts.values());
    const partnerIds = highestCount > 0
      ? [...counts.entries()].filter(([, count]) => count === highestCount).map(([partnerId]) => partnerId)
      : [];
    return [playerId, partnerIds];
  }));
}

const sessions = [
  { players: [{ playerId: 1 }, { playerId: 2 }, { playerId: null, playerName: "甲+1" }] },
  { players: [{ playerId: 1 }, { playerId: 2 }, { playerId: 3 }] },
  { players: [{ playerId: 1 }, { playerId: 3 }, { playerId: 3 }] },
  { players: [{ playerId: 4 }] },
];

const result = getBestPartnerIdsMap(sessions);
assert.deepEqual(result.get(1), [2, 3], "并列最佳拍档应全部保留，交给界面排序并截取前三名");
assert.deepEqual(result.get(2), [1], "共同出场次数最多的成员应成为最佳拍档");
assert.deepEqual(result.get(3), [1], "同一场重复成员行不能重复累计");
assert.deepEqual(result.get(4), [], "没有共同出场成员时应没有最佳拍档");
assert.equal(result.has(null), false, "+N 等未关联成员不应参与统计");

console.log("Best-partner verification passed.");
