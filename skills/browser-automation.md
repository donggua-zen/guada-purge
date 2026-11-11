---
name: browser-automation
description: 浏览器自动化：登录实测、后台取证、单页应用接口发现
tags: exploit, browser
---

# 浏览器自动化

> 用途有三：**验证凭据真的能登**、**给后台/数据页面取证**、**在 SPA 里找隐藏接口**。

## 什么时候必须用浏览器

| 场景 | 为什么不能用 curl |
|---|---|
| 验证账号权限 | 需要看真实页面（后台标题、可见菜单） |
| SPA 应用 | 接口走 JS 动态生成，curl 拿不到 |
| CSRF / 前端校验 | 需要真实浏览器上下文 |
| 取证截图 | 报告要贴图 |

## 常用操作

1. 打开登录页 → 填账号密码 → 提交
2. 检查跳转后的 URL 与页面标题（这就是"登录成功"的证据）
3. 打开 devtools Network → 记录真实接口（含 token 的 URL 去掉 token 再试是否裸奔）
4. 逐页截图 → `redteam_shot_add`

## 接口发现（SPA 关键）

```text
1. 打开目标页 → Network → XHR/Fetch 过滤
2. 记录 API 前缀（/api/、/prod-api/）
3. 找到带 id/uid 参数的接口 → 改 id 试越权
4. 找到 list 接口 → 看是否返回全量数据
```

**越权判定**：换成别的 id 还能拿到数据 = 越权（IDOR），这是未授权里最常见的。

## 落库

```
redteam_credential_add({ username, secretMasked })   // 再用 verified 标记
redteam_evidence_verify({ evidenceId, method: '浏览器登录成功，后台标题 XX' })
redteam_shot_add({ path, note: '后台首页' })
redteam_http_evidence_add({ url, request, response })  // 越权接口
```

## 判定标准

- [ ] 登录成功有证据（URL + 页面标题 + 截图）
- [ ] 越权测试换了真实 id 并拿到数据
- [ ] 截图已登记

## 常见坑

| 坑 | 处理 |
|---|---|
| 只看 HTTP 200 就说登录成功 | 要看页面内容/跳转 |
| 越权只试了自己的 id | 必须换别人的 id |
| 不截图 | 报告缺证据 |
| 截图里有敏感信息 | 打码后再入报告 |
