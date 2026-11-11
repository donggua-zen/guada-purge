---
name: nuclei-scan
description: 模板化漏洞扫描：选模板、限速、去重、结果落库与人工复核
tags: scan, nuclei
---

# nuclei 模板扫描

> 定位：**发现线索**，不是结论。每条命中必须人工复核并补原始请求，才能落成漏洞。

## 1. 选模板

```bash
# 有指纹的优先按技术栈打
nuclei -l urls.txt -tags thinkphp,spring,nacos -severity high,critical -silent

# 无指纹时打通用高危
nuclei -l urls.txt -tags cves,rce,default-login -severity critical,high -silent

# 指定单个模板调试
nuclei -u https://target -t http/cves/2021/CVE-2021-xxxx.yaml -debug
```

选择原则：

1. 先按**已知指纹**选技术栈模板（误报低、命中率高）
2. 再补 `default-login`（默认口令，常见得分点）
3. 最后才是宽泛的 `cves`（噪音大，注意限速）

## 2. 限速（硬要求）

```bash
nuclei -l urls.txt -t <模板> -rate-limit 50 -bulk-size 25 -timeout 10 -retries 1
```

- 对生产/授权目标 `rate-limit ≤ 50`，避免把服务打挂
- 被封禁就停：看返回码突变（403/429 激增）立刻降速或换时间窗

## 3. 结果处理

1. 按 `template-id` 去重（同一模板对多 URL 只需抽 1-2 条复核）
2. **人工复核**：手发一次请求确认可复现，抓原始请求/响应
3. `redteam_vuln_add` 落库：`title` 用模板语义 + 资产，`request` 必填
4. 落库前先 `redteam_vuln_query({assetId})` 查重

## 4. 判定标准

- [ ] 每条漏洞都有原始请求
- [ ] 误报已标注（`status` 置 `false-positive`，不要直接删）
- [ ] 同一资产同类问题合并成一条（写清影响范围）

## 常见坑

| 坑 | 处理 |
|---|---|
| 全量模板一把梭 → 慢且噪音大 | 按指纹裁剪 |
| 命中就报 → 误报率高 | 必须手发包复核 |
| 不落库 → 报告写不出来 | 命中即落库，带 request |
| 不限速 → 打挂服务/IP 被封 | `-rate-limit` 必设 |
