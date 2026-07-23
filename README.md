# 中羽等级

这是一个用于组织羽毛球局的单页应用。前端入口是 `index.html`，线上由 Cloudflare Worker 托管，数据保存在 Cloudflare D1。

## 线上地址

https://badminton-level.choi975.workers.dev

## Cloudflare 资源

- Worker: `badminton-level`
- D1: `Badminton-level`
- D1 ID: `5715c3ab-3575-473b-ad5e-601d78eaaee1`

说明：Cloudflare D1 数据库名不允许空格，所以实际创建名为 `Badminton-level`。

## 常用命令

```bash
npm run build
npm run dev
npm run d1:migrate:local
npm run d1:migrate:remote
npm run deploy
```

## 文件说明

- `index.html`: 主界面和所有前端交互。
- `src/worker.js`: Worker API，负责连接 D1。
- `migrations/0001_initial.sql`: D1 表结构。
- `scripts/verify-chain.js`: 使用需求里的示例验证接龙和群收款规则。
