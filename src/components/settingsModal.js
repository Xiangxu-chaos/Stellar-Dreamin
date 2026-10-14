/**
 * settingsModal.js —— 设置页
 * ============================================================================
 * 本轮增量变更：
 *   记忆材料已全部改为「预生成静态数据」（见 domainMaterialService），
 *   运行时不再调用任何 AI。因此 AI 配置区被重新定位为：
 *     「未来批量生成用」—— 仅在你要为【新领域】批量预生成材料时才需要，
 *     当前版本不参与任何运行时逻辑，留空也不影响使用。
 *
 *   数据管理新增：收藏夹、做题统计、答题历史的清理入口。
 *
 * 所有读写经由 dataService / aiService，本组件不直接触碰 localStorage 或 fetch。
 * ============================================================================
 */

import { h, svgIcon } from '../core/dom.js';
import { iconPath } from '../core/icons.js';
import { openModal, confirmDialog } from './modal.js';
import { showToast } from './toast.js';
import dataService from '../services/dataService.js';
import aiService from '../services/aiService.js';
import { INTEREST_DOMAINS } from '../config/interestsConfig.js';

export async function openSettingsModal() {
  const settings = await dataService.getSettings();
  const dirty = { current: false };
  const markDirty = () => { dirty.current = true; };

  const body = h('div.form');

  /* ---------------- AI 配置（当前版本完全不使用） ----------------
   * 需求二明确规定：复习模式全程不调 API、不需要 API Key。
   * 因此这里整块标注为「当前版本不使用」，仅作为未来扩展领域的预留位。
   * --------------------------------------------------------------- */
  const apiKeyInput = h('input.input', {
    type: 'password',
    value: settings.apiKey,
    placeholder: '当前版本不使用',
    autocomplete: 'off',
    spellcheck: 'false',
    onInput: markDirty,
  });

  const keyAffix = h('div.input-affix', {}, [
    apiKeyInput,
    h('button.input-affix__btn', {
      type: 'button',
      title: '显示 / 隐藏',
      onClick: (e) => {
        const btn = e.currentTarget;
        const show = apiKeyInput.type === 'password';
        apiKeyInput.type = show ? 'text' : 'password';
        btn.replaceChildren(svgIcon(iconPath(show ? 'eyeOff' : 'eye'), { size: 15 }));
      },
    }, [svgIcon(iconPath('eye'), { size: 15 })]),
  ]);

  const baseUrlInput = h('input.input', {
    type: 'text',
    value: settings.baseUrl,
    placeholder: 'https://api.deepseek.com',
    spellcheck: 'false',
    onInput: markDirty,
  });

  const modelInput = h('input.input', {
    type: 'text',
    value: settings.model,
    placeholder: 'deepseek-chat',
    spellcheck: 'false',
    onInput: markDirty,
  });

  const testBtn = h('button.btn', { type: 'button' }, [
    svgIcon(iconPath('bolt'), { size: 14, cls: 'btn__icon' }), '测试连接',
  ]);

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    const original = testBtn.innerHTML;
    testBtn.replaceChildren(h('span.spinner'), document.createTextNode(' 测试中…'));
    try {
      // 先保存当前输入，再测试（避免测试用旧配置）
      await persist();
      const reply = await aiService.testConnection();
      showToast('连接成功', { desc: `模型回复：${reply}`, type: 'ok' });
    } catch (e) {
      showToast('连接失败', { desc: e.message, type: 'err', duration: 7000 });
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = original;
    }
  });

  body.append(
    h('div.notice', { style: { marginBottom: '6px' } }, [
      svgIcon(iconPath('info'), { size: 16, cls: 'notice__icon' }),
      h('div', {
        html: '当前版本的记忆材料是<b>预生成静态数据</b>（<code>src/data/domainMaterials/*.json</code>），<b>复习模式只从收藏夹出题并直接使用这些例句</b>，打开页面即可浏览与做题，<b>全程不调用任何 API，不需要 API Key</b>。下方的 AI 配置在当前版本<b>完全不使用</b>，仅为你未来要为<b>新增兴趣领域</b>批量预生成材料时预留，留空完全不影响使用。',
      }),
    ]),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
      h('div.detail__section-title', {}, [
        svgIcon(iconPath('server'), { size: 13 }),
        'AI 服务配置',
        h('span.chip.chip--warn', { text: '当前版本不使用' }),
      ]),
      h('div.form-hint', {
        text: '复习 / 做题 / 卡片全部走本地静态数据与本地判分，以下配置在运行时不会被读取。仅在你未来为新增领域离线批量生成一次材料时才需要，密钥只保存在本机浏览器中。',
      }),
    ]),
    h('div.form-row', {}, [
      h('label.form-label', {}, [svgIcon(iconPath('key'), { size: 14 }), 'API Key', h('span.opt', { text: '当前版本不使用' })]),
      keyAffix,
      h('div.form-hint', { text: '当前版本无需填写。留空即可正常使用全部功能。' }),
    ]),
    h('div.form-row', {}, [
      h('label.form-label', {}, [svgIcon(iconPath('link'), { size: 14 }), 'Base URL', h('span.opt', { text: 'OpenAI 兼容 · 当前版本不使用' })]),
      baseUrlInput,
      h('div.form-hint', { text: '当前版本无需填写。默认 https://api.deepseek.com，仅作未来扩展预留。' }),
    ]),
    h('div.form-row', {}, [
      h('label.form-label', {}, [svgIcon(iconPath('brain'), { size: 14 }), '模型名', h('span.opt', { text: '当前版本不使用' })]),
      modelInput,
      h('div.form-hint', { text: '当前版本无需填写。默认 deepseek-chat，仅作未来扩展预留。' }),
    ]),
    h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } }, [
      testBtn,
      h('span.form-hint', { text: '当前版本点击测试不会影响任何功能。' }),
    ]),
  );

  /* ---------------- 生成 prompt 覆盖（未来批量生成用） ---------------- */
  const promptSelect = h('select', { onChange: onPromptSelectChange });
  for (const d of Object.values(INTEREST_DOMAINS)) {
    promptSelect.appendChild(h('option', { value: d.id, text: `${d.name}（${d.subtitle}）` }));
  }

  const promptArea = h('textarea.input', {
    spellcheck: 'false',
    placeholder: '留空则使用所选领域内置的 prompt。',
    onInput: markDirty,
  });

  function onPromptSelectChange() {
    const domainId = promptSelect.value;
    // 优先显示已有覆盖；否则展示内置 prompt 全文，便于用户参考修改
    const key = `override:${domainId}`;
    promptArea.value = settings.customPromptOverrideMap?.[key] || INTEREST_DOMAINS[domainId]?.generationPrompt || '';
  }

  promptArea.value = settings.customPromptOverride || INTEREST_DOMAINS[promptSelect.value]?.generationPrompt || '';

  const resetPromptBtn = h('button.btn.btn--ghost.btn--sm', {
    type: 'button',
    onClick: () => {
      promptArea.value = INTEREST_DOMAINS[promptSelect.value]?.generationPrompt || '';
      markDirty();
      showToast('已载入内置 prompt', { desc: '可直接编辑后保存', type: 'info' });
    },
  }, [svgIcon(iconPath('refresh'), { size: 12, cls: 'btn__icon' }), '载入内置 prompt']);

  body.append(
    h('div.detail__divider', { style: { height: '1px', background: 'var(--c-border)' } }),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
      h('div.detail__section-title', {}, [svgIcon(iconPath('wand'), { size: 13 }), '生成 Prompt（未来批量生成用）']),
      h('div.form-hint', {
        text: '这是给 AI 的批量预生成指令模板，运行时不会执行。留空则使用所选领域在 interestsConfig.js 中定义的内置 prompt。领域新增时这里会自动出现对应选项，无需改代码。',
      }),
    ]),
    h('div.form-row', {}, [
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, [
        h('div.field', { style: { flex: '1', minWidth: '220px' } }, [promptSelect]),
        resetPromptBtn,
      ]),
      promptArea,
    ]),
  );

  /* ---------------- 开关项 ---------------- */
  const useAIJudgeSwitch = makeSwitch(settings.autoTranslateExample !== false, markDirty, 'useAIJudge');
  const confirmRegenSwitch = makeSwitch(true, markDirty, 'confirmRegen');

  body.append(
    h('div.detail__divider', { style: { height: '1px', background: 'var(--c-border)' } }),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
      h('div.detail__section-title', {}, [
        svgIcon(iconPath('target'), { size: 13 }),
        '复习与批量生成选项',
        h('span.chip.chip--warn', { text: '当前版本不使用' }),
      ]),
      h('div.form-hint', {
        text: '当前版本复习模式只从收藏夹出题，例句直接取自预生成材料，判分在本地完成，不依赖 AI。以下选项仅对未来扩展生效。',
      }),
    ]),
    h('div.switch-row', {}, [
      h('div', {}, [
        h('div.switch-row__label', { text: '复习时用 AI 判分（当前版本不使用）' }),
        h('div.switch-row__desc', { text: '当前版本复习为选择题，本地即可判分，永远不调用模型。此开关仅作未来扩展预留。' }),
      ]),
      useAIJudgeSwitch.el,
    ]),
    h('div.switch-row', {}, [
      h('div', {}, [
        h('div.switch-row__label', { text: '批量生成前二次确认（当前版本不使用）' }),
        h('div.switch-row__desc', { text: '仅在为新增领域离线批量预生成材料时生效，运行时不会触发。' }),
      ]),
      confirmRegenSwitch.el,
    ]),
  );

  /* ---------------- 数据管理 ---------------- */
  const usageKb = (dataService.estimateUsage() / 1024).toFixed(1);

  const exportBtn = h('button.btn.btn--sm', {
    type: 'button',
    onClick: async () => {
      const payload = await dataService.exportAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `cet6-memory-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('已导出备份', { desc: '文件已开始下载', type: 'ok' });
    },
  }, [svgIcon(iconPath('download'), { size: 12, cls: 'btn__icon' }), '导出备份']);

  const importBtn = h('button.btn.btn--sm', { type: 'button' },
    [svgIcon(iconPath('upload'), { size: 12, cls: 'btn__icon' }), '导入备份']);

  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    style: { display: 'none' },
    onChange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await dataService.importAll(JSON.parse(text));
        showToast('导入成功', { desc: '页面即将刷新以应用数据', type: 'ok' });
        setTimeout(() => window.location.reload(), 900);
      } catch (err) {
        showToast('导入失败', { desc: err.message, type: 'err' });
      } finally {
        e.target.value = '';
      }
    },
  });
  importBtn.addEventListener('click', () => fileInput.click());

  const clearFavBtn = h('button.btn.btn--sm', {
    type: 'button',
    onClick: async () => {
      const keys = await dataService.getFavoriteKeys();
      if (!keys.length) {
        showToast('收藏夹已经是空的', { type: 'info' });
        return;
      }
      const ok = await confirmDialog({
        title: `清空全部 ${keys.length} 个收藏？`,
        message: '收藏记录会被删除，卡片材料与答题历史不受影响。此操作不可撤销。',
        confirmText: '清空收藏',
        danger: true,
      });
      if (!ok) return;
      await dataService.clearFavorites();
      showToast('已清空收藏夹', { desc: '刷新页面后生效', type: 'ok' });
    },
  }, [svgIcon(iconPath('star'), { size: 12, cls: 'btn__icon' }), '清空收藏夹']);

  const clearQuizBtn = h('button.btn.btn--sm', {
    type: 'button',
    onClick: async () => {
      const ok = await confirmDialog({
        title: '清空做题统计？',
        message: '将删除做题模式的正确率统计与逐词记录。收藏夹与记忆材料不受影响。',
        confirmText: '清空统计',
        danger: true,
      });
      if (!ok) return;
      await dataService.clearQuizStats();
      showToast('已清空做题统计', { type: 'ok' });
    },
  }, [svgIcon(iconPath('quiz'), { size: 12, cls: 'btn__icon' }), '清空做题统计']);

  const clearHistoryBtn = h('button.btn.btn--sm', {
    type: 'button',
    onClick: async () => {
      const ok = await confirmDialog({
        title: '清空全部答题历史？',
        message: '将删除复习与做题的逐条作答记录。此操作不可撤销。',
        confirmText: '清空历史',
        danger: true,
      });
      if (!ok) return;
      await dataService.clearHistory();
      showToast('已清空答题历史', { type: 'ok' });
    },
  }, [svgIcon(iconPath('history'), { size: 12, cls: 'btn__icon' }), '清空答题历史']);

  const clearAllBtn = h('button.btn.btn--sm', {
    type: 'button',
    style: { borderColor: 'rgba(var(--c-danger-rgb), 0.5)', color: 'var(--c-danger)' },
    onClick: async () => {
      const ok = await confirmDialog({
        title: '重置全部本地数据？',
        message: '将删除设置、收藏、勾选记录、答题历史与界面偏好。内置的记忆材料与词库文件不受影响。此操作不可撤销。',
        confirmText: '全部重置',
        danger: true,
      });
      if (!ok) return;
      await dataService.clearAll();
      showToast('已重置全部数据', { desc: '页面即将刷新', type: 'ok' });
      setTimeout(() => window.location.reload(), 900);
    },
  }, [svgIcon(iconPath('alert'), { size: 12, cls: 'btn__icon' }), '重置全部数据']);

  body.append(
    h('div.detail__divider', { style: { height: '1px', background: 'var(--c-border)' } }),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
      h('div.detail__section-title', {}, [svgIcon(iconPath('database'), { size: 13 }), '本地数据']),
      h('div.form-hint', { text: `当前占用约 ${usageKb} KB（浏览器 localStorage）。刷新页面数据不会丢失。` }),
    ]),
    h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, [
      exportBtn, importBtn, fileInput,
    ]),
    h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' } }, [
      clearFavBtn, clearQuizBtn, clearHistoryBtn, clearAllBtn,
    ]),
    h('div.notice', { style: { marginTop: '4px', marginBottom: '0' } }, [
      svgIcon(iconPath('info'), { size: 16, cls: 'notice__icon' }),
      h('div', {
        html: '架构说明：记忆材料存放在 <code>src/data/domainMaterials/*.json</code>（只读静态数据），不受上述清理影响。未来接入后端时，只需替换 <code>dataService.js</code> 的内部实现，本页面与所有组件无需改动。',
      }),
    ]),
  );

  async function persist() {
    const overrideText = promptArea.value.trim();
    const builtinText = (INTEREST_DOMAINS[promptSelect.value]?.generationPrompt || '').trim();
    await dataService.saveSettings({
      apiKey: apiKeyInput.value.trim(),
      baseUrl: baseUrlInput.value.trim() || 'https://api.deepseek.com',
      model: modelInput.value.trim() || 'deepseek-chat',
      // 与内置 prompt 完全一致时视为「未覆盖」，保持配置干净
      customPromptOverride: overrideText === builtinText ? '' : overrideText,
      autoTranslateExample: useAIJudgeSwitch.get(),
    });
    dirty.current = false;
  }

  const m = openModal({
    title: '设置',
    subtitle: 'AI 批量生成（可选）、术语规范与本地数据管理',
    width: 'wide',
    body,
    onClose: () => { /* 已通过保存按钮处理 */ },
    footer: [
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => m.close() }, '关闭'),
      h('button.btn.btn--primary', {
        type: 'button',
        onClick: async () => {
          await persist();
          showToast('设置已保存', { type: 'ok' });
          m.close();
        },
      }, [svgIcon(iconPath('check'), { size: 14, cls: 'btn__icon' }), '保存设置']),
    ],
  });

  return m;
}

/** 简易开关控件 */
function makeSwitch(initial, onChange, name) {
  const el = h('button.switch', {
    type: 'button',
    role: 'switch',
    'aria-checked': String(Boolean(initial)),
    'aria-label': name,
    class: initial ? 'is-on' : '',
    onClick: (e) => {
      const next = !e.currentTarget.classList.contains('is-on');
      e.currentTarget.classList.toggle('is-on', next);
      e.currentTarget.setAttribute('aria-checked', String(next));
      onChange?.(next);
    },
  });
  return {
    el,
    get: () => el.classList.contains('is-on'),
    set: (v) => {
      el.classList.toggle('is-on', Boolean(v));
      el.setAttribute('aria-checked', String(Boolean(v)));
    },
  };
}

export default openSettingsModal;
