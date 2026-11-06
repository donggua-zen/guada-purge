'use strict';

/**
 * GuaDa Purge — 三方插件骨架（Phase 0）
 *
 * 约束：
 * - 零依赖、CommonJS；宿主用 require() 直接加载本文件。
 * - 只使用 onLoad(api) 暴露的公开 PluginApi，不 require 宿主内部模块。
 * - manifest 以 manifest.json 为准；此处内联一份作为兜底（无 manifest.json 时可用）。
 *
 * Phase 1 起在这里接入：
 *   registerPromptSection / registerSkill / registerTool / registerLocalCommand
 *   getDataDir（提示词、规则集、快照）
 */

const PLUGIN_ID = 'guada-purge';
const PLUGIN_NAME = 'GuaDa Purge';
const VERSION = '0.1.0';

const NLS_ZH = {
  'settings.title': 'GuaDa Purge',
  'settings.desc': '人格、规则与技能控制台（Phase 0 骨架）',
};

const NLS_EN = {
  'settings.title': 'GuaDa Purge',
  'settings.desc': 'Persona, rules and skills console (Phase 0 skeleton)',
};

class GuadaPurgePlugin {
  constructor() {
    this.manifest = {
      id: PLUGIN_ID,
      name: PLUGIN_NAME,
      version: VERSION,
      description: '人格、规则与技能控制台 —— GuaDa 三方插件参考实现',
      author: 'donggua-zen',
      category: 'user',
      icon: 'assets/icon.svg',
    };
    this.api = null;
  }

  async onLoad(api) {
    this.api = api;
    this.registerNls(api);
    this.registerSlots(api);
    this.registerPlaceholderPrompt(api);
  }

  registerNls(api) {
    if (typeof api.registerNls !== 'function') return;
    api.registerNls('zh', NLS_ZH);
    api.registerNls('en', NLS_EN);
  }

  registerSlots(api) {
    if (typeof api.registerSlot !== 'function') return;
    api.registerSlot({
      name: 'settings',
      component: 'SettingsPage',
      mode: 'list',
      order: 60,
      meta: { label: '%settings.title%', group: 'plugin' },
    });
  }

  registerPlaceholderPrompt(api) {
    if (typeof api.registerPrompt !== 'function') return;
    // Phase 0：空提示词（宿主会过滤空内容）。Phase 1 换成 registerPromptSection。
    api.registerPrompt({
      content: '',
      frequency: 'VOLATILE',
      description: 'GuaDa Purge placeholder (Phase 0)',
    });
  }

  async onStart() {
    // Phase 1：启动自检、读取插件数据目录、恢复上次快照。
  }

  async onStop() {
    // 运行时资源回收（定时器/监听器）；注册项由宿主统一反注册。
  }

  async onUnload() {
    // 卸载清理；用户数据由宿主插件数据目录管理，默认不删除。
  }
}

module.exports = GuadaPurgePlugin;
module.exports.default = GuadaPurgePlugin;
