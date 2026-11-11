---
name: fofa-recon
description: FOFA 语法与资产测绘：常用查询式、去重、结果转资产落库
tags: recon, fofa
---

# FOFA 资产测绘

> 需要 `FOFA_KEY`。没有 key 时降级：crt.sh（证书）+ 被动 DNS + 搜索引擎 + 备案查询。

## 1. 常用语法

| 目的 | 查询式 |
|---|---|
| 主域资产 | `domain="example.com"` |
| 证书反查 | `cert="example.com"` |
| 指定 IP 段 | `ip="1.2.3.0/24"` |
| 指定端口 | `port="8080"` |
| 指定标题 | `title="管理后台"` |
| 指定指纹 | `app="ThinkPHP"` / `app="Nacos"` |
| 组合（缩小范围） | `domain="example.com" && title="后台"` |

常用组合思路：

```
domain="<主域>" && (title="管理" || title="登录" || title="console")
cert="<主域>" && port!="443"          # 证书命中但非常规端口 → 边缘资产
domain="<主域>" && protocol="http"     # 明文暴露面
```

## 2. 查询与分页

- 每页 100 条，按 `page` 翻；`size` 上限受套餐限制
- 结果字段重点关注：`host`（含端口）、`title`、`server`、`ip`、`domain`
- `host` 形如 `https://1.2.3.4:8443` → 拆成 `value` + `ip` + `port` 落库

## 3. 结果处理

1. 去掉主站已知资产（避免重复）
2. 按 `title` / `server` 粗分：管理后台 / API / 文件服务 / 中间件默认页 / 其他
3. 每个 host 一条 `redteam_asset_add`，`source=fofa`
4. `surface` 填 `server + title + 明显指纹`，这是下一阶段评估易打性的依据

## 4. 判定标准

- [ ] 主域 + 证书两条线都跑过
- [ ] 至少覆盖 3 类资产（主站 / 后台 / 边缘服务）
- [ ] FOFA 结果与主动探测结果做过去重（同 IP+端口只留一条）
- [ ] 未备案资产单独标注

## 常见坑

| 坑 | 处理 |
|---|---|
| 只查 `domain=` → 漏证书关联域名 | 必须补 `cert=` |
| 把 CDN 节点当真实资产 | 看 `ip` 归属，CDN IP 单独标注 |
| 检索式过宽 → 拿到别人资产 | 加 `domain` / `cert` 限定 |
| 配额用尽 | 先收窄条件，再分页 |
