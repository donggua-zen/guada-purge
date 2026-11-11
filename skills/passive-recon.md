---
name: passive-recon
description: 被动信息收集：证书透明、被动 DNS、备案、公开数据源，不发包给目标
tags: recon, passive
---

# 被动信息收集

> 特点：**不向目标发包**，全靠第三方数据源。适合"还没拿到授权范围"或"不想暴露 IP"的阶段。

## 数据源

| 数据源 | 用途 | 备注 |
|---|---|---|
| crt.sh | 证书透明日志反查子域 | `https://crt.sh/?q=%25.<域>&output=json` |
| FOFA / ZoomEye / Quake | 资产测绘（有 key 才用） | 见 `fofa-recon` |
| SecurityTrails / DNSDumpster | 被动 DNS、历史解析 | 免费额度有限 |
| ICP 备案查询 | 同主体的其他域名 | 找未备案资产的反向线索 |
| GitHub / Gitee 搜索 | 代码里泄露的域名、IP、密钥 | 搜公司名/域名/`password=` |
| 搜索引擎 | `site:`、`inurl:`、`intitle:` | 找后台、接口、文档 |

## 流程

1. 主域 → crt.sh 拉全部证书域名 → 去重
2. 每个域名 → 被动 DNS 拿历史/当前 A 记录
3. 备案反查同主体域名（找边缘资产）
4. 代码仓库搜索泄露信息
5. 全部 `redteam_asset_add`，`source=passive`

## 判定标准

- [ ] 主域 + 证书两条线都跑过
- [ ] 至少翻到 1 个"主站之外"的域名（测试环境/旧系统）
- [ ] 每个域名都有解析 IP（没有的标注 `unresolved`）

## 常见坑

| 坑 | 处理 |
|---|---|
| crt.sh 超时 | 加分页参数、换 `output=json` |
| 只拿到子域没 IP | 用被动 DNS 补，实在没有标 unresolved |
| 把 CDN 节点当真实资产 | 看 IP 归属，单独标注 |
