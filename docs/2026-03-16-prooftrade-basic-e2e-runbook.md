# ProofTrade 鍩虹璺戦€氭祦绋?
> 鐩爣锛氱敤涓€濂楁渶鐭€佹渶绋冲畾鐨勬祦绋嬶紝璇佹槑 ProofTrade 宸茬粡璺戦€氾細
>
> 1. OpenClaw 瑙﹀彂绛栫暐涓庝俊浠婚摼
> 2. 鐪熷疄 OKX Demo 鍙椾繚鎶ゆ彁浜ゆ垚鍔?> 3. Runtime Guard 鑳芥妸 `L3` 鎵撳洖 `L2`
> 4. X Layer 娴嬭瘯閾句笌涓荤綉閮借兘鍙戝竷鍏紑鐘舵€?
---

## 1. 杩欎唤娴佺▼缁欒皝鐢?
杩欎唤 runbook 閫傚悎锛?
- 鏈湴鑷祴
- 褰曞睆婕旂ず
- README 璇佹嵁鏁寸悊
- X 鍙戝笘绱犳潗鍑嗗

瀹冧笉杩芥眰瑕嗙洊鎵€鏈夎竟瑙掗€昏緫锛屽彧杩芥眰锛?
**鏈€鐭矾寰勬妸浜у搧涓诲彊浜嬭窇閫氫竴娆°€?*

---

## 2. 浜у搧涓诲彊浜?
ProofTrade 涓嶆槸浜ゆ槗鍓嶇锛岃€屾槸閮ㄧ讲鍦細

`Strategy Agent / OpenClaw -> ProofTrade -> OKX / X Layer`

涔嬮棿鐨勬湰鍦颁俊浠讳腑闂村眰銆?
杩欏鍩虹娴佺▼璇佹槑鐨勬槸锛?
1. Strategy 鍏堢敓鎴?`shadow decision`
2. Evaluator / Auditor / License Board 鍐冲畾鑳藉惁鍗囩骇鍒?`L3`
3. 鍗囩骇鍚庡彧鍏佽 `spot algo / bot grid`
4. 杩愯涓鏋滈闄╄秴闄愶紝Runtime Guard 浼氶檷绾ф垨鍚婇攢
5. 鏈€缁堢姸鎬佸彲鍙戝竷鍒?X Layer

---

## 3. 鍓嶇疆鏉′欢

### 3.1 鏈湴鐜

- 宸插畨瑁呬緷璧栵細`npm install`
- 宸插湪浠撳簱鏍圭洰褰曟垨浣跨敤 `npm --prefix`
- 宸插叿澶?OKX Demo profile

### 3.2 浠撳簱璺緞

榛樿浠撳簱璺緞锛?
```powershell
C:\Users\shine\Desktop\codex
```

濡傛灉褰撳墠涓嶅湪浠撳簱鐩綍锛岃缁熶竴浣跨敤锛?
```powershell
npm --prefix C:\Users\shine\Desktop\codex run <script> -- <args>
```

---

## 4. 鍩虹璺戦€氫富娴佺▼

### Step 1锛歄penClaw 瑙﹀彂鐪熷疄 Demo Submit

杩欐槸涓婚珮鍏夈€?
浠庝换鎰忕洰褰曡繍琛岋細

```powershell
npm --prefix C:\Users\shine\Desktop\codex run openclaw -- submit examples/sample-evaluation-input.json --strategy momentum-spot-algo --mode algo --bootstrap-l3 --profile demo --data-dir .\tmp-user-test
```

### 棰勬湡缁堢杈撳嚭

搴旇嚦灏戠湅鍒拌繖浜涘叧閿锛?
```text
Live OKX context synced: last=..., balance=..., positions=...
Active strategy: momentum-spot-algo
OpenClaw workflow: submit
Commitment verified: true
Evaluation verdict: pass
Pending promotion: L3
Audit verdict: approved
License Board action: upgrade
Issued level: L3
Protected execution prepared: exec_dec_20260315_0001_algo
OKX demo submission accepted: okx_demo_exec_dec_20260315_0001_algo
```

