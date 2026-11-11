---
name: fscan-intranet
description: 内网铺面与打点：gogo 探面 + fscan 打点，按网段迭代直到没有新存活
tags: internal, fscan, gogo
---

# 内网渗透（fscan / gogo）

> 前提：已 `redteam_tunnel_add` 并**实测可达**。所有命令都走隧道或落地在内网跳板。
> 核心目标：**挖出内网所有网段**，并对每个存活点做打点。

## 1. 铺面（gogo）

```bash
./gogo -i 10.0.0.0/24 -p 1-65535 --af -o gogo_10.0.0.0_24.txt
```

- 输出关注：存活 IP、开放端口、服务指纹、关键信息（中间件/版本/标题）
- 指纹结果直接进资产的 `surface`，交给漏洞发现阶段
- 大网段分批跑，避免一次打满

## 2. 打点（fscan）

```bash
./fscan -h 10.0.0.0/24 -p 1-65535 -o fscan_10.0.0.0_24.txt -t 200
```

关注输出：

| 类型 | 说明 |
|---|---|
| 弱口令 | ms17010 之外最稳的得分点，先试常见组合 |
| 未授权 | Redis / MongoDB / ES / Docker API / Nacos |
| 高危漏洞 | MS17-010、各类 RCE 指纹 |
| 存活主机 | 用于下一轮扩展 |

## 3. 迭代找新网段（关键）

1. 从每台已控主机读路由/网卡/ARP/主机名解析：
   ```bash
   ipconfig /all        # Windows
   ip addr; ip route    # Linux
   arp -a
   ```
2. 每发现一个新网段 → 回到第 1 步，对该段重跑 gogo + fscan
3. **直到没有新网段、没有新存活为止**

## 4. 落库

- 每台存活主机 → `redteam_asset_add({kind:'host', value:ip, surface:'端口/服务/指纹', source:'gogo|fscan'})`
- 命中项（弱口令/未授权/高危）→ `redteam_vuln_add`（附 fscan 原始输出）
- 弱口令登录成功 → `redteam_credential_add` 并**浏览器/远程实测**后再升级
- 新网段 → `redteam_asset_add({kind:'segment', value:'10.1.0.0/16', source:'route'})`

## 5. 判定标准

- [ ] 每个已发现网段都跑过一轮 gogo + fscan
- [ ] 没有新网段产出后才停
- [ ] 每台存活主机都有 `surface`
- [ ] 命中项都带原始输出（不能只有结论）

## 常见坑

| 坑 | 处理 |
|---|---|
| 用外网 nmap 逐台扫 → 慢且噪音大 | 内网用 gogo/fscan |
| 只扫首段就收工 | 必须按新网段迭代 |
| 打太快触发内网 IDS | `-t` 降到 100-200 |
| 弱口令试成锁定 | 控制次数，优先常见组合 |
