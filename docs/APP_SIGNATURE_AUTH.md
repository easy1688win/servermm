# 应用级验证（API Key + HMAC-SHA256 签名）

## 背景

系统现有鉴权包含：

- 用户级：JWT（Authorization Bearer）
- 应用级：x-ap（API Key，后端与 users.api_key 直接比对加密串）

在需要更强的“请求不可篡改 + 时间窗防重放”场景下，新增可选的应用级签名校验。

## 请求头

- x-api-key：应用 API Key
- x-ts：时间戳（毫秒；也兼容秒）
- x-nonce：随机数（可选；启用后可阻止 5 分钟窗口内的重复请求）
- x-sig：签名（HMAC-SHA256，hex）

## 签名串（canonical string）

```
METHOD\n
PATH_WITH_QUERY\n
TIMESTAMP_MS\n
SHA256( RAW_BODY )\n
NONCE
```

- PATH_WITH_QUERY：例如 `/api/dashboard/summary?x=1`
- RAW_BODY：后端使用原始请求体字节；前端建议使用 axios 默认序列化后的 JSON 字符串
- NONCE：可选；如果不传 nonce，则签名串不含最后一行

## 校验规则

- 时间戳窗口：±5 分钟（默认）
- nonce 防重放：当提供 nonce 时，同一个 `x-api-key + x-nonce` 在窗口内只能使用一次

## 后端环境变量

- APP_HMAC_ENABLED=true|false（开启/关闭）
- APP_HMAC_REQUIRED=true|false（是否强制；建议先灰度，默认 false）
- APP_API_KEY / APP_API_SECRET（单一 key/secret）
- APP_HMAC_KEYS（可选，多 key/secret 的 JSON 字符串，优先级高于单一配置）
  - 例：`{"k1":"s1","k2":"s2"}`

## 注意事项

- 浏览器前端无法安全保存长期 API Secret。如果确需在浏览器端开启强制签名，需要接受 Secret 可能被提取的风险，或将签名放到受信任的中间层（BFF/代理服务）完成。

