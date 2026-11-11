'use strict';

/**
 * 连通性 / 证据复现探测
 *
 * 只发一次请求：HEAD 优先，HEAD 405/501 时回退 GET（只取前 4KB）。
 * 默认 5 秒超时，不跟随无限重定向（fetch 默认最多 20 跳）。
 *
 * 注意：插件运行在后端进程内，出口就是本机网络。授权范围由用户自己把关。
 */

const MAX_BODY_BYTES = 4096;

function normalizeUrl(target) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('target is required');
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

async function probe(target, options = {}) {
  const url = normalizeUrl(target);
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 5000;
  const startedAt = Date.now();

  const attempt = async (method) => {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'guada-purge/2 (authorized-test)' },
    });
    let body;
    if (method === 'GET' && options.body !== false) {
      try {
        const buf = await res.arrayBuffer();
        body = Buffer.from(buf).subarray(0, MAX_BODY_BYTES).toString('utf8');
      } catch {
        body = undefined;
      }
    }
    return { res, body };
  };

  try {
    let out;
    try {
      out = await attempt('HEAD');
    } catch {
      out = await attempt('GET');
    }
    const { res, body } = out;
    const headers = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      ok: true,
      url,
      status: res.status,
      finalUrl: res.url,
      elapsedMs: Date.now() - startedAt,
      server: headers.server || '',
      title: extractTitle(body),
      contentType: headers['content-type'] || '',
      headers,
      bodyPreview: body ? body.slice(0, 500) : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      url,
      elapsedMs: Date.now() - startedAt,
      error: String((err && err.message) || err),
    };
  }
}

function extractTitle(html) {
  if (!html) return '';
  const m = String(html).match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

module.exports = { probe, normalizeUrl };
