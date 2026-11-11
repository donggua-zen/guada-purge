'use strict';

/**
 * 注册结构测试（PluginApi v4）
 *
 * 目标不是覆盖率，而是**钉死隔离契约**：
 * - 所有能力都必须带 visibleTo（否则又退回全局污染）
 * - 工具/技能只在能力包里，不再出现在顶层注册
 * - 专属智能体显式声明 toolkits 与 skills 白名单
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GuadaPurgePlugin = require('../index');

function makeApi(dataDir) {
  const calls = {
    kits: [],
    sections: [],
    agents: [],
    /** 任何"全局注册"都会落到这里；测试末尾断言为空 */
    globals: [],
  };

  const handle = {
    id: null,
    name: null,
    tools: [],
    skills: [],
    registerRawTool(def) {
      this.tools.push(def);
    },
    registerSkill(def) {
      this.skills.push(def);
    },
  };

  const api = {
    calls,
    handle,
    getDataDir: () => dataDir,
    getPluginDir: () => path.join(__dirname, '..'),
    registerToolKit(def) {
      calls.kits.push(def);
      handle.id = def.id;
      handle.name = def.name;
      // 宿主时序：api.onLoad 之后、flush 之前调用 kit.def.onLoad(tk)
      if (typeof def.onLoad === 'function') def.onLoad(handle);
      return handle;
    },
    registerPromptSection(def) {
      calls.sections.push(def);
    },
    registerAgent(def) {
      calls.agents.push(def);
    },
    // 下面这些在 v1 里都不应再被调用
    registerTool(def) {
      calls.globals.push(['registerTool', def]);
    },
    registerSkill(def) {
      calls.globals.push(['registerSkill', def]);
    },
    registerSlot(def) {
      calls.globals.push(['registerSlot', def]);
    },
    registerRpc(def) {
      calls.globals.push(['registerRpc', def]);
    },
    registerNls(locale) {
      calls.globals.push(['registerNls', locale]);
    },
  };

  return api;
}

async function withPlugin(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guada-purge-v4-'));
  try {
    const plugin = new GuadaPurgePlugin();
    const api = makeApi(dataDir);
    await plugin.onLoad(api);
    return await fn({ plugin, api, dataDir });
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('v1 只注册一个能力包、一个规则段、一个专属智能体', async () => {
  await withPlugin(async ({ api }) => {
    assert.equal(api.calls.kits.length, 1);
    assert.equal(api.calls.sections.length, 1);
    assert.equal(api.calls.agents.length, 1);
    // 不再有全局注册
    assert.deepEqual(api.calls.globals, []);
  });
});

test('能力包整包收口：visibleTo self + eager', async () => {
  await withPlugin(async ({ api }) => {
    const kit = api.calls.kits[0];
    assert.equal(kit.id, 'purge');
    assert.equal(kit.loadMode, 'eager');
    assert.deepEqual(kit.visibleTo, ['self']);
  });
});

test('包内两个工具均为只读，且不再有 apply/revert', async () => {
  await withPlugin(async ({ api }) => {
    const names = api.handle.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['purge_rules', 'purge_status']);
    for (const tool of api.handle.tools) {
      assert.equal(tool.readOnly, true, `${tool.name} must be readOnly`);
      assert.equal(typeof tool.handler, 'function');
    }
  });
});

test('包内注册随包技能，且继承整包作用域', async () => {
  await withPlugin(async ({ api }) => {
    assert.equal(api.handle.skills.length, 6);
    for (const skill of api.handle.skills) {
      assert.ok(skill.name, 'skill name required');
      assert.ok(skill.content && skill.content.length > 0, 'skill content required');
      // 未显式声明 → 运行时继承 kit 的 visibleTo
      assert.equal(skill.visibleTo, undefined);
    }
  });
});

test('规则段带 visibleTo，并按工作目录动态匹配', async () => {
  await withPlugin(async ({ api }) => {
    const section = api.calls.sections[0];
    assert.equal(section.name, 'guada-purge.rules');
    assert.equal(section.order, 100);
    assert.deepEqual(section.visibleTo, ['self']);

    const frontendText = section.text({
      session: { workspacePath: 'D:/work/app/frontend/page' },
    });
    assert.match(frontendText, /前端工作约定/);

    const backendText = section.text({
      session: { workspacePath: 'D:/work/app/backend-ts/modules' },
    });
    assert.match(backendText, /后端工作约定/);
    assert.doesNotMatch(backendText, /前端工作约定/);

    const noneText = section.text({ session: { workspacePath: 'D:/tmp/random' } });
    assert.equal(noneText, '');
  });
});

test('专属智能体声明能力白名单，人设来自 presets/persona.md', async () => {
  await withPlugin(async ({ api }) => {
    const agent = api.calls.agents[0];
    assert.equal(agent.id, 'research');
    assert.equal(agent.name, '安全研究助手');
    assert.deepEqual(agent.toolkits, ['purge']);
    assert.equal(agent.skills.length, 6);
    for (const name of agent.skills) {
      assert.equal(name, name.toLowerCase(), 'skills 白名单必须小写');
    }
    assert.ok(agent.systemPrompt.length > 50, 'persona 正文不应为空');
    assert.match(agent.systemPrompt, /安全研究/);
  });
});

test('purge_status 报告规则命中情况', async () => {
  await withPlugin(async ({ api }) => {
    const tool = api.handle.tools.find((t) => t.name === 'purge_status');
    const result = await tool.handler(
      {},
      { session: { workspacePath: 'D:/work/app/frontend/x' } },
    );
    assert.match(result.content, /GuaDa Purge v1\.0\.0/);
    assert.match(result.content, /命中 frontend/);
  });
});

test('purge_rules 无 id 列清单，有 id 返回正文', async () => {
  await withPlugin(async ({ api }) => {
    const tool = api.handle.tools.find((t) => t.name === 'purge_rules');
    const ctx = { session: { workspacePath: 'D:/work/app/frontend/x' } };

    const list = await tool.handler({}, ctx);
    assert.match(list.content, /规则集清单/);
    assert.match(list.content, /frontend/);

    const body = await tool.handler({ id: 'backend' }, ctx);
    assert.match(body.content, /后端工作约定/);

    const missing = await tool.handler({ id: 'nope' }, ctx);
    assert.match(missing.content, /未找到规则集/);
  });
});
