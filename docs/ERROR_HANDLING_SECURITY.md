# 错误处理安全配置文档

## 🔒 **概述**

为了防止敏感信息泄露和提升系统安全性，我们实施了生产环境安全的错误处理机制。该机制根据运行环境返回不同级别的错误信息，确保生产环境不会暴露系统内部细节。

## 🛡️ **安全策略**

### **生产环境 (NODE_ENV=production)**
- ✅ **隐藏堆栈跟踪**: 不返回详细的错误堆栈
- ✅ **通用错误消息**: 使用安全的通用错误描述
- ✅ **错误追踪ID**: 生成唯一ID用于日志追踪
- ✅ **详细日志记录**: 在服务器端记录完整错误信息

### **开发环境 (NODE_ENV=development)**
- ✅ **详细错误信息**: 返回完整错误详情用于调试
- ✅ **堆栈跟踪**: 包含完整的错误堆栈
- ✅ **请求上下文**: 显示请求参数、URL等信息
- ✅ **快速定位**: 帮助开发者快速定位问题

## 🔧 **技术实现**

### **错误处理中间件**
```typescript
// 生产环境安全错误处理
app.use(productionErrorHandler);

// 404错误处理
app.use(notFoundHandler);

// 全局异常捕获
setupGlobalErrorHandlers();
```

### **错误分类处理**

| 错误类型 | 生产环境响应 | 开发环境响应 |
|---------|-------------|-------------|
| 验证错误 | Code400 (400) | 详细错误信息 |
| JWT错误 | Code103 (401) | 堆栈 + 详情 |
| 数据库错误 | Code500 (500) | 完整错误信息 |
| 权限错误 | Code102 (403) | 权限详情 |
| 资源未找到 | Code404 (404) | URL信息 |
| 速率限制 | Code429 (429) | 限制详情 |

## 📊 **错误响应格式**

### **生产环境安全响应**
```json
{
  "code": 2,
  "key": "Code500",
  "http": 500,
  "params": {},
  "details": {
    "traceId": "1A2B3C-4D5E6F",
    "timestamp": "2026-03-28T14:52:00.000Z"
  }
}
```

### **开发环境详细响应**
```json
{
  "code": 2,
  "key": "DEV_ERROR",
  "http": 500,
  "params": {},
  "details": {
    "message": "Database connection failed",
    "stack": "Error: ECONNREFUSED\n    at ...",
    "traceId": "1A2B3C-4D5E6F",
    "timestamp": "2026-03-28T14:52:00.000Z",
    "url": "/api/users",
    "method": "GET",
    "body": {},
    "query": {},
    "params": {}
  }
}
```

## 🔍 **错误追踪系统**

### **追踪ID生成**
- **格式**: `timestamp-random` (例如: `1A2B3C-4D5E6F`)
- **用途**: 关联日志和错误报告
- **唯一性**: 基于时间戳和随机数确保唯一

### **日志记录**
```typescript
// 生产环境日志示例
console.error(`[${traceId}] Production Error:`, {
  message: error.message,
  stack: error.stack,
  url: req.url,
  method: req.method,
  ip: req.ip,
  userAgent: req.get('User-Agent'),
  timestamp: new Date().toISOString(),
});
```

## 🚨 **全局异常处理**

### **未捕获异常**
```typescript
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
  process.exit(1);
});
```

### **未处理Promise拒绝**
```typescript
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', {
    reason,
    promise,
    timestamp: new Date().toISOString(),
  });
});
```

## 🌍 **国际化支持**

### **错误码翻译**
```typescript
// 英文
Code404: "Resource not found"
Code500: "Internal server error"

// 中文
Code404: "资源未找到"
Code500: "内部服务器错误"
```

## ⚙️ **配置建议**

### **环境变量**
```bash
# 生产环境
NODE_ENV=production

# 开发环境
NODE_ENV=development
```

### **日志配置**
```bash
# 生产环境日志级别
LOG_LEVEL=error

# 开发环境日志级别
LOG_LEVEL=debug
```

## 📋 **最佳实践**

### **1. 错误分类**
- **客户端错误** (4xx): 验证失败、权限不足等
- **服务器错误** (5xx): 数据库错误、系统异常等
- **业务错误**: 自定义业务逻辑错误

### **2. 安全原则**
- **最小信息原则**: 只返回必要的错误信息
- **一致性原则**: 统一的错误响应格式
- **可追踪性**: 每个错误都有唯一追踪ID

### **3. 监控告警**
- **错误率监控**: 设置错误率阈值告警
- **异常模式**: 识别异常错误模式
- **性能影响**: 监控错误对性能的影响

## 🎯 **安全效果**

### **信息泄露防护**
- ✅ **堆栈跟踪隐藏**: 生产环境不暴露内部结构
- ✅ **数据库信息保护**: 不暴露数据库连接信息
- ✅ **文件路径隐藏**: 不暴露系统文件结构
- ✅ **第三方服务信息**: 不暴露API密钥和配置

### **攻击防护**
- ✅ **信息收集防护**: 攻击者无法获取系统信息
- ✅ **漏洞利用困难**: 缺少详细错误信息增加攻击难度
- ✅ **社会工程学防护**: 防止基于错误信息的攻击

## 🔧 **调试支持**

### **开发工具**
- **错误追踪ID**: 快速定位生产环境问题
- **详细日志**: 服务器端完整错误记录
- **环境切换**: 轻松在开发和生产环境间切换

### **故障排查**
1. 获取客户端错误追踪ID
2. 在服务器日志中查找对应记录
3. 分析完整错误信息和上下文
4. 制定修复方案

---

## 📈 **性能影响**

- **内存开销**: 极小 (错误对象创建)
- **CPU开销**: 可忽略 (错误处理逻辑)
- **网络开销**: 减少错误响应大小
- **日志存储**: 增加日志记录，但可配置轮转

---

**最后更新**: 2026-03-28  
**维护者**: 开发团队  
**版本**: v1.0.0