### 褰撳墠涓€缁勫凡楠岃瘉鎴愬姛鐨勬湰鍦拌瘉鎹?
瀵瑰簲鐩綍锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test
```

鍏抽敭鏂囦欢锛?
- `licenses/prooftrade-agent-001.json`
- `audits/prooftrade-agent-001.json`
- `license-board-decisions/prooftrade-agent-001.json`
- `certificates/prooftrade-agent-001.json`
- `executions/exec_dec_20260315_0001_algo.json`
- `okx-submissions/okx_demo_exec_dec_20260315_0001_algo.json`

### 褰撳墠宸查獙璇佹垚鍔熺殑鍏抽敭缁撴灉

- 褰撳墠 license level锛歚L3`
- strategy锛歚momentum-spot-algo`
- 瀹¤缁撹锛歚approved`
- Demo submission status锛歚accepted`
- 鏈€鏂颁竴娆″凡楠岃瘉鎴愬姛鐨?OKX `algoId`锛歚3393929170596999168`

---

## 5. 鍏抽敭 JSON 璇佹嵁

### 5.1 License

鏂囦欢锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test\licenses\prooftrade-agent-001.json
```

鍏抽敭瀛楁锛?
```json
{
  "agentId": "prooftrade-agent-001",
  "strategyId": "momentum-spot-algo",
  "currentLevel": "L3",
  "allowedExecutionModes": ["algo", "bot"],
  "active": true,
  "revoked": false
}
```

### 5.2 Audit

鏂囦欢锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test\audits\prooftrade-agent-001.json
```

鍏抽敭瀛楁锛?
```json
{
  "audit_verdict": "approved",
  "recommended_level": "L3",
  "strategy_id": "momentum-spot-algo"
}
```

### 5.3 Certificate

鏂囦欢锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test\certificates\prooftrade-agent-001.json
```

鍏抽敭瀛楁锛?
```json
{
  "current_level": "L3",
  "current_level_label": "L3_Protected_Execution",
  "allowed_execution_modes": ["algo", "bot"],
  "valid_shadow_trade_count": 10
}
```

### 5.4 Submission

鏂囦欢锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test\okx-submissions\okx_demo_exec_dec_20260315_0001_algo.json
```

鍏抽敭瀛楁锛?
```json
{
  "status": "accepted",
  "remoteRequestId": "3393929170596999168",
  "request": {
    "skill": "algo",
    "environment": "demo"
  }
}
```

---

## 6. 杩愯鏃剁啍鏂祦绋?
### Step 2锛氳Е鍙?Runtime Guard

```powershell
npm --prefix C:\Users\shine\Desktop\codex run openclaw -- guard examples/sample-evaluation-input.json --bootstrap-l3 --current-price 82600 --data-dir .\tmp-user-test-guard
```

### 棰勬湡缁堢杈撳嚭

搴旇嚦灏戠湅鍒帮細

```text
Audit verdict: approved
License Board action: upgrade
Issued level: L3
Runtime guard action: downgrade
Runtime guard final level: L2
```

### 瀵瑰簲鏂囦欢

- `tmp-user-test-guard/revocations/prooftrade-agent-001.json`
- `tmp-user-test-guard/licenses/prooftrade-agent-001.json`

### 宸查獙璇佹垚鍔熺殑鍏抽敭缁撴灉

褰撳墠宸查獙璇佺殑涓€缁勭粨鏋滀负锛?
```json
{
  "previous_level": "L3",
  "final_level": "L2",
  "guard_action": "downgrade",
  "trigger_code": "RUNTIME_DRAWDOWN_LIMIT",
  "observed_drawdown_bps": 196,
  "max_drawdown_bps": 150
}
```

浠ュ強鏇存柊鍚庣殑 license锛?
```json
{
  "currentLevel": "L2",
  "allowedExecutionModes": [],
  "active": true,
  "revoked": false
}
```

---

## 7. X Layer 娴嬭瘯閾惧彂甯冩祦绋?
### Step 3锛氬彂甯冨埌娴嬭瘯閾?
鍏堣缃幆澧冨彉閲忥細

```powershell
$env:X_LAYER_PRIVATE_KEY="<浣犵殑 X Layer 娴嬭瘯閾剧閽?"
$env:PROOFTRADE_REGISTRY_ADDRESS="0x5d9c7c4906d2d0367c1cc1d88273ef3372198fab"
```

鐒跺悗鍙戝竷锛?
```powershell
npm --prefix C:\Users\shine\Desktop\codex run publish:xlayer -- prooftrade-agent-001 --network testnet --agent-uri ipfs://prooftrade/agent.json --evidence-base-uri ipfs://prooftrade/evidence --data-dir .\tmp-user-test
```

