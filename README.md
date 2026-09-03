# 羽球助手

这是一个用于组织羽毛球局的单页应用。前端入口是 `index.html`，数据保存在 Cloudflare D1，并提供 GitHub Pages 只读备用入口。

接龙助手会根据当前名单、星期、短期及长期规则、体力、成员共场关系和随行人员历史，估算今天与明天达到 6 人的概率。摇人列表按候选人的预计到场概率与反事实成局提升排序。Cloudflare 管理版会在后台保存去重后的接龙状态；试算模式和 GitHub 只读版不会进入学习数据。模型口径见 `docs/group-formation-probability.md`。

## 线上地址

- 管理版：https://badminton.choi975.workers.dev
- 备用版：https://choi975.github.io/badminton/

管理版优先读取 D1，断网时自动降级到浏览器缓存或随代码发布的数据快照并进入只读状态。备用版始终只读，默认打开接龙助手并隐藏数据库。

## 随行人员口径

接龙里的 `+N`、`＋N`、`➕N`、`代N` 和 `加N` 表示编号为 N 的一位随行人员，并不表示一次增加 N 人。新记录会为每位实际参与者保留独立的性别、水平快照及归属人：接龙助手逐人展示，训练预估按包含随行人员在内的总人数计算；群收款、订场确认、订场日历、成员统计和导出则按归属人汇总金额和带人数。归属人缺席时不增加其打球次数，也不参与该场最佳拍档统计。

旧记录继续使用 `slots` 和 `plusCount` 保留总人数、金额和带人数。旧随行人员从未保存过的性别与水平统一视为“不详”，不会从归属人推断或补造。

## 退群排查

管理版可以上传群成员列表截图，OCR 只负责提取当前序号和可见名称；管理员再用数据库成员设置人工锚点，系统根据新旧序号差值给出可能退群范围。数据库中未录入的序号空位也会保留为候选，分析结果不会自动删除任何成员；单个或多个候选都必须人工确认，并按旧序号从大到小处理。

最终确认前会重新获取云端成员序号并比较候选签名；专用确认接口还会校验当前群的完整序列，资料已变化时返回冲突并停止。双群成员只退出当前群，单群成员才删除档案，未录入成员只调整当前群后方序号，不会连带保存其他群收款设置。

截图仅在本次请求中发送给 Cloudflare AI 做识别，不写入 D1、R2、数据快照或浏览器持久存储。接口只接受 PNG、JPEG 和 WebP 原图，单张不超过 6 MiB；识别人数与管理员填写人数不一致时拒绝继续分析。

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
- `scripts/verify-member-exit-analysis.js`: 截图退群排查的锚点算法、候选范围和 OCR 接口契约测试。
- `scripts/verify-estimator.js`: 验证 v4 公式、独立球型号权重、异常阈值、模型快照同步和历史回放。
- `group-probability.js`: 可在浏览器和 Node 中运行的组局概率与摇人排序核心。
- `migrations/0017_group_attempt_tracking.sql`: 接龙尝试、状态快照和短期规则历史。
- `scripts/verify-group-probability.js`: 验证星期基线、截止时间、体力、大局门槛、随行人员、明日预测和反事实排序。
- `scripts/verify-group-attempts.js`: 验证追踪校验、去重、试算隔离、自动结算和订场对账。
