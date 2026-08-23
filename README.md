# 羽球助手

这是一个用于组织羽毛球局的单页应用。前端入口是 `index.html`，数据保存在 Cloudflare D1，并提供 GitHub Pages 只读备用入口。

## 线上地址

- 管理版：https://badminton.choi975.workers.dev
- 备用版：https://choi975.github.io/badminton/

管理版优先读取 D1，断网时自动降级到浏览器缓存或随代码发布的数据快照并进入只读状态。备用版始终只读，默认打开接龙助手并隐藏数据库。

## 随行人员口径

接龙里的 `+N`、`＋N`、`➕N`、`代N` 和 `加N` 表示编号为 N 的一位随行人员，并不表示一次增加 N 人。新记录会为每位实际参与者保留独立的性别、水平快照及归属人：接龙助手逐人展示，训练预估按包含随行人员在内的总人数计算；群收款、订场确认、订场日历、成员统计和导出则按归属人汇总金额和带人数。归属人缺席时不增加其打球次数，也不参与该场最佳拍档统计。

旧记录继续使用 `slots` 和 `plusCount` 保留总人数、金额和带人数。旧随行人员从未保存过的性别与水平统一视为“不详”，不会从归属人推断或补造。

## Cloudflare 资源

- Worker: `badminton`
- D1: `Badminton`
- R2: `badminton-photos`（成员照片）

## 常用命令

```bash
npm run build
npm run estimator
npm run snapshot
npm run build:fresh
npm test
npm run dev
npm run d1:migrate:local
npm run d1:migrate:remote
npm run deploy
```

## 文件说明

- `index.html`: 主界面和所有前端交互。
- `src/worker.js`: Worker API，负责连接 D1。
- `data/bootstrap-snapshot.json`: 随版本发布的 D1 数据快照。
- `scripts/generate-snapshot.js`: 从远程 D1 生成最新快照。
- `scripts/train-estimator.js`: 使用最新 D1 订场记录训练场地容量和各球型号的独立权重。
- `data/booking-estimator.json`: 当前部署使用的预估模型参数。
- `docs/booking-estimation.md`: 预估规则、固定排除记录和后续更新说明。
- `migrations/0001_initial.sql`: D1 表结构。
- `migrations/0012_participant_owners.sql`: 随行人员归属字段及可确定归属的历史逐人记录回填。
- `scripts/verify-chain.js`: 使用需求里的示例验证接龙和群收款规则。
- `scripts/verify-participant-ownership.js`: 随行人员归属、统计投影及字段贯穿的可执行契约测试。
- `scripts/verify-estimator.js`: 验证 v4 公式、独立球型号权重、异常阈值、模型快照同步和历史回放。
