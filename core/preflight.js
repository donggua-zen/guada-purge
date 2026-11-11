'use strict';

/**
 * 开工前环境预检
 *
 * 只做只读探测：环境变量是否就位、常用二进制是否在 PATH。
 * 不主动安装、不发起网络请求，缺什么就让用户补什么。
 */

const { spawnSync } = require('node:child_process');

/** PATH 里能否找到该可执行文件 */
function hasBinary(bin) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const res = spawnSync(cmd, [bin], { encoding: 'utf8', timeout: 2000 });
    return res.status === 0 && String(res.stdout || '').trim().length > 0;
  } catch {
    return false;
  }
}

/** 需要用户提供的环境变量（缺了相应能力就降级） */
const ENV_KEYS = [
  { key: 'FOFA_KEY', purpose: 'FOFA 资产测绘', fallback: 'crt.sh / 被动 DNS / subfinder' },
  { key: 'VPS_IP', purpose: '反弹 Shell / 隧道落地', fallback: '先做不需要落地的成果' },
];

/** 常用工具（名字 → 用途 → 缺失时的影响） */
const TOOLS = [
  { bin: 'fscan', purpose: '内网打点（弱口令/未授权/高危）' },
  { bin: 'gogo', purpose: '内网铺面（存活/端口/指纹）' },
  { bin: 'nuclei', purpose: 'Nday/模板扫描' },
  { bin: 'nmap', purpose: '端口与服务探测' },
  { bin: 'suo5', purpose: 'HTTP 隧道' },
  { bin: 'frpc', purpose: 'FRP 隧道客户端' },
];

/**
 * @returns {{ ready: boolean, env: Array, tools: Array, hints: string[] }}
 */
function runPreflight() {
  const env = ENV_KEYS.map((item) => {
    const value = process.env[item.key];
    const present = typeof value === 'string' && value.trim().length > 0;
    return {
      key: item.key,
      present,
      purpose: item.purpose,
      fallback: present ? '' : item.fallback,
    };
  });

  const tools = TOOLS.map((item) => ({
    bin: item.bin,
    present: hasBinary(item.bin),
    purpose: item.purpose,
  }));

  const missingEnv = env.filter((e) => !e.present);
  const missingTools = tools.filter((t) => !t.present);

  const hints = [];
  for (const item of missingEnv) {
    hints.push(`缺少环境变量 ${item.key}（${item.purpose}）→ 可降级为：${item.fallback}`);
  }
  if (missingTools.length) {
    hints.push(
      `未在 PATH 找到：${missingTools.map((t) => t.bin).join(', ')}；` +
        `相应技能的对应步骤会被跳过，请补装或说明替代方案。`,
    );
  }

  return {
    ready: missingEnv.length === 0 && missingTools.length === 0,
    env,
    tools,
    hints,
  };
}

module.exports = { runPreflight, hasBinary, ENV_KEYS, TOOLS };
