# ProofTrade 开发状态

## 已实现

### 核心数据结构

- [payload.ts](C:/Users/shine/Desktop/codex/src/payload.ts)
- [types.ts](C:/Users/shine/Desktop/codex/src/types.ts)

已经具备：

- canonical payload schema
- commitment hash 计算
- trust / license 基础类型

### Trust Engine

- [evaluator.ts](C:/Users/shine/Desktop/codex/src/evaluator.ts)

已经具备：

- 确定性的 commitment 校验
- 单次 shadow 决策评估
- rolling summary
- `L3` 受保护执行资格推荐

### 本地 Registries

- [state.ts](C:/Users/shine/Desktop/codex/src/state.ts)

会持久化：

- agent
- commitment
- attestation
- license

### 受保护执行层

- [execution.ts](C:/Users/shine/Desktop/codex/src/execution.ts)

当前规则：

- `L3` 以下直接拒绝执行
- `L3` 只允许：
  - `algo`
  - `bot`
- 会写本地 execution record

### OKX 集成层

- [okx-adapter.ts](C:/Users/shine/Desktop/codex/src/okx-adapter.ts)
- [okx-provider.ts](C:/Users/shine/Desktop/codex/src/okx-provider.ts)

当前能力：

- 把受保护执行映射成真实 `okx-trade-cli` demo 命令
- 提交前校验本地 OKX profile / config
- `algo submit` 前读取 live ticker 并按真实市场价重算触发价
- 持久化 submission records
- 将返回的 `algoId / ordId` 回写 execution state

### CLI

- [cli.ts](C:/Users/shine/Desktop/codex/src/cli.ts)

当前命令：

- `npm run evaluate -- <json>`
- `npm run execute -- <json> --mode algo|bot`
- `npm run submit -- <json> --mode algo|bot --profile <name>`
- `--bootstrap-l3` 用于 demo / 测试路径

### OpenClaw 编排层

- [openclaw.ts](C:/Users/shine/Desktop/codex/src/openclaw.ts)
- [run-openclaw-workflow.ts](C:/Users/shine/Desktop/codex/scripts/run-openclaw-workflow.ts)

当前命令：

- `npm run openclaw -- <workflow> <json>`

当前能力：

- 将 `evaluate -> audit -> license board -> execute / submit / publish` 串成单入口流程
- 支持 `full-demo` 本地演示路径
- 支持按 `--strategy <id>` 激活白名单 strategy skill，并将其输出接入 shadow decision 主链
- 支持在给定 `--profile` 时先同步 live OKX `ticker / balance / positions`
- 支持可选的 X Layer 发布步骤

### Strategy Skill Slot 基础层

- [strategy-loader.ts](C:/Users/shine/Desktop/codex/src/strategy-loader.ts)
- [strategy-registry.ts](C:/Users/shine/Desktop/codex/src/strategy-registry.ts)
- [strategy-context.ts](C:/Users/shine/Desktop/codex/src/strategy-context.ts)
- [strategy-runner.ts](C:/Users/shine/Desktop/codex/src/strategy-runner.ts)
- [strategy-normalizer.ts](C:/Users/shine/Desktop/codex/src/strategy-normalizer.ts)
- [catalog.ts](C:/Users/shine/Desktop/codex/src/strategies/catalog.ts)
- [llm-command-adapter.ts](C:/Users/shine/Desktop/codex/src/llm-command-adapter.ts)

当前能力：

- 提供白名单 strategy skills
- 生成稳定的 `strategy_version_hash`
- 每个 agent 只允许一个 active strategy
- 支持先同步 live OKX：
  - `ticker`
  - `bid / ask`
  - `24h high / low / vol`
  - `balance`
  - `total equity`
  - `positions`
  - `unrealized pnl`
  再生成 strategy context
- 支持通过用户自己的 OpenClaw / 自定义命令运行 prompt-based strategy skill
- 在外部 LLM 未配置或执行失败时自动回退到 deterministic strategy
- 默认 deterministic strategy 已显式消费：
  - spread
  - 24h change
  - total equity
  - unrealized pnl
  - current positions
- 将 strategy 输出标准化为当前 payload 兼容格式
- 将 `strategy_id / strategy_version_hash` 写入：
  - payload
  - state
  - audit
  - license board
  - certificate

### Runtime Guard

- [runtime-guard.ts](C:/Users/shine/Desktop/codex/src/runtime-guard.ts)
- [run-runtime-guard.ts](C:/Users/shine/Desktop/codex/scripts/run-runtime-guard.ts)

当前命令：

- `npm run guard -- <json> --current-price <price>`

当前能力：

- 对已获批 `L3` agent 执行运行时熔断检查
- 支持：
  - 手动 `currentPrice`
  - 或通过 OKX `profile / runner` 自动读取 live ticker
- 触发时可：
  - 降回 `L2`
  - 或直接 `revoke`
- 生成 `revocation_report.json`
- 更新本地 `license` 与 `license_certificate.json`

### 审计脚本

- [generate-audit-report.ts](C:/Users/shine/Desktop/codex/scripts/generate-audit-report.ts)
- [license-board.ts](C:/Users/shine/Desktop/codex/src/license-board.ts)
- [auditor.ts](C:/Users/shine/Desktop/codex/src/auditor.ts)
- [llm-command-adapter.ts](C:/Users/shine/Desktop/codex/src/llm-command-adapter.ts)

