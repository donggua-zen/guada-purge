# GuaDa Purge · 安全研究工作模式

GuaDa 的三方插件：安装后**多一个专用智能体**「安全研究助手」，自带角色提示词、
按工作目录生效的规则集、2 个只读工具和 6 条方法论技能。

> **行为变更（v1.0.0）**：不再是「全局人格注入」。v0.x 会对**所有**智能体注入提示词，
> v1 起这些能力只属于插件注册的专属智能体，你的其他智能体完全无感。
> 想用这套能力：在智能体列表选「安全研究助手」新建会话即可。

---

## 它做什么

| 能力 | 落点 | 作用域 |
|---|---|---|
| 角色提示词（人设 + 工作原则） | 智能体的 `systemPrompt` | 仅该智能体（只读） |
| 规则集（按工作目录匹配） | 提示词段 `guada-purge.rules` | 仅该智能体 |
| 工具 `purge_status` / `purge_rules` | 能力包 `purge` | 仅该智能体 |
| 6 条方法论技能 | 能力包 `purge` | 仅该智能体 |

用的是宿主 **PluginApi v4** 的 `registerAgent` + `visibleTo`：
能力在注册期就声明了「只给本插件注册的智能体」，不是靠用户手工配置隔离。

---

## 为什么和 dsh-purge 长得不一样

[dsh-purge](https://github.com/HunYiSage/dsh-purge) 需要**改写宿主源码**（86 个补丁），
因为 DSH 的身份句、免责声明、沙箱默认值都是编译进安装包的常量，插件 API 只能追加不能改。

GuaDa 不同：

| dsh-purge 的手段 | GuaDa 的做法 |
|---|---|
| 改身份句常量 | 专属智能体自己写 `systemPrompt`，无需"拆"宿主的 |
| 改免责声明（"不可信、可忽略"） | GuaDa 系统提示词里没有这段，无对象 |
| 改审批话术 / 审批门 | GuaDa 没有逐调用审批机制，无对象 |
| 改沙箱 allow/deny | 会话级 `sandboxMode`，由用户在界面上选 |
| apply / revert / 重启 | 不需要：卸载插件即消失 |

**一句话**：dsh-purge 改造的是「这个安装」，本插件提供的是「一个模式」。

---

## 安装

```
插件 → 安装插件 → local:D:/AI/guada_plugins/guada-plugin-purge
```

或（仓库已发布后）：

```
github:donggua-zen/guada-purge#main
```

安装后启用 → 智能体列表出现「安全研究助手」，带插件徽标。

---

## 使用

1. 智能体列表 → 「安全研究助手」→ 新建会话
2. 系统提示词自动包含：角色人设 + 当前工作目录命中的规则集
3. 工具列表有 `purge_status` / `purge_rules`
4. 技能清单有 6 条，模型会通过 `skill_learn` 按需读取

用别的智能体（包括默认助手）开会话：**没有上述任何东西**。

---

## 定制

### 改规则集

规则文件在 `$USERDATA/plugins-data/guada-purge/rules/*.md`：

```markdown
---
name: 前端规范
paths: frontend/**, web/**
---
## 工作约定
- ……
```

- `paths` 用 glob-lite（`**`、`*`、`?`），空表示所有目录生效
- 相对模式按「路径任意位置」匹配
- 改完**禁用再启用插件**（或重启）生效
- 首次安装会把随包的 `presets/rules/*.md` 复制过去，**不覆盖**你已改过的文件

### 改人设

`presets/persona.md` 是智能体 `systemPrompt` 的来源（插件目录内）。
注意：智能体提示词在 UI 里**只读**——这是 v4 的锁定语义，防止用户误改掉插件的权威配置。
要改就改插件源文件后重装/重载。

### 增删技能

`skills/<id>.md`（frontmatter 的 `name` 即技能 id，必须小写）。新增技能后需要
同步加进 `index.js` 里 `registerAgent({ skills: [...] })` 的白名单——**缺省是一个都不开**。

---

## 已知限制

| 限制 | 说明 |
|---|---|
| 沙箱档位不跟随智能体 | 用这个智能体开会话，沙箱仍是 `workspace-write`，需要完整权限请在建会话后手动切换 |
| 子代理不可用 | 插件智能体的 `agents.__default = false`，不能派生子代理 |
| 无 agentId 的路径不可见 | `visibleTo` 是 fail-closed：后台任务、子代理会话里这些能力都不可见（符合预期） |
| 提示词只读 | 见上「改人设」 |
| 无设置页 | v1 移除了 UI 与 RPC，避免"改了没生效"的困惑；定制走文件 |

---

## 目录结构

```
index.js              # 注册：能力包 / 规则段 / 专属智能体
core/
  rules.js            # 规则 frontmatter 解析 + glob-lite 匹配
  skills.js           # 技能文件加载
  store.js            # 数据目录：seed / list / read
  status.js           # 状态分组（工具输出用）
  core.test.js        # rules / status 单测
  plugin.test.js      # 注册结构 + 隔离契约单测
presets/
  persona.md          # 智能体人设
  rules/*.md          # 随包规则集（首次复制到数据目录）
skills/*.md           # 6 条方法论技能
manifest.json         # apiVersion 4
```

## 开发

```bash
npm run check   # node --check index.js
npm test        # node --test core/*.test.js
```

零依赖、CommonJS，不需要构建。

## 许可

MIT
