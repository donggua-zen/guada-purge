'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRule, selectRules, renderRules, matchAny } = require('./rules');
const { buildStatus, STATUS } = require('./status');

const RULE = `---
name: 前端规范
paths: frontend/**, packages/web/**
---
- 使用既有组件
`;

test('parseRule reads frontmatter', () => {
  const rule = parseRule('frontend', RULE);
  assert.equal(rule.name, '前端规范');
  assert.deepEqual(rule.paths, ['frontend/**', 'packages/web/**']);
  assert.match(rule.body, /使用既有组件/);
});

test('relative patterns match anywhere in an absolute workspace path', () => {
  assert.equal(matchAny('D:/AI/ai_chat', ['frontend/**']), false);
  assert.equal(matchAny('D:/AI/ai_chat/frontend/app', ['frontend/**']), true);
  assert.equal(matchAny('/home/me/web', ['packages/web/**']), false);
  assert.equal(matchAny('/home/me/packages/web', ['packages/web/**']), true);
});

test('empty paths means global', () => {
  assert.equal(matchAny('/anything', []), true);
});

test('selectRules filters by workspace path', () => {
  const rules = [
    parseRule('frontend', RULE),
    parseRule('docs', '---\nname: docs\npaths: docs/**\n---\n- 结论先行'),
  ];
  const selected = selectRules(rules, 'D:/AI/ai_chat/frontend');
  assert.deepEqual(selected.map((r) => r.id), ['frontend']);
});

test('renderRules joins bodies', () => {
  const text = renderRules([
    { body: 'a' },
    { body: 'b' },
  ]);
  assert.equal(text, 'a\n\nb');
});

test('buildStatus groups and counts', () => {
  const out = buildStatus([
    { id: 'a', group: 'prompt', status: STATUS.APPLIED },
    { id: 'b', group: 'prompt', status: STATUS.SKIPPED },
    { id: 'c', group: 'tools', status: STATUS.APPLIED },
  ]);
  assert.equal(out.rows.length, 2);
  assert.equal(out.totals.applied, 2);
  assert.equal(out.totals.skipped, 1);
});
