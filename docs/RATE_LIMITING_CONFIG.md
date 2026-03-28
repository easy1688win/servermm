# API速率限制配置文档

## 🛡️ **概述**

为了防止DoS攻击和API滥用，我们实施了多层级的速率限制策略。所有速率限制都基于IP地址进行控制，并支持代理环境下的真实IP获取。

## 📊 **速率限制层级**

### **1. 通用API速率限制** (`generalRateLimit`)
- **应用范围**: 所有 `/api/*` 路由
- **时间窗口**: 15分钟
- **请求限制**: 100次/IP
- **用途**: 一般API调用的基础保护

### **2. 严格认证速率限制** (`authRateLimit`)
- **应用范围**: 登录、2FA设置/验证等敏感操作
- **时间窗口**: 15分钟  
- **请求限制**: 10次/IP
- **特殊功能**: 成功请求不计入限制
- **用途**: 防止暴力破解和认证攻击

### **3. 文件上传速率限制** (`uploadRateLimit`)
- **应用范围**: 文件上传接口
- **时间窗口**: 1小时
- **请求限制**: 20次/IP
- **用途**: 防止存储空间滥用和恶意上传

### **4. 营销页面跟踪限制** (`trackingRateLimit`)
- **应用范围**: 营销页面跟踪 (`/lp/*`)
- **时间窗口**: 1分钟
- **请求限制**: 1000次/IP
- **用途**: 营销数据分析的宽松限制

## 🔧 **技术实现**

### **核心配置**
```typescript
// 代理支持
app.set('trust proxy', 1);

// 分层应用
app.use('/lp', trackingRateLimit);        // 营销跟踪
app.use('/api', generalRateLimit);        // 通用API
```

### **认证特殊处理**
```typescript
// 认证路由使用更严格的限制
router.post('/login', authRateLimit, login);
router.post('/2fa/setup', authRateLimit, setup2FA);
router.post('/2fa/verify', authRateLimit, verify2FA);
```

### **文件上传保护**
```typescript
// 文件上传专用限制
router.post('/upload-image', uploadRateLimit, upload.single('file'));
```

## 📈 **响应格式**

当触发速率限制时，返回统一的错误响应：

```json
{
  "code": 2,
  "key": "Code429", 
  "http": 429,
  "params": {},
  "details": "Too many requests from this IP, please try again later."
}
```

### **HTTP头信息**
- `RateLimit-Limit`: 请求限制总数
- `RateLimit-Remaining`: 剩余请求次数
- `RateLimit-Reset`: 重置时间戳

## 🌍 **国际化支持**

### **英文翻译**
```typescript
Code429: "Too many requests from this IP, please try again later."
```

### **中文翻译**  
```typescript
Code429: "请求过于频繁，请稍后再试"
```

## 🔍 **监控与调试**

### **日志记录**
所有速率限制触发都会记录在应用日志中，包括：
- 触发时间
- 客户端IP
- 请求路径
- 限制类型

### **调试建议**
1. 检查 `RateLimit-*` 响应头
2. 监控应用日志中的速率限制事件
3. 根据实际使用情况调整限制参数

## ⚙️ **配置调优**

### **生产环境建议**
- **高峰期**: 监控API调用频率，必要时调整限制
- **攻击场景**: 快速降低限制阈值
- **业务增长**: 定期评估和调整限制策略

### **环境变量配置**
```bash
# 可选的环境变量配置
RATE_LIMIT_WINDOW_MS=900000        # 15分钟
RATE_LIMIT_GENERAL_MAX=100         # 通用限制
RATE_LIMIT_AUTH_MAX=10             # 认证限制
RATE_LIMIT_UPLOAD_MAX=20           # 上传限制
```

## 🚀 **性能考虑**

### **内存使用**
- 速率限制数据存储在内存中
- 自动清理过期数据
- 对服务器性能影响微乎其微

### **代理兼容性**
- 支持 Nginx、Cloudflare 等代理
- 正确解析 `X-Forwarded-For` 头
- IPv6 地址标准化处理

## 📋 **最佳实践**

1. **分层防护**: 不同敏感度使用不同限制级别
2. **用户体验**: 合理设置限制，避免误伤正常用户
3. **监控告警**: 设置异常流量告警
4. **定期审查**: 根据业务发展调整策略
5. **文档更新**: 及时更新配置文档和团队知识

## 🔒 **安全效果**

实施速率限制后，系统具备了以下安全保护：

- ✅ **DoS攻击防护**: 有效防止大规模请求攻击
- ✅ **暴力破解防护**: 限制登录尝试次数
- ✅ **资源滥用防护**: 防止存储和计算资源滥用
- ✅ **业务连续性**: 确保服务在攻击下仍可用
- ✅ **成本控制**: 避免因攻击导致的云服务费用激增

---

**最后更新**: 2026-03-28
**维护者**: 开发团队
**版本**: v1.0.0
