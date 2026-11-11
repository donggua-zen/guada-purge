# GuaDa Purge · 红队模式

给 GuaDa 装的**红队作业台**：安装后多一个专用智能体「红队指挥官」，自带 22 个资产库工具
和红队方法论技能。**只在授权演练中使用**，不修改宿主、不绕过安全策略。

> 形态：PluginApi v4 的「专属智能体 + 专属能力」。这些工具和技能只属于本插件注册的智能体，
> 你其它智能体完全无感（工具列表里看不到、提示词里也不会出现）。

---

## 现在有什么（P1）

| 类别 | 内容 |
|---|---|
| 专属智能体 | `红队指挥官`（plugin-guada-purge-leader） |
| 工具 | **22 个** `redteam_*`：开靶/绑靶、资产增查统计评估、漏洞登记与查重、证据链（claimed→observed）、WebShell、隧道、凭据、得分点、环境预检 |
| 技能 | **7 条**：`recon-pipeline` / `fofa-recon` / `nuclei-scan` / `webshell-toolkit` / `fscan-intranet` / `credential-attack` / `redteam-authorization` |
| 资产库 | `$USERDATA/plugins-data/guada-purge/redteam.json`（零依赖 JSON，可直接看） |

对照上游 [dsh-purge](https://github.com/HunYiSage/dsh-purge)：64 个工具 / 23 条技能 / 6 角色。
当前进度约 **1/3**，剩余部分见文末路线图。

## 安装

```
插件 → 安装插件 → local:D:/AI/guada_plugins/guada-plugin-purge
```

或 `github:donggua-zen/guada-purge#main`。安装后启用 → 智能体列表出现「红队指挥官」。

## 用法

1. 智能体列表选「红队指挥官」新建会话
2. 第一条消息直接给目标：「靶标 example.com，授权范围是其主域与子域」
3. 它会先跑 `redteam_preflight` 检查环境（FOFA_KEY / VPS_IP / fscan / nuclei…），缺什么一次性告诉你
4. 按 信息收集 → 资产梳理 → 漏洞发现 → 漏洞利用 → 内网渗透 推进，全程落库
5. 随时问「现在什么进度」，它用 `redteam_session_info` 读真实数据回答

### 沙箱

用这个智能体时沙箱仍是 `workspace-write`。**需要完整权限请在建会话后手动切换**（插件不碰安全策略）。

### 多会话

每个会话有自己的靶标绑定，互不干扰。切换目标用 `redteam_session_bind`。

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
| **没有多角色并发** | 当前是单兵模式：扫描/验证/利用都由主智能体自己完成。P2 才会加 5 个执行角色 + 并发闸门（需要宿主放开 `agents` 白名单） |
| 沙箱档位不跟随 | 会话级，需手动切 |
| 子代理不可用 | 插件智能体默认 `agents.__default=false` |
| 无 UI | 没有设置页/状态面板，全部走对话与 `redteam_*` 工具 |
| 技能只有 7 条 | 上游 23 条，剩余 16 条按需补 |

## 路线图

| 期 | 内容 |
|---|---|
| **P1（当前）** | 单兵闭环：22 工具 + 7 技能 + 资产库 |
| P2 | 宿主放开插件智能体的 `agents` 白名单 → 5 个执行角色（recon / assess / vuln-scan / exploit / internal）+ `redteam_agent_slot` 并发闸门（≤3） |
| P3 | 剩余 ~42 个工具（PoC 库、攻击链、报告生成、资产图谱、时间线、未知资产）+ 剩余 16 条技能 |

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
