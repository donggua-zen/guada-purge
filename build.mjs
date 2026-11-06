#!/usr/bin/env node

/**
 * 构建插件前端产物。
 *
 * 当前前端是手写 render-function 组件（不依赖 SFC 编译器），
 * 因此这里只做「源码 → frontend/dist/<Component>.js」的确定性拷贝。
 * 后续若引入 Vue SFC，可在此换成 Vite/Rollup，产物契约不变：
 *   - IIFE
 *   - 执行时调用 window.__GuaDaModuleLoader__.register('<pluginId>:<Component>', { default })
 *   - Vue 从 window.__GuaDaShared__.vue 读取，不打包
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'frontend', 'src', 'settings-page.js');
const outDir = path.join(root, 'frontend', 'dist');
const out = path.join(outDir, 'SettingsPage.js');

const banner = `/* Built by build.mjs — do not edit dist by hand. Source: frontend/src/settings-page.js */\n`;

fs.mkdirSync(outDir, { recursive: true });
const body = fs.readFileSync(src, 'utf8');
fs.writeFileSync(out, banner + body, 'utf8');
console.log(`built ${path.relative(root, out)} (${body.length} bytes)`);
