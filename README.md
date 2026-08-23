# 羽球助手

这是一个用于组织羽毛球局的单页应用。前端入口是 `index.html`，数据保存在 Cloudflare D1，并提供 GitHub Pages 只读备用入口。

## 线上地址

- 管理版：https://badminton.choi975.workers.dev
- 备用版：https://choi975.github.io/badminton/

管理版优先读取 D1，断网时自动降级到浏览器缓存或随代码发布的数据快照并进入只读状态。备用版始终只读，默认打开接龙助手并隐藏数据库。

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
- `scripts/verify-chain.js`: 使用需求里的示例验证接龙和群收款规则。
- `scripts/verify-estimator.js`: 验证 v4 公式、独立球型号权重、异常阈值、模型快照同步和历史回放。
