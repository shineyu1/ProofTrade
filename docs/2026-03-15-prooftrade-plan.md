# ProofTrade 产品方案

## 1. 产品定位

**ProofTrade** 是面向 **OKX CEX trading agents** 的 trust + permission layer。

它不承诺 Agent 一定赚钱。它证明的是：

- Agent 是否在结果出现前先做了承诺
- Agent 是否一直遵守 policy 约束
- Agent 是否通过 shadow 表现赚到了执行权限
- Agent 在升级之后是否仍然被限制在受保护执行路径内

对用户的交互入口是 **OpenClaw**。MVP 不单独做前端面板。

## 2. 核心命题

大多数交易 Agent 首先失败的不是智能，而是信任。

用户不会轻易把执行权限交给 AI，除非它能证明：

- 它先承诺、后验证
- 它始终在 policy 内行动
- 它的权限是 earned 的
- 它即便升级，也不是无限制自动交易

ProofTrade 的目标，就是把这套 trust 机制显式化、结构化。

## 3. 第二届比赛语境下的产品叙事

这个项目是专门为第二届 OKX AI Trading Hackathon 设计的，而第二届是 **CEX 主导**。

所以主叙事必须是：

1. Agent 基于 OKX CEX 的 market 和 portfolio 上下文生成 shadow decision
2. 这次 decision 会被 commitment 和后续评估记录下来
3. Agent 持续积累本地 trust record
4. 在 `L2 -> L3` 的晋升边界，由 Auditor Agent 批量审阅这段窗口内的交易行为与日志
5. License Board 综合量化评估与审计结论，决定是否签发 `L3`
6. `L3` 不等于裸执行权
7. `L3` 只解锁 OKX 的受保护执行能力

### 为什么 CEX-first 产品仍然保留 shadow trading

shadow 模式不是终点，而是：

**AI 获得执行权限的资格赛**

也就是说：

- CEX execution 是目标
- shadow evaluation 是晋升机制

所以最准确的说法是：

**shadow-first, protected CEX execution second**

进一步升级后的准确说法是：

**shadow-first, agent-audited promotion, protected CEX execution last**

## 4. Gemini 四维评分映射

### 集成性 Integration

ProofTrade 集成了：

- OpenClaw 作为交互层
- OKX `market`
- OKX `portfolio`
- OKX `spot algo`
- OKX `bot grid`
- 本地 trust registries
- 可选的 ERC-8004 兼容发布层

### 实用性 Practicality

真实问题不是“AI 能不能帮我下单”，而是：

**AI 交易 Agent 到底什么时候才配获得执行权？**

ProofTrade 用 shadow evaluation、权限升级、受保护执行来回答这个问题。

### 创新性 Innovation

核心创新不是另一个交易助手，而是：

**execution rights are earned, not assumed**

升级版创新点是：

**AI 不只是被规则评估，还要经过 Agent 审核后才能升级权限。**

### 可复现性 Reproducibility

系统会产出清晰证据：

- local registry snapshots
- execution records
- OKX submission records
- `license_certificate.json`
- `shadow-replay.log`
- 明确的 `L2` 拒绝 与 `L3` 放行

## 5. MVP 范围

### 包含

- OpenClaw 作为交互入口
- 本地 shadow decision 生成链路
- commitment hashing 与 verification
- evaluator 与 rolling trust summary
- 本地 registry：
  - agent
  - commitment
  - attestation
  - license
  - execution
  - submission
  - certificate
  - replay evidence
- protected execution gating
- `L3` 只允许：
  - `spot algo` 主路径
  - `bot grid` 次路径
- CLI 友好的输出，方便做录屏、截图和视频演示

### 不包含

- 独立 Web 面板
- 实盘交易
- Agent marketplace
- 复杂多 Agent auction / routing
- 链上执行主流程

## 6. Trust Model

ProofTrade 建立在 4 个核心 trust primitives 上：

### Agent Identity

这个 Agent 到底是谁：

- `agent_id`
- `prompt_hash`
- `policy_hash`
- versioned local profile

### Shadow Commitment

这个 Agent 是否在结果出现前先做了承诺：

- canonical payload
- deterministic commitment hash
- 本地 commitment record
- 未来可选 onchain mirror

### Performance Attestation

这个 Agent 是否长期表现出纪律性和一致性：

- policy compliance
- max adverse excursion
- synthetic PnL
- risk-adjusted score
- rolling summary

### Permission License

这个 Agent 当前被允许做什么：

- `L0` Observe
- `L1` Advise
- `L2` Shadow
- `L3` Limited Execute

