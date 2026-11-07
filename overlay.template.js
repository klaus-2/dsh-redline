// SPDX-License-Identifier: MIT
// tencil-overlay.css is derived from the tencil design system (Apache-2.0, (c) 2026 Pixel Perfect Agency) - see THIRD-PARTY-NOTICES.md
(() => {
  "use strict";
  if (window.__LR_LOADED__) return;
  window.__LR_LOADED__ = true;

  const scriptOrigin = (() => {
    try {
      if (document.currentScript && document.currentScript.src) return new URL(document.currentScript.src).origin;
    } catch {}
    return null;
  })();
  const API_BASE = (window.__LR__ && window.__LR__.apiBase) || scriptOrigin || window.location.origin;
  const PAGE_URL = window.location.href;
  const STORE_KEY = "lr:pins:" + PAGE_URL;

  try {
    window.CSS.registerProperty({ name: "--tencil-rim", syntax: "<angle>", inherits: false, initialValue: "0deg" });
  } catch {}

  const TENCIL_CSS = "__TENCIL_CSS__";


  const Icon = (size, ...paths) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.join("")}</svg>`;
  const ICONS = {
    comment: Icon(16, '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', '<path d="M12 8v8M8 12h8"/>'),
    eye: Icon(16, '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>', '<circle cx="12" cy="12" r="3"/>'),
    eyeOff: Icon(16, '<path d="M10.7 5.1A10.8 10.8 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/>', '<path d="M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/>', '<path d="M9.9 9.9a3 3 0 1 0 4.2 4.2M2 2l20 20"/>'),
    arrowUp: Icon(16, '<path d="m5 12 7-7 7 7M12 19V5"/>'),
    camera: Icon(14, '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>', '<circle cx="12" cy="13" r="3"/>'),
    check: Icon(13, '<path d="M20 6 9 17l-5-5"/>'),
    sliders: Icon(16, '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/>', '<path d="M1 14h6M9 8h6M17 16h6"/>'),
    code: Icon(12, '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>')
  };


  let pins = loadPins();
  const UI_LOCALES = {
    "en": {
      "pickHint": "Click any element to attach a prompt · Esc cancels",
      "adjustHint": "Click an element to adjust · Esc cancels",
      "commentTool": "Comment",
      "commentTitle": "Comment",
      "adjustTool": "Adjust",
      "adjustTitle": "Adjust",
      "composerPlaceholder": "What should change here?",
      "sendTitle": "Save annotation (Enter)",
      "shotOn": "Screenshot attached",
      "composerClose": "Close and cancel the comment",
      "attachesTo": "attaches to the session chat",
      "savedHint": "Saved — use Send on the card above the composer to dispatch",
      "saveFailed": "Failed to save: ",
      "editComment": "Edit the comment…",
      "saveEdit": "Save edit",
      "resolved": "Resolve",
      "reopen": "Reopen",
      "del": "Delete",
      "viewPending": "View pending annotations",
      "sendNow": "Send the annotations to the agent now",
      "sendBtn": "Send",
      "discard": "Discard annotations",
      "removePin": "Remove this pin",
      "noComment": "(no comment)",
      "panelClose": "Close (discards the preview)",
      "commentOptional": "Comment (optional when there are adjustments)",
      "cancelBtn": "Cancel",
      "confirmBtn": "✓ Confirm",
      "resetPrefix": "Restore · ",
      "dragHint": "drag to adjust",
      "presets": "presets",
      "linkOn": "Unlink values",
      "linkOff": "Link values",
      "rawHint": "raw value (CSS syntax)",
      "adjustSaved": "Adjustments saved — they attach to your next prompt",
      "deliveredToast": "Annotations delivered to the agent with your message",
      "secText": "Text",
      "secFill": "Fill",
      "secTypography": "Typography",
      "secSize": "Size & layout",
      "secSpacing": "Spacing",
      "secBorder": "Border",
      "secConstraints": "Constraints & position",
      "secEffects": "Effects",
      "sizeWH": "Width × Height",
      "marginQ": "Margin",
      "paddingQ": "Padding",
      "radiusQ": "Border radius",
      "styleBold": "Bold",
      "styleItalic": "Italic",
      "styleUnderline": "Underline",
      "shadowSX": "Offset X",
      "shadowSY": "Offset Y",
      "shadowBlur": "Blur",
      "shadowSpread": "Spread",
      "shadowColor": "Color",
      "shadowInset": "Inset",
      "tfTX": "Move X",
      "tfTY": "Move Y",
      "tfSX": "Scale X",
      "tfSY": "Scale Y",
      "tfRot": "Rotate",
      "alignL": "L",
      "alignC": "C",
      "alignR": "R",
      "alignJ": "J",
      "prop.color": "Text color",
      "prop.background-color": "Background",
      "prop.opacity": "Opacity",
      "prop.font-family": "Font",
      "prop.font-weight": "Weight",
      "prop.font-style": "Font style",
      "prop.font-size": "Font size",
      "prop.line-height": "Line height",
      "prop.letter-spacing": "Letter spacing",
      "prop.text-align": "Alignment",
      "prop.text-decoration": "Decoration",
      "prop.text-transform": "Case",
      "prop.width": "Width",
      "prop.height": "Height",
      "prop.min-width": "Min width",
      "prop.max-width": "Max width",
      "prop.min-height": "Min height",
      "prop.max-height": "Max height",
      "prop.display": "Display",
      "prop.position": "Position",
      "prop.top": "Top",
      "prop.right": "Right",
      "prop.bottom": "Bottom",
      "prop.left": "Left",
      "prop.z-index": "Layer",
      "prop.flex-direction": "Flex direction",
      "prop.flex-wrap": "Flex wrap",
      "prop.justify-content": "Justify content",
      "prop.align-items": "Align items",
      "prop.align-content": "Align content",
      "prop.gap": "Gap",
      "prop.row-gap": "Row gap",
      "prop.column-gap": "Column gap",
      "prop.overflow": "Overflow",
      "prop.margin-top": "Margin top",
      "prop.margin-right": "Margin right",
      "prop.margin-bottom": "Margin bottom",
      "prop.margin-left": "Margin left",
      "prop.padding-top": "Padding top",
      "prop.padding-right": "Padding right",
      "prop.padding-bottom": "Padding bottom",
      "prop.padding-left": "Padding left",
      "prop.border-width": "Border width",
      "prop.border-style": "Border style",
      "prop.border-color": "Border color",
      "prop.border-radius": "Border radius",
      "prop.box-shadow": "Shadow",
      "prop.transform": "Transform"
    },
    "pt": {
      "pickHint": "Clique em qualquer elemento para fixar um prompt · Esc cancela",
      "adjustHint": "Clique em um elemento para ajustar · Esc cancela",
      "commentTool": "Comentar",
      "commentTitle": "Comentar",
      "adjustTool": "Ajustar",
      "adjustTitle": "Ajustar",
      "composerPlaceholder": "What should change here?",
      "sendTitle": "Guardar anotação (Enter)",
      "shotOn": "Screenshot anexada",
      "composerClose": "Fechar e cancelar o comentário",
      "attachesTo": "anexa ao chat da sessão",
      "savedHint": "Guardada — use Enviar no card acima do composer para despachar",
      "saveFailed": "Falha ao guardar: ",
      "editComment": "Editar o comentário…",
      "saveEdit": "Salvar edição",
      "resolved": "✓ Resolvido",
      "reopen": "Reabrir",
      "del": "Excluir",
      "viewPending": "Ver as anotações pendentes",
      "sendNow": "Enviar as anotações ao agente agora",
      "sendBtn": "Enviar",
      "discard": "Descartar anotações",
      "removePin": "Remover este pin",
      "noComment": "(sem comentário)",
      "panelClose": "Fechar (descarta o preview)",
      "commentOptional": "Comentário (opcional quando há ajustes)",
      "cancelBtn": "Cancelar",
      "confirmBtn": "✓ Confirmar",
      "resetPrefix": "Restaurar · ",
      "dragHint": "arraste para ajustar",
      "presets": "predefinições",
      "linkOn": "Desvincular valores",
      "linkOff": "Vincular valores",
      "rawHint": "valor bruto (sintaxe CSS)",
      "adjustSaved": "Ajustes guardados — anexam ao seu próximo prompt",
      "deliveredToast": "Anotações entregues ao agente com sua mensagem",
      "secText": "Texto",
      "secFill": "Preenchimento",
      "secTypography": "Tipografia",
      "secSize": "Tamanho e layout",
      "secSpacing": "Espaçamento",
      "secBorder": "Borda",
      "secConstraints": "Restrições e posição",
      "secEffects": "Efeitos",
      "sizeWH": "Largura × Altura",
      "marginQ": "Margem",
      "paddingQ": "Padding",
      "radiusQ": "Raio da borda",
      "styleBold": "Negrito",
      "styleItalic": "Itálico",
      "styleUnderline": "Sublinhado",
      "shadowSX": "Deslocamento X",
      "shadowSY": "Deslocamento Y",
      "shadowBlur": "Desfoque",
      "shadowSpread": "Espalhar",
      "shadowColor": "Cor",
      "shadowInset": "Interna",
      "tfTX": "Deslocar X",
      "tfTY": "Deslocar Y",
      "tfSX": "Escala X",
      "tfSY": "Escala Y",
      "tfRot": "Rotação",
      "alignL": "E",
      "alignC": "C",
      "alignR": "D",
      "alignJ": "J",
      "prop.color": "Cor do texto",
      "prop.background-color": "Cor de fundo",
      "prop.opacity": "Opacidade",
      "prop.font-family": "Fonte",
      "prop.font-weight": "Peso",
      "prop.font-style": "Estilo da fonte",
      "prop.font-size": "Tamanho da fonte",
      "prop.line-height": "Altura da linha",
      "prop.letter-spacing": "Entre letras",
      "prop.text-align": "Alinhamento",
      "prop.text-decoration": "Decoração",
      "prop.text-transform": "Maiúsculas",
      "prop.width": "Largura",
      "prop.height": "Altura",
      "prop.min-width": "Largura mín.",
      "prop.max-width": "Largura máx.",
      "prop.min-height": "Altura mín.",
      "prop.max-height": "Altura máx.",
      "prop.display": "Display",
      "prop.position": "Posição",
      "prop.top": "Topo",
      "prop.right": "Direita",
      "prop.bottom": "Baixo",
      "prop.left": "Esquerda",
      "prop.z-index": "Camada",
      "prop.flex-direction": "Direção do flex",
      "prop.flex-wrap": "Quebra do flex",
      "prop.justify-content": "Justificar",
      "prop.align-items": "Alinhar itens",
      "prop.align-content": "Alinhar conteúdo",
      "prop.gap": "Espaço",
      "prop.row-gap": "Entre linhas",
      "prop.column-gap": "Entre colunas",
      "prop.overflow": "Overflow",
      "prop.margin-top": "Margem topo",
      "prop.margin-right": "Margem direita",
      "prop.margin-bottom": "Margem baixo",
      "prop.margin-left": "Margem esquerda",
      "prop.padding-top": "Padding topo",
      "prop.padding-right": "Padding direita",
      "prop.padding-bottom": "Padding baixo",
      "prop.padding-left": "Padding esquerda",
      "prop.border-width": "Espessura da borda",
      "prop.border-style": "Estilo da borda",
      "prop.border-color": "Cor da borda",
      "prop.border-radius": "Raio da borda",
      "prop.box-shadow": "Sombra",
      "prop.transform": "Transformação"
    },
    "zh": {
      "pickHint": "点击页面元素以附加提示 · Esc 取消",
      "adjustHint": "点击要调整的元素 · Esc 取消",
      "commentTool": "评论",
      "commentTitle": "评论",
      "adjustTool": "调整",
      "adjustTitle": "调整",
      "composerPlaceholder": "这里要改什么？",
      "sendTitle": "保存标注 (Enter)",
      "shotOn": "已附加截图",
      "composerClose": "关闭并取消评论",
      "attachesTo": "附加到会话聊天",
      "savedHint": "已保存 — 使用 composer 上方卡片的发送按钮派发",
      "saveFailed": "保存失败：",
      "editComment": "编辑评论…",
      "saveEdit": "保存编辑",
      "resolved": "标记已解决",
      "reopen": "重新打开",
      "del": "删除",
      "viewPending": "查看待发送标注",
      "sendNow": "立即把标注发送给智能体",
      "sendBtn": "发送",
      "discard": "丢弃标注",
      "removePin": "移除此标注",
      "noComment": "（无评论）",
      "panelClose": "关闭（放弃预览）",
      "commentOptional": "评论（有调整时可选）",
      "cancelBtn": "取消",
      "confirmBtn": "✓ 确认",
      "resetPrefix": "恢复 · ",
      "dragHint": "拖动调整",
      "presets": "预设",
      "linkOn": "取消关联",
      "linkOff": "关联数值",
      "rawHint": "原始值（CSS 语法）",
      "adjustSaved": "调整已保存 — 将附加到你的下一个提示",
      "deliveredToast": "标注已随消息发送给智能体",
      "secText": "文本",
      "secFill": "填充",
      "secTypography": "排版",
      "secSize": "尺寸与布局",
      "secSpacing": "间距",
      "secBorder": "边框",
      "secConstraints": "约束与定位",
      "secEffects": "效果",
      "sizeWH": "宽 × 高",
      "marginQ": "外边距",
      "paddingQ": "内边距",
      "radiusQ": "圆角",
      "styleBold": "粗体",
      "styleItalic": "斜体",
      "styleUnderline": "下划线",
      "shadowSX": "水平偏移",
      "shadowSY": "垂直偏移",
      "shadowBlur": "模糊",
      "shadowSpread": "扩展",
      "shadowColor": "颜色",
      "shadowInset": "内阴影",
      "tfTX": "水平位移",
      "tfTY": "垂直位移",
      "tfSX": "水平缩放",
      "tfSY": "垂直缩放",
      "tfRot": "旋转",
      "alignL": "左",
      "alignC": "中",
      "alignR": "右",
      "alignJ": "两端",
      "prop.color": "文字颜色",
      "prop.background-color": "背景色",
      "prop.opacity": "不透明度",
      "prop.font-family": "字体",
      "prop.font-weight": "字重",
      "prop.font-style": "字形",
      "prop.font-size": "字号",
      "prop.line-height": "行高",
      "prop.letter-spacing": "字间距",
      "prop.text-align": "对齐",
      "prop.text-decoration": "文本装饰",
      "prop.text-transform": "大小写转换",
      "prop.width": "宽度",
      "prop.height": "高度",
      "prop.min-width": "最小宽度",
      "prop.max-width": "最大宽度",
      "prop.min-height": "最小高度",
      "prop.max-height": "最大高度",
      "prop.display": "显示",
      "prop.position": "定位",
      "prop.top": "上",
      "prop.right": "右",
      "prop.bottom": "下",
      "prop.left": "左",
      "prop.z-index": "层级",
      "prop.flex-direction": "Flex 方向",
      "prop.flex-wrap": "Flex 换行",
      "prop.justify-content": "主轴对齐",
      "prop.align-items": "交叉轴对齐",
      "prop.align-content": "内容对齐",
      "prop.gap": "间距",
      "prop.row-gap": "行间距",
      "prop.column-gap": "列间距",
      "prop.overflow": "溢出",
      "prop.margin-top": "上外边距",
      "prop.margin-right": "右外边距",
      "prop.margin-bottom": "下外边距",
      "prop.margin-left": "左外边距",
      "prop.padding-top": "上内边距",
      "prop.padding-right": "右内边距",
      "prop.padding-bottom": "下内边距",
      "prop.padding-left": "左内边距",
      "prop.border-width": "边框宽度",
      "prop.border-style": "边框样式",
      "prop.border-color": "边框颜色",
      "prop.border-radius": "圆角",
      "prop.box-shadow": "阴影",
      "prop.transform": "变换"
    }
  };
  const SETTINGS = (() => { try { return window.__LR__?.settings ?? {}; } catch { return {}; } })();
  const UI_LANG = (() => {
    if (SETTINGS.lang && SETTINGS.lang !== "auto") return SETTINGS.lang;
    const l = (navigator.language || "en").toLowerCase();
    return l.startsWith("pt") ? "pt" : l.startsWith("zh") ? "zh" : "en";
  })();
  const KEY_COMMENT = (typeof SETTINGS.keys?.comment === "string" ? SETTINGS.keys.comment : "c").toLowerCase();
  const KEY_ADJUST = (typeof SETTINGS.keys?.adjust === "string" ? SETTINGS.keys.adjust : "v").toLowerCase();
  const t = (key) => UI_LOCALES[UI_LANG][key] ?? UI_LOCALES.en[key] ?? key;
  let mode = null;
  let hovered = null;
  let draft = null;
  let openPinId = null;
  let screenshotOnSend = SETTINGS.screenshot === false ? false : true;
  let html2canvasReady = null;
  let lastStatusAt = "";
  let hidden = false;
  let lastAgentActivity = 0;

  function loadPins() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }
  function savePins() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(pins));
    } catch {}
  }


  function cssPath(el) {
    if (!(el instanceof Element)) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      let index = 1;
      let sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (sib.localName === node.localName) index += 1;
      }
      parts.unshift(`${node.localName}:nth-of-type(${index})`);
      node = node.parentElement;
    }
    return parts.length === 0 ? "body" : `body ${parts.join(" > ")}`;
  }

  function locate(selector) {
    if (typeof selector !== "string" || selector === "") return null;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function quickLabel(el) {
    const component = reactComponentName(el);
    const tag = `${el.localName}${el.id ? `#${el.id}` : ""}`;
    return component ? `${component} · ${tag}` : tag;
  }

  function reactComponentName(el) {
    try {
      let node = el;
      for (let depth = 0; node && depth < 10; depth += 1) {
        const fiberKey = Object.keys(node).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternal$"));
        if (fiberKey) {
          let fiber = node[fiberKey];
          for (let hop = 0; fiber && hop < 8; hop += 1) {
            const type = fiber.type ?? fiber.elementType;
            const name = typeof type === "function" ? type.displayName || type.name : null;
            if (name && !name.startsWith("_")) return name;
            fiber = fiber.return;
          }
        }
        node = node.parentElement;
      }
    } catch {}
    return null;
  }


  const host = document.createElement("div");
  host.id = "dsh-redline-host";
  const shadow = host.attachShadow({ mode: "open" });
  const rootDiv = el("div", { class: "root dark" });
  const styleEl = document.createElement("style");
  styleEl.textContent = TENCIL_CSS + `
    .lr-close { all: unset; cursor: pointer; margin-left: auto; width: 20px; height: 20px;
      display: inline-flex; align-items: center; justify-content: center; border-radius: 6px;
      color: var(--n-500); font-size: 12px; }
    .lr-close:hover { background: var(--n-100); color: var(--n-950); }
    .pin-bubble-body { padding: 0 10px 8px; color: var(--n-950); }
    .pin-bubble-meta { color: var(--n-500); font-size: 11px; word-break: break-all; margin-bottom: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .pin-bubble-changes { color: var(--n-600); font-size: 11px; margin-top: 4px; }
    .pin-bubble-actions { display: flex; gap: 6px; padding: 6px 10px 10px; }
    .pin-bubble-actions button { all: unset; cursor: pointer; padding: 3px 10px; border-radius: 8px;
      font-size: 12px; background: var(--n-100); color: var(--n-950); }
    .pin-bubble-actions button:hover { background: var(--n-200); }
    .pin-bubble-actions .danger { color: var(--error); }

    .lr-insp { width: 372px; max-width: calc(100vw - 24px); }
    .lr-insp-sub { color: var(--n-500); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .lr-comment { all: unset; box-sizing: border-box; display: block; width: calc(100% - 20px); margin: 6px auto 0; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--n-100); color: var(--n-950); font-size: 12px; font-family: inherit; resize: vertical; min-height: 40px; }
    .lr-comment:focus { border-color: var(--accent); }
    .lr-insp-body { max-height: min(56vh, 540px); overflow-y: auto; padding: 2px 10px 8px; }
    .lr-sec { border-top: 1px solid var(--n-100); padding: 1px 0; }
    .lr-sec:first-child { border-top: none; }
    .lr-sec-head { all: unset; box-sizing: border-box; display: flex; width: 100%; cursor: pointer; align-items: center; justify-content: space-between; padding: 8px 2px; font-size: 12px; font-weight: 600; color: var(--n-700); }
    .lr-sec-head:hover { color: var(--n-900); }
    .lr-sec-chev { color: var(--n-500); font-size: 10px; transition: transform .15s; }
    .lr-sec[data-open] .lr-sec-chev { transform: rotate(180deg); }
    .lr-sec-body { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 8px; }
    .lr-row { display: flex; align-items: center; gap: 8px; min-height: 28px; }
    .lr-row-wide { flex-direction: column; align-items: stretch; gap: 4px; }
    .lr-row-label { flex: none; width: 88px; font-size: 11px; color: var(--n-500); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lr-row-static { display: block; }
    .lr-row-static .lr-row-label { width: auto; font-weight: 600; color: var(--n-600); padding-bottom: 4px; }
    .lr-row-ctl { flex: 1; display: flex; align-items: center; gap: 6px; min-width: 0; justify-content: flex-end; }
    .lr-row-wide .lr-row-ctl { justify-content: flex-start; }
    .lr-reset { all: unset; cursor: pointer; flex: none; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 6px; color: var(--accent); font-size: 13px; }
    .lr-reset:hover { background: var(--n-200); }
    .lr-field { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 26px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--n-100); color: var(--n-950); font-size: 12px; font-family: inherit; }
    .lr-field:focus { border-color: var(--accent); }
    .lr-field-num { width: 78px; flex: none; text-align: right; }
    .lr-textarea { height: auto; min-height: 44px; padding: 6px 8px; resize: vertical; font-family: inherit; }
    .lr-invalid { border-color: var(--error) !important; }
    .lr-scrub { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
    .lr-handle { all: unset; box-sizing: border-box; cursor: ew-resize; flex: none; width: 22px; height: 26px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--line); background: var(--n-100); color: var(--n-500); font-size: 10px; user-select: none; touch-action: none; }
    .lr-handle:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .lr-handle:disabled { opacity: .4; cursor: default; }
    .lr-menu { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 26px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--n-100); color: var(--n-950); font-size: 12px; cursor: pointer; }
    .lr-menu:focus { border-color: var(--accent); }
    .lr-scrub .lr-menu { flex: none; width: 64px; }
    .lr-color { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; }
    .lr-swatch { position: relative; flex: none; width: 26px; height: 26px; border-radius: 8px; border: 1px solid var(--n-700); overflow: hidden; cursor: pointer; }
    .lr-swatch input { position: absolute; inset: -8px; width: 44px; height: 44px; border: none; padding: 0; cursor: pointer; background: none; }
    .lr-seg { display: inline-flex; border: 1px solid var(--n-700); border-radius: 8px; overflow: hidden; }
    .lr-seg button { all: unset; cursor: pointer; padding: 4px 9px; font-size: 11px; color: var(--n-600); border-left: 1px solid var(--line); }
    .lr-seg button:first-child { border-left: none; }
    .lr-seg button:hover { color: var(--n-100); background: var(--n-100); }
    .lr-seg button[data-on] { background: var(--accent); color: #fff; }
    .lr-tgl { all: unset; box-sizing: border-box; cursor: pointer; min-width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--line); background: var(--n-100); color: var(--n-700); font-size: 12px; font-weight: 700; }
    .lr-tgl:hover { border-color: var(--accent); }
    .lr-tgl[data-on] { background: var(--accent); border-color: var(--accent); color: #fff; }
    .lr-quad-wrap { display: flex; align-items: flex-start; gap: 6px; flex: 1; min-width: 0; }
    .lr-quad { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; flex: 1; min-width: 0; }
    .lr-cell { display: flex; align-items: center; min-width: 0; }
    .lr-cell .lr-scrub { flex: 1; }
    .lr-link-cell { flex: none; padding-top: 1px; }
    .lr-link { all: unset; cursor: pointer; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--line); color: var(--n-500); }
    .lr-link:hover { border-color: var(--accent); color: var(--accent); }
    .lr-link[data-on] { color: var(--accent); border-color: var(--accent); }
    .lr-size { display: flex; align-items: flex-start; gap: 6px; flex: 1; min-width: 0; }
    .lr-effect { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    .lr-effect-row { display: flex; align-items: center; gap: 8px; }
    .lr-effect-label { flex: none; width: 70px; font-size: 11px; color: var(--n-400); }
    .lr-rawhint { font-size: 10px; color: var(--n-500); }
    .lr-footer { display: flex; gap: 8px; padding: 8px 10px 10px; border-top: 1px solid var(--n-100); }
    .lr-cancel { all: unset; cursor: pointer; flex: 1; height: 30px; border-radius: 10px; background: var(--n-100); color: var(--n-200); font-size: 12px; display: grid; place-items: center; }
    .lr-cancel:hover { background: var(--n-200); color: var(--n-100); }
    .lr-confirm { all: unset; cursor: pointer; flex: 1; height: 30px; border-radius: 10px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 600; display: grid; place-items: center; }
    .lr-confirm:hover { filter: brightness(1.1); }
    .lr-confirm[data-disabled] { opacity: .45; pointer-events: none; }
  `;
  const absLayer = document.createElement("div");
  absLayer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483600;";
  const fixedLayer = document.createElement("div");
  fixedLayer.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483600;";
  shadow.append(styleEl, rootDiv);
  rootDiv.append(absLayer, fixedLayer);

  function mountShadow() {
    if (host.parentNode === document.documentElement) return;
    document.documentElement.appendChild(host);
    installKeyShield();
  }








  let keyShieldInstalled = false;
  function installKeyShield() {
    if (keyShieldInstalled) return;
    keyShieldInstalled = true;
    const stop = (e) => e.stopPropagation();
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, stop, false);
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (typeof child === "string" && child.startsWith("<svg")) {
        const icon = document.createElement("span");
        icon.style.display = "inline-flex";
        icon.innerHTML = child;
        node.append(icon);
      } else {
        node.append(child);
      }
    }
    return node;
  }


  const wrap = el("div", { class: "toolbar-wrap dock-bottom-center" });
  const hint = el("div", { class: "toolbar-hint", style: "display:none" });
  const toolbar = el("div", { class: "toolbar" });
  const statusDot = el("span", { class: "status-dot status-ok", title: "Live Review ativo" });
  const divider = el("button", { class: "divider", title: "Mover (arraste)", "aria-label": "Mover toolbar" });
  const commentBtn = el("button", { class: "tool", title: t("commentTitle") + " (" + KEY_COMMENT.toUpperCase() + ")", html: ICONS.comment }, el("span", { class: "tool-label" }, t("commentTool")), el("kbd", {}, KEY_COMMENT.toUpperCase()));
  const pendingSpan = el("span", { class: "tool-label", style: "display:none", title: "Anotações aguardando seu próximo prompt no chat" }, "0 pendente(s)");
  const adjustBtn = el("button", { class: "tool", title: t("adjustTitle") + " (" + KEY_ADJUST.toUpperCase() + ")", html: ICONS.sliders }, el("span", { class: "tool-label" }, t("adjustTool")));
  const eyeBtn = el("button", { class: "tool", title: "Mostrar/ocultar pins", html: ICONS.eye });
  toolbar.append(statusDot, divider, commentBtn, pendingSpan, adjustBtn, eyeBtn);
  wrap.append(hint, toolbar);
  rootDiv.append(wrap);

  function setHint(text) {
    if (!text) {
      hint.style.display = "none";
      return;
    }
    hint.textContent = text;
    hint.style.display = "block";
  }

  function updateToolbar() {
    const pending = pins.filter((p) => p.status === "queued").length;
    commentBtn.classList.toggle("tool-active", mode === "picking");
    adjustBtn.classList.toggle("tool-active", mode === "adjust");
    pendingSpan.textContent = pending > 0 ? `${pending} pendente(s)` : "";
    pendingSpan.style.display = pending > 0 ? "" : "none";
    eyeBtn.innerHTML = hidden ? ICONS.eyeOff : ICONS.eye;
    absLayer.style.display = hidden ? "none" : "";
  }


  let highlightEl = null;
  let highlightLabel = null;
  function clearHighlight() {
    highlightEl?.remove();
    highlightLabel?.remove();
    highlightEl = null;
    highlightLabel = null;
    hovered = null;
  }
  function showHighlight(target) {
    clearHighlight();
    const box = target.getBoundingClientRect();
    hovered = target;
    highlightEl = el("div", { class: "highlight" });
    Object.assign(highlightEl.style, { transform: `translate(${box.left}px, ${box.top}px)`, width: `${box.width}px`, height: `${box.height}px` });
    const below = box.top < 28;
    highlightLabel = el(
      "div",
      { class: "highlight-label" },
      quickLabel(target),
      el("span", { class: "highlight-size" }, `${Math.round(box.width)}×${Math.round(box.height)}`)
    );
    highlightLabel.style.transform = `translate(${Math.max(4, box.left)}px, ${below ? box.bottom + 6 : box.top - 26}px)`;
    fixedLayer.append(highlightEl, highlightLabel);
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      if (mode === null || draft !== null) return;
      if (event.composedPath().some((n) => n === host || (n instanceof Node && host.contains(n)))) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target === hovered) return;
      showHighlight(target);
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (mode === null || draft !== null) return;
      if (event.composedPath().some((n) => n === host || (n instanceof Node && host.contains(n)))) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (mode === "picking") {
        openDraft(target, event);

        setMode(null);
      } else if (mode === "adjust") {
        openAdjustPanel(target);
        setMode(null);
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (event) => {
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (event.key === KEY_COMMENT || event.key === KEY_COMMENT.toUpperCase()) setMode(mode === "picking" ? null : "picking");
      if (event.key === KEY_ADJUST || event.key === KEY_ADJUST.toUpperCase()) setMode(mode === "adjust" ? null : "adjust");
      if (event.key === "Escape") {
        if (adjustPanel !== null) {
          closeAdjustPanel(true);
          return;
        }
        if (draft !== null) {
          draft = null;
          renderDraft();
        } else if (mode !== null) setMode(null);
      }
    },
    true
  );

  function setMode(next) {
    mode = mode === next ? null : next;
    if (mode !== "picking" && mode !== "adjust") clearHighlight();
    if (mode === "picking") {
      setHint(t("pickHint"));
      closePanels();
    } else if (mode === "adjust") {
      setHint(t("adjustHint"));
      closePanels();
    } else {
      setHint(null);
    }
    updateToolbar();
  }
  commentBtn.addEventListener("click", () => setMode("picking"));
  adjustBtn.addEventListener("click", () => setMode("adjust"));
  eyeBtn.addEventListener("click", () => {
    hidden = !hidden;
    updateToolbar();
  });


  function pinVariant(pin) {
    if (pin.status === "resolvido") return "resolved";
    if (pin.status === "done") return "done";
    if (pin.status === "enviado") {
      const quiet = Date.now() - lastAgentActivity > 25000;
      return quiet ? "done" : "working";
    }
    return "queued";
  }

  function anchorPoint(pin) {
    const element = locate(pin.selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const ox = Math.min(Math.max(0, pin.offsets?.ox ?? rect.width / 2), rect.width);
    const oy = Math.min(Math.max(0, pin.offsets?.oy ?? rect.height / 2), rect.height);
    return { x: rect.left + ox + window.scrollX, y: rect.top + oy + window.scrollY };
  }

  function draftPoint() {
    if (!draft) return null;
    const rect = draft.anchorEl.getBoundingClientRect();
    const ox = Math.min(Math.max(0, draft.offsets.ox), rect.width);
    const oy = Math.min(Math.max(0, draft.offsets.oy), rect.height);
    return { x: rect.left + ox, y: rect.top + oy };
  }

  const pinNodes = new Map();

  function renderPins() {
    mountShadow();
    const alive = new Set();
    if (!hidden) {
      for (const pin of pins) {
        if (pin.status === "resolvido") continue;
        alive.add(pin.id);
        let node = pinNodes.get(pin.id)?.node;
        const point = anchorPoint(pin) ?? { x: pin.rect.x, y: pin.rect.y };
        if (!node) {
          node = el("button", { class: "pin", title: pin.comment });
          node.append(el("span", { class: "pin-body" }, ""));
          node.addEventListener("click", () => {
            openPinId = openPinId === pin.id ? null : pin.id;
            renderPinPanel(pin);
            renderPins();
          });
          wirePinDrag(node, pin);
          absLayer.append(node);
          pinNodes.set(pin.id, { node });
        }
        node.className = `pin pin-${pinVariant(pin)}${openPinId === pin.id ? " pin-open" : ""}`;
        node.style.transform = `translate(${point.x}px, ${point.y}px)`;
        const number = pins.filter((p) => p.status !== "resolvido").indexOf(pin) + 1;
        const glyph = pin.status === "resolvido" ? ICONS.check : String(number || "•");
        node.querySelector(".pin-body").innerHTML = `<span class="pin-glyph">${glyph}</span>`;
      }
    }
    for (const [id, entry] of [...pinNodes]) {
      if (!alive.has(id)) {
        entry.node.remove();
        pinNodes.delete(id);
      }
    }
    updateToolbar();
  }

  function repositionPins() {
    for (const [id, entry] of pinNodes) {
      const pin = pins.find((p) => p.id === id);
      if (!pin) continue;
      const point = anchorPoint(pin);
      if (point) entry.node.style.transform = `translate(${point.x}px, ${point.y}px)`;
    }
    if (draft !== null) renderDraft();
  }
  window.addEventListener("scroll", repositionPins, { passive: true });
  window.addEventListener("resize", repositionPins);
  let mutationTimer = null;
  new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(repositionPins, 400);
  }).observe(document.body ?? document.documentElement, { childList: true, subtree: true, attributes: true });


  const DRAG_THRESHOLD = 4;
  function wirePinDrag(node, pin) {
    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        node.setPointerCapture(event.pointerId);
      } catch {}
      const startX = event.clientX;
      const startY = event.clientY;
      let dragged = false;
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragged = true;
        const point = insidePage({ x: moveEvent.clientX, y: moveEvent.clientY });
        node.style.transform = `translate(${point.x}px, ${point.y}px)`;
      };
      const end = (endEvent) => {
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", end);
        node.removeEventListener("pointercancel", end);
        if (!dragged) return;
        const point = insidePage({ x: endEvent.clientX, y: endEvent.clientY });
        const element = document.elementsFromPoint(point.x, point.y).find((n) => n !== host && n !== document.documentElement) ?? document.body;
        pin.selector = cssPath(element);
        const rect = element.getBoundingClientRect();
        pin.offsets = { ox: point.x - rect.left, oy: point.y - rect.top };
        pin.rect = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
        savePins();
        renderPins();
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", end);
      node.addEventListener("pointercancel", end);
    });
  }

  function insidePage(point) {
    return {
      x: Math.max(0, Math.min(point.x, document.documentElement.clientWidth - 1)),
      y: Math.max(0, Math.min(point.y, document.documentElement.clientHeight - 1))
    };
  }


  let draftNode = null;
  let composerNode = null;

  function renderDraft() {
    draftNode?.remove();
    composerNode?.remove();
    draftNode = null;
    composerNode = null;
    if (draft === null) return;
    mountShadow();
    const point = draftPoint();
    draftNode = el("div", { class: "pin pin-draft pin-open" });
    draftNode.style.transform = `translate(${point.x}px, ${point.y}px)`;
    draftNode.append(el("span", { class: "pin-body" }, "+"));
    absLayer.append(draftNode);

    const WIDTH = 320;
    const left = Math.min(Math.max(8, point.x + 16), window.innerWidth - WIDTH - 8);
    const top = Math.min(Math.max(8, point.y - 46), window.innerHeight - 240);
    composerNode = el("div", { class: "popover composer", style: `width:${WIDTH}px;transform-origin:top left;left:${left}px;top:${top}px` });
    const textarea = el("textarea", { placeholder: "What should change here?" });
    const submit = el("button", { class: "send", title: t("sendTitle") }, ICONS.arrowUp);
    const shotToggle = el("button", { class: `toggle${screenshotOnSend ? " toggle-on" : ""}`, title: t("shotOn"), html: ICONS.camera });
    shotToggle.addEventListener("click", () => {
      screenshotOnSend = !screenshotOnSend;
      shotToggle.classList.toggle("toggle-on", screenshotOnSend);
    });
    submit.addEventListener("click", () => submitDraft());
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitDraft();
      }
      if (e.key === "Escape") {
        draft = null;
        renderDraft();
      }
    });
    composerNode.append(
      el(
        "div",
        { class: "composer-target" },
        el("span", { class: "chip" }, ICONS.code, `${draft.label}`),
        el("span", { class: "composer-provider" }, el("span", { class: "composer-provider-label" }, t("attachesTo"))),
        el("button", { class: "lr-close", title: t("composerClose"), onclick: () => { draft = null; renderDraft(); } }, "✕")
      ),
      el("div", { class: "prompt-input" }, textarea, el("div", { class: "prompt-actions" }, el("div", { class: "prompt-extras" }, shotToggle), submit))
    );
    fixedLayer.append(composerNode);
    textarea.focus({ preventScroll: true });
  }

  function openDraft(target, event) {
    const rect = target.getBoundingClientRect();
    draft = {
      anchorEl: target,
      selector: cssPath(target),
      label: quickLabel(target),
      component: reactComponentName(target),
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      offsets: { ox: event ? event.clientX - rect.left : rect.width / 2, oy: event ? event.clientY - rect.top : rect.height / 2 }
    };
    renderDraft();
  }

  async function submitDraft() {
    const textarea = composerNode?.querySelector("textarea");
    const comment = (textarea?.value ?? "").trim();
    if (comment === "" || draft === null) return;
    const rect = draft.anchorEl.getBoundingClientRect();
    let shot = null;


    if (screenshotOnSend) shot = await captureCropFor({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    pins.push({
      id: crypto.randomUUID(),
      tag: draft.anchorEl.localName,
      role: draft.anchorEl.getAttribute?.("role") ?? "",
      label: draft.anchorEl.getAttribute?.("aria-label") ?? "",
      selector: draft.selector,
      text: (draft.anchorEl.textContent ?? "").trim().slice(0, 300),
      component: draft.component ?? "",
      comment,
      changes: [],
      pageUrl: PAGE_URL,
      rect: draft.rect,
      offsets: draft.offsets,
      shot,
      status: "queued",
      at: Date.now()
    });
    savePins();
    draft = null;
    renderDraft();
    renderPins();
    await postSnapshot();
  }

  async function postSnapshot() {
    const queued = pins.filter((p) => p.status === "queued");
    const payload = {
      pageUrl: PAGE_URL,
      pageTitle: document.title,
      pins: queued.map((p) => ({
        id: p.id,
        tag: p.tag,
        role: p.role,
        label: p.label,
        selector: p.selector,
        text: p.text,
        component: p.component,
        comment: p.comment,
        changes: p.changes,
        textChange: p.textChange ?? null,
        rect: p.rect,
        shot: p.shot ?? null
      }))
    };
    try {
      const response = await fetch(`${API_BASE}/.lr/annotations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(data.error ?? `HTTP ${response.status}`);
      setHint(t("savedHint"), 4200);
      updateToolbar();
    } catch (error) {
      toast(`Falha ao guardar: ${String(error).slice(0, 80)}`);
    }
  }


  function ensureHtml2Canvas() {
    if (html2canvasReady !== null) return html2canvasReady;
    html2canvasReady = new Promise((resolve) => {
      if (typeof window.html2canvas === "function") return resolve(true);
      const script = document.createElement("script");
      script.src = `${API_BASE}/.lr/vendor/html2canvas.min.js`;
      script.onload = () => resolve(typeof window.html2canvas === "function");
      script.onerror = () => resolve(false);
      document.head.append(script);
    });
    return html2canvasReady;
  }





  const CROP_PAD = 72;
  const CROP_MAX_EDGE = 900;

  async function captureCropFor(rect, cropPad = CROP_PAD) {
    const ok = await ensureHtml2Canvas();
    if (!ok || typeof window.html2canvas !== "function") return null;
    try {
      const canvas = await window.html2canvas(document.body, {
        backgroundColor: "#ffffff",
        scale: Math.min(1, 1600 / window.innerWidth),
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        useCORS: true,
        ignoreElements: (element) => element.id === "dsh-redline-host"
      });
      return cropCanvas(canvas, rect);
    } catch {
      return null;
    }
  }

  function cropCanvas(canvas, rect) {
    try {
      const scale = canvas.width / Math.max(1, window.innerWidth);
      let sx = (rect.x - cropPad) * scale;
      let sy = (rect.y - cropPad) * scale;
      let sw = (rect.w + cropPad * 2) * scale;
      let sh = (rect.h + cropPad * 2) * scale;
      sx = Math.max(0, Math.min(sx, canvas.width - 1));
      sy = Math.max(0, Math.min(sy, canvas.height - 1));
      sw = Math.max(32, Math.min(sw, canvas.width - sx));
      sh = Math.max(32, Math.min(sh, canvas.height - sy));
      const shrink = Math.min(1, CROP_MAX_EDGE / Math.max(sw, sh));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(sw * shrink));
      out.height = Math.max(1, Math.round(sh * shrink));
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", 0.8);
    } catch {
      return null;
    }
  }


  let pinPanelNode = null;
  let adjustPanel = null;
  let adjustTarget = null;

  function renderPinPanel(pin) {
    pinPanelNode?.remove();
    pinPanelNode = null;
    if (openPinId !== pin.id) return;
    mountShadow();
    const point = anchorPoint(pin) ?? { x: pin.rect.x, y: pin.rect.y };
    const panel = el("div", { class: "popover composer", style: "width:320px" });
    const changesText = pin.changes.map((c) => `${c.prop}: ${c.before} → ${c.after}`).join(" · ");
    const textChangeText = pin.textChange ? `texto: "${pin.textChange.before}" → "${pin.textChange.after}"` : "";
    const textarea = el("textarea", { placeholder: t("editComment") });
    textarea.value = pin.comment;
    const submit = el("button", { class: "send", title: t("saveEdit") }, ICONS.arrowUp);
    submit.addEventListener("click", () => {
      pin.comment = textarea.value.trim() || pin.comment;
      pin.status = "queued";
      savePins();
      postSnapshot();
      openPinId = null;
      renderPinPanel(pin);
      renderPins();
    });
    panel.append(
      el("div", { class: "composer-target" }, el("span", { class: "chip" }, ICONS.code, `${pins.filter((p) => p.status !== "resolvido").indexOf(pin) + 1} · ${quickLabel(locate(pin.selector) ?? pin.tag)}`)),
      el("div", { class: "pin-bubble-body" }, el("div", { class: "pin-bubble-meta" }, `${pin.selector.slice(0, 90)}${pin.component ? ` · ${pin.component}` : ""}`), changesText !== "" ? el("div", { class: "pin-bubble-changes" }, changesText) : null, textChangeText !== "" ? el("div", { class: "pin-bubble-changes" }, textChangeText) : null),
      el("div", { class: "prompt-input" }, textarea, el("div", { class: "prompt-actions" }, el("div", { class: "prompt-extras" }), submit)),
      el(
        "div",
        { class: "pin-bubble-actions" },
        el("button", {
          onclick: () => {
            pin.status = pin.status === "resolvido" ? "queued" : "resolvido";
            savePins();
            openPinId = null;
            renderPinPanel(pin);
            renderPins();
          }
        }, pin.status === "resolvido" ? t("reopen") : t("resolved")),
        el("button", {
          class: "danger",
          onclick: () => {
            pins = pins.filter((x) => x !== pin);
            savePins();
            openPinId = null;
            renderPins();
          }
        }, t("del"))
      )
    );
    const left = Math.min(Math.max(8, point.x + 16), window.innerWidth - 336);
    const top = Math.min(Math.max(8, point.y - 40), window.innerHeight - 280);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    pinPanelNode = panel;
    rootDiv.append(panel);
  }








  const EDITABLE_PROPS = ["color","background-color","opacity","font-family","font-size","font-weight","font-style","line-height","letter-spacing","text-align","text-decoration","text-transform","width","height","min-width","max-width","min-height","max-height","display","position","top","right","bottom","left","z-index","flex-direction","flex-wrap","justify-content","align-items","align-content","gap","row-gap","column-gap","overflow","margin-top","margin-right","margin-bottom","margin-left","padding-top","padding-right","padding-bottom","padding-left","border-width","border-style","border-color","border-radius","box-shadow","transform"];
  const PROP_META = {
    "color": { label: "Cor do texto", kind: "color" },
    "background-color": { label: "Cor de fundo", kind: "color" },
    "opacity": { label: "Opacidade", kind: "number", step: 0.01, min: 0, max: 1, glyph: "%" },
    "font-family": { label: "Fonte", kind: "menu", options: ["Inter, sans-serif","system-ui, sans-serif","Arial, sans-serif","Helvetica, sans-serif","Roboto, sans-serif","Georgia, serif","Times New Roman, serif","ui-monospace, monospace"] },
    "font-weight": { label: "Peso", kind: "menu", options: ["100","200","300","400","500","600","700","800","900"] },
    "font-style": { label: "Estilo da fonte", kind: "menu", options: ["normal","italic","oblique"] },
    "font-size": { label: "Tamanho da fonte", kind: "number", step: 1, min: 0, glyph: "S", options: ["small","medium","large","x-large","smaller","larger"] },
    "line-height": { label: "Altura da linha", kind: "number", step: 1, min: 0, glyph: "↕", options: ["normal"] },
    "letter-spacing": { label: "Entre letras", kind: "number", step: 0.1, glyph: "↔", options: ["normal"] },
    "text-align": { label: "Alinhamento", kind: "menu", options: ["left","center","right","justify","start","end"] },
    "text-decoration": { label: "Decoração", kind: "menu", options: ["none","underline","line-through","overline"] },
    "text-transform": { label: "Maiúsculas", kind: "menu", options: ["none","uppercase","lowercase","capitalize"] },
    "width": { label: "Largura", kind: "number", step: 1, min: 0, glyph: "W", options: ["auto","min-content","max-content","fit-content"] },
    "height": { label: "Altura", kind: "number", step: 1, min: 0, glyph: "H", options: ["auto","min-content","max-content","fit-content"] },
    "min-width": { label: "Largura mín.", kind: "number", step: 1, min: 0, glyph: "W", options: ["auto","min-content","max-content","fit-content"] },
    "max-width": { label: "Largura máx.", kind: "number", step: 1, glyph: "W", options: ["none","min-content","max-content","fit-content"] },
    "min-height": { label: "Altura mín.", kind: "number", step: 1, min: 0, glyph: "H", options: ["auto","min-content","max-content","fit-content"] },
    "max-height": { label: "Altura máx.", kind: "number", step: 1, glyph: "H", options: ["none","min-content","max-content","fit-content"] },
    "display": { label: "Display", kind: "menu", options: ["block","inline","inline-block","flex","inline-flex","grid","none"] },
    "position": { label: "Posição", kind: "menu", options: ["static","relative","absolute","fixed","sticky"] },
    "top": { label: "Topo", kind: "number", glyph: "T", options: ["auto"] },
    "right": { label: "Direita", kind: "number", glyph: "R", options: ["auto"] },
    "bottom": { label: "Baixo", kind: "number", glyph: "B", options: ["auto"] },
    "left": { label: "Esquerda", kind: "number", glyph: "L", options: ["auto"] },
    "z-index": { label: "Camada", kind: "number", step: 1, glyph: "Z", options: ["auto"] },
    "flex-direction": { label: "Direção do flex", kind: "menu", options: ["row","row-reverse","column","column-reverse"] },
    "flex-wrap": { label: "Quebra do flex", kind: "menu", options: ["nowrap","wrap","wrap-reverse"] },
    "justify-content": { label: "Justificar", kind: "menu", options: ["normal","flex-start","center","flex-end","space-between","space-around","space-evenly"] },
    "align-items": { label: "Alinhar itens", kind: "menu", options: ["normal","stretch","flex-start","center","flex-end","baseline"] },
    "align-content": { label: "Alinhar conteúdo", kind: "menu", options: ["normal","stretch","flex-start","center","flex-end","space-between","space-around"] },
    "gap": { label: "Espaço", kind: "number", step: 1, min: 0, options: ["normal"] },
    "row-gap": { label: "Entre linhas", kind: "number", step: 1, min: 0, options: ["normal"] },
    "column-gap": { label: "Entre colunas", kind: "number", step: 1, min: 0, options: ["normal"] },
    "overflow": { label: "Overflow", kind: "menu", options: ["visible","hidden","clip","scroll","auto"] },
    "margin-top": { label: "Margem topo", kind: "number", glyph: "↑", options: ["auto"] },
    "margin-right": { label: "Margem direita", kind: "number", glyph: "→", options: ["auto"] },
    "margin-bottom": { label: "Margem baixo", kind: "number", glyph: "↓", options: ["auto"] },
    "margin-left": { label: "Margem esquerda", kind: "number", glyph: "←", options: ["auto"] },
    "padding-top": { label: "Padding topo", kind: "number", min: 0, glyph: "↑" },
    "padding-right": { label: "Padding direita", kind: "number", min: 0, glyph: "→" },
    "padding-bottom": { label: "Padding baixo", kind: "number", min: 0, glyph: "↓" },
    "padding-left": { label: "Padding esquerda", kind: "number", min: 0, glyph: "←" },
    "border-width": { label: "Espessura da borda", kind: "number", min: 0, options: ["thin","medium","thick"] },
    "border-style": { label: "Estilo da borda", kind: "menu", options: ["none","solid","dashed","dotted","double"] },
    "border-color": { label: "Cor da borda", kind: "color" },
    "border-radius": { label: t("radiusQ"), kind: "number", min: 0, glyph: "◡" },
    "box-shadow": { label: "Sombra", kind: "raw" },
    "transform": { label: "Transformação", kind: "raw" }
  };
  const CONTENT_SIZING = ["auto","min-content","max-content","fit-content"];
  const FONT_MENU_OPTIONS = ["Inter, sans-serif","system-ui, sans-serif","Arial, sans-serif","Helvetica, sans-serif","Roboto, sans-serif","Georgia, serif","Times New Roman, serif","ui-monospace, monospace"];


  const NUM_RE = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)\s*$/iu;
  function parseNumeric(value) {
    const m = NUM_RE.exec(value);
    if (m === null || m[1] === undefined) return null;
    const number = Number(m[1]);
    return Number.isFinite(number) ? { number, unit: m[2] ?? "" } : null;
  }
  function formatNumeric(number, unit) {
    const rounded = Math.round(number * 1000) / 1000;
    return `${Object.is(rounded, -0) ? 0 : rounded}${unit}`;
  }
  function parseColor(value) {
    const hex = /^#([\da-f]{6})([\da-f]{2})?$/iu.exec(value.trim());
    if (hex !== null) {
      return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: hex[2] === undefined ? 1 : parseInt(hex[2], 16) / 255 };
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*[,/]\s*(\d*\.?\d+)(%)?)?\s*\)$/iu.exec(value.trim());
    if (rgb === null) return null;
    const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] === "%" ? 100 : 1);
    const r = Number(rgb[1]), g = Number(rgb[2]), b = Number(rgb[3]);
    if ([r, g, b, a].some((x) => !Number.isFinite(x)) || r > 255 || g > 255 || b > 255 || a > 1) return null;
    return { r, g, b, a };
  }
  function hexOf(color) {
    return `#${[color.r, color.g, color.b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, "0")).join("")}`;
  }
  function isSafeValue(value) {
    const v = value.trim();
    return v !== "" && !/[\u0000-\u001f\u007f]/u.test(v) && !/(?:url|expression)\s*\(/iu.test(v) && !/@import/iu.test(v);
  }


  function parseSimpleShadow(value) {
    const raw = value.trim();
    if (raw === "none") return { inset: false, color: "rgba(0, 0, 0, 0.2)", colorFirst: false, lengths: ["0px", "4px", "12px", "0px"], arity: 4 };
    let depth = 0;
    for (const ch of raw) { if (ch === "(") depth += 1; else if (ch === ")") depth -= 1; else if (ch === "," && depth === 0) return null; }
    const colorMatch = /#[\da-f]{6}(?:[\da-f]{2})?|rgba?\([^)]*\)/iu.exec(raw);
    if (colorMatch === null || parseColor(colorMatch[0]) === null) return null;
    const colorFirst = raw.slice(0, colorMatch.index).trim() === "";
    const withoutColor = `${raw.slice(0, colorMatch.index)} ${raw.slice(colorMatch.index + colorMatch[0].length)}`;
    const tokens = withoutColor.trim().split(/\s+/u).filter(Boolean);
    const inset = tokens.includes("inset");
    if (inset) tokens.splice(tokens.indexOf("inset"), 1);
    if (tokens.length < 2 || tokens.length > 4 || tokens.some((t) => parseNumeric(t) === null)) return null;
    const unit = parseNumeric(tokens[0])?.unit ?? "px";
    const zero = unit === "" ? "0" : `0${unit}`;
    return { inset, color: colorMatch[0], colorFirst, lengths: [tokens[0], tokens[1], tokens[2] ?? zero, tokens[3] ?? zero], arity: tokens.length };
  }
  function serializeSimpleShadow(shadow) {
    const lengths = shadow.lengths.slice(0, Math.max(2, shadow.arity)).join(" ");
    const inset = shadow.inset ? " inset" : "";
    return shadow.colorFirst ? `${shadow.color} ${lengths}${inset}` : `${lengths} ${shadow.color}${inset}`;
  }
  const TRANSFORM_DEFAULTS = { translateX: "0px", translateY: "0px", scaleX: "1", scaleY: "1", rotate: "0deg" };
  function parseSimpleTransform(value) {
    const raw = value.trim();
    if (raw === "none") return { order: [], values: { ...TRANSFORM_DEFAULTS } };
    const values = { ...TRANSFORM_DEFAULTS };
    const order = [];
    const expression = /([a-zA-Z]+)\(([^()]*)\)/gu;
    let cursor = 0;
    for (const match of raw.matchAll(expression)) {
      if (match.index === undefined || raw.slice(cursor, match.index).trim() !== "") return null;
      const kind = match[1];
      const argument = (match[2] ?? "").trim();
      if (!(kind in TRANSFORM_DEFAULTS) || order.includes(kind) || parseNumeric(argument) === null) return null;
      const num = parseNumeric(argument);
      if ((kind.startsWith("scale") && num.unit !== "") || (kind === "rotate" && !["deg", "rad", "turn"].includes(num.unit))) return null;
      values[kind] = argument;
      order.push(kind);
      cursor = match.index + match[0].length;
    }
    if (order.length === 0 || raw.slice(cursor).trim() !== "") return null;
    return { order, values };
  }
  function serializeSimpleTransform(transform) {
    const order = [...transform.order];
    for (const kind of Object.keys(TRANSFORM_DEFAULTS)) {
      if (!order.includes(kind) && transform.values[kind] !== TRANSFORM_DEFAULTS[kind]) order.push(kind);
    }
    return order.length === 0 ? "none" : order.map((kind) => `${kind}(${transform.values[kind]})`).join(" ");
  }


  function editableTextNode(element) {
    if (element.children.length > 0) return null;
    const nodes = Array.from(element.childNodes).filter((node) => node.nodeType === 3 && node.data.trim() !== "");
    return nodes.length === 1 ? nodes[0] : null;
  }
  function computedValue(element, property) {
    return element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue(property).trim() ?? "";
  }
  function createLivePatch(element) {
    const node = editableTextNode(element);
    return {
      element,
      originalStyles: new Map(),
      computedBaselines: new Map(EDITABLE_PROPS.map((property) => [property, computedValue(element, property)])),
      originalText: node === null ? null : { node, value: node.data }
    };
  }
  function previewStyle(patch, property, value) {
    const style = patch.element.style;
    if (!patch.originalStyles.has(property)) {
      patch.originalStyles.set(property, { value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) });
    }
    style.setProperty(property, value, "important");
  }
  function restoreStyle(patch, property) {
    const style = patch.element.style;
    const original = patch.originalStyles.get(property);
    if (original === undefined) return;
    if (original.value === "") style.removeProperty(property);
    else style.setProperty(property, original.value, original.priority);
    patch.originalStyles.delete(property);
  }
  function restoreText(patch) {
    if (patch.originalText !== null) patch.originalText.node.data = patch.originalText.value;
  }
  function restoreAll(patch) {
    for (const property of [...patch.originalStyles.keys()]) restoreStyle(patch, property);
    restoreText(patch);
  }
  function applyCommitted(patch, changes, textChange) {
    for (const change of changes) previewStyle(patch, change.prop, change.after);
    if (textChange !== null && textChange !== undefined) {
      if (patch.originalText !== null) patch.originalText.node.data = textChange.after;
    }
  }


  let adjustPatch = null;
  let adjustValues = new Map();
  let adjustText = "";
  let adjustInvalid = new Set();
  let adjustLedger = new Map();
  const adjustSeen = { flex: false, layout: false, positioned: false };

  function adjustBaseline(prop) {
    const ledger = adjustTarget !== null ? adjustLedger.get(adjustTargetSelector) : undefined;
    const fromLedger = ledger?.props?.get(prop);
    if (typeof fromLedger === "string") return fromLedger;
    return adjustPatch?.computedBaselines.get(prop) ?? "";
  }
  function adjustChanged(prop) {
    return (adjustValues.get(prop) ?? "") !== adjustBaseline(prop);
  }
  function adjustCurrentChanges() {
    const changes = [];
    for (const prop of EDITABLE_PROPS) {
      const value = adjustValues.get(prop);
      if (value === undefined) continue;
      const before = adjustBaseline(prop);
      if (before !== value) changes.push({ prop, before, after: value });
    }
    return changes;
  }
  function adjustUpdateProperty(prop, next) {
    if (!isSafeValue(next)) {
      adjustInvalid.add(prop);
      adjustValues.set(prop, next);
      rerenderAdjustRows();
      return;
    }
    adjustInvalid.delete(prop);
    if (adjustPatch !== null) previewStyle(adjustPatch, prop, next);
    adjustValues.set(prop, next);
    rerenderAdjustRows();
  }
  function adjustReset(prop) {
    const ledger = adjustTarget !== null ? adjustLedger.get(adjustTargetSelector) : undefined;
    const before = ledger?.props?.get(prop);
    const value = before !== undefined ? before : (adjustPatch?.computedBaselines.get(prop) ?? "");
    if (adjustPatch !== null && value === (adjustPatch.computedBaselines.get(prop) ?? "")) restoreStyle(adjustPatch, prop);
    else if (adjustPatch !== null) previewStyle(adjustPatch, prop, value);
    adjustValues.set(prop, value);
    adjustInvalid.delete(prop);
    rerenderAdjustRows();
  }
  function adjustUpdateText(next) {
    adjustText = next;
    if (adjustPatch === null || adjustPatch.originalText === null) return;
    if (next === adjustPatch.originalText.value) restoreText(adjustPatch);
    else adjustPatch.originalText.node.data = next;
    rerenderAdjustRows();
  }


  function secHead(label, open) {
    const head = el("button", { class: "lr-sec-head", type: "button" }, el("span", {}, label), el("span", { class: "lr-sec-chev" }, "▾"));
    head.setAttribute("aria-expanded", open ? "true" : "false");
    return head;
  }
  function inspectorSection(label, open, build) {
    const section = el("div", { class: "lr-sec" });
    if (open) section.setAttribute("data-open", "");
    const head = secHead(label, open);
    const body = el("div", { class: "lr-sec-body" });
    if (!open) body.style.display = "none";
    head.addEventListener("click", () => {
      const isOpen = section.hasAttribute("data-open");
      if (isOpen) section.removeAttribute("data-open");
      else section.setAttribute("data-open", "");
      body.style.display = isOpen ? "none" : "";
      head.setAttribute("aria-expanded", isOpen ? "false" : "true");
    });
    build(body);
    section.append(head, body);
    return section;
  }
  function inspectorRow(label, control, opts = {}) {
    const row = el("div", { class: `lr-row${opts.wide ? " lr-row-wide" : ""}${opts.staticLabel ? " lr-row-static" : ""}` });
    row.append(el("span", { class: "lr-row-label" }, label));
    const ctl = el("span", { class: "lr-row-ctl" });
    ctl.append(control);
    row.append(ctl);
    if (opts.rerender !== undefined) {
      const reset = el("button", { class: "lr-reset", type: "button", title: `${t("resetPrefix")}${label}` }, "↺");
      reset.style.display = "none";
      opts.rerender.push(() => {
        reset.style.display = opts.changed() ? "" : "none";
        if (typeof opts.refresh === "function") opts.refresh();
        if (typeof opts.invalid === "function") opts.invalid();
      });
      reset.addEventListener("click", () => opts.onReset());
      ctl.append(reset);
    }
    return row;
  }
  function lrField(value, onChange, opts = {}) {
    const input = el("input", { class: `lr-field${opts.num ? " lr-field-num" : ""}`, type: "text", spellcheck: "false" });
    input.value = value;
    input.addEventListener("change", () => onChange(input.value));
    if (opts.escapeRestore) {
      const focusValue = { v: value };
      input.addEventListener("focus", () => { focusValue.v = input.value; });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        input.value = focusValue.v;
        onChange(focusValue.v);
        input.blur();
      });
    }
    return input;
  }
  function markInvalid(input, isInvalid) {
    input.classList.toggle("lr-invalid", isInvalid === true);
  }
  function scrubControl(opts) {
    const { label, glyph = "↔", value, onChange, step = 1, min, max, options = [], fallback } = opts;
    const wrap = el("span", { class: "lr-scrub" });
    let lastNumeric = parseNumeric(value) ?? (fallback !== undefined ? parseNumeric(fallback) : null);
    const input = lrField(value, (next) => onChange(next), { escapeRestore: true, num: true });
    const clamp = (n) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, n));
    const numericValue = () => parseNumeric(input.value) ?? lastNumeric ?? (fallback !== undefined ? parseNumeric(fallback) : null);


    const emit = (formatted) => { input.value = formatted; lastNumeric = parseNumeric(formatted) ?? lastNumeric; handle.disabled = numericValue() === null; onChange(formatted); };
    const setFromNumeric = (n, unit) => emit(formatNumeric(clamp(n), unit));
    const handle = el("button", { class: "lr-handle", type: "button", title: `${label} · arraste para ajustar` }, glyph);
    if (numericValue() === null) handle.disabled = true;
    const drag = { x: 0, value: 0, unit: "", started: false, active: false };
    handle.addEventListener("pointerdown", (e) => {
      const parsed = numericValue();
      if (parsed === null) return;
      drag.x = e.clientX; drag.value = parsed.number; drag.unit = parsed.unit; drag.started = false; drag.active = true;
      handle.setPointerCapture?.(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag.active) return;
      const delta = e.clientX - drag.x;
      if (!drag.started && Math.abs(delta) < 3) return;
      drag.started = true;
      setFromNumeric(drag.value + delta * step, drag.unit);
    });
    const endDrag = () => { drag.active = false; };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const parsed = numericValue();
        if (parsed === null) return;
        const factor = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        setFromNumeric(parsed.number + (e.key === "ArrowUp" ? step : -step) * factor, parsed.unit);
      }
    });
    wrap.append(handle, input);
    if (options.length > 0) {
      const preset = el("select", { class: "lr-menu", title: `${label} · ${t("presets")}` });
      preset.append(el("option", { value: "" }, "⋯"));
      for (const option of options) preset.append(el("option", { value: option }, option));
      preset.addEventListener("change", () => { if (preset.value !== "") emit(preset.value); preset.value = ""; });
      wrap.append(preset);
    }
    wrap.__input = input;
    wrap.__refresh = (display) => { input.value = display; lastNumeric = parseNumeric(display) ?? lastNumeric; handle.disabled = numericValue() === null; };
    return wrap;
  }
  function colorControl(value, onChange) {
    const wrap = el("span", { class: "lr-color" });
    const swatchWrap = el("span", { class: "lr-swatch" });
    const pick = el("input", { type: "color", "aria-label": value });
    const parsed = parseColor(value);
    pick.value = parsed === null ? "#000000" : hexOf(parsed);
    pick.addEventListener("input", () => {
      text.value = hexOf(parseColor(pick.value) ?? { r: 0, g: 0, b: 0 });
      onChange(pick.value);
    });
    swatchWrap.append(pick);
    const text = lrField(parsed === null ? value : hexOf(parsed), (next) => onChange(next), { escapeRestore: true });
    wrap.append(swatchWrap, text);
    wrap.__refresh = (current, isInvalid) => {
      const p = parseColor(current);
      pick.value = p === null ? "#000000" : hexOf(p);
      text.value = p === null ? current : hexOf(p);
      markInvalid(text, isInvalid === true);
    };
    return wrap;
  }
  function menuControl(options, value, onChange) {
    const select = el("select", { class: "lr-menu" });
    const values = options.includes(value) ? options : [value, ...options];
    for (const option of values) select.append(el("option", { value: option }, option));
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }
  function segmentedControl(options, value, onChange) {
    const wrap = el("span", { class: "lr-seg", role: "group" });
    for (const option of options) {
      const btn = el("button", { type: "button", title: option.label }, option.content);
      if (option.value === value) btn.setAttribute("data-on", "");
      btn.addEventListener("click", () => onChange(option.value));
      wrap.append(btn);
    }
    wrap.__value = value;
    wrap.__refresh = (next) => {
      wrap.__value = next;
      [...wrap.children].forEach((btn, index) => {
        if (options[index]?.value === next) btn.setAttribute("data-on", "");
        else btn.removeAttribute("data-on");
      });
    };
    return wrap;
  }
  function toggleButton(label, content, pressed, onToggle) {
    const btn = el("button", { type: "button", class: "lr-tgl", title: label }, content);
    if (pressed) btn.setAttribute("data-on", "");
    btn.addEventListener("click", () => onToggle());
    return btn;
  }
  function linkButton(linked, onToggle) {
    const btn = el("button", { type: "button", class: "lr-link", title: linked ? t("linkOn") : t("linkOff") });
    btn.innerHTML = linked
      ? '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5.25 4.1 6.4 2.95a2.4 2.4 0 0 1 3.4 3.4L8.65 7.5M8.75 9.9 7.6 11.05a2.4 2.4 0 0 1-3.4-3.4L5.35 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M5.25 4.1 6.4 2.95a2.4 2.4 0 0 1 3.4 3.4L8.65 7.5M8.75 9.9 7.6 11.05a2.4 2.4 0 0 1-3.4-3.4L5.35 6.5M2 2l10 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    if (linked) btn.setAttribute("data-on", "");
    btn.addEventListener("click", () => onToggle());
    return btn;
  }
  const QUAD_SIDES = ["↑", "→", "↓", "←"];
  function quadControl(props4, badges4, fallbacks4, min, onChangeOne) {
    const wrap = el("span", { class: "lr-quad-wrap" });
    const grid = el("span", { class: "lr-quad" });
    const scrubs = [];
    let linked = false;
    const applyLinked = (index, next) => {
      for (let i = 0; i < 4; i += 1) {
        if (i !== index) {
          onChangeOne(props4[i], next, true);
          scrubs[i].__refresh(next);
        }
      }
      onChangeOne(props4[index], next, true);
    };
    props4.forEach((prop, index) => {
      const cell = el("span", { class: "lr-cell" });
      const scrub = scrubControl({
        label: t(PROP_META[prop]?.label ?? ""),
        glyph: badges4[index],
        value: adjustValues.get(prop) ?? "",
        fallback: fallbacks4[index],
        min,
        onChange: (next) => {
          if (linked) applyLinked(index, next);
          else onChangeOne(prop, next, false);
        }
      });
      scrubs.push(scrub);
      cell.append(scrub);
      grid.append(cell);
    });
    const linkWrap = el("span", { class: "lr-link-cell" });
    const link = linkButton(linked, () => {});
    link.addEventListener("click", () => {
      linked = !linked;
      if (linked) {
        const first = adjustValues.get(props4[0]) ?? "";
        for (let i = 1; i < 4; i += 1) {
          onChangeOne(props4[i], first, true);
          scrubs[i].__refresh(first);
        }
      }
      if (linked) link.setAttribute("data-on", "");
      else link.removeAttribute("data-on");
    });
    linkWrap.append(link);
    wrap.append(grid, linkWrap);
    wrap.__refresh = () => {
      props4.forEach((prop, index) => scrubs[index].__refresh(adjustValues.get(prop) ?? ""));
    };
    return wrap;
  }
  function sizeControl(widthProp, heightProp) {
    const wrap = el("span", { class: "lr-size" });
    let linked = false;
    let ratio = null;
    const grid = el("span", { class: "lr-quad" });
    const otherRef = { input: null };
    const mk = (prop, badge, otherProp) => {
      const cell = el("span", { class: "lr-cell" });
      const scrub = scrubControl({
        label: t(PROP_META[prop]?.label ?? ""),
        glyph: badge,
        value: adjustValues.get(prop) ?? "",
        fallback: adjustNumericFallback(prop),
        step: 1, min: 0,
        options: PROP_META[prop]?.options ?? [],
        onChange: (next) => {
          if (linked) {
            const nextNum = parseNumeric(next);
            const otherNum = parseNumeric(adjustValues.get(otherProp) ?? "");
            if (nextNum !== null && otherNum !== null && ratio !== null && ratio !== 0) {
              const value = prop === widthProp ? nextNum.number / ratio : nextNum.number * ratio;
              const rounded = formatNumeric(Math.round(value * 1000) / 1000, otherNum.unit);
              adjustUpdateProperty(otherProp, rounded);
              otherRef.input.value = rounded;
            }
          }
          adjustUpdateProperty(prop, next);
        }
      });
      return { cell, input: scrub.__input, scrub };
    };
    const w = mk(widthProp, "W", heightProp);
    const h = mk(heightProp, "H", widthProp);
    otherRef.input = h.input;
    grid.append(w.cell, h.cell);
    const linkWrap = el("span", { class: "lr-link-cell" });
    const link = linkButton(false, () => {});
    link.addEventListener("click", () => {
      linked = !linked;
      if (linked) {
        const wn = parseNumeric(adjustValues.get(widthProp) ?? "");
        const hn = parseNumeric(adjustValues.get(heightProp) ?? "");
        ratio = wn !== null && hn !== null && hn.number !== 0 ? wn.number / hn.number : null;
      }
      if (linked) link.setAttribute("data-on", "");
      else link.removeAttribute("data-on");
    });
    linkWrap.append(link);
    wrap.append(grid, linkWrap);
    wrap.__refresh = () => {
      w.scrub.__refresh(adjustValues.get(widthProp) ?? "");
      h.scrub.__refresh(adjustValues.get(heightProp) ?? "");
    };
    return wrap;
  }
  function adjustNumericFallback(prop) {
    const ledger = adjustTarget !== null ? adjustLedger.get(adjustTargetSelector) : undefined;
    const originalInline = adjustTarget?.style?.getPropertyValue(prop) ?? "";
    if (originalInline !== "" && parseNumeric(originalInline) !== null) return originalInline;
    const baseline = adjustPatch?.computedBaselines.get(prop) ?? "";
    if (baseline !== "" && parseNumeric(baseline) !== null) return baseline;
    if (prop === "line-height") {
      const fontSize = parseNumeric(adjustValues.get("font-size") ?? adjustPatch?.computedBaselines.get("font-size") ?? "");
      return fontSize === null ? "16px" : `${Math.round(fontSize.number * 1.2 * 1000) / 1000}${fontSize.unit || "px"}`;
    }
    if (prop === "letter-spacing" || prop === "gap" || prop === "row-gap" || prop === "column-gap") return "0px";
    if (prop === "z-index") return "0";
    if (prop === "opacity") return "100%";
    return "0px";
  }
  function shadowControl(prop) {
    const wrap = el("span", { class: "lr-effect" });
    const render = () => {
      wrap.replaceChildren();
      const parsed = parseSimpleShadow(adjustValues.get(prop) ?? "");
      if (parsed === null) {
        const raw = lrField(adjustValues.get(prop) ?? "", (next) => adjustUpdateProperty(prop, next), { escapeRestore: true });
        wrap.append(raw, el("span", { class: "lr-rawhint" }, t("rawHint")));
        return;
      }
      const grid = el("span", { class: "lr-quad" });
      const badges = ["X", "Y", "B", "S"];
      const labels = [t("shadowSX"), t("shadowSY"), t("shadowBlur"), t("shadowSpread")];
      parsed.lengths.forEach((part, index) => {
        const cell = el("span", { class: "lr-cell" });
        const scrub = scrubControl({ label: labels[index], glyph: badges[index], value: part, onChange: (next) => {
          const shadow = { ...parsed, lengths: [...parsed.lengths], arity: Math.max(parsed.arity, index + 1) };
          shadow.lengths[index] = next;
          adjustUpdateProperty(prop, serializeSimpleShadow(shadow));
        } });
        cell.append(scrub);
        grid.append(cell);
      });
      const colorRow = el("span", { class: "lr-effect-row" });
      colorRow.append(el("span", { class: "lr-effect-label" }, t("shadowColor")));
      colorRow.append(colorControl(parsed.color, (next) => {
        adjustUpdateProperty(prop, serializeSimpleShadow({ ...parsed, color: next }));
      }));
      const insetRow = el("span", { class: "lr-effect-row" });
      insetRow.append(el("span", { class: "lr-effect-label" }, t("shadowInset")));
      insetRow.append(toggleButton("Sombra interna", "I", parsed.inset, () => {
        adjustUpdateProperty(prop, serializeSimpleShadow({ ...parsed, inset: !parsed.inset }));
      }));
      wrap.append(grid, colorRow, insetRow);
    };
    render();
    wrap.__render = render;
    return wrap;
  }
  function transformControl(prop) {
    const wrap = el("span", { class: "lr-effect" });
    const render = () => {
      wrap.replaceChildren();
      const parsed = parseSimpleTransform(adjustValues.get(prop) ?? "");
      if (parsed === null) {
        const raw = lrField(adjustValues.get(prop) ?? "", (next) => adjustUpdateProperty(prop, next), { escapeRestore: true });
        wrap.append(raw, el("span", { class: "lr-rawhint" }, t("rawHint")));
        return;
      }
      const grid = el("span", { class: "lr-quad" });
      const kinds = [["translateX", "X", t("tfTX"), "0px"], ["translateY", "Y", t("tfTY"), "0px"], ["scaleX", "SX", t("tfSX"), "1"], ["scaleY", "SY", t("tfSY"), "1"], ["rotate", "°", t("tfRot"), "0deg"]];
      for (const [kind, badge, label, fallback] of kinds) {
        const cell = el("span", { class: "lr-cell" });
        const scrub = scrubControl({ label, glyph: badge, value: parsed.values[kind], fallback, step: kind === "rotate" ? 1 : kind.startsWith("scale") ? 0.05 : 1, onChange: (next) => {
          adjustUpdateProperty(prop, serializeSimpleTransform({ ...parsed, values: { ...parsed.values, [kind]: next } }));
        } });
        cell.append(scrub);
        grid.append(cell);
      }
      wrap.append(grid);
    };
    render();
    wrap.__render = render;
    return wrap;
  }


  let adjustRerender = [];
  function rerenderAdjustRows() {
    for (const fn of adjustRerender) { try { fn(); } catch {} }
    if (adjustConfirmBtn !== null) adjustConfirmBtn.toggleAttribute("data-disabled", !adjustCanConfirm());
  }
  function adjustCanConfirm() {
    const comment = adjustCommentInput?.value?.trim() ?? "";
    return comment !== "" || adjustCurrentChanges().length > 0 || (adjustPatch?.originalText !== null && adjustText !== (adjustPatch?.originalText?.value ?? ""));
  }
  function propertyRow(prop) {
    const meta = PROP_META[prop];
    if (meta === undefined) return null;
    const label = t(meta.label);
    const value = adjustValues.get(prop) ?? "";
    let control;
    let refreshDisplay = null;
    if (meta.kind === "color") {
      control = colorControl(value, (next) => adjustUpdateProperty(prop, next));
      refreshDisplay = () => control.__refresh(adjustValues.get(prop) ?? "", adjustInvalid.has(prop));
    } else if (meta.kind === "menu") {
      control = menuControl(meta.options ?? [], value, (next) => adjustUpdateProperty(prop, next));
      refreshDisplay = () => { control.value = adjustValues.get(prop) ?? ""; };
    } else if (prop === "opacity") {
      const toDisplay = (raw) => {
        const normalized = raw.trim() === "" ? "1" : raw;
        const bare = /^\s*(\d*\.?\d+)\s*$/u.exec(normalized);
        return bare === null ? normalized : `${Math.round(Number(bare[1]) * 10000) / 100}%`;
      };
      const scrub = scrubControl({ label, value: toDisplay(value), step: 1, min: 0, max: 100, onChange: (next) => {
        const percent = /^\s*(\d*\.?\d+)\s*%?\s*$/u.exec(next);
        adjustUpdateProperty(prop, percent === null ? next : String(Number(percent[1]) / 100));
      } });
      control = scrub;
      refreshDisplay = () => scrub.__refresh(toDisplay(adjustValues.get(prop) ?? "1"));
    } else if (meta.kind === "number") {
      const scrub = scrubControl({ label, value, fallback: adjustNumericFallback(prop), step: meta.step ?? 1, min: meta.min, max: meta.max, glyph: meta.glyph, options: meta.options ?? [], onChange: (next) => adjustUpdateProperty(prop, next) });
      control = scrub;
      refreshDisplay = () => scrub.__refresh(adjustValues.get(prop) ?? "");
    } else {
      const field = lrField(value, (next) => adjustUpdateProperty(prop, next), { escapeRestore: true });
      control = field;
      refreshDisplay = () => { field.value = adjustValues.get(prop) ?? ""; markInvalid(field, adjustInvalid.has(prop)); };
    }
    return inspectorRow(label, control, {
      changed: () => adjustChanged(prop),
      onReset: () => adjustReset(prop),
      rerender: adjustRerender,
      refresh: refreshDisplay
    });
  }
  function quadRow(label, props4, badges4, min) {
    const wrap = quadControl(props4, badges4, props4.map((p) => adjustNumericFallback(p)), min, (prop, next) => adjustUpdateProperty(prop, next));
    return inspectorRow(label, wrap, { wide: true, staticLabel: true, changed: () => props4.some((p) => adjustChanged(p)), onReset: () => { props4.forEach((p) => adjustReset(p)); wrap.__refresh(); }, rerender: adjustRerender });
  }

  let adjustCommentInput = null;
  let adjustConfirmBtn = null;
  let adjustTargetSelector = "";

  function closeAdjustPanel(restore) {
    if (adjustPanel !== null && restore && adjustPatch !== null) restoreAll(adjustPatch);
    adjustPanel?.remove();
    adjustPanel = null;
    adjustPatch = null;
    adjustValues = new Map();
    adjustInvalid = new Set();
    adjustRerender = [];
    adjustCommentInput = null;
    adjustConfirmBtn = null;
  }

  function openAdjustPanel(target) {
    closePanels();
    adjustTarget = target ?? document.body;
    adjustTargetSelector = cssPath(adjustTarget);






    const existing = pins.find((p) => p.selector === adjustTargetSelector);
    adjustPatch = createLivePatch(adjustTarget);


    if (!adjustLedger.has(adjustTargetSelector)) adjustLedger.set(adjustTargetSelector, { props: new Map(), text: adjustPatch.originalText?.value ?? null });
    adjustValues = new Map(EDITABLE_PROPS.map((prop) => [prop, adjustPatch.computedBaselines.get(prop) ?? ""]));
    adjustText = adjustPatch.originalText?.value ?? "";
    adjustInvalid = new Set();
    adjustRerender = [];
    adjustSeen.flex = false; adjustSeen.layout = false; adjustSeen.positioned = false;


    applyCommitted(adjustPatch, existing?.changes ?? [], existing?.textChange ?? null);
    for (const change of existing?.changes ?? []) adjustValues.set(change.prop, change.after);

    const rect = adjustTarget.getBoundingClientRect();
    const panel = el("div", { class: "popover composer lr-insp" });
    const targetLine = el("div", { class: "composer-target" }, el("span", { class: "chip" }, ICONS.code, `<${adjustTarget.localName}>`), el("span", { class: "lr-insp-sub" }, adjustTargetSelector.slice(0, 60)), el("button", { class: "lr-close", title: t("panelClose"), onclick: () => closeAdjustPanel(true) }, "✕"));
    panel.append(targetLine);
    adjustCommentInput = el("textarea", { class: "lr-comment", placeholder: t("commentOptional"), rows: "2" });
    adjustCommentInput.value = existing?.comment === "Ajuste visual" ? "" : (existing?.comment ?? "");
    adjustCommentInput.addEventListener("input", () => rerenderAdjustRows());
    panel.append(adjustCommentInput);

    const body = el("div", { class: "lr-insp-body" });

    if (adjustPatch.originalText !== null) {
      body.append(inspectorSection(t("secText"), true, (sec) => {
        const textarea = el("textarea", { class: "lr-field lr-textarea", rows: "2", "aria-label": t("secText") });
        textarea.value = adjustText;
        textarea.addEventListener("focus", () => { textarea.dataset.focusValue = textarea.value; });
        textarea.addEventListener("input", () => adjustUpdateText(textarea.value));
        textarea.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); textarea.value = textarea.dataset.focusValue ?? textarea.value; adjustUpdateText(textarea.value); textarea.blur(); } });
        sec.append(inspectorRow(t("secText"), textarea, { wide: true, changed: () => adjustText !== (adjustPatch?.originalText?.value ?? ""), onReset: () => { textarea.value = adjustPatch.originalText.value; adjustUpdateText(adjustPatch.originalText.value); }, rerender: adjustRerender }));
      }));
    }

    body.append(inspectorSection(t("secFill"), true, (sec) => {
      sec.append(propertyRow("color"), propertyRow("background-color"), propertyRow("opacity"));
    }));

    body.append(inspectorSection(t("secTypography"), true, (sec) => {
      sec.append(propertyRow("font-family"));
      const styleRow = inspectorRow("Estilo da fonte", el("span", { class: "lr-row-ctl" }), { changed: () => adjustChanged("font-weight") || adjustChanged("font-style") || adjustChanged("text-decoration"), onReset: () => { adjustReset("font-weight"); adjustReset("font-style"); adjustReset("text-decoration"); }, rerender: adjustRerender });
      const group = styleRow.querySelector(".lr-row-ctl");
      const refresh = () => {
        const weight = Number(adjustValues.get("font-weight") ?? "");
        const bold = Number.isFinite(weight) && weight >= 600;
        const style = adjustValues.get("font-style") ?? "";
        const tokens = (adjustValues.get("text-decoration") ?? "").split(/\s+/u).filter((t) => t !== "" && t !== "none");
        group.replaceChildren(
          toggleButton(t("styleBold"), "B", bold, () => {
            if (bold) adjustUpdateProperty("font-weight", adjustValues.get("__normalWeight") ?? "400");
            else { adjustValues.set("__normalWeight", adjustValues.get("font-weight") ?? "400"); adjustUpdateProperty("font-weight", "700"); }
            refresh(); rerenderAdjustRows();
          }),
          toggleButton(t("styleItalic"), "I", style === "italic" || style === "oblique", () => {
            if (style === "italic" || style === "oblique") adjustUpdateProperty("font-style", adjustValues.get("__normalStyle") ?? "normal");
            else { adjustValues.set("__normalStyle", style || "normal"); adjustUpdateProperty("font-style", "italic"); }
            refresh(); rerenderAdjustRows();
          }),
          toggleButton(t("styleUnderline"), "U", tokens.includes("underline"), () => {
            const next = tokens.includes("underline") ? tokens.filter((t) => t !== "underline") : [...tokens, "underline"];
            adjustUpdateProperty("text-decoration", next.length === 0 ? "none" : next.join(" "));
            refresh(); rerenderAdjustRows();
          })
        );
      };
      refresh();
      sec.append(styleRow);
      sec.append(propertyRow("font-weight"), propertyRow("font-size"), propertyRow("line-height"), propertyRow("letter-spacing"));
      const alignRow = inspectorRow("Alinhamento", el("span", { class: "lr-row-ctl" }), { changed: () => adjustChanged("text-align"), onReset: () => adjustReset("text-align"), rerender: adjustRerender });
      const alignCtl = alignRow.querySelector(".lr-row-ctl");
      const ALIGN_OPTIONS = [["left", t("alignL")], ["center", t("alignC")], ["right", t("alignR")], ["justify", t("alignJ")]];
      const alignWrap = segmentedControl(ALIGN_OPTIONS.map(([value, label]) => ({ value, label, content: label })), ALIGN_OPTIONS.some(([v]) => v === (adjustValues.get("text-align") || "left")) ? (adjustValues.get("text-align") || "left") : "left", (next) => { adjustUpdateProperty("text-align", next); alignWrap.__refresh(next); });
      alignCtl.append(alignWrap);
      sec.append(alignRow);
      sec.append(propertyRow("text-decoration"), propertyRow("text-transform"));
    }));

    body.append(inspectorSection(t("secSize"), true, (sec) => {
      const sizeWrap = sizeControl("width", "height");
      sec.append(inspectorRow(t("sizeWH"), sizeWrap, { wide: true, staticLabel: true, changed: () => adjustChanged("width") || adjustChanged("height"), onReset: () => { adjustReset("width"); adjustReset("height"); sizeWrap.__refresh(); }, rerender: adjustRerender }));
      sec.append(propertyRow("display"), propertyRow("position"));


      const flexRows = [propertyRow("flex-direction"), propertyRow("flex-wrap")];
      const layoutRows = [propertyRow("justify-content"), propertyRow("align-items"), propertyRow("align-content"), propertyRow("gap"), propertyRow("row-gap"), propertyRow("column-gap")];
      for (const row of [...flexRows, ...layoutRows]) sec.append(row);
      sec.append(propertyRow("overflow"));
      adjustRerender.push(() => {
        const display = adjustValues.get("display") ?? "";
        const flex = display === "flex" || display === "inline-flex";
        const layout = flex || display === "grid";
        if (flex) adjustSeen.flex = true;
        if (layout) adjustSeen.layout = true;
        for (const row of flexRows) row.style.display = adjustSeen.flex ? "" : "none";
        for (const row of layoutRows) row.style.display = adjustSeen.layout ? "" : "none";
      });
    }));

    body.append(inspectorSection(t("secSpacing"), true, (sec) => {
      sec.append(quadRow(t("marginQ"), ["margin-top", "margin-right", "margin-bottom", "margin-left"], QUAD_SIDES, undefined));
      sec.append(quadRow(t("paddingQ"), ["padding-top", "padding-right", "padding-bottom", "padding-left"], QUAD_SIDES, 0));
    }));

    body.append(inspectorSection(t("secBorder"), true, (sec) => {
      sec.append(propertyRow("border-width"), propertyRow("border-style"), propertyRow("border-color"));
      sec.append(quadRow(t("radiusQ"), ["border-radius", "border-radius", "border-radius", "border-radius"], ["◡", "◡", "◡", "◡"], 0));
    }));

    body.append(inspectorSection(t("secConstraints"), true, (sec) => {
      sec.append(propertyRow("min-width"), propertyRow("max-width"), propertyRow("min-height"), propertyRow("max-height"));
      const positionRows = [propertyRow("top"), propertyRow("right"), propertyRow("bottom"), propertyRow("left"), propertyRow("z-index")];
      for (const row of positionRows) sec.append(row);
      adjustRerender.push(() => {
        const positioned = (adjustValues.get("position") ?? "static") !== "static" || ["top", "right", "bottom", "left", "z-index"].some((p) => adjustChanged(p));
        if (positioned) adjustSeen.positioned = true;
        for (const row of positionRows) row.style.display = adjustSeen.positioned ? "" : "none";
      });
    }));

    body.append(inspectorSection(t("secEffects"), false, (sec) => {
      const shadowWrap = shadowControl("box-shadow");
      const transformWrap = transformControl("transform");
      const shadowRowEl = inspectorRow("Sombra", shadowWrap, { wide: true, staticLabel: true, changed: () => adjustChanged("box-shadow"), onReset: () => { adjustReset("box-shadow"); shadowWrap.__render(); }, rerender: adjustRerender });
      const transformRowEl = inspectorRow("Transformação", transformWrap, { wide: true, staticLabel: true, changed: () => adjustChanged("transform"), onReset: () => { adjustReset("transform"); transformWrap.__render(); }, rerender: adjustRerender });
      sec.append(shadowRowEl, transformRowEl);
    }));

    panel.append(body);

    const footer = el("div", { class: "lr-footer" });
    const cancel = el("button", { class: "lr-cancel", type: "button" }, t("cancelBtn"));
    cancel.addEventListener("click", () => closeAdjustPanel(true));
    adjustConfirmBtn = el("button", { class: "lr-confirm", type: "button", title: "Confirmar ajustes" }, t("confirmBtn"));
    adjustConfirmBtn.addEventListener("click", () => {
      const changes = adjustCurrentChanges();
      const textChanged = adjustPatch !== null && adjustPatch.originalText !== null && adjustText !== adjustPatch.originalText.value;
      if (!adjustCanConfirm()) return;
      const ledger = adjustLedger.get(adjustTargetSelector);


      let pin = pins.find((p) => p.selector === adjustTargetSelector);
      if (!pin) {
        const rect = adjustTarget.getBoundingClientRect();
        pins.push({
          id: crypto.randomUUID(),
          tag: adjustTarget.localName,
          role: adjustTarget.getAttribute?.("role") ?? "",
          label: adjustTarget.getAttribute?.("aria-label") ?? "",
          selector: adjustTargetSelector,
          text: (adjustTarget.textContent ?? "").trim().slice(0, 300),
          component: reactComponentName(adjustTarget) ?? "",
          comment: "",
          changes: [],
          pageUrl: PAGE_URL,
          rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
          offsets: { ox: rect.width / 2, oy: rect.height / 2 },
          status: "queued",
          at: Date.now()
        });
        pin = pins[pins.length - 1];
      }
      for (const change of changes) {
        const originalBefore = ledger?.props?.get(change.prop);
        if (typeof originalBefore === "string") change.before = originalBefore;
        if (change.before === change.after) continue;
        const existingChange = pin.changes.find((c) => c.prop === change.prop);
        if (existingChange) {
          if (existingChange.before === change.after) pin.changes = pin.changes.filter((c) => c !== existingChange);
          else existingChange.after = change.after;
        } else pin.changes.push(change);
      }
      if (textChanged) {
        const before = ledger?.text ?? adjustPatch.originalText.value;
        pin.textChange = { before, after: adjustText };
        if (pin.textChange.before === pin.textChange.after) delete pin.textChange;
      }
      pin.comment = adjustCommentInput.value.trim();
      pin.status = "queued";
      pin.at = Date.now();
      savePins();
      renderPins();
      postSnapshot();
      openPinId = null;
      closeAdjustPanel(false);
      toast(t("adjustSaved"), 3200);
    });
    footer.append(cancel, adjustConfirmBtn);
    panel.append(footer);

    const below = rect.bottom + 12 + 460 < window.innerHeight;
    panel.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 372))}px`;
    panel.style.top = below ? `${rect.bottom + 12}px` : `${Math.max(8, rect.top - 12 - Math.min(560, window.innerHeight - 24))}px`;
    adjustPanel = panel;
    rootDiv.append(panel);
    rerenderAdjustRows();
  }


  async function pollStatus() {
    try {
      const response = await fetch(`${API_BASE}/.lr/status`, { cache: "no-store" });
      const data = await response.json();
      const events = Array.isArray(data.events) ? data.events : [];
      for (const entry of events) {
        if (entry.at === lastStatusAt) continue;
        if (entry.kind === "ack") {

          pins.forEach((p) => {
            if (p.status === "queued") p.status = "enviado";
          });
          savePins();
          toast("✅ Anotações entregues ao agente com sua mensagem", 3200);
        }
        if (entry.kind === "sent") {
          pins.forEach((p) => {
            if (p.status === "queued") p.status = "enviado";
          });
          savePins();
        }
        if (entry.kind === "tool" || entry.kind === "agent" || entry.kind === "result") lastAgentActivity = Date.now();
      }
      const newest = events[events.length - 1]?.at ?? "";
      if (newest !== "" && newest !== lastStatusAt) lastStatusAt = newest;
      await reconcileWithHost();
      renderPins();
    } catch {}
  }


  async function reconcileWithHost() {
    try {
      const response = await fetch(`${API_BASE}/.lr/pending-pins`, { cache: "no-store" });
      const data = await response.json();
      const ids = new Set(data.ids ?? []);
      let changed = false;
      pins = pins.filter((p) => {
        if (p.status !== "queued") return true;
        if (ids.has(p.id)) return true;
        if (Date.now() - (p.at ?? 0) < 6000) return true;
        changed = true;
        return false;
      });
      if (changed) savePins();
    } catch {}
  }
  setInterval(pollStatus, 2500);

  function toast(text, ms = 2600) {
    mountShadow();
    setHint(text);
    setTimeout(() => setHint(null), ms);
  }

  function closePanels() {
    pinPanelNode?.remove();
    pinPanelNode = null;
    if (adjustPanel !== null) closeAdjustPanel(true);
  }


  function startup() {
    mountShadow();
    renderPins();
    if (pins.length > 0) toast(`Redline: ${pins.length} pin(s) restaurado(s)`);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startup);
  else startup();
})();
