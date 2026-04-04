# 环境配置文档

## 🔧 **环境变量配置**

### **基础配置**
```bash
# 服务器配置
PORT=5000
NODE_ENV=production

# 数据库配置
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name
DB_PORT=3306

# JWT配置
JWT_SECRET=your_very_long_jwt_secret_key_here
JWT_EXPIRES_IN=24h

# 加密配置
ENCRYPTION_KEY=your_32_byte_encryption_key_here

# CORS配置
CORS_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com

# 公共基础URL
PUBLIC_BASE_URL=https://yourdomain.com
```

### **安全配置**
```bash
# 速率限制配置 (可选)
RATE_LIMIT_WINDOW_MS=900000        # 15分钟
RATE_LIMIT_GENERAL_MAX=100         # 通用限制
RATE_LIMIT_AUTH_MAX=10             # 认证限制
RATE_LIMIT_UPLOAD_MAX=20           # 上传限制

# 日志配置
LOG_LEVEL=error                     # error, warn, info, debug
LOG_FILE_PATH=/var/log/app.log
```

### **生产环境配置**
```bash
# 生产环境
NODE_ENV=production
PORT=5000
LOG_LEVEL=error

# 数据库连接池
DB_POOL_MIN=5
DB_POOL_MAX=20
DB_POOL_ACQUIRE=30000
DB_POOL_IDLE=10000
```

### **开发环境配置**
```bash
# 开发环境
NODE_ENV=development
PORT=5000
LOG_LEVEL=debug

# 开发数据库
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=root
DB_NAME=dev_db
```

## 🔒 **安全最佳实践**

### **1. 密钥管理**
- 使用强随机密钥
- 定期轮换密钥
- 不要在代码中硬编码密钥
- 使用环境变量或密钥管理服务

### **2. JWT密钥要求**
```bash
# 至少32字符的强密钥
JWT_SECRET=your_super_secure_jwt_secret_key_minimum_32_characters_long

# 示例生成命令
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### **3. 加密密钥要求**
```bash
# 32字节 (64字符十六进制) 或任意长度字符串
ENCRYPTION_KEY=your_32_byte_encryption_key_or_any_length_string

# 示例生成命令
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🚀 **部署配置**

### **Docker环境变量**
```yaml
# docker-compose.yml
environment:
  - NODE_ENV=production
  - PORT=5000
  - DB_HOST=db
  - DB_USER=${DB_USER}
  - DB_PASSWORD=${DB_PASSWORD}
  - DB_NAME=${DB_NAME}
  - JWT_SECRET=${JWT_SECRET}
  - ENCRYPTION_KEY=${ENCRYPTION_KEY}
```

### **Nginx代理配置**
```nginx
# 传递真实IP
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;

# 设置信任代理
# 在Node.js中: app.set('trust proxy', 1);
```

## 📋 **配置检查清单**

### **生产环境部署前检查**
- [ ] `NODE_ENV=production`
- [ ] 强JWT密钥 (至少32字符)
- [ ] 加密密钥已设置
- [ ] CORS域名正确配置
- [ ] 数据库连接测试
- [ ] 日志级别设置为 `error`
- [ ] 速率限制已启用
- [ ] SSL证书配置
- [ ] 防火墙规则配置

### **安全配置验证**
```bash
# 检查环境变量
node -e "console.log('NODE_ENV:', process.env.NODE_ENV)"
node -e "console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length || 0)"
node -e "console.log('ENCRYPTION_KEY set:', !!process.env.ENCRYPTION_KEY)"
```

## 🔍 **故障排查**

### **常见配置问题**
1. **JWT_SECRET未设置**: 服务器启动失败
2. **ENCRYPTION_KEY缺失**: 加密功能不可用
3. **NODE_ENV错误**: 错误处理行为异常
4. **CORS配置错误**: 前端无法访问API

### **调试命令**
```bash
# 检查当前配置
npm run config:check

# 测试数据库连接
npm run db:test

# 验证JWT密钥
npm run jwt:verify
```

---

**最后更新**: 2026-03-28  
**维护者**: 开发团队  
**版本**: v1.0.0
