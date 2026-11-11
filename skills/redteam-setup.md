---
name: redteam-setup
description: 演练环境准备：Kali/工具清单/环境变量/VPS 检查，开工前一次性配齐
tags: setup, environment
---

# 演练环境准备

> 目的：**开工前把"缺什么"一次性问清**，而不是打到一半发现没装 fscan。

## 环境选择

| 选项 | 建议 |
|---|---|
| 专用 Kali VM | ✅ 首选：扫描器/马/隧道工具都在里面，整机可丢弃 |
| 日常办公机 | ⚠️ 可以跑，但落盘的马与扫描器可能被 EDR 误伤；出口 IP 会影响信誉 |
| 远程跳板 | ✅ 适合长期演练（VPS 上跑工具，结果回传） |

## 工具清单

```bash
# 侦察
which subfinder dnsx httpx nmap whatweb
# 扫描
which nuclei fscan gogo
# 隧道
which suo5 chisel frpc
# 利用
which sqlmap hydra
```

缺什么就装什么（或向用户要）。装不了就在预检里说明降级方案。

## 环境变量

| 变量 | 用途 | 没有怎么办 |
|---|---|---|
| `FOFA_KEY` | 资产测绘 | crt.sh + 被动 DNS + 搜索引擎 |
| `VPS_IP` | 反弹 shell / frp | 用 suo5（不需要 VPS） |

## 预检

```
redteam_preflight
```

返回 `env` / `tools` / `hints` 三块。把缺失项一次性列给用户。

## 目录约定（建议）

```
runs/
├── recon/          # 侦察输出
├── scan/           # 扫描结果
├── exploit/        # PoC 与脚本
├── evidence/       # 原始报文、截图
└── report/         # 最终报告
```

产出登记到 `redteam_attack_file_add`，报告会引用。

## 判定标准

- [ ] `redteam_preflight` 的缺失项已向用户列清
- [ ] 降级方案已写明（哪个能力会缺）
- [ ] 工作目录与产物路径已确定