在 MVP 里，`L3` 的准确含义是：

- 只允许 demo 环境
- 只允许 `algo` 或 `bot`
- 执行仍然受到 policy 限制

### Agent Audit Layer

这层不参与实时交易，而参与晋升审查。

核心职责：

- 审阅一段时间窗口内的 shadow decisions
- 审阅 evaluator 输出和 replay logs
- 识别量化规则不易捕捉的问题，例如：
  - 遇到极端波动时是否出现逻辑崩溃
  - 是否对特定叙事或假新闻过拟合
  - 是否存在理由与行为脱节
- 形成审计报告
- 对 `L2 -> L3` 给出推荐意见

这一层的目标不是“逐单拦截”，而是“晋升审计”。

## 7. 产品架构

### OpenClaw Layer

- 用户交互入口
- 接收用户请求和上下文
- 展示当前 trust state 和执行资格

### ProofTrade Local Engine

- canonical payload generation
- commitment hashing
- evaluator
- rolling recommendation logic
- 本地 JSON registries

### Auditor Agent / License Board

- 读取时间窗口内的 shadow records
- 读取 evaluator summary
- 生成批量审计报告
- 对 `L2 -> L3` 做通过 / 驳回建议
- License Board 结合规则结果与审计意见签发 license

### Onchain Protocol Layer（未来扩展）

这层不是执行主路径，而是协议层与发布层。

它的职责不是代替本地 trust engine，而是把结果发布成公共、可验证、可审计的协议状态。

建议沉淀上链的对象包括：

- Agent identity
- Agent registration file
- 审计报告摘要
- license 状态
- reputation / validation records
- 审计结论哈希

在产品定位上，这层最适合落在 X Layer，并保持与 ERC-8004 兼容。

### Protected Execution Layer

- 读取当前 license
- 若低于 `L3`，直接拒绝执行
- 若达到 `L3`，只生成：
  - `algo`
  - `bot`

### Evidence Layer

这层是为了 Gemini 评分和视频演示而专门强化的：

- `license_certificate.json`
- `shadow-replay.log`
- `audit_report.json`
- execution JSON
- OKX submission JSON
- `L2` 拒绝 与 `L3` 放行 的对比日志

### X Layer / ERC-8004 Compatibility Layer

这层是兼容层，不是本地 trust engine 本体。

计划中的用途：

- agent identity publication
- endpoint discovery
- reputation summaries
- validation / attestation evidence

我们不会用 ERC-8004 去替代本地 commitment 和 license 逻辑。

更准确地说：

- `ProofTrade core`：本地决定与执行门控
- `Onchain protocol layer`：链上公开注册、验证留痕、声誉沉淀

## 8. 为什么 ERC-8004 仍然重要

ERC-8004 很适合作为外层标准：

- 负责 publish / prove
- 不负责 decide / enforce

架构上一句话：

**ProofTrade 是一个兼容 ERC-8004 的 trading agent trust layer。**

产品上一句话：

**ProofTrade 让 AI Agent 必须先赚到使用 OKX 受保护 CEX 策略的资格。**

## 9. OKX Skill Strategy

### 基础上下文技能

- `market`
- `portfolio`

### 受保护执行技能

- `spot algo`
- `bot grid`

### 刻意约束

不要把 `L3` 设计成 unrestricted `trade`。

因为项目的核心价值就是：

**执行权限要先 earned，再执行；执行时还要 bounded。**

## 10. Demo 结构

最强 demo 应该呈现这条链：

1. 在 OpenClaw 中展示 Agent 身份与当前 level
2. 展示一次 shadow decision 和对应 commitment
3. 展示 rolling trust results
4. 展示 `L2 -> L3` 升级
5. 展示 `L3` 只解锁受保护执行
6. 触发一次 protected demo execution
7. 展示 OKX submission result 与本地状态更新

此外还要补一段强对比证据：

- 一次 `L2` 越权被拒
- 一次 `L3` spot algo 成功放行
- 一次 Auditor Agent 对晋升窗口的批量审计报告

## 11. 当前构建状态

本地已完成：

- canonical payload validation
- commitment hash generation
- evaluator and rolling recommendation logic
- local JSON state persistence
- protected execution gating
- OKX CLI request / submit path
- `license_certificate.json`
- historical replay evidence generation
- X Layer registry contract compilation
- X Layer publication bundle generation
- X Layer deploy / publish scripts

下一版重点新增：

- License Board 混合签发逻辑完善
- X Layer / ERC-8004 协议层发布设计