当前命令：

- `npm run audit -- <json> --bootstrap-l3 --auditor <id>`

当前能力：

- 支持 `LLM-backed Auditor Agent`
- 支持用户通过 OpenClaw / 自定义命令接入自己的 auditor
- 外部 LLM 未配置或执行失败时自动回退到 deterministic auditor

### 证据层

- [certificate.ts](C:/Users/shine/Desktop/codex/src/certificate.ts)
- [replay.ts](C:/Users/shine/Desktop/codex/src/replay.ts)
- [simulate-shadow-evaluation.ts](C:/Users/shine/Desktop/codex/scripts/simulate-shadow-evaluation.ts)

当前能力：

- 自动生成 `license_certificate.json`
- 自动生成 `audit_report.json`
- 自动生成 `revocation_report.json`
- 自动生成 `license-board-decisions/<agentId>.json`
- 自动生成 `shadow-replay.log`
- 支持历史回放式 shadow 评估
- 支持在短时间内演示 `L2 -> L3`

### X Layer 协议层

- [xlayer.ts](C:/Users/shine/Desktop/codex/src/xlayer.ts)
- [ProofTradeRegistry.sol](C:/Users/shine/Desktop/codex/contracts/ProofTradeRegistry.sol)
- [deploy-xlayer.ts](C:/Users/shine/Desktop/codex/scripts/deploy-xlayer.ts)
- [publish-xlayer.ts](C:/Users/shine/Desktop/codex/scripts/publish-xlayer.ts)
- [show-xlayer-account.ts](C:/Users/shine/Desktop/codex/scripts/show-xlayer-account.ts)

当前能力：

- 从本地 state/certificate 构建链上发布包
- 编译 ProofTrade registry 合约
- 部署 X Layer registry
- 发布：
  - agent identity
  - validation summary
  - license state
  - audit summary

## 已确定但尚未完成的集成项

当前还缺的主要是：

- 更完整的 OKX 全量市场/账户字段覆盖
- 持续在线的 runtime guard 守护进程
- 更成熟的多策略 / 多审计员编排层

设计原则已经确定：

- Auditor Agent 不审核每一笔实时交易
- Auditor Agent 只在 `L2 -> L3` 晋升边界进行批量审计
- 实时执行保护仍然由当前确定性规则系统负责
- Strategy Skill 可以读 OKX 数据，但不能直接执行

## 链上协议层定位

目前已经明确：

- 如果未来补 X Layer / ERC-8004，这层将被设计成 **协议层 / 发布层**
- 它不会替代当前本地的 evaluator、auditor agent 或 license board
- 它更适合承载：
  - agent identity
  - audit report hash
  - validation / reputation summary
  - license publication

## 已验证

- `npm test`
- `npm run build`
- `npm run evaluate -- examples/sample-evaluation-input.json`
- `npm run execute -- examples/sample-evaluation-input.json --mode algo --bootstrap-l3`
- `npm run replay -- examples/sample-evaluation-input.json --scenario extreme-volatility-replay`
- `npm run openclaw -- full-demo examples/sample-evaluation-input.json --mode algo --bootstrap-l3 --data-dir .\\tmp-strategy-slot-check`
- `npm run openclaw -- full-demo examples/sample-evaluation-input.json --strategy momentum-spot-algo --mode algo --bootstrap-l3 --data-dir .\\tmp-openclaw-strategy-check`
- `npm run openclaw -- submit examples/sample-evaluation-input.json --strategy momentum-spot-algo --mode algo --bootstrap-l3 --profile demo --data-dir .\\tmp-openclaw-live-context`
- `npm run openclaw -- guard examples/sample-evaluation-input.json --bootstrap-l3 --profile demo --data-dir .\\tmp-openclaw-guard`

## 当前证据文件

本地已经会生成：

- [data/licenses](C:/Users/shine/Desktop/codex/data/licenses)
- [data/executions](C:/Users/shine/Desktop/codex/data/executions)
- [data/okx-submissions](C:/Users/shine/Desktop/codex/data/okx-submissions)
- [data/certificates](C:/Users/shine/Desktop/codex/data/certificates)
- [data/audits](C:/Users/shine/Desktop/codex/data/audits)
- [data/revocations](C:/Users/shine/Desktop/codex/data/revocations)
- [data/evidence](C:/Users/shine/Desktop/codex/data/evidence)

例如：

- [shadow-replay.log](C:/Users/shine/Desktop/codex/data/evidence/extreme-volatility-replay/shadow-replay.log)
- [license_certificate.json](C:/Users/shine/Desktop/codex/data/evidence/extreme-volatility-replay/license_certificate.json)
- [prooftrade-agent-001.json](C:/Users/shine/Desktop/codex/data/audits/prooftrade-agent-001.json)

## 当前限制

- 还没有做 ERC-8004 publisher
- 真实 submit 仍然需要用户先在 `~/.okx/config.toml` 中配置 OKX demo profile

## 下一步工程重点

1. 扩展更丰富的实时 OKX `market / account` 上下文字段
2. 做 README / evidence packaging，直接面向 Gemini 评分
3. 补 `L2 rejection -> L3 grant -> runtime downgrade` 的高光证据脚本
4. 补 ERC-8004 映射与公开发布说明
