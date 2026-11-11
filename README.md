# GuaDa Purge · 红队模式

给 GuaDa 装的**红队作业台**：安装后多一个专用智能体「红队指挥官」，自带 22 个资产库工具
和红队方法论技能。**只在授权演练中使用**，不修改宿主、不绕过安全策略。

> 形态：PluginApi v4 的「专属智能体 + 专属能力」。这些工具和技能只属于本插件注册的智能体，
> 你其它智能体完全无感（工具列表里看不到、提示词里也不会出现）。

---

## 现在有什么（v2.5.0）

| 类别 | 内容 |
|---|---|
| 智能体 | **6 个**：`红队指挥官`（可见）+ 5 个执行角色（隐藏：信息收集 / 资产梳理 / 漏洞发现 / 漏洞利用 / 内网渗透） |
| 工具 | **61 个** `redteam_*` |
| 技能 | **24 条**方法论技能（含 `redteam-authorization` 授权检查） |
| 资产库 | `$USERDATA/plugins-data/guada-purge/redteam.json`（零依赖 JSON，可直接看） |

技能分组：

| 组 | 技能 |
|---|---|
| 侦察（6） | `recon-pipeline` `fofa-recon` `passive-recon` `web-fingerprint` `active-scan` `asset-correlation` |
| 漏洞（4） | `nuclei-scan` `dir-bruteforce` `unauth-exploit` `credential-attack` |
| 利用（5） | `webshell-toolkit` `shell-handler` `browser-automation` `lateral-movement` `vps-reverse-shell` |
| 隧道（4） | `suo5-tunnel` `chisel-tunnel` `frp-tunnel` |
| 内网（2） | `fscan-intranet` `gogo-intranet` |
| 环境与可选（4） | `redteam-setup` `redteam-authorization` `cn-proxy-pool` `kimi-webbridge` |

### 资产深挖（P3-2 新增）

```
redteam_asset_get       单资产详情（关联漏洞/证据/链步骤/入口/关系）
redteam_asset_link      建关系（subdomain / resolves-to / hosts / pivot）
redteam_asset_graph     图谱（节点 + 边）
redteam_asset_timeline  时间线（资产/漏洞/证据/步骤按时间排）
redteam_asset_test      连通性探测（HEAD→GET 回退，返回状态码/标题/指纹/耗时）
redteam_vuln_update     状态流转：found → confirmed → exploited / false-positive
redteam_webshell_update / tunnel_update   标记"已实测连通/可达"
redteam_http_evidence_add   归档原始 HTTP 报文（直接记为 observed）
redteam_evidence_verify     复现核实（给 URL 会实际发请求比对）
redteam_shot_add / shot_list / shot_delete  截图登记
```

### 报告能力（P3-1 新增）

```
redteam_chain_add      记录攻击链步骤（tool=命令原文，result=回显）
redteam_score_report   生成 Markdown 报告（只收录有证据/已拿分的成果）
redteam_report_targets 按资产汇总"哪个目标还缺什么"
redteam_unknown_*      暂时说不清的资产先挂着，不丢
```

报告结构：执行摘要 → 得分明细 → 攻击链（按阶段）→ 成果漏洞（附原始请求）→ 入口与凭据 → 内网资产 → 未决事项 → 修复建议。

得分点内置：`rce 50` / `webshell 30` / `boundary 40` / `internal-pivot 40` / `web-account-admin 20` / `web-account-user 10` / `db-access 20` / `sensitive-data 20` / `core-system 60`，可用 `redteam_score_point_save` 覆盖。

## 安装

```
插件 → 安装插件 → local:D:/AI/guada_plugins/guada-plugin-purge
```

或 `github:donggua-zen/guada-purge#main`。安装后启用 → 智能体列表出现「红队指挥官」。

## 用法

1. 智能体列表选「红队指挥官」新建会话
2. 第一条消息直接给目标：「靶标 example.com，授权范围是其主域与子域」
3. 它会先跑 `redteam_preflight` 检查环境（FOFA_KEY / VPS_IP / fscan / nuclei…），缺什么一次性告诉你
4. 它按 信息收集 → 资产梳理 → 漏洞发现 → 漏洞利用 → 内网渗透 **派活给执行角色**，全程落库
5. 随时问「现在什么进度」，它用 `redteam_session_info` 读真实数据回答

