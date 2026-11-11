---
name: web-fingerprint
description: Web 指纹识别：中间件/框架/CMS/版本判定，决定后续打什么
tags: recon, fingerprint
---

# Web 指纹识别

> 指纹决定打什么。判错版本 → 用错 PoC → 浪费一整轮。

## 采集顺序

1. **响应头**：`Server`、`X-Powered-By`、`Set-Cookie` 名字（`JSESSIONID`→Java、`PHPSESSID`→PHP、`ASP.NET_SessionId`→.NET）
2. **错误页**：框架默认 404 页、堆栈信息、白页特征
3. **静态路径**：`/favicon.ico`（hash 比对）、`/robots.txt`、`/sitemap.xml`
4. **特定路径**：`/wp-admin`（WP）、`/administrator`（Joomla）、`/actuator`（Spring）、`/nacos`（Nacos）
5. **HTML 特征**：`<meta name="generator">`、注释、JS 文件命名

## 工具

```bash
whatweb -a 3 https://target
nuclei -u https://target -t http/technologies/ -silent
httpx -u https://target -tech-detect -title -status-code -silent
```

## 落库

```
redteam_asset_add / redteam_asset_assess
surface = "nginx/1.20 | PHP/7.4 | ThinkPHP 5.0.23 | 后台标题"
```

有版本号就一定要写进 `surface` —— 那是下一阶段匹配 Nday 的唯一依据。

## 判定标准

- [ ] 至少识别出「中间件 + 语言 + 框架」三层
- [ ] 有版本号（拿不到精确版本就写范围，如 `ThinkPHP 5.0.x`）
- [ ] 明确记录是否在 CDN/WAF 后面

## 常见坑

| 坑 | 处理 |
|---|---|
| 只看 `Server` 头 | 会被反向代理骗（nginx 后面跑 Tomcat 很常见） |
| 没版本就猜 | 写范围，别写死；后续用行为特征补 |
| 忽略 favicon hash | 它是最稳的 CMS 判据之一 |
| WAF 拦截指纹探测 | 降速、换 UA、用被动方式 |
