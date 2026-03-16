# ProofTrade Registry And Integration Spec

## 1. Scope

This spec describes the storage and integration boundaries for ProofTrade.

The current implementation is **local-first**:

- local JSON registries are the source of truth for the MVP
- OKX CEX is the primary execution system
- X Layer is the future external trust mirror
- ERC-8004 is the external compatibility layer

## 2. Local Registry Layout

The current local state layout is:

```text
data/
  agents/
  commitments/
  attestations/
  licenses/
  executions/
  okx-submissions/
```

## 3. Registry Responsibilities

### `agents/<agentId>.json`

Stores local agent identity:

- `agentId`
- `name`
- `promptHash`
- `policyHash`
- `status`
- `updatedAt`

### `commitments/<commitmentId>.json`

Stores the shadow-decision commitment summary:

- `commitmentId`
- `agentId`
- `commitmentHash`
- `symbol`
- `side`
- `intentType`
- `createdAt`
- `expiresAt`
- `commitmentVerified`
- `evaluationId`

### `attestations/<attestationId>.json`

Stores the rolling trust summary:

- `attestationId`
- `agentId`
- `validShadowTradeCount`
- `averagePolicyComplianceBps`
- `rollingMaxDrawdownBps`
- `averageRiskAdjustedScore`
- `warningCountLast5`
- `failCountLast5`
- `recommendedLevel`
- `allowedExecutionModes`
- `reason`
- `issuedAt`

### `licenses/<agentId>.json`

Stores the active permission state:

- `agentId`
- `currentLevel`
- `allowedExecutionModes`
- `active`
- `revoked`
- `updatedAt`
- `lastEvaluationId`
- `lastAttestationId`
- `reason`

### `executions/<executionId>.json`

Stores protected execution requests:

- `executionId`
- `agentId`
- `decisionId`
- `symbol`
- `executionMode`
- `okxSkill`
- `environment`
- `licenseLevel`
- `remoteRequestId`
- `submissionStatus`
- `protection` for `algo`
- `botConfig` for `bot`

### `okx-submissions/<submissionId>.json`

Stores the OKX demo submission result:

- `submissionId`
- `provider`
- `executionId`
- `profile`
- `status`
- `remoteRequestId`
- `submittedAt`
- `request`
- `invocation`
- `response`

## 4. Canonical Payload

The local canonical decision payload remains the main preimage for commitment and evaluation.

Important fields:

- `agent_id`
- `decision_id`
- `market_context`
- `portfolio_context`
- `decision`
- `policy_ref`
- `rationale`
- `evaluation`

The commitment hash is computed from the trust-critical subset of the payload.

## 5. License Semantics

### `L0`

- observe only

### `L1`

- advice only

### `L2`

- shadow only
- no execution

### `L3`

- limited execution
- demo only
- **only** `algo` and `bot`
- no naked unrestricted trade execution

`allowedExecutionModes` must be:

- `[]` for `L0-L2`
- `["algo", "bot"]` for `L3`

## 6. Protected Execution Mapping

### `algo`

Use when:

- the agent has a concrete directional trade
- stop loss is defined
- take profit is defined

The protected request maps to:

- `okx spot algo place`
- OCO / TP-SL order shape

For the second competition, this is the **primary** execution path.

### `bot`

Use when:

- a low-risk structured entry is preferred
- the agent should open bounded automation instead of a direct order

The MVP local record uses:

- `strategyType = grid`
- `riskTier = low`

For the second competition, this is the **secondary** execution path.

## 7. OKX CLI Integration

The current real adapter path is:

1. protected execution record
2. OKX request mapping
3. CLI invocation generation
4. profile/config validation
5. submission record persistence
6. remote request id write-back into execution state

## 8. ERC-8004 Mapping

ProofTrade should use ERC-8004 as an external compatibility layer.

### Map local agent identity to ERC-8004 identity

Suggested fields:

- `agentId`
- version metadata
- service endpoints

### Map local trust summary to ERC-8004 reputation

Suggested public reputation fields:

- policy compliance summary
- validation count
- execution eligibility status

### Map local attestation to ERC-8004 validation

Suggested payload:

- attestation hash
- timestamp
- issuer
- recommendation summary

## 9. X Layer Strategy

We should not make X Layer a blocker for the MVP.

Recommended approach:

1. local registries remain canonical during development
2. keep OKX CEX execution as the product core
3. add an X Layer mirror after the local OpenClaw + OKX flow is stable
4. publish identity and attestation summaries in ERC-8004-compatible form

## 10. Implementation Status

Implemented locally today:

- agent record persistence
- commitment record persistence
- attestation record persistence
- license record persistence
- protected execution record persistence
- OKX CLI invocation generation
- OKX submission record persistence
- remote request id write-back into execution state

Not yet implemented:

- X Layer contract deployment
- ERC-8004 publishing adapter
- OpenClaw orchestration