### 褰撳墠宸查獙璇佹垚鍔熺殑涓€缁勬祴璇曢摼 tx

- `register tx`
  - `0xf2b3dec5477da251c265156bc7c4556953e5500f447d0a4e1dc99856e5fcb34a`
- `validation tx`
  - `0x6160fc0dc6513dca57924c2de124da7830d9e0aa2a829be837aee544d117a6b4`
- `license tx`
  - `0x1ec5b8b9dbba3fd84c677a306eaa5abd22e8bda87b193bf74490adf1149ab487`
- `audit tx`
  - `0x9379ef6652d1deb08eba576f8f1cbacc868451beb908a7e9abda870eeaba2204`

### 璇存槑

X Layer 娴嬭瘯閾?RPC 鍋跺皵浼氬嚭鐜颁复鏃舵€у紓甯革紝渚嬪锛?
- `block is out of range`

杩欏睘浜庢祴璇曢摼 RPC 娉㈠姩锛屼笉浠ｈ〃鏈湴鍙戝竷閫昏緫閿欒銆? 
鍑虹幇鏃剁洿鎺ラ噸璇曞嵆鍙€?
---

## 8. X Layer 涓荤綉鍙戝竷娴佺▼

### Step 4锛氶儴缃蹭富缃?Registry

鍏堣缃富缃戠閽ョ幆澧冨彉閲忥細

```powershell
$env:X_LAYER_PRIVATE_KEY="<浣犵殑 X Layer 涓荤綉绉侀挜>"
```

閮ㄧ讲鍛戒护锛?
```powershell
npm --prefix C:\Users\shine\Desktop\codex run deploy:xlayer -- --network mainnet
```

### 褰撳墠宸查獙璇佹垚鍔熺殑涓荤綉閮ㄧ讲缁撴灉

- 涓荤綉鍦板潃锛歚0x0155a77ec12278f37d637d1035B45D555B601A5E`
- Registry 鍦板潃锛歚0x048c47b6f800e4ee1e63c0ccaba59b08f1972ef0`
- Deployment tx锛?  - `0xaea273a7b72f0dc90d186d1e67a66e5fb1d485e5f829c5b39eb27e82395f1c6e`

### Step 5锛氬彂甯冧富缃戠姸鎬?
鍐嶈缃?Registry 鍦板潃锛?
```powershell
$env:PROOFTRADE_REGISTRY_ADDRESS="0x048c47b6f800e4ee1e63c0ccaba59b08f1972ef0"
```

鐒跺悗鍙戝竷锛?
```powershell
npm --prefix C:\Users\shine\Desktop\codex run publish:xlayer -- prooftrade-agent-001 --network mainnet --agent-uri ipfs://prooftrade/agent.json --evidence-base-uri ipfs://prooftrade/evidence --data-dir .\tmp-user-test
```

### 褰撳墠宸查獙璇佹垚鍔熺殑涓€缁勪富缃?tx

- `register tx`
  - `0xbdfb18d16dd4f97d5a010f0cf98ed1bcf37e088aad3b11ca3d3dbf00b07c2df4`
- `validation tx`
  - `0x90811414b31f74ad1f8e7df7a068b7d4c08ef2922ccedc365516f316cbcd6fd2`
- `license tx`
  - `0x3c6069c84df44d56dcd063b8a6d1928a8f4be2f81897b4a23aecaee591784712`
- `audit tx`
  - `0x4faed5275ef7c30848bcd26cd265e05785b7f4daca110380eb264042b7ab63d0`

### 鎺ㄨ崘 Explorer 閾炬帴

