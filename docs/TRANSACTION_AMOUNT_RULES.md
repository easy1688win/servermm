# Transaction Amount Rules (Company vs Vendor)

## 两套余额

- 公司余额：由 **Bank** 与 **Game(本地对账池)** 体现
- 供应商余额：由供应商侧 **玩家余额** 体现（TC）

## 字段语义（禁止混淆）

- `amount`：只代表公司银行出/入账金额
- `bonus`：只用于 DEPOSIT，代表供应商侧额外入账金额
- `walve`：用于 WITHDRAWAL/WALVE，代表供应商侧额外扣款金额或销毁金额
- `tips`：只用于 WITHDRAWAL，代表公司侧对账与供应商扣款的一部分（银行余额仍只按 amount 变动）

## 规则

### 1) DEPOSIT

- Vendor：`+(amount + bonus)`
- Bank：`+ amount`
- Game：`- (amount + bonus)`
- UI Total / Recent：`amount + bonus`

### 2) WITHDRAWAL

- Vendor：`- (amount + walve + tips)`
- Bank：`- amount`
- Game：`+ (amount + walve + tips)`
- UI Total / Recent：`amount + walve + tips`

### 3) WALVE

- Vendor：`- walve`（只用 walve）
- Bank：`0`
- Game：`+ walve`
- UI Total / Recent：`walve`

## 反例（视为缺陷）

- DEPOSIT 把 tips/walve 混进供应商金额
- WITHDRAWAL 把 bonus 混进供应商金额
- WALVE 使用 amount 或 tips/bonus 参与供应商金额或展示金额

## 代码入口

- 金额规则单一来源：`backend/src/services/transactions/transaction-amounts.ts`

