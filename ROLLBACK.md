# 回流/回滚版本指令（发布到 GitHub 后使用）

本文档用于：当线上出现问题时，把代码与部署快速“回流/回滚”到某个已发布版本。

## 1) 推荐发布方式（可回滚）

- 每次发布都打 tag（强烈推荐）：`vYYYY.MM.DD[-n]` 或 `vX.Y.Z`
- 同时把 tag 推到 GitHub：这样线上随时可回滚到任意 tag

```bash
# 在主分支/发布分支确认代码无误
git status
git pull --rebase

# 创建并推送 tag
git tag -a v2026.03.15-1 -m "release v2026.03.15-1"
git push origin v2026.03.15-1
```

## 2) 回滚到某个 tag（最常用）

### 2.1 仅“回滚代码”（推荐用于线上部署）

```bash
git fetch --tags
git checkout v2026.03.15-1
```

如果你希望保持在一个可 push 的分支上：

```bash
git checkout -b rollback/v2026.03.15-1 v2026.03.15-1
```

### 2.2 回滚到某个 commit

```bash
git fetch
git checkout <COMMIT_SHA>
```

## 3) 回滚部署（按你的实际部署方式选择）

注意：本项目有 backend 与 frontend 两部分；回滚时通常两边一起回滚更稳。

### 3.1 前端（Vite/静态文件）通用流程

```bash
cd frontend
npm ci
npm run build
```

把 `frontend/dist/` 发布到你的静态站点（Nginx/Cloudflare Pages/对象存储等）。

### 3.2 后端（Node/Express）通用流程

```bash
cd backend
npm ci
npm run build
```

然后按你的进程管理方式重启：

- PM2：
  ```bash
  pm2 restart <APP_NAME>
  ```
- systemd：
  ```bash
  sudo systemctl restart <SERVICE_NAME>
  ```
- 直接 node：
  ```bash
  node dist/server.js
  ```

## 4) 数据库迁移（重要）

- 本项目 migration 是“向前演进”为主：一旦迁移已在生产执行，回滚代码不一定能回滚数据库结构。
- 安全策略：
  - 回滚代码时，确保旧版本仍能兼容当前数据库字段（最好保持向后兼容）
  - 如果必须回退数据库结构，建议新增一条“反向迁移”的 migration（而不是强行 down）

## 5) 快速应急：回滚到上一个发布 tag（示例）

```bash
git fetch --tags
git checkout v2026.03.15-0

cd backend && npm ci && npm run build
cd ../frontend && npm ci && npm run build

# 然后重启后端服务 + 发布前端 dist
```

## 6) 建议你在 GitHub Release 里记录

- tag 名称
- 本次变更点
- 数据库迁移是否包含破坏性变更（breaking）

