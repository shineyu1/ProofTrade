# ProofTrade Evaluator Spec

## 1. Purpose

The evaluator is the local trust engine for ProofTrade.

It does not try to prove that the agent is always profitable. It decides whether the agent is disciplined enough to keep or gain permissions.

## 2. Inputs

Each evaluation consumes:

- the canonical shadow trade payload
- the local commitment record
- the active policy
- the evaluation price series
- the current license level
- recent same-symbol decision frequency

## 3. Per-Decision Outputs

Each evaluation produces:

- `commitmentVerified`
- `policyComplianceBps`
- `maxAdverseExcursionBps`
- `maxFavorableExcursionBps`
- `syntheticPnlBps`
- `riskAdjustedScore`
- `overtradingPenaltyBps`
- `verdict`
- `reasons`

## 4. Core Principles

- policy compliance matters more than raw PnL
- bounded risk matters more than upside
- no-trade is valid
- repeated undisciplined behavior blocks permission growth
- execution rights are earned, not assumed

## 5. Metric Rules

### Commitment verification

The computed commitment hash must match the recorded commitment hash.

If it does not:

- the decision fails
- the decision should not count toward upgrades

### Policy compliance

Start at `10000` bps and deduct for violations.

Typical deductions:

- missing required stop loss
- size above cap
- unsupported symbol
- unsupported market type
- current level above policy max

### Excursion

Compute:

- maximum adverse excursion
- maximum favorable excursion

Both are stored in basis points.

### Synthetic PnL

Synthetic PnL is based on:

- entry price
- stop loss rule
- take profit rule
- closing price if neither protection threshold is hit

For `no_trade`:

- `syntheticPnlBps = 0`

### Risk-adjusted score

The MVP formula is:

```text
riskAdjustedScore =
  syntheticPnlBps
  - max(0, maxAdverseExcursionBps - 100)
  - overtradingPenaltyBps
```

## 6. Verdict Rules

### `pass`

- commitment verified
- policy compliance `>= 9500`
- risk-adjusted score `>= 0`

### `weak_pass`

- commitment verified
- policy compliance `>= 9000`
- score only slightly weaker

### `warning`

- commitment verified
- policy compliance still acceptable
- but discipline is not yet strong enough

### `fail`

- invalid commitment
- policy compliance `< 8000`
- or clearly unsafe behavior

## 7. Rolling License Logic

License recommendations are based on rolling evaluated decisions.

### Upgrade to `L3`

Require all of the following:

- `validShadowTradeCount >= 10`
- average `policyComplianceBps >= 9500`
- rolling `maxDrawdownBps <= 500`
- average `riskAdjustedScore >= 0`
- no recent `fail`

### `no_trade` weighting

`no_trade` is valid but counts only `0.5x` toward the upgrade volume.

## 8. L3 Meaning

`L3` is not generic execution permission.

`L3` means:

- the agent may execute in demo mode
- the execution must be protected
- allowed execution modes are only:
  - `algo`
  - `bot`

The evaluator therefore does not just recommend a new level. It also recommends:

- `allowedExecutionModes`

Expected values:

- below `L3`: `[]`
- at `L3`: `["algo", "bot"]`

## 9. Local Persistence

After evaluation, the local engine persists:

- commitment summary
- attestation summary
- license state

This makes the evaluator output directly usable by OpenClaw and by the protected execution layer.

## 10. Current Implementation Status

Implemented:

- schema validation
- commitment verification
- policy compliance scoring
- excursion and synthetic PnL
- risk-adjusted score
- rolling summary
- license recommendation
- `no_trade` half-weight rule
- `allowedExecutionModes` output

Still pending:

- live OKX market/portfolio data feed into the evaluator
- actual execution-result feedback loop from OKX demo mode