- Registry锛?  - [Registry Contract](https://www.okx.com/web3/explorer/xlayer/address/0x048c47b6f800e4ee1e63c0ccaba59b08f1972ef0)
- Deployment锛?  - [Deployment Tx](https://www.okx.com/web3/explorer/xlayer/tx/0xaea273a7b72f0dc90d186d1e67a66e5fb1d485e5f829c5b39eb27e82395f1c6e)
- Register锛?  - [Register Tx](https://www.okx.com/web3/explorer/xlayer/tx/0xbdfb18d16dd4f97d5a010f0cf98ed1bcf37e088aad3b11ca3d3dbf00b07c2df4)
- Validation锛?  - [Validation Tx](https://www.okx.com/web3/explorer/xlayer/tx/0x90811414b31f74ad1f8e7df7a068b7d4c08ef2922ccedc365516f316cbcd6fd2)
- License锛?  - [License Tx](https://www.okx.com/web3/explorer/xlayer/tx/0x3c6069c84df44d56dcd063b8a6d1928a8f4be2f81897b4a23aecaee591784712)
- Audit锛?  - [Audit Tx](https://www.okx.com/web3/explorer/xlayer/tx/0x4faed5275ef7c30848bcd26cd265e05785b7f4daca110380eb264042b7ab63d0)

---

## 9. 鎺ㄨ崘鎴浘娓呭崟

杩欓儴鍒嗘槸缁?README銆乆 甯栧瓙鍜岃棰戝綍灞忓噯澶囩殑銆?
### 鎴浘 1锛氱粓绔?submit 鎴愬姛

淇濈暀杩欎簺鍏抽敭琛岋細

- `Live OKX context synced`
- `Audit verdict: approved`
- `Issued level: L3`
- `OKX demo submission accepted`

### 鎴浘 2锛歴ubmission JSON

鎵撳紑锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test\okx-submissions\okx_demo_exec_dec_20260315_0001_algo.json
```

閲嶇偣鎴細

- `status: accepted`
- `remoteRequestId`
- `skill: algo`

### 鎴浘 3锛歭icense certificate

鎵撳紑锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test\certificates\prooftrade-agent-001.json
```

閲嶇偣鎴細

- `current_level: L3`
- `allowed_execution_modes`
- `strategy_id`

### 鎴浘 4锛歊untime Guard 闄嶇骇

鎵撳紑锛?
```text
C:\Users\shine\Desktop\codex\tmp-user-test-guard\revocations\prooftrade-agent-001.json
```

閲嶇偣鎴細

- `previous_level: L3`
- `final_level: L2`
- `guard_action: downgrade`

### 鎴浘 5锛氭祴璇曢摼鍙戝竷鎴愬姛

淇濈暀缁堢杈撳嚭閲岀殑 4 绗?tx锛?
- `register tx`
- `validation tx`
- `license tx`
- `audit tx`

### 鎴浘 6锛氫富缃戝彂甯冩垚鍔?
閲嶇偣鎴繖 5 涓俊鎭細

- 涓荤綉 Registry 鍦板潃
- `deployment tx`
- `register tx`
- `license tx`
- `audit tx`

---

## 10. 鏈€鐭紨绀洪『搴?
濡傛灉浣犲彧鎯冲綍涓€鐗堟渶鐭殑瑙嗛锛屾寜杩欎釜椤哄簭鏉ワ細

1. `submit`
2. 鎵撳紑 `submission json`
3. 鎵撳紑 `certificate`
4. `guard`
5. 鎵撳紑 `revocation report`
6. `publish:xlayer`
7. 灞曠ず 4 绗旀祴璇曢摼 tx
8. 濡傞渶鏈€缁堟彁浜わ紝鍐嶅睍绀轰富缃?Registry 鍦板潃鍜屼富缃?4 绗旂姸鎬?tx

杩欐潯閾惧凡缁忚冻澶熷畬鏁村湴璇存槑锛?
- 绯荤粺浼氬崌绾?- 绯荤粺浼氭斁琛屽彈淇濇姢鎵ц
- 绯荤粺浼氱啍鏂?- 绯荤粺鐘舵€佽兘鍏紑鍙戝竷

---

## 11. 缁撹

杩欏鍩虹娴佺▼璺戦€氬悗锛孭roofTrade 鐨勪富鍙欎簨宸茬粡鎴愮珛锛?
- 瀹冧笉鏄櫘閫氫氦鏄撴満鍣ㄤ汉
- 瀹冩槸浜ゆ槗 Agent 鍜?OKX 涔嬮棿鐨勪俊浠讳腑闂村眰
- Agent 蹇呴』鍏?shadow銆佸啀瀹¤銆佸啀鍙戣瘉
- 鍗充究鎷垮埌 `L3`锛屼篃鍙厑璁稿彈淇濇姢鎵ц
- 鍗充究宸茬粡鎵ц锛屼粛鍙兘琚?Runtime Guard 鎵撳洖 `L2`

杩欏氨鏄綋鍓嶆渶閫傚悎瀵瑰婕旂ず鐨勬渶灏忛棴鐜€?