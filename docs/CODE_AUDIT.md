## 代码审计（Sub Brand 相关）

### 主要变更
- createPlayer：仅以当前 scope games 为准，metadata 仅覆写账号名（支持 gameId 优先匹配）
- players/list-context：引入 scope 级缓存（TTL 300s）
- 多处 operator/subBrand 下拉按租户维度查询，避免遗漏

### 风险点与对策
- 进程内缓存一致性：设置短 TTL（300s），用户/设置变更需调用 invalidate 接口（后续）
- 元数据匹配：新增 gameId 精确匹配；name 匹配仅限当前 scope；其余忽略
- 日志量：建议仅在灰度环境短期开启 SQL/RT 日志采集，避免生产日志膨胀

### 安全
- 不记录密钥/账号敏感字段；已使用字段级加密与脱敏展示
- 权限与 scope 由中间件统一把关（含 x-sub-brand-id 校验）

### 上线与回滚
- 先在灰度环境短期开启 SQL/RT 日志采集；观测 P99、错误率、内存/句柄
- 若异常，关闭采集并回滚到上一个稳定版本（构建产物保留）
