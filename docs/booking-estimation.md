# 订场预估模型

订场预估模型 v3 只使用当场总人次，场地和用球分别训练。模型不再使用“性别 × 等级”权重或个人修正；当前样本量不足以稳定估计这些细分参数。

## 预估公式

### 场地

```text
场地数 = max(1, ceil(总人次 / 每片场地人数))
```

训练脚本会在 6 到 9 人、步长 0.25 的候选容量中选择历史 MAE 最低的参数，再比较 RMSE。多个参数同分时，选择最接近默认值 7.5 的参数。最终参数写入 `court.peoplePerCourt`，公式写入 `court.formula`。

场地预测不使用球馆、场地价格、场地质量、性别、等级或成员身份。

### 用球

先把每场实际用球按耐打系数换算成亚3等价量，再拟合经过原点的单变量公式：

```text
亚3等价需求 = 总人次 * 亚3等价耗球率 + 风险缓冲
某型号推荐数量 = max(1, ceil(亚3等价需求 / 该型号耐打系数))
```

`shuttle.rsl3EquivalentPerParticipant` 是用全部有效样本做过原点最小二乘得到的每人耗球率。`shuttle.riskBuffer` 默认取训练残差的 70% 分位数，并且不小于 0；这样会把“少带球”的风险计入推荐值。分位数和最终缓冲都以亚3等价颗数为单位。

风险策略可在训练时配置：

- `BOOKING_ESTIMATOR_SHUTTLE_RISK_QUANTILE`：残差分位数，允许 0.5 到 0.99，默认 0.7。
- `BOOKING_ESTIMATOR_SHUTTLE_RISK_BUFFER`：直接指定非负风险缓冲；设置后不再从残差学习缓冲。

## 球型号规则

- 亚3（亚狮龙3号）的耐打系数为 1；历史价格 11、11.3、11.5 元。
- AS05（尤尼克斯 AS05）的耐打系数暂为 1.2；历史价格 13.5 元。
- 用球明细存在 `type` 时，以显式型号为准。
- 只有旧记录缺少 `type` 时，才按上述已知价格识别。
- 显式型号为 `unknown`、型号未登记或旧价格无法识别时，训练立即报错；不能默认当作亚3。

新增球型号时，需要同时在记录端和 `scripts/train-estimator.js` 的 `SHUTTLE_TYPES` 中登记型号、历史价格与耐打系数。

## 独立样本与排除记录

场地和用球使用独立样本管线。一场记录缺少有效场地数量时只跳过场地训练，缺少有效用球数量时只跳过用球训练，不会连带删除另一类样本。总人次取订场参与者记录中的 `slots` 之和，`+N` 已包含在对应记录的 `slots` 中。

场地固定排除：

- 2026-08-10：低水平且场地拥挤，实际订场数量不代表常规需求。

用球固定排除：

- 2026-08-04：球友请客，实际用球数量不完整。

排除项分别维护在 `COURT_EXCLUDED_SESSIONS` 和 `SHUTTLE_EXCLUDED_SESSIONS`。自动跳过的无效记录会写入模型的 `skippedSessions`，固定排除项写入 `excludedSessions`。

## 严格时间验证

验证采用滚动起点（rolling-origin），按日期依次测试：

1. 前 5 场只作为首个训练窗口。
2. 每个测试场次只允许使用日期严格早于它的记录训练参数。
3. 场地容量在每个训练窗口重新选择；用球率和风险缓冲也在每个训练窗口重新拟合。
4. 同一天的其他场次不会进入该场测试的训练集。

这避免了随机切分或普通留一法把未来数据泄漏给过去。`validation` 会记录验证日期、折数、MAE、RMSE、完全命中率、平均偏差以及高估/低估比例。正偏差表示推荐量平均偏多，负偏差表示平均偏少。

## v3 输出结构

`data/booking-estimator.json` 的核心结构如下：

```json
{
  "version": 3,
  "generatedAt": "...",
  "training": {
    "dateRange": { "from": "...", "to": "..." },
    "court": {
      "sampleCount": 0,
      "dateRange": { "from": "...", "to": "..." },
      "excludedSessions": [],
      "skippedSessions": []
    },
    "shuttle": {
      "sampleCount": 0,
      "dateRange": { "from": "...", "to": "..." },
      "excludedSessions": [],
      "skippedSessions": []
    }
  },
  "court": {
    "formula": "ceil(participantCount / peoplePerCourt)",
    "peoplePerCourt": 7.5,
    "minimum": 1,
    "validation": {
      "method": "rolling-origin",
      "minimumTrainingSessions": 5,
      "folds": 0,
      "mae": 0,
      "rmse": 0
    }
  },
  "shuttle": {
    "baseType": "rsl3",
    "formula": "ceil((participantCount * rsl3EquivalentPerParticipant + riskBuffer) / durability)",
    "rsl3EquivalentPerParticipant": 0.81,
    "riskQuantile": 0.7,
    "riskBuffer": 0.6,
    "riskBufferSource": "residual-quantile",
    "minimum": 1,
    "validation": {
      "method": "rolling-origin",
      "minimumTrainingSessions": 5,
      "folds": 0,
      "mae": 0,
      "rmse": 0
    }
  }
}
```

v3 不再输出 `genderLevelWeights`、`intercept` 或 `memberAdjustments`。

## 更新模型

执行 `npm run estimator` 会从 Cloudflare D1 获取最新订场记录，训练 v3 并写入 `data/booking-estimator.json`。随后执行 `npm run snapshot` 和 `npm run build`，将模型加入 Cloudflare 与 GitHub 使用的只读快照和静态产物。

更新前应先检查未知球型号报错、两类固定排除记录和滚动验证指标。除非明确要求，不应直接部署。
