---
name: recon-pipeline
description: 信息收集流水线：被动测绘 → 子域/端口 → 指纹 → 全量落库（只收集，不测漏洞）
tags: recon, pipeline
---

# 信息收集流水线

> 目标：把靶标单位的资产**收全**，尤其是边缘资产与未备案资产。本阶段**不做漏洞检测**。

## 0. 前置

- 已 `redteam_engagement_open` 绑定靶标，范围写进 `scope`
- `redteam_preflight` 通过（或已知降级方案）

## 1. 被动测绘（先要面）

```
FOFA      domain="<主域>"                  # 主域资产
FOFA      cert="<主域>"                    # 证书反查，绕开子域枚举
crt.sh    https://crt.sh/?q=%25.<主域>&output=json   # 证书透明日志
备案      ICP 备案查询（站长工具）         # 找未备案的同主体资产
```

产出：域名 / IP / URL 的原始清单，先不判断归属。

## 2. 子域枚举（要边）

```bash
subfinder -d <主域> -all -silent | dnsx -silent -a -resp
```

- 拿到解析结果的子域优先；`dnsx` 顺便做泛解析判定
- 泛解析存在时，用随机子域对比过滤假解析

## 3. 存活与指纹（要形）

```bash
httpx -l subs.txt -title -tech-detect -status-code -silent -o alive.txt
nmap -iL ips.txt -p- --min-rate 2000 -T4 -oA nmap_full   # 全端口（授权内）
```

- 指纹（中间件/框架/版本）直接决定后面打什么
- 管理后台、API 网关、文件服务、VPN 是优先目标

## 4. 落库（关键）

每条都 `redteam_asset_add`：

```
kind=domain|host|url|service|segment
value=<资产值>  ip=<解析 IP>  port=<端口>
title=<系统名>  surface=<中间件/框架/指纹>  source=fofa|crt|active
```

**判定标准**：能在 `redteam_asset_query` 里按类型/关键字查到，覆盖率才算够。

## 5. 收尾自查

- [ ] 主域资产是否全部覆盖（含 80/443 之外的端口服务）
- [ ] 是否找到至少 1 个边缘资产（非主站、非常规端口、测试环境）
- [ ] 每个资产都有 `surface`（没有指纹的标 `unknown`，后续补）
- [ ] 未解析/不可达的资产也落库并标注，避免下阶段重复探测

## 常见坑

| 坑 | 处理 |
|---|---|
| 只查主域 → 漏同主体其他域名 | 用证书 + 备案交叉找 |
| 泛解析导致子域爆炸 | 随机子域对比过滤 |
| CDN 后面的真实 IP | 历史 DNS / 证书 / 邮件头，别直接扫 CDN |
| 全端口扫太慢 | 先 top1000，再对存活主机全端口 |
