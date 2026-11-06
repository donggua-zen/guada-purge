# GuaDa Purge

GuaDa 的**三方插件**参考实现：把「人格 / 规则集 / 技能库 / 状态面板」做成一个可安装、可回滚的插件，用来验证并推进 GuaDa 的三方插件机制。

> 这是一个**功能等价**的复刻：借鉴 [dsh-purge](https://github.com/HunYiSage/dsh-purge) 的产品形态与交互（入口按钮、右侧 dock、Clean/Drill、Apply/Restore、规则集、技能库），但**不修改宿主源码、不绕过宿主安全策略/审批/沙箱**。

## 状态

- **Phase 0**：插件骨架、manifest、设置页占位、安装链路。
- **Phase 1（当前）**：提示词段 / 规则集 / 技能库 / 模型工具 / RPC / 设置页。
- Phase 2：入口按钮 / 右侧 dock / 动作命令 / hook。
- Phase 3：快照回滚 / 权限审计 / 全量验收。

### Phase 1 已具备

| 能力 | 实现 |
|---|---|
| 人格 / 提示词 | `registerPromptSection('guada-purge.persona', order=-100)`；`prompt-inject.md` 优先于 state.persona |
| 规则集 | `registerPromptSection('guada-purge.rules', order=100)`；按 `session.workspacePath` 做 glob 匹配 |
| 技能库 | 随包 `skills/*.md` → `registerSkill`（6 条防御/规范类） |
| 模型工具 | `purge_status`（只读）/ `purge_apply` / `purge_revert` |
| 设置页 | `settings` slot：状态 / 提示词 / 规则集三页签，走 `registerRpc` |
| 数据目录 | `api.getDataDir()`：`prompt-inject.md`、`rules/*.md`、`state.json`（原子写 + `.bad` 修复） |

改动在下一次提示词装配（下一轮/下一步）生效；无需重启宿主。

## 安装

开发期（本地目录）：

```bash
# 在 GuaDa 的插件页选择"从源安装"，填写：
local:/absolute/path/to/guada-purge
```

或直接调用后端接口（需登录态）：

```bash
curl -X POST http://127.0.0.1:<port>/api/v1/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"source":"local:/absolute/path/to/guada-purge"}'
```

发布后：

```
github:donggua-zen/guada-purge#v0.1.0
```

> 宿主会扫描插件目录并 `require('index.js')`。`frontend/dist/*.js` 是已构建产物，安装端不需要构建。

## 权限声明

`manifest.json` 声明：

| 权限 | 用途 |
|---|---|
| `prompt` | 注册提示词段（人格/规则） |
| `fs` | 读取插件自带技能/预设；读写插件数据目录（提示词、规则、快照） |

不申请 `net` / `shell` / `policy`。不修改宿主默认安全策略。

## 目录

```
manifest.json          插件清单（id/version/apiVersion/permissions）
index.js               CommonJS 入口，零依赖，只用公开 PluginApi
core/                  状态、提示词、规则、技能、状态分组、授权（纯函数，可单测）
skills/                技能库（Markdown + frontmatter）
presets/               人格/规则预设
frontend/src/          插件 UI 源码（Vue SFC）
frontend/dist/         构建产物（IIFE，注册到 __GuaDaModuleLoader__）
```

## 开发

```bash
npm run check     # node --check index.js
npm test          # node --test core/*.test.js
npm run build     # 构建 frontend/dist（Phase 1 起）
```

## 合规

本插件不提供绕过安全策略、审批、沙箱的能力，不内置越狱提示词，不分发攻击工具。Drill 页仅用于合规清单与环境检查，并保留二次确认门。

## License

MIT
