# Sub Brand 性能优化报告（阶段性）

## 目标
- 单次请求 RT < 200ms（P99 < 500ms）
- 并发 ≥ 1k QPS 时 CPU < 60%、内存 < 2GB

## 已完成
- 请求与 SQL 级别 Profiling：建议接入 APM 或在灰度环境临时开启 SQL/RT 日志采集
- createPlayer 跨 Sub Brand 同名 Game 混淆修复：严格以当前 scope 的 game.id 为准
- Player list-context 增加分层缓存（scope 级，TTL 300s）
- 多页面 Sub Brand 即时刷新下拉去抖，避免重复请求

## 建议索引
- players: (sub_brand_id, player_game_id) 唯一；(tenant_id, sub_brand_id, created_at)
- games: (sub_brand_id, name) 唯一；(tenant_id, sub_brand_id, status, use_api)
- player_stats: (tenant_id, sub_brand_id, date)
- transactions: (tenant_id, sub_brand_id, created_at), (bank_account_id, created_at)

## 建议缓存
- operatorOptions / subBrandOptions：scope 级 TTL 300s，用户变更时主动失效
- games 元数据（id, name, use_api）：scope 级 TTL 300s

## 后续
- 接入 Redis（或 Memcached）替换进程内缓存
- 接入 APM（OpenTelemetry/Jaeger 或商业 APM）上报 route/sql 维度时延
- Artillery 压测脚本（目标 1k QPS）与灰度回滚验证流程
