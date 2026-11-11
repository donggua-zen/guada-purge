---
name: gogo-intranet
description: gogo 内网铺面：存活/端口/服务/指纹/关键信息，按网段迭代
tags: internal, gogo
---

# gogo 内网铺面

> 内网第一步永远是**铺面**（gogo），不是打点（fscan）。先知道有什么，再决定打什么。

## 基本用法

```bash
./gogo -i 10.0.0.0/24 -p 1-65535 --af -o gogo_10.0.0.0_24.txt
```

| 参数 | 作用 |
|---|---|
| `-i` | 目标网段/IP 列表 |
| `-p` | 端口范围（默认常见端口，`1-65535` 全端口） |
| `--af` | 主动指纹识别（慢一些，但信息量大） |
| `-o` | 输出文件 |

## 看什么

| 输出 | 含义 | 下一步 |
|---|---|---|
| 存活 IP | 机器活着 | 进资产库 |
| 开放端口 + 服务 | 暴露面 | 有 web 就看指纹 |
| 指纹（中间件/版本） | 决定打什么 | 交漏洞发现 |
| 关键信息（标题、证书、SNMP） | 判断系统用途 | 标 priority |

## 迭代找网段（核心）

gogo 跑完一轮后：

1. 对已控主机读路由/网卡/ARP：
   ```bash
   ip route; ip addr; arp -a
   ipconfig /all        # Windows
   ```
2. 每发现新网段 → 对新段跑 gogo
3. **直到没有新网段、没有新存活**

## 落库

```
redteam_asset_add({ kind:'host', value: ip, surface: '端口/服务/指纹', source: 'gogo' })
redteam_asset_add({ kind:'segment', value: '10.1.0.0/16', source: 'route' })   // 新网段
```

## 判定标准

- [ ] 每个已发现网段都跑过 gogo
- [ ] 每台存活主机有 `surface`
- [ ] 新网段已登记为 `kind=segment`

## 常见坑

| 坑 | 处理 |
|---|---|
| 用 nmap 逐台扫 | 内网用 gogo，快且带指纹 |
| 一次打大段 | 分批，先 /24 |
| 只看端口不看指纹 | 指纹才是"打什么"的依据 |
| 忘了跑第二轮 | 新网段是老网段里发现的 |
