---
name: lateral-movement
description: 横向移动：凭据复用、远程执行、跳板，逐跳控制影响面
tags: exploit, lateral
---

# 横向移动

> 每一跳都要问三个问题：**从哪来、到哪去、怎么证明到了**。横向越多，暴露面越大。

## 前提

- 已有稳定入口（shell 或隧道）
- 已知下一跳的地址与服务（`redteam_asset_query`）
- 已拿到可用凭据（`redteam_credential_list`）

## 常见手法（按隐蔽性排序）

| 手法 | 适用 | 特征 |
|---|---|---|
| SSH 密钥/口令复用 | Linux | 日志留痕明显 |
| WinRM / SMB（`crackmapexec`、`evil-winrm`） | Windows | 事件日志 4624/4625 |
| RDP | Windows 图形 | 会话记录 |
| 计划任务 / 服务创建 | Windows | 系统日志 4698/7045 |
| WMI | Windows | 较隐蔽 |
| 数据库 xp_cmdshell | MSSQL | 需高权限 |

## 凭据复用

1. 从已控主机读：`~/.ssh/`、`/etc/shadow`（能破就破）、浏览器密码库、配置文件
2. 试同网段同服务（运维习惯复用口令）
3. **每条都记录**：来源系统 → 命中系统 → 是否成功
4. 成功的 → `redteam_credential_add` + `redteam_access_add`

## 落库

```
redteam_access_add({ host, method: 'ssh'|'rdp'|'smb'|'web-shell', privilege })
redteam_asset_link({ from: 当前资产, to: 目标资产, kind: 'pivot' })
redteam_chain_add({ stageCode: 'internal', title: '从 A 横移到 B', tool: '<命令>', result: '<回显>' })
```

## 判定标准

- [ ] 每一跳都有 `access` 记录 + `pivot` 关系
- [ ] 链步骤写了实际命令与回显
- [ ] 没有越出授权网段

## 常见坑

| 坑 | 处理 |
|---|---|
| 无脑横向 → 触发 EDR | 先看目标有没有杀软/EDR |
| 用同一凭据横扫整段 | 会触发账号锁定，控制次数 |
| 不记录路径 | 报告里说不清"怎么到内网的" |
| 忘记授权边界 | 每跳前确认目标在 scope 内 |