### 派活与并发

- 指挥官**自己不动手**（人设硬约束），只做计划 / 派活 / 核对 / 汇报
- 每次派活前用 `redteam_agent_slot` 占位，**同一靶标最多 3 个角色并发**
- 执行角色跑完或崩溃后名额释放（30 分钟租约自动回收）
- 子会话**自动继承父会话靶标**，执行角色不需要（也不允许）自己开靶

### 沙箱

用这个智能体时沙箱仍是 `workspace-write`。**需要完整权限请在建会话后手动切换**（插件不碰安全策略）。

### 多会话

每个会话有自己的靶标绑定，互不干扰。子代理由父会话派出，天然共享同一靶标。

## 资产库

```jsonc
{
  "engagements": { "ENG-xxx": { "name": "靶标", "scope": "授权范围", "sessionId": "..." } },
  "assets":      { "A1": { "kind": "domain", "value": "...", "priority": "high", "surface": "..." } },
  "vulns":       { "V1": { "assetId": "A1", "title": "...", "request": "...", "level": "critical" } },
  "evidence":    { "E1": { "summary": "...", "confidence": "claimed|observed" } },
  "webshells": {}, "tunnels": {}, "credentials": {}, "scores": []
}
```

- 原子写（tmp + rename），坏文件自动备份为 `.bad` 后重置
- 直接编辑文件后重载插件即可（`invalidate` 在 `onStart` 触发）

## 证据纪律（工具层面强制）

- `redteam_evidence_record` 默认写 `claimed`
- 只有 `redteam_evidence_upgrade` 能升级为 `observed`，且必须填核实方式
- `redteam_unverified_count > 0` 时，汇报必须说明"还有 N 条未核实"

## 已知限制

| 限制 | 说明 |
|---|---|
| 沙箱档位不跟随 | 会话级，需手动切 |
| 角色不可直接选 | 5 个执行角色是 `hidden`，只能被指挥官派活 |
| 并发计数单进程 | 落文件保证重启一致，多进程同时写不保证 |
| 无 UI | 没有设置页/状态面板，全部走对话与 `redteam_*` 工具 |

## 路线图

| 期 | 内容 |
|---|---|
| P1 ✅ | 单兵闭环：22 工具 + 7 技能 + 资产库 |
| P2 ✅ | 5 个执行角色 + 指挥官派活 + 并发闸门（≤3）+ 靶标继承 + 角色隐藏 |
| **P3-1 ✅** | 攻击链 + Markdown 报告 + 未知资产（13 个工具，共 36） |
| **P3-2 ✅** | 资产深挖（详情/关系/图谱/时间线/连通探测）+ 状态流转 + HTTP 证据 + 截图（13 个，共 49） |
| **P3-3 ✅** | PoC 知识库（6 个，共 55） |
| **P3-4 ✅** | 访问会话 / 演练总览 / 会话检查 / Web 列表 / 域名索引（6 个，共 61） |
| **P3-5 ✅（当前）** | 17 条技能补齐（共 24 条） |

## 目录结构

```
index.js                # 注册：能力包 + 22 工具 + 专属智能体
core/
  redteam-db.js         # JSON 资产库（engagement/asset/vuln/evidence/…）
  preflight.js          # 环境与工具预检
  skills.js             # 技能文件加载
  rules.js              # frontmatter 解析（技能用）
  store.js              # 数据目录与 persona 读取
  core.test.js          # 纯函数单测
  plugin.test.js        # 注册结构 + 全链路 + 隔离契约
presets/persona.md      # 智能体人设（红队作业纪律）
skills/*.md             # 方法论技能
manifest.json           # apiVersion 4
```

## 开发

```bash
npm run check   # node --check index.js
npm test        # node --test core/*.test.js
```

零依赖、CommonJS，无需构建。

## 许可

MIT
