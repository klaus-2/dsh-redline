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
  // The page can rewrite window.__LR__ before this script runs, so the host it names is not
  // trusted: the overlay is served from the same loopback as the host it talks to, and that
  // origin is the one that counts. A page that points elsewhere gets nothing loaded from it.
  const API_BASE = (() => {
    if (scriptOrigin !== null) return scriptOrigin;
    const named = window.__LR__ && typeof window.__LR__.apiBase === "string" ? window.__LR__.apiBase : "";
    return named || window.location.origin;
  })();
  // The page never holds the instance secret. Every privileged call goes
  // through the bridge, which the host answers from its own context.
  const BRIDGE = (() => { try { return window.__LR_BRIDGE__ ?? null; } catch { return null; } })();
  const bridgeSend = async (type, payload) => {
    if (BRIDGE === null || typeof BRIDGE.send !== "function") throw new Error("the Redline bridge is not available in this page");
    return await BRIDGE.send(type, payload ?? {});
  };
  const TARGET = (() => {
    try {
      const url = new URL(typeof window.__LR__?.pageUrl === "string" && window.__LR__.pageUrl !== "" ? window.__LR__.pageUrl : window.location.href);
      return { origin: url.origin, path: url.pathname };
    } catch {
      return { origin: window.location.origin, path: window.location.pathname };
    }
  })();
  const PAGE_URL = window.location.href;
  const STORE_KEY = `lr:pins:${TARGET.origin}${TARGET.path}`;

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
    accessibility: Icon(16, '<circle cx="12" cy="4" r="1.6"/>', '<path d="M5 8h14M12 8v5m0 0-3.5 7M12 13l3.5 7"/>'),
    sliders: Icon(16, '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/>', '<path d="M1 14h6M9 8h6M17 16h6"/>'),
    group: Icon(16, '<rect x="3" y="3" width="7" height="7" rx="1.5"/>', '<rect x="14" y="3" width="7" height="7" rx="1.5"/>', '<rect x="3" y="14" width="7" height="7" rx="1.5"/>', '<path d="M17.5 14v7M14 17.5h7"/>'),
    code: Icon(12, '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>')
  };
  const ICON_MARKUP = new Set(Object.values(ICONS));


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
      "pasteTooLarge": "Image too large (max 4 MB)",
      "pasteRemove": "Remove attached image",
      "templatesLabel": "Templates",
      "templateAlignDesign": "Align with the design",
      "templateReduceSpacing": "Reduce spacing",
      "templateIncreaseContrast": "Increase contrast",
      "templateFixOverflow": "Fix overflow",
      "templateExplainWhy": "Explain why this is a problem",
      "panelDrag": "Drag to move · double-click to reset",
      "attachesTo": "attaches to the session chat",
      "savedHint": "Saved. Use Send on the card above the composer to dispatch",
      "saveFailed": "Failed to save: ",
      "editComment": "Edit the comment…",
      "saveEdit": "Save edit",
      "resolved": "Resolve",
      "reopen": "Reopen",
      "del": "Delete",
      "pinStale": "Target not found. The pin is stale. Drag the marker to re-anchor.",
      "ambiguousSelectorWarning": "This selector matches {n} elements on the page.",
      "ambiguousSelectorDetail": "Selector: {selector}",
      "focusMode": "Focus",
      "focusModeExit": "Exit focus",
      "focusModeActive": "Focusing: {label}. Press Esc to exit.",
      "focusModeDismiss": "Dismiss focus mode",
      "duplicatePin": "Duplicate",
      "duplicateHint": "Click an element to duplicate this pin. Press Esc to cancel.",
      "duplicateDone": "Pin duplicated.",
      "pinDimensions": "Dimensions",
      "ancestorTrail": "Click an ancestor to re-anchor",
      "copyCss": "Copy CSS",
      "cssCopied": "CSS copied to clipboard",
      "cssCopyFailed": "Could not copy CSS",
      "copySelector": "Copy selector",
      "selectorCopied": "Selector copied",
      "tokenSuggestions": "Design tokens",
      "a11yTitle": "Accessibility",
      "a11yContrast": "Text contrast",
      "a11yAccessibleName": "Accessible name",
      "a11yImgAlt": "Image alt",
      "a11yRole": "Role",
      "a11yTargetSize": "Target size",
      "a11yPass": "Pass",
      "a11yFail": "Fail",
      "a11yWarn": "Warn",
      "a11yUnknown": "Unknown",
      "a11yNotApplicable": "n/a",
      "a11yFixApply": "Apply",
      "a11yFixDiscard": "Discard",
      "a11yFixContrastProposal": "Contrast {before} → {after} (ratio {ratioBefore} → {ratioAfter})",
      "a11yFixAltProposal": "Alt text: {value}",
      "a11yFixApplied": "Fix applied.",
      "a11yFixDiscarded": "Fix discarded.",
      "pinDeleted": "Annotation deleted.",
      "a11yNoAutoFix": "No automatic fix for this check.",
      "a11yFixContrastUnavailable": "This background cannot reach a 4.5:1 contrast ratio. Change the background instead.",
      "auditFixComment": "Accessibility fix (text contrast)",
      "auditFixCommentAlt": "Accessibility fix (image alt text)",
      "groupBtn": "Group",
      "groupHint": "Click elements to group, then press Enter",
      "groupCreated": "Group created",
      "viewportLabel": "Preview width",
      "viewportReset": "Full width",
      "layoutGrid": "Toggle layout grid",
      "gridColumns": "Columns",
      "gridGutter": "Gutter",
      "gridMargin": "Margin",
      "gridFill": "Fill",
      "gridOutline": "Outline",
      "distanceMeter": "Hold Alt with a panel open to measure distances",
      "inspectorStates": "States",
      "inspectorFilterPlaceholder": "Filter properties",
      "inspectorFilterNoResults": "No properties match this filter",
      "inspectorFilterClear": "Clear the filter",
      "captureRunning": "Capturing the page…",
      "captureSimplified": "Capturing without images…",
      "captureCancel": "Cancel",
      "captureTimeoutFallback": "The capture took too long; trying without images",
      "captureTimeoutFailed": "The capture did not finish in time",
      "auditCancel": "Cancel",
      "auditPartial": "Partial results; the audit was interrupted",
      "eyeTitle": "Show/hide pins",
      "statusTitle": "Live Review active",
      "pendingTitle": "Annotations waiting for your next prompt in the chat",
      "pendingCount": "{n} pending",
      "restoredPins": "Redline: {n} pin(s) restored",
      "a11yAuditPage": "Page accessibility audit",
      "a11yAuditScanned": "Scanned {scanned} elements, {findings} findings",
      "a11yAuditNoIssues": "No accessibility issues found in the scanned elements.",
      "a11yAuditGroupContrast": "Contrast",
      "a11yAuditGroupName": "Accessible name",
      "a11yAuditGroupAlt": "Image alt",
      "a11yAuditGroupRole": "Role",
      "a11yAuditGroupTargetSize": "Target size",
      "a11yAuditIssuesCount": "{n} issues",
    "drawTool": "Draw",
    "drawTitle": "Free canvas",
    "drawHint": "Draw over the page. Esc exits.",
    "drawBrush": "Brush",
    "drawErase": "Erase",
    "drawText": "Text",
    "drawRect": "Rectangle",
    "drawCircle": "Ellipse",
    "drawArrow": "Arrow",
    "drawClear": "Clear drawings",
    "drawExit": "Exit canvas",
    "drawBlack": "Black",
    "drawRed": "Red, for corrections",
    "drawBlue": "Blue, for highlights",
    "drawGreen": "Green",
    "drawWhite": "White",
    "drawShapes": "Shapes",
    "drawLine": "Line",
    "drawStep": "Step",
    "drawUndo": "Undo",
    "drawRedo": "Redo",
    "adjustUndo": "Undo",
    "adjustRedo": "Redo",
    "drawSend": "Add to chat",
    "drawColor": "Color",
    "drawWidth": "Thickness",
    "drawThin": "Thin",
    "drawMedium": "Medium",
    "drawThick": "Thick",
    "drawSentHint": "Added to chat. It follows your next message.",
    "drawShotFail": "Could not capture the screen",
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
      "adjustSaved": "Adjustments saved. They attach to your next prompt.",
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
      "pasteTooLarge": "Imagem grande demais (máx. 4 MB)",
      "pasteRemove": "Remover imagem anexada",
      "templatesLabel": "Modelos",
      "templateAlignDesign": "Alinhar com o design",
      "templateReduceSpacing": "Reduzir espaçamento",
      "templateIncreaseContrast": "Aumentar o contraste",
      "templateFixOverflow": "Corrigir overflow",
      "templateExplainWhy": "Explicar por que isto é um problema",
      "panelDrag": "Arraste para mover · duplo clique para voltar ao padrão",
      "attachesTo": "anexa ao chat da sessão",
      "savedHint": "Guardada. Use Enviar no card acima do composer para despachar",
      "saveFailed": "Falha ao guardar: ",
      "editComment": "Editar o comentário…",
      "saveEdit": "Salvar edição",
      "resolved": "✓ Resolvido",
      "reopen": "Reabrir",
      "del": "Excluir",
      "pinStale": "Alvo não encontrado. O pin está obsoleto. Arraste o marcador para reancorar.",
      "ambiguousSelectorWarning": "Este seletor corresponde a {n} elementos na página.",
      "ambiguousSelectorDetail": "Seletor: {selector}",
      "focusMode": "Foco",
      "focusModeExit": "Sair do foco",
      "focusModeActive": "Foco: {label}. Pressione Esc para sair.",
      "focusModeDismiss": "Dispensar modo de foco",
      "duplicatePin": "Duplicar",
      "duplicateHint": "Clique em um elemento para duplicar este pin. Pressione Esc para cancelar.",
      "duplicateDone": "Pin duplicado.",
      "pinDimensions": "Dimensões",
      "ancestorTrail": "Clique em um ancestral para reancorar",
      "copyCss": "Copiar CSS",
      "cssCopied": "CSS copiado para a área de transferência",
      "cssCopyFailed": "Não foi possível copiar o CSS",
      "copySelector": "Copiar seletor",
      "selectorCopied": "Seletor copiado",
      "tokenSuggestions": "Tokens de design",
      "a11yTitle": "Acessibilidade",
      "a11yContrast": "Contraste do texto",
      "a11yAccessibleName": "Nome acessível",
      "a11yImgAlt": "Alt da imagem",
      "a11yRole": "Papel",
      "a11yTargetSize": "Tamanho do alvo",
      "a11yPass": "Passa",
      "a11yFail": "Falha",
      "a11yWarn": "Atenção",
      "a11yUnknown": "Desconhecido",
      "a11yNotApplicable": "n/a",
      "a11yFixApply": "Aplicar",
      "a11yFixDiscard": "Descartar",
      "a11yFixContrastProposal": "Contraste {before} → {after} (razão {ratioBefore} → {ratioAfter})",
      "a11yFixAltProposal": "Texto alternativo: {value}",
      "a11yFixApplied": "Correção aplicada.",
      "a11yFixDiscarded": "Correção descartada.",
      "pinDeleted": "Anotação excluída.",
      "a11yNoAutoFix": "Sem correção automática para esta verificação.",
      "a11yFixContrastUnavailable": "Este fundo não atinge uma razão de contraste de 4,5:1. Altere o fundo.",
      "auditFixComment": "Correção de acessibilidade (contraste do texto)",
      "auditFixCommentAlt": "Correção de acessibilidade (texto alternativo da imagem)",
      "groupBtn": "Agrupar",
      "groupHint": "Clique nos elementos para agrupar, depois pressione Enter",
      "groupCreated": "Grupo criado",
      "viewportLabel": "Largura do preview",
      "viewportReset": "Largura total",
      "layoutGrid": "Alternar grade de layout",
      "gridColumns": "Colunas",
      "gridGutter": "Medianiz",
      "gridMargin": "Margem",
      "gridFill": "Preenchimento",
      "gridOutline": "Contorno",
      "distanceMeter": "Segure Alt com um painel aberto para medir distâncias",
      "inspectorStates": "Estados",
      "inspectorFilterPlaceholder": "Filtrar propriedades",
      "inspectorFilterNoResults": "Nenhuma propriedade corresponde ao filtro",
      "inspectorFilterClear": "Limpar o filtro",
      "captureRunning": "Capturando a página…",
      "captureSimplified": "Capturando sem imagens…",
      "captureCancel": "Cancelar",
      "captureTimeoutFallback": "A captura demorou; tentando sem imagens",
      "captureTimeoutFailed": "A captura não terminou a tempo",
      "auditCancel": "Cancelar",
      "auditPartial": "Resultado parcial; a auditoria foi interrompida",
      "eyeTitle": "Mostrar/ocultar pins",
      "statusTitle": "Live Review ativo",
      "pendingTitle": "Anotações aguardando seu próximo prompt no chat",
      "pendingCount": "{n} pendente(s)",
      "restoredPins": "Redline: {n} pin(s) restaurado(s)",
      "a11yAuditPage": "Auditoria de acessibilidade da página",
      "a11yAuditScanned": "Analisados {scanned} elementos, {findings} problemas",
      "a11yAuditNoIssues": "Nenhum problema de acessibilidade encontrado nos elementos analisados.",
      "a11yAuditGroupContrast": "Contraste",
      "a11yAuditGroupName": "Nome acessível",
      "a11yAuditGroupAlt": "Texto alternativo da imagem",
      "a11yAuditGroupRole": "Função",
      "a11yAuditGroupTargetSize": "Tamanho do alvo",
      "a11yAuditIssuesCount": "{n} problemas",
    "drawTool": "Desenhar",
    "drawTitle": "Canvas livre",
    "drawHint": "Desenhe sobre a página. Esc sai.",
    "drawBrush": "Pincel",
    "drawErase": "Apagar",
    "drawText": "Texto",
    "drawRect": "Retângulo",
    "drawCircle": "Elipse",
    "drawArrow": "Seta",
    "drawClear": "Limpar desenhos",
    "drawExit": "Sair do canvas",
    "drawBlack": "Preto",
    "drawRed": "Vermelho, para correções",
    "drawBlue": "Azul, para destaques",
    "drawGreen": "Verde",
    "drawWhite": "Branco",
    "drawShapes": "Formas",
    "drawLine": "Linha",
    "drawStep": "Passo",
    "drawUndo": "Desfazer",
    "drawRedo": "Refazer",
    "adjustUndo": "Desfazer",
    "adjustRedo": "Refazer",
    "drawSend": "Adicionar ao chat",
    "drawColor": "Cor",
    "drawWidth": "Espessura",
    "drawThin": "Fina",
    "drawMedium": "Média",
    "drawThick": "Grossa",
    "drawSentHint": "Adicionado ao chat. Segue com a sua próxima mensagem.",
    "drawShotFail": "Não foi possível capturar a tela",
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
      "adjustSaved": "Ajustes guardados. Anexam ao seu próximo prompt.",
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
      "pasteTooLarge": "图片过大（上限 4 MB）",
      "pasteRemove": "移除附加图片",
      "templatesLabel": "模板",
      "templateAlignDesign": "与设计对齐",
      "templateReduceSpacing": "减少间距",
      "templateIncreaseContrast": "提高对比度",
      "templateFixOverflow": "修复溢出",
      "templateExplainWhy": "说明为什么这是个问题",
      "panelDrag": "拖动移动 · 双击恢复默认位置",
      "attachesTo": "附加到会话聊天",
      "savedHint": "已保存。使用 composer 上方卡片的发送按钮派发",
      "saveFailed": "保存失败：",
      "editComment": "编辑评论…",
      "saveEdit": "保存编辑",
      "resolved": "标记已解决",
      "reopen": "重新打开",
      "del": "删除",
      "pinStale": "未找到目标。图钉已失效。拖动标记以重新锚定。",
      "ambiguousSelectorWarning": "此选择器匹配页面上的 {n} 个元素。",
      "ambiguousSelectorDetail": "选择器：{selector}",
      "focusMode": "聚焦",
      "focusModeExit": "退出聚焦",
      "focusModeActive": "聚焦中：{label}。按 Esc 退出。",
      "focusModeDismiss": "关闭聚焦模式",
      "duplicatePin": "复制",
      "duplicateHint": "点击某个元素以复制此 pin。按 Esc 取消。",
      "duplicateDone": "Pin 已复制。",
      "pinDimensions": "尺寸",
      "ancestorTrail": "点击祖先元素重新锚定",
      "copyCss": "复制 CSS",
      "cssCopied": "CSS 已复制到剪贴板",
      "cssCopyFailed": "无法复制 CSS",
      "copySelector": "复制选择器",
      "selectorCopied": "选择器已复制",
      "tokenSuggestions": "设计令牌",
      "a11yTitle": "无障碍",
      "a11yContrast": "文字对比度",
      "a11yAccessibleName": "可访问名称",
      "a11yImgAlt": "图片 alt",
      "a11yRole": "角色",
      "a11yTargetSize": "目标尺寸",
      "a11yPass": "通过",
      "a11yFail": "未通过",
      "a11yWarn": "警告",
      "a11yUnknown": "未知",
      "a11yNotApplicable": "不适用",
      "a11yFixApply": "应用",
      "a11yFixDiscard": "放弃",
      "a11yFixContrastProposal": "对比度 {before} → {after}（比值 {ratioBefore} → {ratioAfter}）",
      "a11yFixAltProposal": "替代文本：{value}",
      "a11yFixApplied": "修复已应用。",
      "a11yFixDiscarded": "修复已放弃。",
      "pinDeleted": "批注已删除。",
      "a11yNoAutoFix": "此检查没有自动修复。",
      "a11yFixContrastUnavailable": "此背景无法达到 4.5:1 对比度。请改为调整背景。",
      "auditFixComment": "无障碍修复（文本对比度）",
      "auditFixCommentAlt": "无障碍修复（图片替代文本）",
      "groupBtn": "成组",
      "groupHint": "点击要成组的元素，然后按 Enter",
      "groupCreated": "组已创建",
      "viewportLabel": "预览宽度",
      "viewportReset": "全宽",
      "layoutGrid": "切换布局网格",
      "gridColumns": "列数",
      "gridGutter": "栏间距",
      "gridMargin": "边距",
      "gridFill": "填充",
      "gridOutline": "轮廓",
      "distanceMeter": "按住 Alt 并打开面板以测量距离",
      "inspectorStates": "状态",
      "inspectorFilterPlaceholder": "筛选属性",
      "inspectorFilterNoResults": "没有匹配的属性",
      "inspectorFilterClear": "清除筛选",
      "captureRunning": "正在截取页面…",
      "captureSimplified": "正在截取（不含图片）…",
      "captureCancel": "取消",
      "captureTimeoutFallback": "截图超时，正在尝试不含图片",
      "captureTimeoutFailed": "截图未按时完成",
      "auditCancel": "取消",
      "auditPartial": "部分结果；审计已中断",
      "eyeTitle": "显示/隐藏图钉",
      "statusTitle": "Live Review 运行中",
      "pendingTitle": "标注将随你的下一条消息发送",
      "pendingCount": "{n} 条待发送",
      "restoredPins": "Redline: 已恢复 {n} 个图钉",
      "a11yAuditPage": "页面无障碍审计",
      "a11yAuditScanned": "已扫描 {scanned} 个元素，{findings} 个问题",
      "a11yAuditNoIssues": "在已扫描的元素中未发现无障碍问题。",
      "a11yAuditGroupContrast": "对比度",
      "a11yAuditGroupName": "可访问名称",
      "a11yAuditGroupAlt": "图片替代文本",
      "a11yAuditGroupRole": "角色",
      "a11yAuditGroupTargetSize": "目标尺寸",
      "a11yAuditIssuesCount": "{n} 个问题",
    "drawTool": "绘制",
    "drawTitle": "自由画布",
    "drawHint": "在页面上绘制。Esc 退出。",
    "drawBrush": "画笔",
    "drawErase": "擦除",
    "drawText": "文本",
    "drawRect": "矩形",
    "drawCircle": "椭圆",
    "drawArrow": "箭头",
    "drawClear": "清空绘图",
    "drawExit": "退出画布",
    "drawBlack": "黑色",
    "drawRed": "红色，修改",
    "drawBlue": "蓝色，强调",
    "drawGreen": "绿色",
    "drawWhite": "白色",
    "drawShapes": "形状",
    "drawLine": "直线",
    "drawStep": "步骤",
    "drawUndo": "撤销",
    "drawRedo": "重做",
    "adjustUndo": "撤销",
    "adjustRedo": "重做",
    "drawSend": "添加到聊天",
    "drawColor": "颜色",
    "drawWidth": "粗细",
    "drawThin": "细",
    "drawMedium": "中",
    "drawThick": "粗",
    "drawSentHint": "已添加到聊天。将随你的下一条消息发送。",
    "drawShotFail": "无法截取屏幕",
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
      "adjustSaved": "调整已保存。将附加到你的下一个提示。",
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
  const SETTINGS = (() => { try { return { ...(window.__LR__?.settings ?? {}) }; } catch { return {}; } })();
  let UI_LANG = (() => {
    if (SETTINGS.lang && SETTINGS.lang !== "auto") return SETTINGS.lang;
    const l = (navigator.language || "en").toLowerCase();
    return l.startsWith("pt") ? "pt" : l.startsWith("zh") ? "zh" : "en";
  })();
  /** A hotkey is a single key, or that key with modifiers: "a", "Ctrl+Shift+a". undefined when
   * the text is not a hotkey. */
  function parseHotkey(text) {
    const names = ["ctrl", "alt", "shift", "meta"];
    // The longest shortcut is "Ctrl+Alt+Shift+Meta+a": 22 characters. The limit is read before
    // the text is split, so a page-sized string costs nothing to refuse.
    if (typeof text !== "string" || text.length > 32) return undefined;
    const parts = text.split("+").map((part) => part.trim()).filter((part) => part !== "");
    if (parts.length === 0) return undefined;
    const key = parts.at(-1);
    if (!/^[a-z0-9]$/i.test(key)) return undefined;
    const modifiers = parts.slice(0, -1).map((part) => part.toLowerCase());
    if (new Set(modifiers).size !== modifiers.length) return undefined;
    if (modifiers.some((name) => !names.includes(name))) return undefined;
    return { key: key.toLowerCase(), modifiers: names.filter((name) => modifiers.includes(name)) };
  }

  /** True when the event is exactly that hotkey: the same key and the same set of modifiers.
   * The key is matched on the character the layout produces when no modifier is held, and on the
   * physical key when one is: a shortcut names the key the user reads. Shift+1 produces "!",
   * which is not what anyone means by "1". */
  function hotkeyMatches(event, hotkey) {
    if (hotkey === undefined) return false;
    const held = [];
    if (event.ctrlKey) held.push("ctrl");
    if (event.altKey) held.push("alt");
    if (event.shiftKey) held.push("shift");
    if (event.metaKey) held.push("meta");
    if (held.length !== hotkey.modifiers.length || !hotkey.modifiers.every((name) => held.includes(name))) return false;
    let key = String(event.key ?? "").toLowerCase();
    if (held.length > 0) {
      const code = String(event.code ?? "");
      const letter = /^Key([A-Za-z])$/.exec(code);
      const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
      if (letter !== null) key = letter[1].toLowerCase();
      else if (digit !== null) key = digit[1];
    }
    return key === hotkey.key;
  }

  /** The hotkey as it is shown: the key uppercased, the modifiers in their canonical spelling. */
  function formatHotkey(hotkey) {
    if (hotkey === undefined) return "";
    const labels = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Meta" };
    return [...hotkey.modifiers.map((name) => labels[name] ?? name), hotkey.key.toUpperCase()].join("+");
  }

  let hotkeyComment = parseHotkey(SETTINGS.keys?.comment) ?? parseHotkey("c");
  let hotkeyAdjust = parseHotkey(SETTINGS.keys?.adjust) ?? parseHotkey("v");
  let hotkeyDraw = parseHotkey(SETTINGS.keys?.draw) ?? parseHotkey("d");
  let hotkeyHidePins = parseHotkey(SETTINGS.keys?.hidePins) ?? parseHotkey("h");
  const t = (key) => UI_LOCALES[UI_LANG][key] ?? UI_LOCALES.en[key] ?? key;
  let mode = null;
  let duplicateArmed = null;
  let hovered = null;
  let draft = null;
  let pastedShot = null;
  let pasteChipNode = null;
  let pasteThumbNode = null;
  let openPinId = null;
  const focusState = { current: null };
  let focusSpotlightNode = null;
  let focusHintNode = null;
  let focusRepositionTimer = null;
  let screenshotOnSend = SETTINGS.screenshot === false ? false : true;
  let html2canvasReady = null;
  let hidden = false;
  let gridOn = false;
  let gridLayer = null;
  let gridStepper = null;
  let gridColumns = 12;
  let gridGutter = 24;
  let gridMargin = 32;
  let gridOutline = false;
  let gridResize = null;
  let meterAlt = false;
  let meterRef = null;
  let meterLayer = null;
  let meterRaf = 0;
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

  const PANEL_POS_KEY = `lr-panel-pos:${TARGET.origin}${TARGET.path}`;
  const panelPositions = loadPanelPositions();
  function loadPanelPositions() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(PANEL_POS_KEY) ?? "null");
      const read = (value) => (Number.isFinite(value?.x) && Number.isFinite(value?.y) ? { x: Math.round(value.x), y: Math.round(value.y) } : null);
      const stored = { composer: read(raw?.composer), pin: read(raw?.pin), adjust: read(raw?.adjust), audit: read(raw?.audit) };
      return stored;
    } catch {
      return { composer: null, pin: null, adjust: null, audit: null };
    }
  }
  function savePanelPositions() {
    try {
      sessionStorage.setItem(PANEL_POS_KEY, JSON.stringify(panelPositions));
    } catch {}
  }
  function applyPanelPosition(panel, kind) {
    const stored = panelPositions[kind];
    if (stored === null) return;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${clampPanelAxis(stored.x, rect.width, window.innerWidth, 8)}px`;
    panel.style.top = `${clampPanelAxis(stored.y, rect.height, window.innerHeight, 8)}px`;
    panel.style.transform = "none";
  }
  function clampPanelAxis(desired, size, extent, margin) {
    return Math.min(Math.max(margin, desired), Math.max(margin, extent - size - margin));
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

  function ancestorTrail(element) {
    const trail = [];
    let node = element.parentElement;
    while (node !== null && node !== host && node !== document.documentElement && trail.length < 12) {
      trail.push(node);
      if (node === document.body) break;
      node = node.parentElement;
    }
    return trail;
  }

  function locate(selector) {
    if (typeof selector !== "string" || selector === "") return null;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function countSelectorMatches(selector, queryAll) {
    try {
      return queryAll(selector).length;
    } catch {
      return 0;
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

  function buildDuplicatePin(source, target, id, readBefore) {
    return {
      id,
      tag: target.tag,
      role: target.role,
      label: target.label,
      selector: target.selector,
      text: target.text,
      component: target.component,
      comment: source.comment,
      changes: (Array.isArray(source.changes) ? source.changes : []).map((change) => ({ prop: change.prop, before: readBefore(change.prop), after: change.after })),
      pageUrl: source.pageUrl,
      rect: target.rect,
      offsets: target.offsets,
      shot: null,
      status: "queued"
    };
  }

  function createDuplicatePin(target, event) {
    const source = duplicateArmed;
    duplicateArmed = null;
    if (source === null) return;
    const rect = target.getBoundingClientRect();
    const pin = buildDuplicatePin(
      source,
      {
        selector: cssPath(target),
        tag: target.localName,
        role: target.getAttribute?.("role") ?? "",
        label: target.getAttribute?.("aria-label") ?? "",
        text: (target.textContent ?? "").trim().slice(0, 300),
        component: reactComponentName(target) ?? "",
        rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
        offsets: { ox: event ? event.clientX - rect.left : rect.width / 2, oy: event ? event.clientY - rect.top : rect.height / 2 }
      },
      crypto.randomUUID(),
      (prop) => computedValue(target, prop)
    );
    pin.at = Date.now();
    pins.push(pin);
    savePins();
    renderPins();
    void postSnapshot();
    toast(t("duplicateDone"), 2600);
  }


  const host = document.createElement("div");
  host.id = "dsh-redline-host";
  const shadow = host.attachShadow({ mode: "open" });
  const rootDiv = el("div", { class: themeRootClass(SETTINGS.theme) });
  const styleEl = document.createElement("style");
  styleEl.textContent = TENCIL_CSS + `
    .lr-close { all: unset; cursor: pointer; margin-left: auto; width: 20px; height: 20px;
      display: inline-flex; align-items: center; justify-content: center; border-radius: 6px;
      color: var(--n-500); font-size: 12px; }
    .lr-close:hover { background: var(--n-100); color: var(--n-950); }
    .chip > span { flex: none; }
    .chip svg { flex: none; width: 12px; height: 12px; }
    .pin-bubble-body { padding: 0 10px 8px; color: var(--n-950); max-height: 220px; overflow: auto; }
    .pin-bubble-meta { color: var(--n-500); font-size: 11px; word-break: break-all; margin-bottom: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .pin-bubble-changes { color: var(--n-600); font-size: 11px; margin-top: 4px; }
    .pin-bubble-stale { color: var(--error); font-size: 11px; margin-top: 4px; }
    .pin-bubble-warning { color: var(--error); font-size: 11px; margin-top: 4px; }
    .lr-a11y { display: grid; gap: 3px; margin: 6px 0 0; padding: 6px 8px; border-radius: 8px; background: var(--n-100); }
    .lr-a11y-title { color: var(--n-500); font-size: 11px; font-weight: 600; }
    .lr-a11y-row { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--n-600); }
    .lr-a11y-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lr-a11y-value { max-width: 120px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--n-500); }
    .lr-a11y-chip { flex: none; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; }
    .lr-a11y-chip.pass { background: color-mix(in oklab, var(--done), white 75%); color: var(--done); }
    .lr-a11y-chip.fail { background: color-mix(in oklab, var(--error), white 75%); color: var(--error); }
    .lr-a11y-chip.warn { background: color-mix(in oklab, var(--warn), white 75%); color: var(--warn); }
    .lr-a11y-chip.unknown, .lr-a11y-chip.n\/a { background: var(--n-200); color: var(--n-600); }
    .lr-a11y-fix { all: unset; cursor: pointer; flex: none; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; background: var(--n-200); color: var(--n-950); }
    .lr-a11y-fix:hover { background: var(--accent); color: #fff; }
    .lr-a11y-fix-proposal { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 8px; background: var(--n-200); font-size: 11px; color: var(--n-700); }
    .lr-a11y-fix-proposal .lr-field { height: 22px; flex: 1 1 100%; }
    .lr-a11y-fix-proposal button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 7px; font-size: 11px; background: var(--n-950); color: var(--n-50); }
    .lr-a11y-fix-proposal button:hover { filter: brightness(1.15); }
    .lr-a11y-fix-note { flex: 1; min-width: 0; word-break: break-word; }
    .pin-bubble-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px 10px; }
    .pin-bubble-actions button { all: unset; cursor: pointer; padding: 3px 10px; border-radius: 8px;
      font-size: 12px; background: var(--n-100); color: var(--n-950); }
    .pin-bubble-actions button:hover { background: var(--n-200); }
    .pin-bubble-actions .danger { color: var(--error); }
    .pin-bubble-actions-secondary { flex-wrap: wrap; }
    .lr-audit-panel { position: fixed; width: 320px; max-width: calc(100vw - 24px); max-height: min(70vh, 560px); display: flex; flex-direction: column; overflow: hidden; }
    .lr-audit-body { overflow-y: auto; padding: 0 10px 10px; display: grid; gap: 6px; }
    .lr-audit-group { display: grid; gap: 3px; margin: 0; padding: 6px 8px; border-radius: 8px; background: var(--n-100); }
    .lr-audit-group-title { display: flex; align-items: center; gap: 6px; color: var(--n-500); font-size: 11px; font-weight: 600; }
    .lr-audit-count { flex: none; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; background: color-mix(in oklab, var(--error), white 75%); color: var(--error); }
    .lr-audit-row { all: unset; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--n-600); }
    .lr-audit-row:hover { color: var(--n-950); }
    .lr-audit-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lr-audit-value { max-width: 110px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--n-500); }
    .lr-audit-row .lr-a11y-fix { margin-left: auto; }
    .lr-audit-summary { color: var(--n-500); font-size: 11px; padding: 2px 0 6px; }
    .lr-audit-partial { color: #e69a10; }
    .lr-audit-progress { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .lr-audit-progress-track { flex: 1; height: 6px; border-radius: 3px; background: var(--n-100); overflow: hidden; }
    .lr-audit-progress-fill { width: 0%; height: 100%; border-radius: 3px; background: var(--accent); transition: width 120ms var(--ease-out); }
    .lr-audit-progress-label { font-size: 11px; color: var(--n-500); font-variant-numeric: tabular-nums; }
    .lr-audit-cancel { all: unset; cursor: pointer; padding: 2px 10px; border-radius: 999px; background: var(--n-950); color: var(--n-50); font-size: 11px; }
    .lr-focus-spotlight { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none;
      border-radius: 6px; outline: 2px solid rgba(255,255,255,0.9); box-shadow: 0 0 0 100vmax rgba(0,0,0,0.55); z-index: 2147483603; }
    .lr-focus-hint { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px;
      padding: 6px 10px; border-radius: 10px; background: var(--n-950); color: var(--n-50); font-size: 11px; pointer-events: none; z-index: 2147483604; }
    .lr-focus-hint .lr-close { pointer-events: auto; }
    .lr-toast-stack { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); pointer-events: none; display: grid; gap: 8px; z-index: 2147483602; }
    .lr-toast-stack .toast { position: static; left: auto; bottom: auto; transform: none; }
    .lr-capture-toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; }
    .lr-capture-cancel { all: unset; cursor: pointer; padding: 2px 10px; border-radius: 999px; background: var(--n-950); color: var(--n-50); font-size: 11px; }
    .lr-template-row { display: flex; align-items: center; gap: 5px; min-width: 0; }
    .lr-template-label { display: none; }
    .lr-template-btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 1px 8px; border-radius: 999px; background: var(--n-100); color: var(--n-600); font-size: 10px; white-space: nowrap; }
    .lr-template-btn:hover { background: var(--n-200); color: var(--n-950); }

    .lr-insp { width: 372px; max-width: calc(100vw - 24px); overflow: hidden; }
    .lr-insp-sub { color: var(--n-500); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
    .lr-comment { all: unset; box-sizing: border-box; display: block; width: calc(100% - 20px); max-width: 100%; margin: 6px auto 0; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--n-100); color: var(--n-950); font-size: 12px; font-family: inherit; resize: vertical; min-height: 40px; }
    .lr-comment:focus { border-color: var(--accent); }
    .lr-insp-body { max-height: min(56vh, 540px); overflow-x: hidden; overflow-y: auto; padding: 2px 10px 8px; }
    .lr-sec { border-top: 1px solid var(--n-100); padding: 1px 0; }
    .lr-sec:first-child { border-top: none; }
    .lr-sec-head { all: unset; box-sizing: border-box; display: flex; width: 100%; cursor: pointer; align-items: center; justify-content: space-between; padding: 8px 2px; font-size: 12px; font-weight: 600; color: var(--n-700); }
    .lr-sec-head:hover { color: var(--n-900); }
    .lr-sec-chev { color: var(--n-500); font-size: 10px; transition: transform .15s; }
    .lr-sec[data-open] .lr-sec-chev { transform: rotate(180deg); }
    .lr-sec-body { display: flex; flex-direction: column; gap: 6px; padding: 2px 0 8px; }
    .lr-filter-bar { display: flex; align-items: center; gap: 4px; padding: 6px 0; }
    .lr-filter { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--n-50); color: var(--n-900); font-size: 12px; }
    .lr-filter:focus { border-color: var(--accent); }
    .lr-filter-clear { all: unset; box-sizing: border-box; cursor: pointer; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 5px; color: var(--n-500); font-size: 11px; }
    .lr-filter-clear:hover { background: var(--n-100); color: var(--n-900); }
    .lr-filter-empty { padding: 8px 2px; font-size: 12px; color: var(--n-500); }
    .lr-row { display: flex; align-items: center; gap: 8px; min-height: 28px; min-width: 0; flex-wrap: wrap; }
    .lr-row-wide { flex-direction: column; align-items: stretch; gap: 4px; }
    .lr-row-label { flex: none; width: 88px; min-width: 0; max-width: 40%; font-size: 11px; color: var(--n-500); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lr-row-static { display: block; min-width: 0; }
    .lr-row-static .lr-row-label { width: auto; max-width: none; font-weight: 600; color: var(--n-600); padding-bottom: 4px; }
    .lr-row-ctl { flex: 1 1 0; display: flex; align-items: center; gap: 6px; min-width: 0; justify-content: flex-start; }
    .lr-row-wide .lr-row-ctl { justify-content: flex-start; }
    .lr-reset { all: unset; cursor: pointer; flex: none; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 6px; color: var(--accent); font-size: 13px; }
    .lr-reset:hover { background: var(--n-200); }
    .lr-token-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; flex: 1 1 100%; }
    .lr-row-wide .lr-token-row { flex: initial; }
    .lr-row-static .lr-token-row { flex: initial; }
    .lr-token-label { flex: none; font-size: 10px; color: var(--n-500); }
    .lr-token-chip { all: unset; box-sizing: border-box; cursor: pointer; max-width: min(140px, 100%); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 7px; border-radius: 8px; background: var(--n-100); color: var(--accent); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .lr-token-chip:hover { background: var(--n-200); }
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
    .lr-cancel { all: unset; cursor: pointer; flex: 1; height: 30px; border-radius: 10px; background: var(--n-100); color: var(--n-700); font-size: 12px; display: grid; place-items: center; }
    .lr-cancel:hover { background: var(--n-200); color: var(--n-950); }
    .lr-confirm { all: unset; cursor: pointer; flex: 1; height: 30px; border-radius: 10px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 600; display: grid; place-items: center; }
    .lr-confirm:hover { filter: brightness(1.1); }
    .lr-confirm[data-disabled] { opacity: .55; pointer-events: none; }
    .root.dark .lr-cancel { background: var(--n-200); color: var(--n-950); }
    .root.dark .lr-confirm { background: var(--accent); color: #fff; }
    .root.contrast .lr-cancel { background: var(--n-200); color: var(--n-950); }
    .lr-undo, .lr-redo { all: unset; cursor: pointer; flex: none; height: 24px; padding: 0 9px; border-radius: 8px; background: var(--n-100); color: var(--n-700); font-size: 11px; display: grid; place-items: center; }
    .lr-undo:hover, .lr-redo:hover { background: var(--n-200); color: var(--n-950); }
    .lr-undo[data-disabled], .lr-redo[data-disabled] { opacity: .45; pointer-events: none; }
.lr-draw-canvas { position: fixed; inset: 0; pointer-events: none; touch-action: none; z-index: 2147483590; }
.lr-draw-canvas[data-on] { pointer-events: auto; cursor: crosshair; }
.lr-draw-canvas[data-tool="none"] { cursor: default; }
.popover { z-index: 2147483601; }
.toolbar-wrap { z-index: 2147483602; }
.root.lr-drawing .pin { pointer-events: none; }
.lr-drawbar { position: fixed; left: 12px; top: 50%; transform: translateY(-50%); display: none; flex-direction: column; gap: 4px; background: var(--n-100); border: 1px solid var(--line); border-radius: 12px; padding: 6px; box-shadow: var(--shadow); z-index: 2147483601; }
.lr-drawbar[data-dock="top"] { left: 50%; top: 12px; transform: translateX(-50%); flex-direction: row; align-items: center; gap: 2px; padding: 4px 6px; max-width: calc(100vw - 16px); overflow-x: auto; }
.lr-drawbar[data-on] { display: flex; }
.lr-dicon { display: inline-flex; width: 14px; height: 14px; }
.lr-dicon svg { display: block; }
.lr-dtool { all: unset; box-sizing: border-box; cursor: pointer; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--n-700); position: relative; }
.lr-dtool:hover { background: var(--n-200); color: var(--n-950); }
.lr-dtool[data-on] { background: var(--accent); color: #fff; }
.lr-dtool[data-disabled] { opacity: .45; pointer-events: none; }
.lr-dchev { position: absolute; right: 3px; bottom: 2px; display: inline-flex; opacity: .55; }
.lr-dchev svg { display: block; }
.lr-dcolor { width: 13px; height: 13px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--line); flex: none; }
.lr-dwdemo { display: block; width: 16px; border-bottom: 2px solid var(--n-700); flex: none; }
.lr-dsend { all: unset; box-sizing: border-box; cursor: pointer; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: var(--n-950); color: var(--n-50); transition: opacity 150ms ease; }
.lr-dsend:not([data-disabled]):active { transform: var(--press); }
.lr-dsend[data-disabled] { opacity: .3; pointer-events: none; }
.lr-dmenu { position: fixed; display: none; flex-direction: column; gap: 1px; background: var(--n-50); border: 1px solid var(--line); border-radius: 10px; padding: 4px; box-shadow: var(--shadow); z-index: 2147483602; min-width: 132px; }
.lr-dmenu[data-on] { display: flex; }
.lr-ditem { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 6px; color: var(--n-700); font-size: 12px; }
.lr-ditem:hover { background: var(--n-100); color: var(--n-950); }
.lr-ditem[data-on] { background: var(--n-100); color: var(--n-950); }
  
`;
  const absLayer = document.createElement("div");
  absLayer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483600;";
  const fixedLayer = document.createElement("div");
  fixedLayer.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483600;";
  shadow.append(styleEl, rootDiv);
  rootDiv.append(absLayer, fixedLayer);


  const ICONS_CANVAS = {
    brush: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>',
    eraser: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
    text: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>',
    rect: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
    circle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>',
    arrow: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    line: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19L19 5"/></svg>',
    step: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" stroke="none">1</text></svg>',
    undo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>',
    redo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0-5.5 5.5v0a5.5 5.5 0 0 0 5.5 5.5H13"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    chev: '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    grid: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>'
  };

  let drawMode = false;
  let drawTool = "brush";
  let drawColor = "#e5484d";
  let drawWidth = 2;
  let drawItems = [];
  let drawUndo = [];
  let drawRedo = [];
  let drawTyping = null;
  let drawSel = null;
  let drawDrag = null;
  let drawResize = null;
  let drawCanvas = null;
  let drawCtx = null;
  let drawBar = null;
  let drawDock = "left";
  let drawBtn = null;
  let drawLive = null;
  let drawMenu = null;
  let drawShapeIcon = null;
  let drawColorDot = null;
  let drawWidthDemo = null;
  let drawUndoBtn = null;
  let drawRedoBtn = null;
  let drawTrashBtn = null;
  let drawSendBtn = null;
  let drawSending = false;

  const SHAPE_DEFS = [
    { id: "line", label: "drawLine", icon: "line" },
    { id: "arrow", label: "drawArrow", icon: "arrow" },
    { id: "rect", label: "drawRect", icon: "rect" },
    { id: "ellipse", label: "drawCircle", icon: "circle" },
    { id: "step", label: "drawStep", icon: "step" }
  ];
  const DRAW_COLORS = [
    { value: "#e5484d", label: "drawRed" },
    { value: "#3b82f6", label: "drawBlue" },
    { value: "#22c55e", label: "drawGreen" },
    { value: "#111111", label: "drawBlack" },
    { value: "#ffffff", label: "drawWhite" }
  ];
  const DRAW_WIDTHS = [
    { value: 2, label: "drawThin" },
    { value: 4, label: "drawMedium" },
    { value: 7, label: "drawThick" }
  ];

  function saveDrawings() {
    bridgeSend("drawings.save", { items: drawItems.slice(0, 400) }).catch(() => {});
  }

  const cloneItems = (items) => JSON.parse(JSON.stringify(items));
  function snapshotDraw() {
    drawUndo.push(cloneItems(drawItems));
    if (drawUndo.length > 60) drawUndo.shift();
    drawRedo = [];
  }
  function undoDraw() {
    if (drawUndo.length === 0) return;
    drawRedo.push(cloneItems(drawItems));
    drawItems = drawUndo.pop();
    saveDrawings();
    redrawDrawings();
    updateDrawBarState();
  }
  function redoDraw() {
    if (drawRedo.length === 0) return;
    drawUndo.push(cloneItems(drawItems));
    drawItems = drawRedo.pop();
    saveDrawings();
    redrawDrawings();
    updateDrawBarState();
  }
  function clearDraw() {
    if (drawItems.length === 0) return;
    snapshotDraw();
    drawItems = [];
    saveDrawings();
    redrawDrawings();
    updateDrawBarState();
  }

  function drawUndoKeydown(event) {
    if (!drawMode || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      undoDraw();
      return true;
    }
    if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      redoDraw();
      return true;
    }
    return false;
  }

  function itemBBox(item) {
    if (item.type === "path") {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of item.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (item.type === "text") {
      let width = 40;
      if (drawCtx !== null) {
        drawCtx.font = "13px Segoe UI, system-ui, sans-serif";
        width = drawCtx.measureText(item.text).width;
      }
      return { x: item.x, y: item.y, w: width, h: 16 };
    }
    if (item.type === "step") return { x: item.x - 11, y: item.y - 11, w: 22, h: 22 };
    return { x: Math.min(item.x, item.x2), y: Math.min(item.y, item.y2), w: Math.abs(item.x2 - item.x), h: Math.abs(item.y2 - item.y) };
  }

  function itemHandles(item) {
    const h = [];
    const size = 8;
    const half = size / 2;
    const b = itemBBox(item);
    if (item.type === "rect" || item.type === "ellipse") {
      h.push({ id: "nw", x: b.x, y: b.y });
      h.push({ id: "ne", x: b.x + b.w, y: b.y });
      h.push({ id: "sw", x: b.x, y: b.y + b.h });
      h.push({ id: "se", x: b.x + b.w, y: b.y + b.h });
      h.push({ id: "n", x: b.x + b.w / 2, y: b.y });
      h.push({ id: "s", x: b.x + b.w / 2, y: b.y + b.h });
      h.push({ id: "w", x: b.x, y: b.y + b.h / 2 });
      h.push({ id: "e", x: b.x + b.w, y: b.y + b.h / 2 });
    } else if (item.type === "line" || item.type === "arrow") {
      h.push({ id: "p1", x: item.x, y: item.y });
      let mx = (item.x + item.x2) / 2, my = (item.y + item.y2) / 2;
      if (item.curved && item.cx !== undefined) {
        mx = (item.x + 2 * item.cx + item.x2) / 4;
        my = (item.y + 2 * item.cy + item.y2) / 4;
      }
      h.push({ id: "mid", x: mx, y: my });
      h.push({ id: "p2", x: item.x2, y: item.y2 });
    } else if (item.type === "text" || item.type === "step") {
      h.push({ id: "move", x: b.x + b.w / 2, y: b.y + b.h / 2, move: true });
    } else if (item.type === "path") {
    }
    return h.map((p) => ({ ...p, x0: p.x - half, y0: p.y - half, x1: p.x + half, y1: p.y + half, size }));
  }

  function hitTestHandle(item, x, y) {
    for (const h of itemHandles(item)) {
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h;
    }
    return null;
  }

  function resizeHandleCursor(id) {
    if (!id) return "default";
    if (id === "p1" || id === "p2" || id === "mid" || id === "move") return "move";
    if (id === "n" || id === "s") return "ns-resize";
    if (id === "e" || id === "w") return "ew-resize";
    if (id === "nw" || id === "se") return "nwse-resize";
    if (id === "ne" || id === "sw") return "nesw-resize";
    return "pointer";
  }

  function moveDrawItem(item, dx, dy) {
    if (item.type === "path") {
      for (const pt of item.points) { pt.x += dx; pt.y += dy; }
      return;
    }
    if (item.type === "text" || item.type === "step") { item.x += dx; item.y += dy; return; }
    item.x += dx;
    item.y += dy;
    item.x2 += dx;
    item.y2 += dy;
    if (item.curved && item.cx !== undefined) { item.cx += dx; item.cy += dy; }
  }

  function drawHit(item, x, y) {
    const tol = Math.max(6, (item.w ?? 2.5) + 4);
    if (item.type === "path") return item.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= tol);
    if (item.type === "text") {
      const b = itemBBox(item);
      return x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4;
    }
    if (item.type === "step") return Math.hypot(item.x - x, item.y - y) <= 14;
    if (item.type === "rect" || item.type === "ellipse") {
      const b = itemBBox(item);
      if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) return false;
      const nearEdge = Math.min(Math.abs(x - b.x), Math.abs(x - (b.x + b.w)), Math.abs(y - b.y), Math.abs(y - (b.y + b.h)));
      return nearEdge <= tol;
    }
    const dx = item.x2 - item.x, dy = item.y2 - item.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - item.x) * dx + (y - item.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (item.x + t * dx), y - (item.y + t * dy)) <= tol;
  }

  function hitTestDraw(x, y) {
    for (let i = drawItems.length - 1; i >= 0; i -= 1) {
      if (drawHit(drawItems[i], x, y)) return drawItems[i];
    }
    return null;
  }

  function eraseDrawItemAt(x, y) {
    if (drawTyping !== null) return false;
    const hit = hitTestDraw(x, y);
    if (hit === null) return false;
    snapshotDraw();
    drawItems.splice(drawItems.indexOf(hit), 1);
    saveDrawings();
    redrawDrawings();
    updateDrawBarState();
    return true;
  }

  function renderDrawItem(ctx, item, previewTo) {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = item.w ?? 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (item.type === "path") {
      ctx.beginPath();
      (previewTo ? [...item.points, previewTo] : item.points).forEach((pt, index) => {
        if (index === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    } else if (item.type === "rect") {
      const x2 = previewTo ? previewTo.x : item.x2, y2 = previewTo ? previewTo.y : item.y2;
      ctx.strokeRect(Math.min(item.x, x2), Math.min(item.y, y2), Math.abs(x2 - item.x), Math.abs(y2 - item.y));
    } else if (item.type === "ellipse") {
      const x2 = previewTo ? previewTo.x : item.x2, y2 = previewTo ? previewTo.y : item.y2;
      const cx = (item.x + x2) / 2, cy = (item.y + y2) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(x2 - item.x) / 2, Math.abs(y2 - item.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (item.type === "line" || item.type === "arrow") {
      const x2 = previewTo ? previewTo.x : item.x2, y2 = previewTo ? previewTo.y : item.y2;
      if (item.curved && item.cx !== undefined) {
        ctx.beginPath();
        ctx.moveTo(item.x, item.y);
        ctx.quadraticCurveTo(item.cx, item.cy, x2, y2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(item.x, item.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      if (item.type === "arrow") {
        let angle;
        if (item.curved && item.cx !== undefined) {
          angle = Math.atan2(y2 - item.cy, x2 - item.cx);
        } else {
          angle = Math.atan2(y2 - item.y, x2 - item.x);
        }
        const head = 12;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
        ctx.stroke();
      }
    } else if (item.type === "text") {
      ctx.font = "13px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "start";
      ctx.textBaseline = "top";
      ctx.fillText(item.text, item.x, item.y);
    } else if (item.type === "step") {
      ctx.beginPath();
      ctx.arc(item.x, item.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 12px Segoe UI, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(item.n ?? 1), item.x, item.y + 1);
      ctx.textAlign = "start";
    }
  }

  function redrawDrawings() {
    if (drawCtx === null) return;
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    for (const item of drawItems) renderDrawItem(drawCtx, item);
    if (drawLive !== null) renderDrawItem(drawCtx, drawLive.item, drawLive.to);
    if (drawTyping !== null) {
      drawCtx.font = "13px Segoe UI, system-ui, sans-serif";
      drawCtx.textAlign = "start";
      drawCtx.textBaseline = "top";
      drawCtx.fillStyle = drawTyping.color;
      drawCtx.fillText(drawTyping.text, drawTyping.x, drawTyping.y);
      const tw = drawCtx.measureText(drawTyping.text).width;
      drawCtx.fillRect(drawTyping.x + tw + 1, drawTyping.y, 1.5, 14);
    }
    if (drawSel !== null && drawItems.includes(drawSel)) {
      drawCtx.save();
      drawCtx.setLineDash([]);
      drawCtx.fillStyle = "#ffffff";
      drawCtx.strokeStyle = "#3b82f6";
      drawCtx.lineWidth = 1.5;
      for (const h of itemHandles(drawSel)) {
        drawCtx.fillRect(h.x - h.size / 2, h.y - h.size / 2, h.size, h.size);
        drawCtx.strokeRect(h.x - h.size / 2, h.y - h.size / 2, h.size, h.size);
      }
      drawCtx.restore();
    }
  }

  function resizeDrawCanvas() {
    if (drawCanvas === null) return;
    drawCanvas.width = window.innerWidth;
    drawCanvas.height = window.innerHeight;
    redrawDrawings();
  }

  function commitDrawTyping() {
    if (drawTyping === null) return;
    const text = drawTyping.text;
    const item = { type: "text", x: drawTyping.x, y: drawTyping.y, color: drawTyping.color, text };
    drawTyping = null;
    if (text !== "") {
      snapshotDraw();
      drawItems.push(item);
      saveDrawings();
      updateDrawBarState();
    }
    redrawDrawings();
  }

  function toggleDraw(on) {
    drawMode = typeof on === "boolean" ? on : !drawMode;
    if (drawMode) { setMode(null); if (groupMode) setGroupMode(false); closePanels(); }
    closeDrawMenu();
    drawSel = null;
    drawDrag = null;
    if (!drawMode && drawTyping !== null) commitDrawTyping();
    drawCanvas.toggleAttribute("data-on", drawMode);
    drawBar.toggleAttribute("data-on", drawMode);
    rootDiv.classList.toggle("lr-drawing", drawMode);
    if (drawBtn !== null) drawBtn.classList.toggle("tool-active", drawMode);
    if (drawMode) {
      resizeDrawCanvas();
      updateDrawBarState();
      setHint(t("drawHint"), 2600);
    } else {
      drawLive = null;
      redrawDrawings();
    }
  }

  function updateDrawBarState() {
    if (drawBar === null) return;
    drawUndoBtn?.toggleAttribute("data-disabled", drawUndo.length === 0);
    drawRedoBtn?.toggleAttribute("data-disabled", drawRedo.length === 0);
    drawTrashBtn?.toggleAttribute("data-disabled", drawItems.length === 0);
    drawSendBtn?.toggleAttribute("data-disabled", drawItems.length === 0 || drawSending);
  }

  function syncDrawTools() {
    if (drawBar === null) return;
    if (drawCanvas !== null) { drawCanvas.dataset.tool = drawTool ?? "none"; drawCanvas.style.cursor = ""; }
    const shape = SHAPE_DEFS.find((def) => def.id === drawTool);
    drawBar.querySelectorAll(".lr-dtool").forEach((btn) => {
      btn.toggleAttribute("data-on", btn.dataset.tool === drawTool || (btn.dataset.tool === "shapes" && shape !== undefined));
    });
    if (drawShapeIcon !== null) drawShapeIcon.innerHTML = shape !== undefined ? ICONS_CANVAS[shape.icon] : ICONS_CANVAS.rect;
  }

  function closeDrawMenu() {
    if (drawMenu !== null) {
      try { drawMenu.__lrCleanup?.(); } catch {}
      drawMenu.remove();
      drawMenu = null;
    }
  }

  function openDrawMenu(anchor, rows, onPick, current) {
    closeDrawMenu();
    drawMenu = el("div", { class: "lr-dmenu" });
    for (const row of rows) {
      const parts = [];
      if (row.icon !== undefined) { const ic = el("span", { class: "lr-dicon" }); ic.innerHTML = row.icon; parts.push(ic); }
      if (row.color !== undefined) { const dot = el("span", { class: "lr-dcolor" }); dot.style.background = row.color; parts.push(dot); }
      if (row.width !== undefined) { const demo = el("span", { class: "lr-dwdemo" }); demo.style.borderBottomWidth = `${row.width}px`; parts.push(demo); }
      const item = el("button", { class: "lr-ditem", type: "button" }, ...parts, el("span", {}, row.label));
      const active = typeof current === "function" ? current(row) : (row.key !== undefined ? row.key === current : row.value === current);
      if (active) item.setAttribute("data-on", "");
      item.addEventListener("click", () => { closeDrawMenu(); onPick(row.value); });
      drawMenu.append(item);
    }
    fixedLayer.append(drawMenu);
    drawMenu.toggleAttribute("data-on", true);
    const place = () => {
      if (drawMenu === null || !drawMenu.isConnected) return;
      const r = anchor.getBoundingClientRect();
      const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
      const mw = drawMenu.offsetWidth || 160;
      const mh = drawMenu.offsetHeight || 200;
      let left = r.right + 8;
      if (left + mw + 8 > vw) left = r.left - mw - 8;
      left = Math.max(8, Math.min(left, Math.max(8, vw - mw - 8)));
      let top = r.top - 4;
      if (top + mh + 8 > vh) top = vh - mh - 8;
      if (top < 8) top = 8;
      drawMenu.style.left = `${left}px`;
      drawMenu.style.top = `${top}px`;
      drawMenu.style.maxHeight = `${Math.max(120, vh - 16)}px`;
      drawMenu.style.overflowY = "auto";
    };
    place();
    requestAnimationFrame(place);
    const onReflow = () => place();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    drawMenu.__lrCleanup = () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }

  function openShapesMenu(anchor) {
    openDrawMenu(anchor, SHAPE_DEFS.map((def) => ({ value: def.id, label: t(def.label), icon: ICONS_CANVAS[def.icon] })), (value) => {
      if (drawTyping !== null) commitDrawTyping();
      drawTool = value;
      redrawDrawings();
      syncDrawTools();
    }, SHAPE_DEFS.some((def) => def.id === drawTool) ? drawTool : null);
  }

  function openColorMenu(anchor) {
    openDrawMenu(anchor, DRAW_COLORS.map((c) => ({ value: c.value, label: t(c.label), color: c.value })), (value) => {
      drawColor = value;
      if (drawColorDot !== null) drawColorDot.style.background = value;
    }, drawColor);
  }

  function openWidthMenu(anchor) {
    openDrawMenu(anchor, DRAW_WIDTHS.map((w) => ({ value: w.value, label: t(w.label), width: w.value })), (value) => {
      drawWidth = value;
      if (drawWidthDemo !== null) drawWidthDemo.style.borderBottomWidth = `${value}px`;
    }, drawWidth);
  }

  function buildDrawBar() {
    drawBar = el("div", { class: "lr-drawbar" });
    drawBar.setAttribute("data-dock", drawDock);
    drawBar.toggleAttribute("data-on", drawMode);
    const addTool = (id, labelKey, icon, onPick) => {
      const btn = el("button", { class: "lr-dtool", type: "button", title: t(labelKey) });
      if (icon !== "") {
        const ic = el("span", { class: "lr-dicon" });
        ic.innerHTML = icon;
        btn.append(ic);
      }
      const isActive = () => btn.dataset.tool === drawTool || (id === "shapes" && SHAPE_DEFS.some((def) => def.id === drawTool));
      const toggle = () => {
        closeDrawMenu();
        if (drawTyping !== null) commitDrawTyping();
        drawTool = isActive() ? null : id;
        drawSel = null;
        redrawDrawings();
        syncDrawTools();
      };
      if (onPick === undefined) {
        btn.addEventListener("click", toggle);
      } else {
        btn.addEventListener("click", () => {
          if (isActive()) toggle();
          else { closeDrawMenu(); onPick(btn); }
        });
      }
      btn.dataset.tool = id;
      drawBar.append(btn);
      return btn;
    };
    addTool("brush", "drawBrush", ICONS_CANVAS.brush);
    const shapeBtn = addTool("shapes", "drawShapes", ICONS_CANVAS.rect, (btn) => openShapesMenu(btn));
    drawShapeIcon = shapeBtn.querySelector(".lr-dicon");
    shapeBtn.append(el("span", { class: "lr-dchev", html: ICONS_CANVAS.chev }));
    addTool("eraser", "drawErase", ICONS_CANVAS.eraser);
    addTool("text", "drawText", ICONS_CANVAS.text);
    const colorBtn = addTool("color", "drawColor", "", (btn) => openColorMenu(btn));
    drawColorDot = el("span", { class: "lr-dcolor" });
    drawColorDot.style.background = drawColor;
    colorBtn.prepend(drawColorDot);
    colorBtn.append(el("span", { class: "lr-dchev", html: ICONS_CANVAS.chev }));
    const widthBtn = addTool("width", "drawWidth", "", (btn) => openWidthMenu(btn));
    drawWidthDemo = el("span", { class: "lr-dwdemo" });
    drawWidthDemo.style.borderBottomWidth = `${drawWidth}px`;
    widthBtn.prepend(drawWidthDemo);
    widthBtn.append(el("span", { class: "lr-dchev", html: ICONS_CANVAS.chev }));
    drawUndoBtn = addTool("undo", "drawUndo", ICONS_CANVAS.undo, () => undoDraw());
    drawRedoBtn = addTool("redo", "drawRedo", ICONS_CANVAS.redo, () => redoDraw());
    drawTrashBtn = addTool("trash", "drawClear", ICONS_CANVAS.trash, () => clearDraw());
    drawSendBtn = el("button", { class: "lr-dsend", type: "button", title: t("drawSend"), html: ICONS_CANVAS.plus });
    drawSendBtn.addEventListener("click", () => sendDrawingToChat());
    drawBar.append(drawSendBtn);
    const exit = el("button", { class: "lr-dtool", type: "button", title: t("drawExit") }, "✕");
    exit.dataset.tool = "exit";
    exit.addEventListener("click", () => toggleDraw(false));
    drawBar.append(exit);
    fixedLayer.append(drawBar);
    syncDrawTools();
    updateDrawBarState();
  }

  function commitStep(x, y) {
    snapshotDraw();
    const n = drawItems.reduce((max, item) => (item.type === "step" && (item.n ?? 0) > max ? item.n : max), 0) + 1;
    drawItems.push({ type: "step", x, y, color: drawColor, w: drawWidth, n });
    saveDrawings();
    redrawDrawings();
    updateDrawBarState();
  }

  async function sendDrawingToChat() {
    if (drawItems.length === 0 || drawSending) return;
    if (drawTyping !== null) commitDrawTyping();
    drawSending = true;
    updateDrawBarState();
    try {
      const rect = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
      const shot = await captureCropFor(rect, 0, true);
      if (shot === null) { toast(t("drawShotFail")); return; }
      pins.push({
        id: crypto.randomUUID(),
        tag: "canvas",
        role: "",
        label: t("drawTool"),
        selector: "canvas:drawing",
        text: "",
        component: "",
        comment: "",
        changes: [],
        pageUrl: PAGE_URL,
        rect,
        offsets: null,
        shot,
        status: "queued",
        at: Date.now()
      });
      savePins();
      renderPins();
      const sent = await postSnapshot();
      if (sent) {
        snapshotDraw();
        drawItems = [];
        drawSel = null;
        saveDrawings();
        redrawDrawings();
        updateDrawBarState();
        toast(t("drawSentHint"), 3600);
      }
    } finally {
      drawSending = false;
      updateDrawBarState();
    }
  }

  function onCanvasPointerDown(e) {
    if (!drawMode) return;
    if (e.button !== 0) return;
    if (drawMenu !== null) { closeDrawMenu(); return; }
    const x = e.clientX, y = e.clientY;
    if (drawTool !== "text" && drawTyping !== null) commitDrawTyping();
    if (drawTool === null) {
      if (drawSel !== null && drawItems.includes(drawSel)) {
        const handle = hitTestHandle(drawSel, x, y);
        if (handle) {
          drawCanvas.setPointerCapture?.(e.pointerId);
          snapshotDraw();
          drawResize = { item: drawSel, handle: handle.id, x, y, orig: cloneItems([drawSel])[0] };
          redrawDrawings();
          return;
        }
      }
      drawCanvas.setPointerCapture?.(e.pointerId);
      drawSel = hitTestDraw(x, y);
      drawDrag = drawSel !== null ? { x, y, moved: false } : null;
      redrawDrawings();
      return;
    }
    if (drawTool === "eraser") {
      drawCanvas.setPointerCapture?.(e.pointerId);
      eraseDrawItemAt(x, y);
      return;
    }
    if (drawTool === "text") {
      e.preventDefault();
      if (drawTyping !== null) commitDrawTyping();
      drawSel = null;
      drawTyping = { x, y, color: drawColor, text: "" };
      drawCanvas.focus({ preventScroll: true });
      redrawDrawings();
      return;
    }
    if (drawTool === "step") { e.preventDefault(); commitStep(x, y); return; }
    drawCanvas.setPointerCapture?.(e.pointerId);
    if (drawTool === "brush") drawLive = { item: { type: "path", color: drawColor, w: drawWidth, points: [{ x, y }] }, to: null };
    else drawLive = { item: { type: drawTool, color: drawColor, w: drawWidth, x, y, x2: x, y2: y }, to: { x, y } };
  }

  function applyResize(item, orig, handleId, x, y) {
    const dx = x - drawResize.x, dy = y - drawResize.y;
    if (item.type === "rect" || item.type === "ellipse") {
      let nx = orig.x, ny = orig.y, nx2 = orig.x2, ny2 = orig.y2;
      if (handleId.includes("e")) nx2 = orig.x2 + dx;
      if (handleId.includes("w")) nx = orig.x + dx;
      if (handleId.includes("s")) ny2 = orig.y2 + dy;
      if (handleId.includes("n")) ny = orig.y + dy;
      if (nx > nx2) { const t = nx; nx = nx2; nx2 = t; }
      if (ny > ny2) { const t = ny; ny = ny2; ny2 = t; }
      item.x = nx; item.y = ny; item.x2 = nx2; item.y2 = ny2;
    } else if (item.type === "line" || item.type === "arrow") {
      if (handleId === "p1") { item.x = orig.x + dx; item.y = orig.y + dy; }
      else if (handleId === "p2") { item.x2 = orig.x2 + dx; item.y2 = orig.y2 + dy; }
      else if (handleId === "mid") {
        const baseMx = (orig.x + orig.x2) / 2, baseMy = (orig.y + orig.y2) / 2;
        const onMx = baseMx + dx, onMy = baseMy + dy;
        item.cx = 2 * onMx - (item.x + item.x2) / 2;
        item.cy = 2 * onMy - (item.y + item.y2) / 2;
        item.curved = true;
      }
    } else if ((item.type === "text" || item.type === "step") && handleId === "move") {
      item.x = orig.x + dx;
      item.y = orig.y + dy;
    }
  }

  function onCanvasPointerMove(e) {
    if (drawResize !== null) {
      applyResize(drawResize.item, drawResize.orig, drawResize.handle, e.clientX, e.clientY);
      redrawDrawings();
      return;
    }
    if (drawDrag !== null) {
      if (!drawDrag.moved) { drawDrag.moved = true; }
      moveDrawItem(drawSel, e.clientX - drawDrag.x, e.clientY - drawDrag.y);
      drawDrag.x = e.clientX;
      drawDrag.y = e.clientY;
      redrawDrawings();
      return;
    }
    if (drawTool === "eraser" && e.buttons === 1) {
      eraseDrawItemAt(e.clientX, e.clientY);
      return;
    }
    if (drawLive === null) {
      if (drawTool === null && drawMode && drawSel !== null && drawItems.includes(drawSel)) {
        const h = hitTestHandle(drawSel, e.clientX, e.clientY);
        if (h) { drawCanvas.style.cursor = resizeHandleCursor(h.id); return; }
      }
      if (drawTool === null && drawMode) drawCanvas.style.cursor = hitTestDraw(e.clientX, e.clientY) !== null ? "move" : "default";
      return;
    }
    const to = { x: e.clientX, y: e.clientY };
    if (drawLive.item.type === "path") drawLive.item.points.push(to);
    drawLive.to = to;
    redrawDrawings();
  }

  function onCanvasPointerUp() {
    if (drawResize !== null) {
      drawResize = null;
      saveDrawings();
      updateDrawBarState();
      return;
    }
    if (drawDrag !== null) {
      const moved = drawDrag.moved;
      drawDrag = null;
      if (moved) { saveDrawings(); updateDrawBarState(); }
      return;
    }
    if (drawLive === null) return;
    const item = drawLive.item;
    const to = drawLive.to;
    drawLive = null;
    if (item.type === "path" && item.points.length < 2) return;
    if (item.type !== "path" && to !== null && Math.abs(to.x - item.x) < 4 && Math.abs(to.y - item.y) < 4) return;
    if (to !== null) { item.x2 = to.x; item.y2 = to.y; }
    snapshotDraw();
    drawItems.push(item);
    drawSel = item;
    drawTool = null;
    syncDrawTools();
    saveDrawings();
    redrawDrawings();
    updateDrawBarState();
  }

  function setupDrawCanvas() {
    drawCanvas = el("canvas", { class: "lr-draw-canvas" });
    drawCanvas.tabIndex = -1;
    resizeDrawCanvas();
    rootDiv.append(drawCanvas);
    drawCtx = drawCanvas.getContext("2d");
    redrawDrawings();
    buildDrawBar();
    drawCanvas.addEventListener("pointerdown", onCanvasPointerDown);
    drawCanvas.addEventListener("pointermove", onCanvasPointerMove);
    drawCanvas.addEventListener("pointerup", onCanvasPointerUp);
    drawCanvas.addEventListener("pointercancel", () => { drawLive = null; drawDrag = null; redrawDrawings(); });
    window.addEventListener("resize", resizeDrawCanvas);
  }

  function mountShadow() {
    if (host.parentNode === document.documentElement) return;
    document.documentElement.appendChild(host);
    installKeyShield();
  }

  function themeRootClass(theme) {
    if (theme === "light") return "root";
    if (theme === "contrast") return "root dark contrast";
    return "root dark";
  }








  let keyShieldInstalled = false;
  function installKeyShield() {
    if (keyShieldInstalled) return;
    keyShieldInstalled = true;
    const stop = (e) => e.stopPropagation();
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, stop, false);
    window.addEventListener("resize", clampOpenPanels);
  }
  function clampOpenPanels() {
    for (const node of [composerNode, pinPanelNode, adjustPanel]) {
      if (node === null || !node.isConnected) continue;
      node.style.transform = "none";
      node.style.left = `${clampPanelAxis(node.offsetLeft, node.offsetWidth, window.innerWidth, 8)}px`;
      node.style.top = `${clampPanelAxis(node.offsetTop, node.offsetHeight, window.innerHeight, 8)}px`;
    }
  }

  function isIconMarkup(child) {
    return typeof child === "string" && ICON_MARKUP.has(child);
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
      if (isIconMarkup(child)) {
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
  const commentBtn = el("button", { class: "tool", title: t("commentTitle") + " (" + formatHotkey(hotkeyComment) + ")", html: ICONS.comment }, el("span", { class: "tool-label" }, t("commentTool")), el("kbd", {}, formatHotkey(hotkeyComment)));
  const pendingSpan = el("span", { class: "tool-label", style: "display:none", title: t("pendingTitle") }, t("pendingCount").replace("{n}", 0));
  const adjustBtn = el("button", { class: "tool", title: t("adjustTitle") + " (" + formatHotkey(hotkeyAdjust) + ")", html: ICONS.sliders }, el("span", { class: "tool-label" }, t("adjustTool")), el("kbd", {}, formatHotkey(hotkeyAdjust)));
  const groupBtn = el("button", { class: "tool", title: t("groupBtn"), html: ICONS.group }, el("span", { class: "tool-label" }, t("groupBtn")));
  const viewportBtn = el("button", { class: "tool lr-viewport-btn", title: t("viewportLabel"), "aria-label": t("viewportLabel"), "aria-haspopup": "menu" }, el("span", { class: "tool-label lr-viewport-label" }, "100%"));
  viewportBtn.addEventListener("click", () => {
    const rows = [
      { value: { kind: "reset" }, label: "100%" },
      ...VIEWPORT_PRESETS.map((px) => ({ value: { kind: "width", px }, label: `${px}px` })),
      ...VIEWPORT_ZOOMS.map((pct) => ({ value: { kind: "zoom", pct }, label: `${pct}%` })),
    ];
    openDrawMenu(viewportBtn, rows, (value) => {
      if (!value || value.kind === "reset") applyViewportState({ w: null, z: 100 });
      else if (value.kind === "width") applyViewportState({ w: value.px, z: 100 });
      else if (value.kind === "zoom") applyViewportState({ w: vpWidth, z: value.pct });
    }, (row) => {
      if (!row || !row.value) return vpIsDefault();
      if (row.value.kind === "reset") return vpIsDefault();
      if (row.value.kind === "width") return vpWidth === row.value.px && vpZoom === 100;
      if (row.value.kind === "zoom") return vpZoom === row.value.pct;
      return false;
    });
  });
  function updateViewportBtn() {
    let label = "100%";
    if (vpWidth !== null && vpZoom !== 100) label = `${vpWidth}px · ${vpZoom}%`;
    else if (vpWidth !== null) label = `${vpWidth}px`;
    else if (vpZoom !== 100) label = `${vpZoom}%`;
    viewportBtn.querySelector(".lr-viewport-label").textContent = label;
    viewportBtn.classList.toggle("tool-active", !vpIsDefault());
  }
  const gridBtn = el("button", { class: "tool", title: t("layoutGrid"), "aria-label": t("layoutGrid"), html: ICONS_CANVAS.grid });
  gridBtn.addEventListener("click", () => {
    if (gridStepper !== null) setGrid(false);
    else if (gridOn) openGridStepper();
    else setGrid(true);
  });
  const eyeBtn = el("button", { class: "tool", title: "Mostrar/ocultar pins", html: ICONS.eye });
  const auditBtn = el("button", { class: "tool", title: t("a11yAuditPage"), "aria-label": t("a11yAuditPage"), html: ICONS.accessibility });
  auditBtn.addEventListener("click", () => {
    if (auditPanelNode !== null) closeAuditPanel();
    else openAuditPanel();
  });
    drawBtn = el("button", { class: "tool", title: t("drawTitle") + " (" + formatHotkey(hotkeyDraw) + ")", html: ICONS_CANVAS.brush }, el("span", { class: "tool-label" }, t("drawTool")), el("kbd", {}, formatHotkey(hotkeyDraw)));
    drawBtn.addEventListener("click", () => toggleDraw());
    toolbar.append(statusDot, divider, commentBtn, pendingSpan, adjustBtn, drawBtn, groupBtn, viewportBtn, gridBtn, eyeBtn, auditBtn);
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

  function applyOverlayLanguage() {
    const kbd = (key) => formatHotkey({ comment: hotkeyComment, adjust: hotkeyAdjust, draw: hotkeyDraw }[key]);
    commentBtn.title = t("commentTitle") + " (" + kbd("comment") + ")";
    commentBtn.querySelector(".tool-label").textContent = t("commentTool");
    commentBtn.querySelector("kbd").textContent = kbd("comment");
    adjustBtn.title = t("adjustTitle") + " (" + kbd("adjust") + ")";
    adjustBtn.querySelector(".tool-label").textContent = t("adjustTool");
    adjustBtn.querySelector("kbd").textContent = kbd("adjust");
    drawBtn.title = t("drawTitle") + " (" + kbd("draw") + ")";
    drawBtn.querySelector(".tool-label").textContent = t("drawTool");
    drawBtn.querySelector("kbd").textContent = kbd("draw");
    groupBtn.title = t("groupBtn");
    groupBtn.querySelector(".tool-label").textContent = t("groupBtn");
    viewportBtn.title = t("viewportLabel");
    viewportBtn.setAttribute("aria-label", t("viewportLabel"));
    gridBtn.title = t("layoutGrid");
    gridBtn.setAttribute("aria-label", t("layoutGrid"));
    auditBtn.title = t("a11yAuditPage");
    auditBtn.setAttribute("aria-label", t("a11yAuditPage"));
    if (auditPanelNode !== null) {
      const chip = auditPanelNode.querySelector(".chip");
      if (chip !== null) chip.textContent = t("a11yAuditPage");
    }
    updateViewportBtn();
    eyeBtn.title = t("eyeTitle");
    statusDot.title = t("statusTitle");
    pendingSpan.title = t("pendingTitle");
    if (adjustPanel !== null) rerenderAdjustRows();
    if (drawBar !== null) {
      const dockTitles = { brush: "drawBrush", shapes: "drawShapes", text: "drawText", color: "drawColor", width: "drawWidth", undo: "drawUndo", redo: "drawRedo", trash: "drawClear", exit: "drawExit" };
      drawBar.querySelectorAll(".lr-dtool").forEach((btn) => {
        const key = dockTitles[btn.dataset.tool];
        if (key) btn.title = t(key);
      });
      const send = drawBar.querySelector(".lr-dsend");
      if (send !== null) send.title = t("drawSend");
    }
    updateToolbar();
  }

  function resolveUiLang(raw) {
    if (raw && raw !== "auto") return ["en", "pt", "zh"].includes(raw) ? raw : UI_LANG;
    const l = (navigator.language || "en").toLowerCase();
    return l.startsWith("pt") ? "pt" : l.startsWith("zh") ? "zh" : "en";
  }

  // The host is the source of truth for the settings, but the page only takes
  // the initial screenshot flag and the crop padding from it: after that the
  // user owns both on this page.
  let hostSettingsApplied = false;
  let customTemplates = normalizeTemplates(SETTINGS.templates);
  function normalizeTemplates(value) {
    const fallback = [t("templateAlignDesign"), t("templateReduceSpacing"), t("templateIncreaseContrast"), t("templateFixOverflow"), t("templateExplainWhy")];
    if (!Array.isArray(value)) return fallback;
    const seen = new Set();
    const result = [];
    for (const entry of value) {
      const text = typeof entry === "string" ? entry : (entry !== null && typeof entry === "object" && typeof entry.text === "string" ? entry.text : "");
      const clean = text.trim().slice(0, 120);
      if (clean === "" || seen.has(clean)) continue;
      seen.add(clean);
      result.push(clean);
      if (result.length === 20) break;
    }
    return result;
  }
  function templateItems() {
    return customTemplates.length > 0 ? customTemplates : [t("templateAlignDesign"), t("templateReduceSpacing"), t("templateIncreaseContrast"), t("templateFixOverflow"), t("templateExplainWhy")];
  }
  function applySettings(next) {
    if (next === null || typeof next !== "object") return;
    if (!hostSettingsApplied) {
      hostSettingsApplied = true;
      if (typeof next.screenshot === "boolean") screenshotOnSend = next.screenshot;
      if (Number.isFinite(Number(next.cropPad))) CROP_PAD = Math.max(16, Math.min(200, Math.round(Number(next.cropPad))));
    }
    rootDiv.className = themeRootClass(next.theme);
    if (Array.isArray(next.templates)) customTemplates = normalizeTemplates(next.templates);
    if (typeof next.captureQuality === "string") captureQuality = ["leve", "padrao", "alta"].includes(next.captureQuality) ? next.captureQuality : "padrao";
    if (Number.isFinite(Number(next.captureTimeout))) captureTimeout = Math.max(0, Math.min(60, Math.round(Number(next.captureTimeout))));
    if (Number.isFinite(Number(next.auditLimit))) auditLimit = Math.max(50, Math.min(2000, Math.round(Number(next.auditLimit))));
    if (typeof next.drawDock === "string") drawDock = ["left", "top"].includes(next.drawDock) ? next.drawDock : "left";
    drawBar?.setAttribute("data-dock", drawDock);
    if (next.keys === null || typeof next.keys !== "object") return;
    let changed = false;
    const comment = parseHotkey(next.keys.comment);
    const adjust = parseHotkey(next.keys.adjust);
    const draw = parseHotkey(next.keys.draw);
    const hidePins = parseHotkey(next.keys.hidePins);
    if (comment !== undefined && formatHotkey(comment) !== formatHotkey(hotkeyComment)) { hotkeyComment = comment; changed = true; }
    if (adjust !== undefined && formatHotkey(adjust) !== formatHotkey(hotkeyAdjust)) { hotkeyAdjust = adjust; changed = true; }
    if (draw !== undefined && formatHotkey(draw) !== formatHotkey(hotkeyDraw)) { hotkeyDraw = draw; changed = true; }
    if (hidePins !== undefined && formatHotkey(hidePins) !== formatHotkey(hotkeyHidePins)) { hotkeyHidePins = hidePins; changed = true; }
    if (!changed) return;
    applyOverlayLanguage();
  }

  function updateToolbar() {
    const pending = pins.filter((p) => p.status === "queued").length;
    commentBtn.classList.toggle("tool-active", mode === "picking");
    adjustBtn.classList.toggle("tool-active", mode === "adjust");
    groupBtn.classList.toggle("tool-active", groupMode);
    gridBtn.classList.toggle("tool-active", gridOn);
    pendingSpan.textContent = pending > 0 ? t("pendingCount").replace("{n}", pending) : "";
    pendingSpan.style.display = pending > 0 ? "" : "none";
    eyeBtn.innerHTML = hidden ? ICONS.eyeOff : ICONS.eye;
    absLayer.style.display = hidden ? "none" : "";
  }

  const GRID_BOUNDS = { columns: [1, 24, 1], gutter: [0, 64, 4], margin: [0, 160, 8] };

  function gridGeometry(columns, innerWidth, gutter, margin) {
    const columnWidth = Math.max(0, (innerWidth - margin * 2 - (columns - 1) * gutter) / columns);
    return { margin, gutter, columnWidth, columns };
  }

  function renderGrid() {
    if (!gridOn) return;
    gridLayer?.remove();
    const geometry = gridGeometry(gridColumns, window.innerWidth, gridGutter, gridMargin);
    const bands = [];
    for (let index = 0; index < geometry.columns; index += 1) {
      const band = el("div", { class: "lr-grid-band" });
      band.style.left = `${geometry.margin + index * (geometry.columnWidth + geometry.gutter)}px`;
      band.style.width = `${geometry.columnWidth}px`;
      bands.push(band);
    }
    gridLayer = el("div", { class: gridOutline ? "lr-grid lr-outline" : "lr-grid" }, ...bands);
    fixedLayer.append(gridLayer);
  }

  function gridAdjust(key, delta) {
    const bounds = GRID_BOUNDS[key];
    const current = key === "columns" ? gridColumns : key === "gutter" ? gridGutter : gridMargin;
    const next = Math.max(bounds[0], Math.min(bounds[1], current + delta * bounds[2]));
    if (next === current) return;
    if (key === "columns") gridColumns = next;
    else if (key === "gutter") gridGutter = next;
    else gridMargin = next;
    renderGrid();
    const value = gridStepper?.querySelector(`[data-grid-value="${key}"]`);
    if (value !== undefined && value !== null) value.textContent = `${next}`;
  }

  function closeGridStepper() {
    if (gridStepper === null) return;
    try { gridStepper.__lrCleanup?.(); } catch {}
    gridStepper.remove();
    gridStepper = null;
  }

  function openGridStepper() {
    closeGridStepper();
    const row = (label, key) => el("div", { class: "lr-grid-row" }, el("span", { class: "lr-grid-row-label" }, t(label)), el("span", { class: "lr-grid-stepper" }, el("button", { class: "lr-grid-step-btn", type: "button", onclick: () => gridAdjust(key, -1) }, "−"), el("span", { class: "lr-grid-step-value", "data-grid-value": key }, `${key === "columns" ? gridColumns : key === "gutter" ? gridGutter : gridMargin}`), el("button", { class: "lr-grid-step-btn", type: "button", onclick: () => gridAdjust(key, 1) }, "+")));
    const styleButton = (key, label) => el("button", { class: "lr-grid-style-btn", type: "button", "data-grid-style": key, "data-on": gridOutline === (key === "outline") ? "" : null, onclick: () => { gridOutline = key === "outline"; renderGrid(); gridStepper?.querySelectorAll(".lr-grid-style-btn").forEach((b) => b.toggleAttribute("data-on", b.dataset.gridStyle === key)); } }, t(label));
    gridStepper = el("div", { class: "lr-grid-step" },
      row("gridColumns", "columns"),
      row("gridGutter", "gutter"),
      row("gridMargin", "margin"),
      el("div", { class: "lr-grid-row" }, el("span", { class: "lr-grid-row-label" }, " "), el("span", { class: "lr-grid-style" }, styleButton("fill", "gridFill"), styleButton("outline", "gridOutline"))));
    fixedLayer.append(gridStepper);
    const place = () => {
      if (gridStepper === null || !gridStepper.isConnected) return;
      const r = gridBtn.getBoundingClientRect();
      gridStepper.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 224))}px`;
      gridStepper.style.top = `${Math.max(8, r.top - gridStepper.offsetHeight - 6)}px`;
    };
    place();
    requestAnimationFrame(place);
    const dismiss = (event) => {
      if (gridStepper === null) return;
      const path = event.composedPath?.() ?? [];
      if (path.includes(gridStepper) || path.includes(gridBtn)) return;
      closeGridStepper();
    };
    document.addEventListener("pointerdown", dismiss, true);
    gridStepper.__lrCleanup = () => {
      document.removeEventListener("pointerdown", dismiss, true);
    };
  }

  function setGrid(on) {
    if (on === gridOn) return;
    gridOn = on;
    updateToolbar();
    if (on) {
      renderGrid();
      gridResize = () => renderGrid();
      window.addEventListener("resize", gridResize);
    } else {
      gridLayer?.remove();
      gridLayer = null;
      closeGridStepper();
      if (gridResize !== null) {
        window.removeEventListener("resize", gridResize);
        gridResize = null;
      }
    }
  }

  function meterReference() {
    if (adjustPanel !== null && adjustTarget !== null) return adjustTarget;
    if (openPinId !== null) {
      const pin = pins.find((candidate) => candidate.id === openPinId);
      if (pin !== undefined) return locate(pin.selector);
    }
    return null;
  }

  function meterGaps(aRect, bRect) {
    let horizontal = null;
    if (bRect.left >= aRect.right) horizontal = bRect.left - aRect.right;
    else if (aRect.left >= bRect.right) horizontal = aRect.left - bRect.right;
    let vertical = null;
    if (bRect.top >= aRect.bottom) vertical = bRect.top - aRect.bottom;
    else if (aRect.top >= bRect.bottom) vertical = aRect.top - bRect.bottom;
    return { horizontal, vertical };
  }

  function clearMeter() {
    if (meterRaf !== 0) {
      cancelAnimationFrame(meterRaf);
      meterRaf = 0;
    }
    meterLayer?.remove();
    meterLayer = null;
  }

  function renderMeter(target) {
    if (!meterAlt || meterRef === null || target === null || target === meterRef) {
      clearMeter();
      return;
    }
    if (meterRaf !== 0) return;
    meterRaf = requestAnimationFrame(() => {
      meterRaf = 0;
      if (!meterAlt || meterRef === null || target === null || target === meterRef) {
        clearMeter();
        return;
      }
      const refRect = meterRef.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const gaps = meterGaps(refRect, targetRect);
      meterLayer?.remove();
      const parts = [];
      if (gaps.horizontal !== null) {
        const bRightOfA = targetRect.left >= refRect.right;
        const x1 = bRightOfA ? refRect.right : targetRect.right;
        const x2 = bRightOfA ? targetRect.left : refRect.left;
        const y = (Math.max(refRect.top, targetRect.top) + Math.min(refRect.bottom, targetRect.bottom)) / 2;
        parts.push(el("div", { class: "lr-meter-line", style: `left:${Math.min(x1, x2)}px;top:${y}px;width:${Math.abs(x2 - x1)}px;height:0` }));
        parts.push(el("span", { class: "lr-meter-label", style: `left:${(x1 + x2) / 2}px;top:${y}px` }, `${Math.round(gaps.horizontal)}px`));
      }
      if (gaps.vertical !== null) {
        const bBelowA = targetRect.top >= refRect.bottom;
        const y1 = bBelowA ? refRect.bottom : targetRect.bottom;
        const y2 = bBelowA ? targetRect.top : refRect.top;
        const x = (Math.max(refRect.left, targetRect.left) + Math.min(refRect.right, targetRect.right)) / 2;
        parts.push(el("div", { class: "lr-meter-line lr-meter-line-v", style: `left:${x}px;top:${Math.min(y1, y2)}px;width:0;height:${Math.abs(y2 - y1)}px` }));
        parts.push(el("span", { class: "lr-meter-label", style: `left:${x}px;top:${(y1 + y2) / 2}px` }, `${Math.round(gaps.vertical)}px`));
      }
      parts.push(el("div", { class: "lr-meter-box", style: `left:${refRect.left}px;top:${refRect.top}px;width:${refRect.width}px;height:${refRect.height}px` }));
      parts.push(el("div", { class: "lr-meter-box", style: `left:${targetRect.left}px;top:${targetRect.top}px;width:${targetRect.width}px;height:${targetRect.height}px` }));
      meterLayer = el("div", { class: "lr-meter" }, ...parts);
      fixedLayer.append(meterLayer);
    });
  }

  function resetMeter() {
    meterAlt = false;
    meterRef = null;
    clearMeter();
  }

  function meterAltKeydown(event) {
    if (event.key !== "Alt") return false;
    event.preventDefault();
    if (!meterAlt) {
      meterAlt = true;
      meterRef = meterReference();
      if (meterRef === null) setHint(t("distanceMeter"));
    }
    return true;
  }

  function meterAltKeyup(event) {
    if (event.key !== "Alt") return false;
    event.preventDefault();
    meterAlt = false;
    clearMeter();
    return true;
  }

  function setHidden(next) {
    hidden = next;
    if (hidden) {
      openPinId = null;
      pinPanelNode?.remove();
      pinPanelNode = null;
      a11yFixHandler.current = null;
      exitFocusMode();
      closeAuditPanel();
      discardDraft();
      if (groupComposerNode !== null) setGroupMode(false);
    }
    updateToolbar();
    renderPins();
  }


  let highlightEl = null;
  let highlightLabel = null;
  let hoverRaf = null;
  let hoverPendingTarget = null;
  function scheduleHighlight(target) {
    hoverPendingTarget = target;
    if (hoverRaf !== null) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = null;
      const pending = hoverPendingTarget;
      hoverPendingTarget = null;
      if (pending === null) return;
      if ((mode === null && !groupMode) || draft !== null) return;
      showHighlight(pending);
    });
  }
  function clearHighlight() {
    if (hoverRaf !== null) {
      cancelAnimationFrame(hoverRaf);
      hoverRaf = null;
    }
    hoverPendingTarget = null;
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

  let revealTimer = null;
  function revealSelector(selector) {
    const target = locate(selector);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    showHighlight(target);
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { clearHighlight(); revealTimer = null; }, 2000);
  }

  function focusSpotlightRect(rect) {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function exitFocusMode() {
    focusState.current = null;
    focusSpotlightNode?.remove();
    focusSpotlightNode = null;
    focusHintNode?.remove();
    focusHintNode = null;
    if (focusRepositionTimer !== null) {
      clearTimeout(focusRepositionTimer);
      focusRepositionTimer = null;
    }
  }

  function enterFocusMode(pin) {
    const target = locate(pin.selector);
    if (target === null) return;
    const label = quickLabel(target);
    const rect = target.getBoundingClientRect();
    focusState.current = { selector: pin.selector, label, rect };
    const box = focusSpotlightRect(rect);
    focusSpotlightNode = el("div", { class: "lr-focus-spotlight" });
    Object.assign(focusSpotlightNode.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    rootDiv.append(focusSpotlightNode);
    focusHintNode = el("div", { class: "lr-focus-hint" },
      el("span", {}, t("focusModeActive").replace("{label}", label)),
      el("button", { class: "lr-close", title: t("focusModeDismiss"), type: "button", onclick: () => exitFocusMode() }, "✕"));
    rootDiv.append(focusHintNode);
    if (focusRepositionTimer !== null) clearTimeout(focusRepositionTimer);
    focusRepositionTimer = setTimeout(() => { focusRepositionTimer = null; repositionFocus(); }, 0);
  }

  function toggleFocusMode(pin) {
    if (focusState.current !== null) {
      exitFocusMode();
      return;
    }
    enterFocusMode(pin);
  }

  function repositionFocus() {
    if (focusState.current === null) return;
    const target = locate(focusState.current.selector);
    if (target === null) return;
    const rect = target.getBoundingClientRect();
    focusState.current.rect = rect;
    if (focusSpotlightNode === null) return;
    const box = focusSpotlightRect(rect);
    Object.assign(focusSpotlightNode.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  }

  document.addEventListener(
    "mousemove",
    (event) => {
      const inHost = event.composedPath().some((n) => n === host || (n instanceof Node && host.contains(n)));
      if (meterAlt && meterRef !== null && !inHost) {
        renderMeter(event.target instanceof Element ? event.target : null);
      }
      if ((mode === null && !groupMode) || draft !== null) return;
      if (inHost) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target === hovered) return;
      scheduleHighlight(target);
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (mode === null && !groupMode) return;
      if (event.composedPath().some((n) => n === host || (n instanceof Node && host.contains(n)))) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (mode === "picking") {
        if (duplicateArmed !== null) createDuplicatePin(target, event);
        else openDraft(target, event);

        setMode(null);
      } else if (mode === "adjust") {
        openAdjustPanel(target);
        setMode(null);
      } else if (groupMode) {
        event.preventDefault();
        event.stopPropagation();
        void groupPick(target);
      }
    },
    true
  );

  function handleEscape(event) {
    if (gridStepper !== null) {
      closeGridStepper();
      return true;
    }
    resetMeter();
    if (focusState.current !== null) {
      exitFocusMode();
      return true;
    }
    if (drawMode) { toggleDraw(false); return true; }
    if (groupMode) { setGroupMode(false); return true; }
    if (adjustPanel !== null) {
      closeAdjustPanel(true);
      return true;
    }
    if (openPinId !== null) {
      openPinId = null;
      pinPanelNode?.remove();
      pinPanelNode = null;
      a11yFixHandler.current = null;
      exitFocusMode();
      return true;
    }
    if (auditPanelNode !== null) {
      closeAuditPanel();
      return true;
    }
    if (draft !== null) {
      discardDraft();
    } else if (mode !== null) setMode(null);
    return true;
  }

  document.addEventListener(
    "keydown",
    (event) => {
      const from = event.composedPath?.()[0] ?? event.target;
      const tag = from?.tagName;
      if (meterAltKeydown(event)) return;
      if (event.key === "Escape" && captureAbort !== null) {
        event.preventDefault();
        event.stopPropagation();
        captureAbort();
        return;
      }
      if (tag === "INPUT" || tag === "TEXTAREA" || from?.isContentEditable === true) return;
      if (adjustPanel !== null && (event.ctrlKey || event.metaKey) && !event.altKey) {
        const undoKey = event.key.toLowerCase();
        const undoShortcut = undoKey === "z" && !event.shiftKey;
        const redoShortcut = (undoKey === "z" && event.shiftKey) || undoKey === "y";
        if (undoShortcut || redoShortcut) {
          event.preventDefault();
          if (redoShortcut) adjustRedo();
          else adjustUndo();
          return;
        }
      }
      if (drawUndoKeydown(event)) return;
      if (drawMode && drawTyping === null && drawSel !== null && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        snapshotDraw();
        drawItems = drawItems.filter((item) => item !== drawSel);
        drawSel = null;
        saveDrawings();
        redrawDrawings();
        updateDrawBarState();
        return;
      }
      if (drawMode && drawTyping !== null && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (event.key === "Enter") commitDrawTyping();
        else if (event.key === "Escape") { drawTyping = null; redrawDrawings(); }
        else if (event.key === "Backspace") { drawTyping.text = drawTyping.text.slice(0, -1); redrawDrawings(); }
        else if (event.key.length === 1) { drawTyping.text += event.key; redrawDrawings(); }
        return;
      }
      // One key arms one mode: the first match wins, so a settings file that names the same key
      // for two modes cannot arm both at once.
      if (hotkeyMatches(event, hotkeyComment)) { if (drawMode) toggleDraw(false); setMode(mode === "picking" ? null : "picking"); }
      else if (hotkeyMatches(event, hotkeyAdjust)) { if (drawMode) toggleDraw(false); setMode(mode === "adjust" ? null : "adjust"); }
      else if (hotkeyMatches(event, hotkeyDraw)) toggleDraw();
      else if (hotkeyMatches(event, hotkeyHidePins)) setHidden(!hidden);
      if (event.key === "Escape") {
        handleEscape(event);
        return;
      }
      if (event.key === "Enter" && groupMode && groupComposerNode === null) {
        event.preventDefault();
        openGroupComposer();
      }
    },
    true
  );

  document.addEventListener(
    "keyup",
    (event) => {
      meterAltKeyup(event);
    },
    true
  );

  function setMode(next) {
    mode = mode === next ? null : next;
    if (mode !== "picking" && duplicateArmed !== null) duplicateArmed = null;
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
  commentBtn.addEventListener("click", () => { if (drawMode) toggleDraw(false); if (groupMode) setGroupMode(false); setMode("picking"); });
  adjustBtn.addEventListener("click", () => { if (drawMode) toggleDraw(false); if (groupMode) setGroupMode(false); setMode("adjust"); });
  groupBtn.addEventListener("click", () => {
    if (groupMode && groupComposerNode !== null) {
      groupComposerNode.querySelector("textarea")?.focus({ preventScroll: true });
      return;
    }
    if (groupMode && groupPicks.length > 0) {
      openGroupComposer();
      return;
    }
    setGroupMode(!groupMode);
  });
  eyeBtn.addEventListener("click", () => {
    setHidden(!hidden);
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
    return { x: rect.left + ox, y: rect.top + oy };
  }

  function pinDimensions(pin) {
    const el2 = locate(pin.selector);
    if (el2) {
      const r = el2.getBoundingClientRect();
      return `${Math.round(r.width)}×${Math.round(r.height)}`;
    }
    return `${Math.round(pin.rect.w)}×${Math.round(pin.rect.h)}`;
  }

  function draftPoint() {
    if (!draft) return null;
    const rect = draft.anchorEl.getBoundingClientRect();
    const ox = Math.min(Math.max(0, draft.offsets.ox), rect.width);
    const oy = Math.min(Math.max(0, draft.offsets.oy), rect.height);
    return { x: rect.left + ox, y: rect.top + oy };
  }

  const pinNodes = new Map();
  const pinIoIds = new Map();
  const pinIoNear = new Map();
  const pinIoRects = new Map();
  const pinLastPoints = new Map();
  const edgeChips = [];
  const pulseTimers = new Map();
  let repositionRaf = null;
  let pinObserver = null;

  function renderPins() {
    mountShadow();
    const alive = new Set();
    if (!hidden) {
      for (const pin of pins) {
        if (pin.status === "resolvido") continue;
        alive.add(pin.id);
        let node = pinNodes.get(pin.id)?.node;
        const point = anchorPoint(pin) ?? (pin.stale === true ? null : { x: pin.rect.x, y: pin.rect.y });
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
        node.className = `pin pin-${pinVariant(pin)}${pin.stale === true ? " lr-pin-stale" : ""}${openPinId === pin.id ? " pin-open" : ""}`;
        if (point) node.style.transform = `translate(${point.x}px, ${point.y}px)`;
        const number = pins.filter((p) => p.status !== "resolvido").indexOf(pin) + 1;
        const glyph = pin.status === "resolvido" ? ICONS.check : String(number || "•");
        node.querySelector(".pin-body").innerHTML = `<span class="pin-glyph">${glyph}</span>`;
      }
    }
    for (const [id, entry] of [...pinNodes]) {
      if (!alive.has(id)) {
        entry.node.remove();
        pinNodes.delete(id);
        pinIoNear.delete(id);
        pinIoRects.delete(id);
        pinLastPoints.delete(id);
      }
    }
    if (!hidden) syncPinObserver();
    updateToolbar();
    updateEdgeMarkers();
  }

  function scheduleReposition() {
    if (repositionRaf !== null) return;
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = null;
      repositionPins();
    });
  }
  function pinIsFar(id) {
    const rect = pinIoRects.get(id);
    return pinIoNear.get(id) === false && rect !== undefined && (rect.width > 0 || rect.height > 0);
  }
  function repositionPins() {
    for (const [id, entry] of pinNodes) {
      const pin = pins.find((p) => p.id === id);
      if (!pin) continue;
      if (pinIsFar(id)) continue;
      const point = anchorPoint(pin);
      if (point) {
        entry.node.style.transform = `translate(${point.x}px, ${point.y}px)`;
        pinLastPoints.set(id, point);
        if (pin.stale === true) {
          pin.stale = false;
          entry.node.classList.remove("lr-pin-stale");
        }
      }
    }
    repositionDraft();
    repositionFocus();
    updateEdgeMarkers();
  }
  function syncPinObserver() {
    if (typeof IntersectionObserver !== "function") return;
    if (pinObserver === null) {
      pinObserver = new IntersectionObserver((entries) => {
        let entered = false;
        for (const entry of entries) {
          const id = pinIoIds.get(entry.target);
          if (id === undefined) continue;
          pinIoRects.set(id, entry.boundingClientRect);
          pinIoNear.set(id, entry.isIntersecting);
          if (entry.isIntersecting) entered = true;
        }
        if (entered) scheduleReposition();
      }, { rootMargin: "480px" });
    }
    const wanted = new Map();
    for (const pin of pins) {
      if (pin.status === "resolvido" || pin.tag === "canvas") continue;
      const element = locate(pin.selector);
      if (element !== null) wanted.set(element, pin.id);
    }
    for (const [element, id] of [...pinIoIds]) {
      if (wanted.has(element)) continue;
      pinObserver.unobserve(element);
      pinIoIds.delete(element);
      pinIoNear.delete(id);
      pinIoRects.delete(id);
    }
    for (const [element, id] of wanted) {
      if (pinIoIds.has(element)) continue;
      pinIoIds.set(element, id);
      pinObserver.observe(element);
    }
  }
  function updateEdgeMarkers() {
    for (const node of edgeChips) node.remove();
    edgeChips.length = 0;
    if (hidden) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const lanes = new Map();
    for (const pin of pins) {
      if (pin.status === "resolvido") continue;
      const ioRect = pinIoRects.get(pin.id);
      let point = pinIsFar(pin.id) && ioRect ? { x: ioRect.left + ioRect.width / 2, y: ioRect.top + ioRect.height / 2 } : pinLastPoints.get(pin.id) ?? null;
      if (point === null && pin.rect) point = { x: pin.rect.x, y: pin.rect.y };
      if (point === null) continue;
      if (point.x >= 0 && point.x <= vw && point.y >= 0 && point.y <= vh) continue;
      const overLeft = -point.x;
      const overRight = point.x - vw;
      const overTop = -point.y;
      const overBottom = point.y - vh;
      const overX = Math.max(overLeft, overRight);
      const overY = Math.max(overTop, overBottom);
      const side = overX >= overY ? (overLeft >= overRight ? "left" : "right") : (overTop >= overBottom ? "top" : "bottom");
      const along = side === "left" || side === "right" ? Math.min(Math.max(24, point.y), vh - 24) : Math.min(Math.max(24, point.x), vw - 24);
      const laneKey = `${side}:${Math.round(along / 32)}`;
      const lane = lanes.get(laneKey);
      if (lane) lane.pins.push(pin);
      else lanes.set(laneKey, { side, along, pins: [pin] });
    }
    for (const lane of lanes.values()) {
      const count = lane.pins.length;
      const number = pins.filter((p) => p.status !== "resolvido").indexOf(lane.pins[0]) + 1;
      const chip = el("button", { class: "lr-edge-pin", "data-side": lane.side, type: "button", title: lane.pins[0].comment });
      chip.append(el("span", { class: "lr-edge-arrow", html: ICONS_CANVAS.chev }), el("span", { class: "lr-edge-count" }, count > 1 ? String(count) : String(number || "•")));
      chip.addEventListener("click", () => {
        const pin = lane.pins[0];
        const element = pin.tag === "canvas" ? null : locate(pin.selector);
        if (element !== null) element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        else if (pin.rect) window.scrollTo({ top: Math.max(0, pin.rect.y - window.innerHeight / 2), behavior: "smooth" });
        scheduleReposition();
        pulsePin(pin.id);
      });
      if (lane.side === "left" || lane.side === "right") {
        if (lane.side === "left") chip.style.left = "3px";
        else chip.style.right = "3px";
        chip.style.top = `${lane.along - 11}px`;
      } else if (lane.side === "top") {
        chip.style.top = "3px";
        chip.style.left = `${lane.along}px`;
        chip.style.transform = "translateX(-50%)";
      } else {
        chip.style.bottom = "3px";
        chip.style.left = `${lane.along}px`;
        chip.style.transform = "translateX(-50%)";
      }
      fixedLayer.append(chip);
      edgeChips.push(chip);
    }
  }
  function pulsePin(id) {
    const entry = pinNodes.get(id);
    if (!entry) return;
    entry.node.classList.add("lr-pin-pulse");
    const timer = pulseTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pulseTimers.set(id, setTimeout(() => {
      pulseTimers.delete(id);
      entry.node.classList.remove("lr-pin-pulse");
    }, 1400));
  }
  function repositionDraft() {
    if (draft === null || draftNode === null || composerNode === null) return;
    const point = draftPoint();
    if (point === null) return;
    draftNode.style.transform = `translate(${point.x}px, ${point.y}px)`;
    if (panelPositions.composer === null) {
      if (placeComposerDefault !== null) placeComposerDefault();
    } else {
      applyPanelPosition(composerNode, "composer");
    }
  }
  function auditPinAnchors() {
    for (const pin of pins) {
      if (pin.tag === "canvas") continue;
      const found = locate(pin.selector) !== null;
      const node = pinNodes.get(pin.id)?.node;
      if (found) {
        if (pin.stale === true) {
          pin.stale = false;
          node?.classList.remove("lr-pin-stale");
        }
      } else {
        pin.stale = true;
        node?.classList.add("lr-pin-stale");
      }
    }
  }
  window.addEventListener("scroll", scheduleReposition, { passive: true });
  window.addEventListener("resize", scheduleReposition);
  let mutationTimer = null;
  new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      scheduleReposition();
      auditPinAnchors();
    }, 400);
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
        pin.stale = false;
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

  function reanchorPin(pin, element) {
    pin.selector = cssPath(element);
    pin.stale = false;
    const rect = element.getBoundingClientRect();
    pin.offsets = { ox: rect.width / 2, oy: rect.height / 2 };
    pin.rect = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    savePins();
    renderPins();
  }

  function insidePage(point) {
    return {
      x: Math.max(0, Math.min(point.x, document.documentElement.clientWidth - 1)),
      y: Math.max(0, Math.min(point.y, document.documentElement.clientHeight - 1))
    };
  }

  const PANEL_DRAG_THRESHOLD = 4;
  function isInteractivePanelTarget(target) {
    return target !== null && typeof target.closest === "function" &&
      target.closest("button, a, input, select, textarea, [contenteditable]") !== null;
  }
  function wirePanelDrag(panel, kind, placeDefault) {
    const handle = panel.querySelector(":scope > .composer-target");
    if (handle === null) return;
    handle.title = t("panelDrag");
    handle.setAttribute("aria-label", t("panelDrag"));
    let source = null;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;
    let dragged = false;
    let frame = 0;
    let nextLeft = 0;
    let nextTop = 0;
    const freeze = () => {
      panel.style.transform = "none";
      panel.style.left = `${panel.offsetLeft}px`;
      panel.style.top = `${panel.offsetTop}px`;
      baseLeft = panel.offsetLeft;
      baseTop = panel.offsetTop;
    };
    const paint = () => {
      frame = 0;
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    };
    const begin = (x, y) => {
      if (source !== null) return false;
      startX = x;
      startY = y;
      dragged = false;
      return true;
    };
    const stroke = (x, y) => {
      const dx = x - startX;
      const dy = y - startY;
      if (!dragged) {
        if (Math.hypot(dx, dy) < PANEL_DRAG_THRESHOLD) return;
        dragged = true;
        freeze();
      }
      handle.toggleAttribute("data-dragging", dragged);
      nextLeft = clampPanelAxis(baseLeft + dx, panel.offsetWidth, window.innerWidth, 8);
      nextTop = clampPanelAxis(baseTop + dy, panel.offsetHeight, window.innerHeight, 8);
      if (frame === 0) frame = requestAnimationFrame(paint);
    };
    const finish = () => {
      source = null;
      handle.toggleAttribute("data-dragging", false);
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        frame = 0;
        if (dragged) paint();
      }
      if (!dragged || !panel.isConnected) return;
      dragged = false;
      const rect = panel.getBoundingClientRect();
      panelPositions[kind] = { x: Math.round(rect.left), y: Math.round(rect.top) };
      savePanelPositions();
    };
    if (typeof window.PointerEvent === "function") {
      const move = (event) => {
        if (event.pointerId !== source) return;
        stroke(event.clientX, event.clientY);
      };
      const end = (event) => {
        if (event.pointerId !== source) return;
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        handle.removeEventListener("lostpointercapture", end);
        finish();
      };
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || isInteractivePanelTarget(event.target) || !begin(event.clientX, event.clientY)) return;
        source = event.pointerId;
        event.preventDefault();
        event.stopPropagation();
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {}
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
        handle.addEventListener("lostpointercapture", end);
      });
    } else {
      const move = (event) => {
        stroke(event.clientX, event.clientY);
      };
      const stop = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", stop);
        finish();
      };
      const touchMove = (event) => {
        const touch = event.touches[0];
        if (touch) stroke(touch.clientX, touch.clientY);
        event.preventDefault();
      };
      const touchStop = () => {
        window.removeEventListener("touchmove", touchMove);
        window.removeEventListener("touchend", touchStop);
        window.removeEventListener("touchcancel", touchStop);
        finish();
      };
      handle.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || isInteractivePanelTarget(event.target) || !begin(event.clientX, event.clientY)) return;
        event.preventDefault();
        event.stopPropagation();
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", stop);
      });
      handle.addEventListener("touchstart", (event) => {
        const touch = event.touches[0];
        if (!touch || isInteractivePanelTarget(event.target) || !begin(touch.clientX, touch.clientY)) return;
        event.preventDefault();
        event.stopPropagation();
        window.addEventListener("touchmove", touchMove, { passive: false });
        window.addEventListener("touchend", touchStop);
        window.addEventListener("touchcancel", touchStop);
      });
    }
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      panelPositions[kind] = null;
      savePanelPositions();
      if (typeof placeDefault === "function") placeDefault();
    });
  }


  let draftNode = null;
  let composerNode = null;
  let placeComposerDefault = null;

  async function decodePastedImage(file) {
    let bitmap = null;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.8);
    } finally {
      bitmap?.close?.();
    }
  }

  function acceptPastedImage(dataUrl) {
    if (draft === null) return false;
    if (typeof dataUrl !== "string" || dataUrl === "") return false;
    if (dataUrl.length > 4 * 1024 * 1024) {
      toast(t("pasteTooLarge"), 3200);
      return false;
    }
    pastedShot = dataUrl;
    if (pasteThumbNode !== null) pasteThumbNode.src = dataUrl;
    if (pasteChipNode !== null) pasteChipNode.style.display = "";
    return true;
  }

  function clearPastedShot() {
    pastedShot = null;
    if (pasteThumbNode !== null) pasteThumbNode.removeAttribute("src");
    if (pasteChipNode !== null) pasteChipNode.style.display = "none";
  }

  function discardDraft() {
    pastedShot = null;
    draft = null;
    renderDraft();
  }

  function insertAtCaret(textarea, text) {
    const value = textarea.value ?? "";
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    return {
      value: `${value.slice(0, start)}${text}${value.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + text.length
    };
  }

  function applyTemplate(textarea, text) {
    const value = textarea.value ?? "";
    const caret = textarea.selectionStart ?? value.length;
    const separator = value !== "" && caret === value.length && !/\s$/.test(value) ? " " : "";
    const next = insertAtCaret(textarea, `${separator}${text}`);
    textarea.value = next.value;
    textarea.selectionStart = next.selectionStart;
    textarea.selectionEnd = next.selectionEnd;
    textarea.focus({ preventScroll: true });
  }

  function renderTemplateRow(textarea) {
    const row = el("div", { class: "lr-template-row" });
    const btn = el("button", { class: "lr-template-btn", type: "button", title: t("templatesLabel") }, `⋯ ${t("templatesLabel")}`);
    btn.addEventListener("click", () => {
      closeDrawMenu();
      drawMenu = el("div", { class: "lr-dmenu" });
      for (const item of templateItems()) {
        const entry = el("button", { class: "lr-ditem", type: "button" }, el("span", {}, item));
        entry.addEventListener("click", () => { closeDrawMenu(); applyTemplate(textarea, item); });
        drawMenu.append(entry);
      }
      fixedLayer.append(drawMenu);
      drawMenu.toggleAttribute("data-on", true);
      const r = btn.getBoundingClientRect();
      drawMenu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 200))}px`;
      drawMenu.style.top = `${Math.max(8, r.top - drawMenu.offsetHeight - 6)}px`;
      const dismiss = (event) => {
        const path = event.composedPath?.() ?? [];
        if (drawMenu !== null && !path.includes(drawMenu) && !path.includes(btn)) {
          closeDrawMenu();
          document.removeEventListener("pointerdown", dismiss, true);
        }
      };
      setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
    });
    row.append(btn);
    return row;
  }

  function renderDraft() {
    draftNode?.remove();
    composerNode?.remove();
    draftNode = null;
    composerNode = null;
    placeComposerDefault = null;
    if (draft === null) return;
    mountShadow();
    const point = draftPoint();
    draftNode = el("div", { class: "pin pin-draft pin-open" });
    draftNode.style.transform = `translate(${point.x}px, ${point.y}px)`;
    draftNode.append(el("span", { class: "pin-body" }, "+"));
    absLayer.append(draftNode);

    const WIDTH = 320;
    const placeComposerDefaultLeft = Math.min(Math.max(8, point.x + 16), window.innerWidth - WIDTH - 8);
    const placeComposerDefaultTop = Math.min(Math.max(8, point.y - 46), window.innerHeight - 240);
    placeComposerDefault = () => {
      const point = draftPoint();
      composerNode.style.left = `${Math.min(Math.max(8, point.x + 16), window.innerWidth - WIDTH - 8)}px`;
      composerNode.style.top = `${Math.min(Math.max(8, point.y - 46), window.innerHeight - 240)}px`;
      composerNode.style.transform = "none";
    };
    composerNode = el("div", { class: "popover composer", style: `width:${WIDTH}px;transform-origin:top left;left:${placeComposerDefaultLeft}px;top:${placeComposerDefaultTop}px` });
    const textarea = el("textarea", { placeholder: t("composerPlaceholder") });
    const submit = el("button", { class: "send", title: t("sendTitle") }, ICONS.arrowUp);
    const shotToggle = el("button", { class: `toggle${screenshotOnSend ? " toggle-on" : ""}`, title: t("shotOn"), html: ICONS.camera });
    shotToggle.addEventListener("click", () => {
      screenshotOnSend = !screenshotOnSend;
      shotToggle.classList.toggle("toggle-on", screenshotOnSend);
    });
    pasteChipNode = el("div", { class: "paste-chip" });
    pasteThumbNode = el("img", { class: "paste-thumb", alt: "" });
    pasteChipNode.append(pasteThumbNode, el("button", { class: "lr-close paste-remove", title: t("pasteRemove"), type: "button", onclick: () => clearPastedShot() }, "✕"));
    pasteChipNode.style.display = "none";
    submit.addEventListener("click", () => submitDraft());
    textarea.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (items === undefined || items === null) return;
      let file = null;
      for (const item of items) {
        if (typeof item?.type === "string" && item.type.startsWith("image/")) {
          file = item.getAsFile();
          break;
        }
      }
      if (file === null) return;
      e.preventDefault();
      void (async () => {
        let dataUrl = null;
        try {
          dataUrl = await decodePastedImage(file);
        } catch (error) {
          reportDiag(`paste decode: ${String(error).slice(0, 120)}`);
        }
        if (dataUrl !== null) acceptPastedImage(dataUrl);
      })();
    });
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitDraft();
      }
      if (e.key === "Escape") {
        discardDraft();
      }
    });
    composerNode.append(
      el(
        "div",
        { class: "composer-target" },
        el("span", { class: "chip" }, ICONS.code, `${draft.label}`),
        el("span", { class: "composer-provider" }, el("span", { class: "composer-provider-label" }, t("attachesTo"))),
        el("button", { class: "lr-close", title: t("composerClose"), type: "button", onclick: discardDraft }, "✕")
      ),
      el("div", { class: "prompt-input" }, pasteChipNode, textarea, el("div", { class: "prompt-actions" }, el("div", { class: "prompt-extras" }, renderTemplateRow(textarea), shotToggle), submit))
    );
    fixedLayer.append(composerNode);
    applyPanelPosition(composerNode, "composer");
    wirePanelDrag(composerNode, "composer", placeComposerDefault);
    textarea.focus({ preventScroll: true });
  }

  function openDraft(target, event) {
    pastedShot = null;
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
    const pin = {
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
    };
    if (viewportPresetWidth !== null) pin.viewportWidth = viewportPresetWidth;
    if (pastedShot !== null) pin.pastedShot = pastedShot;
    pins.push(pin);
    savePins();
    discardDraft();
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
        fixes: p.fixes ?? [],
        rect: p.rect,
        shot: p.shot ?? null,
        afterShot: p.afterShot ?? null,
        pastedShot: p.pastedShot ?? null,
        groupId: p.groupId ?? null,
        viewportWidth: p.viewportWidth ?? null
      }))
    };
    try {
      const data = await bridgeSend("annotations.submit", payload);
      if (data === null || typeof data !== "object" || data.ok !== true) throw new Error(`HTTP ${data?.error ?? "?"}`);
      toast(t("savedHint"), 4200);
      updateToolbar();
      return true;
    } catch (error) {
      toast(`${t("saveFailed")}${String(error).slice(0, 80)}`);
      return false;
    }
  }


  function reportDiag(detail) {
    try { bridgeSend("diag", { detail: String(detail).slice(0, 300) }).catch(() => {}); } catch {}
  }

  function ensureHtml2Canvas() {
    if (html2canvasReady !== null) return html2canvasReady;
    html2canvasReady = new Promise((resolve) => {
      if (typeof window.html2canvas === "function") return resolve(true);
      const script = document.createElement("script");
      script.src = `${API_BASE}/.lr/vendor/html2canvas.min.js`;
      script.onload = () => {
        const ready = typeof window.html2canvas === "function";
        if (!ready) reportDiag("capture: script carregou mas window.html2canvas ausente");
        resolve(ready);
      };
      script.onerror = () => { reportDiag("capture: script html2canvas falhou ao carregar (onerror)"); resolve(false); };
      document.head.append(script);
    });
    return html2canvasReady;
  }





  let CROP_PAD = 72;
  let captureQuality = "padrao";
  function capturePreset(quality) {
    if (quality === "leve") return { maxEdge: 640, quality: 0.7 };
    if (quality === "alta") return { maxEdge: 1400, quality: 0.92 };
    return { maxEdge: 900, quality: 0.8 };
  }

  let captureTimeout = 12;
  let captureCancelled = false;
  let captureAbort = null;
  const CAPTURE_SIMPLIFIED_TAGS = new Set(["IMG", "VIDEO", "IFRAME", "OBJECT", "EMBED"]);
  function raceCapture(renderPromise, ms) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        captureAbort = null;
        if (timer !== null) clearTimeout(timer);
        resolve(value);
      };
      if (ms > 0) timer = setTimeout(() => finish({ status: "timeout" }), ms);
      captureAbort = () => finish({ status: "cancelled" });
      renderPromise.then((canvas) => finish({ status: "done", canvas })).catch((error) => finish({ status: "error", error }));
    });
  }
  let captureToastNode = null;
  function showCaptureToast(simplified) {
    hideCaptureToast();
    captureToastNode = el("div", { class: "toast lr-capture-toast" },
      el("span", { class: "lr-capture-label" }, simplified ? t("captureSimplified") : t("captureRunning")),
      el("button", { class: "lr-capture-cancel", type: "button", onclick: () => captureAbort?.() }, t("captureCancel")));
    toastStack.append(captureToastNode);
  }
  function hideCaptureToast() {
    captureToastNode?.remove();
    captureToastNode = null;
  }
  const groupCaptureCache = { canvas: null, key: null, at: 0 };
  function groupCanvasKey() {
    return `${window.scrollX}|${window.scrollY}|${window.innerWidth}|${window.innerHeight}`;
  }
  async function captureCropFor(rect, cropPad = CROP_PAD, withDrawings = false, reuse = null) {
    const ok = await ensureHtml2Canvas();
    if (!ok || typeof window.html2canvas !== "function") return null;
    captureCancelled = false;
    let simplified = false;
    for (;;) {
      if (reuse !== null && simplified === false && reuse.canvas !== null && reuse.key === groupCanvasKey() && Date.now() - reuse.at < 10000) {
        try {
          return cropCanvas(reuse.canvas, rect, cropPad);
        } catch (error) {
          reportDiag(`crop: ${String(error && error.message ? error.message : error).slice(0, 200)}`);
          return null;
        }
      }
      showCaptureToast(simplified);
      const outcome = await raceCapture(window.html2canvas(document.body, {
        backgroundColor: "#ffffff",
        scale: Math.min(1, 1600 / window.innerWidth),
        width: window.innerWidth,
        height: window.innerHeight,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        useCORS: true,
        ignoreElements: simplified
          ? (element) => element.id === "dsh-redline-host" || CAPTURE_SIMPLIFIED_TAGS.has(element.tagName)
          : (element) => element.id === "dsh-redline-host"
      }), captureTimeout > 0 ? captureTimeout * 1000 : 0);
      hideCaptureToast();
      if (outcome.status === "cancelled") {
        captureCancelled = true;
        return null;
      }
      if (outcome.status === "timeout") {
        if (simplified) {
          toast(t("captureTimeoutFailed"));
          return null;
        }
        simplified = true;
        toast(t("captureTimeoutFallback"));
        continue;
      }
      if (outcome.status === "error") {
        reportDiag(`capture: exceção ${String(outcome.error && outcome.error.message ? outcome.error.message : outcome.error).slice(0, 200)}`);
        return null;
      }
      try {
        const canvas = outcome.canvas;
        if (reuse !== null && simplified === false) {
          reuse.canvas = canvas;
          reuse.key = groupCanvasKey();
          reuse.at = Date.now();
        }
        if (withDrawings && drawCtx !== null && drawItems.length > 0) {
          const dscale = canvas.width / Math.max(1, drawCanvas.width);
          canvas.getContext("2d").drawImage(drawCanvas, 0, 0, drawCanvas.width * dscale, drawCanvas.height * dscale);
        }
        return cropCanvas(canvas, rect, cropPad);
      } catch (error) {
        reportDiag(`crop: ${String(error && error.message ? error.message : error).slice(0, 200)}`);
        return null;
      }
    }
  }

  function cropCanvas(canvas, rect, pad = CROP_PAD) {
    try {
      const preset = capturePreset(captureQuality);
      const scale = canvas.width / Math.max(1, window.innerWidth);
      let sx = (rect.x - pad) * scale;
      let sy = (rect.y - pad) * scale;
      let sw = (rect.w + pad * 2) * scale;
      let sh = (rect.h + pad * 2) * scale;
      sx = Math.max(0, Math.min(sx, canvas.width - 1));
      sy = Math.max(0, Math.min(sy, canvas.height - 1));
      sw = Math.max(32, Math.min(sw, canvas.width - sx));
      sh = Math.max(32, Math.min(sh, canvas.height - sy));
      const shrink = Math.min(1, preset.maxEdge / Math.max(sw, sh));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(sw * shrink));
      out.height = Math.max(1, Math.round(sh * shrink));
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", preset.quality);
    } catch (error) {
      reportDiag(`crop: ${String(error && error.message ? error.message : error).slice(0, 200)}`);
      return null;
    }
  }


  let pinPanelNode = null;
  let adjustPanel = null;
  let adjustTarget = null;

  function buildCssPatch(pin) {
    if (pin.tag === "canvas") return "";
    if (!Array.isArray(pin.changes) || pin.changes.length === 0) return "";
    const declarations = pin.changes.map((change) => `${change.prop}: ${change.after}`).join("; ");
    return `${pin.selector} { ${declarations}; }`;
  }
  function copyCssPatch(pin) {
    const write = navigator.clipboard?.writeText(buildCssPatch(pin));
    if (write && typeof write.then === "function") write.then(() => toast(t("cssCopied"))).catch(() => toast(t("cssCopyFailed")));
    else toast(t("cssCopyFailed"));
  }
  function copySelectorText(pin) {
    const write = navigator.clipboard?.writeText(pin.selector);
    if (write && typeof write.then === "function") write.then(() => toast(t("selectorCopied"), 3200)).catch(() => toast(t("cssCopyFailed"), 3200));
    else toast(t("cssCopyFailed"), 3200);
  }
  const A11Y_SEMANTIC_TAGS = new Set(["button", "input", "select", "textarea", "img", "h1", "h2", "h3", "h4", "h5", "h6", "nav", "main", "header", "footer", "ul", "ol", "table"]);
  const A11Y_ROW_LABELS = { contrast: "a11yContrast", name: "a11yAccessibleName", imgAlt: "a11yImgAlt", role: "a11yRole", targetSize: "a11yTargetSize" };
  const A11Y_STATUS_KEYS = { pass: "a11yPass", fail: "a11yFail", warn: "a11yWarn", unknown: "a11yUnknown", "n/a": "a11yNotApplicable" };
  const A11Y_FIXABLE_CHECKS = new Set(["contrast", "imgAlt"]);
  const a11yFixHandler = { current: null };
  function relativeLuminance(color) {
    const channel = (raw) => {
      const c = raw / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }
  function contrastRatio(fg, bg) {
    const front = typeof fg === "string" ? parseColor(fg) : fg;
    const back = typeof bg === "string" ? parseColor(bg) : bg;
    if (front === null || back === null || (front.a ?? 1) < 1 || (back.a ?? 1) < 1) return null;
    const l1 = relativeLuminance(front);
    const l2 = relativeLuminance(back);
    const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (lighter + 0.05) / (darker + 0.05);
  }
  function resolveReadableBackground(el) {
    let node = el;
    while (node !== null && node !== undefined) {
      const background = getComputedStyle(node).backgroundColor ?? "";
      const parsed = parseColor(background);
      if (parsed !== null && parsed.a >= 1) return background;
      if (parsed === null) return "unknown";
      node = node.parentElement ?? null;
    }
    return "unknown";
  }
  function accessibleName(el) {
    const attr = (name) => {
      const value = el.getAttribute?.(name);
      return typeof value === "string" ? value : "";
    };
    const label = attr("aria-label").trim();
    if (label !== "") return label;
    const labelledBy = attr("aria-labelledby").trim();
    if (labelledBy !== "") {
      const doc = el.ownerDocument ?? document;
      const parts = labelledBy.split(/\s+/u).map((id) => doc.getElementById?.(id)?.textContent ?? "").filter((text) => text.trim() !== "");
      if (parts.length > 0) return parts.join(" ").trim();
    }
    const alt = attr("alt").trim();
    if (alt !== "") return alt;
    const text = typeof el.textContent === "string" ? el.textContent.trim() : "";
    if (text !== "") return text;
    const title = attr("title").trim();
    if (title !== "") return title;
    return "";
  }
  function auditElement(el) {
    const attr = (name) => {
      const value = el.getAttribute?.(name);
      return typeof value === "string" ? value : null;
    };
    const rows = [];
    const style = getComputedStyle(el);
    const ratio = contrastRatio(style.color, resolveReadableBackground(el));
    rows.push({ check: "contrast", status: ratio === null ? "unknown" : ratio >= 4.5 ? "pass" : "fail", value: ratio === null ? "unknown" : String(Math.round(ratio * 100) / 100) });
    const name = accessibleName(el);
    rows.push({ check: "name", status: name === "" ? "fail" : "pass", value: name });
    const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
    if (tag === "img") {
      const alt = attr("alt");
      rows.push({ check: "imgAlt", status: alt === null ? "fail" : "pass", value: alt ?? "" });
    } else {
      rows.push({ check: "imgAlt", status: "n/a", value: "" });
    }
    const role = attr("role");
    if (role !== null && role.trim() !== "") rows.push({ check: "role", status: "pass", value: role.trim() });
    else if (A11Y_SEMANTIC_TAGS.has(tag) || (tag === "a" && attr("href") !== null && attr("href") !== "")) rows.push({ check: "role", status: "pass", value: tag });
    else rows.push({ check: "role", status: "warn", value: "none" });
    const rect = el.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    rows.push({ check: "targetSize", status: rect.width >= 24 && rect.height >= 24 ? "pass" : "fail", value: `${Math.round(rect.width)}×${Math.round(rect.height)}` });
    return rows;
  }
  const A11Y_AUDIT_FAMILY_SELECTORS = { interactive: "button, a, input, select, textarea, [contenteditable]", images: "img", semantic: "h1, h2, h3, h4, h5, h6, nav, main, header, footer, ul, ol, table" };
  function collectAuditCandidates(families, walkBudget) {
    const seen = new Set();
    const candidates = [];
    const add = (element) => {
      if (!(element instanceof Element) || seen.has(element)) return;
      seen.add(element);
      candidates.push(element);
    };
    for (const collect of [families?.interactive, families?.images, families?.semantic]) {
      if (typeof collect !== "function") continue;
      for (const element of collect()) add(element);
    }
    if (typeof families?.textBearing === "function") {
      let visited = 0;
      const walk = (node) => {
        if (node === null || node === undefined || visited >= walkBudget) return;
        visited += 1;
        for (const child of node.childNodes ?? []) {
          if (child.nodeType === 3 && typeof child.data === "string" && child.data.trim() !== "") {
            add(node);
            break;
          }
        }
        for (const child of node.children ?? []) walk(child);
      };
      walk(families.textBearing());
    }
    return candidates;
  }
  function pickAuditCandidates(candidates, cap) {
    const list = Array.isArray(candidates) ? candidates : [];
    return list.slice(0, cap);
  }
  const A11Y_GROUP_TITLES = { contrast: "a11yAuditGroupContrast", name: "a11yAuditGroupName", imgAlt: "a11yAuditGroupAlt", role: "a11yAuditGroupRole", targetSize: "a11yAuditGroupTargetSize" };
  function groupAuditFindings(findings) {
    const groups = [];
    const byCheck = new Map();
    for (const finding of Array.isArray(findings) ? findings : []) {
      if (finding?.status !== "fail") continue;
      if (!byCheck.has(finding.check)) {
        const group = { check: finding.check, label: A11Y_ROW_LABELS[finding.check] ?? finding.check, title: A11Y_GROUP_TITLES[finding.check] ?? finding.check, findings: [] };
        byCheck.set(finding.check, group);
        groups.push(group);
      }
      byCheck.get(finding.check).findings.push(finding);
    }
    return groups;
  }
  let groupMode = false;
  let groupPicks = [];
  let groupComposerNode = null;
  function setGroupMode(on) {
    if (on === groupMode) return;
    groupMode = on;
    if (on) {
      setMode(null);
      if (drawMode) toggleDraw(false);
      if (draft !== null) discardDraft();
      closePanels();
      groupCaptureCache.canvas = null;
      setHint(t("groupHint"));
    } else {
      groupCaptureCache.canvas = null;
      clearGroupPicks();
      groupComposerNode?.remove();
      groupComposerNode = null;
      clearHighlight();
      setHint(null);
    }
    updateToolbar();
  }
  function clearGroupPicks() {
    for (const pick of groupPicks) { pick.marker?.remove(); pick.badge?.remove(); }
    groupPicks = [];
  }
  function groupPickMarker(target, index) {
    const box = target.getBoundingClientRect();
    const marker = el("div", { class: "highlight group-pick" });
    Object.assign(marker.style, { transform: `translate(${box.left}px, ${box.top}px)`, width: `${box.width}px`, height: `${box.height}px` });
    const badge = el("div", { class: "highlight-label group-pick-badge" }, String(index));
    const inside = box.top < 26;
    Object.assign(badge.style, {
      transform: inside
        ? `translate(${box.left + 2}px, ${box.top + 2}px)`
        : `translate(${box.left}px, ${box.top}px)`
    });
    badge.classList.toggle("group-pick-badge-inside", inside);
    fixedLayer.append(marker, badge);
    return { marker, badge };
  }
  async function groupPick(target) {
    if (!groupMode) return;
    if (!(target instanceof Element) || target.tagName.toLowerCase() === "canvas") return;
    if (groupPicks.some((pick) => pick.target === target)) return;
    const rect = target.getBoundingClientRect();
    const shot = screenshotOnSend ? await captureCropFor({ x: rect.left, y: rect.top, w: rect.width, h: rect.height }, CROP_PAD, false, groupCaptureCache) : null;
    if (!groupMode) return;
    const pick = {
      target,
      selector: cssPath(target),
      rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
      offsets: { ox: rect.width / 2, oy: rect.height / 2 },
      shot,
      marker: null,
      badge: null
    };
    ({ marker: pick.marker, badge: pick.badge } = groupPickMarker(target, groupPicks.length + 1));
    groupPicks.push(pick);
  }
  function finalizeGroup() {
    const comment = (groupComposerNode?.querySelector("textarea")?.value ?? "").trim();
    if (comment === "" || groupPicks.length === 0) {
      setGroupMode(false);
      return [];
    }
    const groupId = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const created = [];
    for (const pick of groupPicks) {
      created.push({
        id: crypto.randomUUID(),
        tag: pick.target.localName,
        role: pick.target.getAttribute?.("role") ?? "",
        label: pick.target.getAttribute?.("aria-label") ?? "",
        selector: pick.selector,
        text: (pick.target.textContent ?? "").trim().slice(0, 300),
        component: reactComponentName(pick.target) ?? "",
        comment,
        changes: [],
        pageUrl: PAGE_URL,
        rect: pick.rect,
        offsets: pick.offsets,
        shot: pick.shot,
        groupId,
        status: "queued",
        at: Date.now()
      });
      if (viewportPresetWidth !== null) created[created.length - 1].viewportWidth = viewportPresetWidth;
    }
    pins.push(...created);
    savePins();
    setGroupMode(false);
    renderPins();
    toast(t("groupCreated"));
    postSnapshot();
    return created;
  }
  function renderGroupComposer() {
    if (!groupMode || groupPicks.length === 0) return;
    if (groupComposerNode !== null) {
      const count = groupComposerNode.querySelector(".group-count");
      if (count !== null) count.textContent = String(groupPicks.length);
      return;
    }
    mountShadow();
    const WIDTH = 320;
    const composer = el("div", { class: "popover composer", style: `width:${WIDTH}px;left:24px;top:64px` });
    const textarea = el("textarea", { placeholder: t("composerPlaceholder") });
    const submit = el("button", { class: "send", title: t("sendTitle") }, ICONS.arrowUp);
    submit.addEventListener("click", () => finalizeGroup());
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finalizeGroup();
      }
      if (e.key === "Escape") setGroupMode(false);
    });
    composer.append(
      el(
        "div",
        { class: "composer-target" },
        el("span", { class: "chip" }, ICONS.group, el("span", { class: "group-count" }, String(groupPicks.length))),
        el("span", { class: "composer-provider" }, el("span", { class: "composer-provider-label" }, t("groupHint"))),
        el("button", { class: "lr-close", title: t("composerClose"), onclick: () => setGroupMode(false) }, "✕")
      ),
      el("div", { class: "prompt-input" }, textarea, el("div", { class: "prompt-actions" }, el("div", { class: "prompt-extras" }), submit))
    );
    fixedLayer.append(composer);
    groupComposerNode = composer;
    textarea.focus({ preventScroll: true });
  }
  function openGroupComposer() {
    if (!groupMode || groupPicks.length === 0) return;
    renderGroupComposer();
  }

  let vpWidth = null;
  let vpZoom = 100;
  let viewportPresetWidth = null;
  const VIEWPORT_PRESETS = [375, 768, 1280];
  const VIEWPORT_ZOOMS = [50, 75, 125, 150, 200];
  function vpIsDefault() { return vpWidth === null && vpZoom === 100; }
  function vpPayload() { return { w: vpWidth, z: vpZoom }; }
  function normVpW(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) ? n : null;
  }
  function parseVpPayload(raw) {
    if (raw === null || raw === undefined || raw === "") return { w: null, z: 100 };
    if (typeof raw === "object") {
      const w = normVpW(raw.w);
      const zRaw = (raw.z === null || raw.z === undefined || raw.z === "") ? 100 : Number(raw.z);
      const z = (Number.isFinite(zRaw) && VIEWPORT_ZOOMS.includes(zRaw)) ? zRaw : 100;
      return { w, z };
    }
    if (typeof raw === "string") {
      const s = raw.trim();
      if (s === "") return { w: null, z: 100 };
      try {
        const o = JSON.parse(s);
        if (o && typeof o === "object") return parseVpPayload(o);
      } catch {}
      const n = Number(s);
      if (Number.isFinite(n) && n > 0) return { w: n, z: 100 };
    }
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return { w: raw, z: 100 };
    return { w: null, z: 100 };
  }
  function applyViewportState(next, opts = {}) {
    const w = normVpW(next && next.w);
    const zRaw = (next && next.z !== null && next.z !== undefined && next.z !== "") ? Number(next.z) : 100;
    const z = (Number.isFinite(zRaw) && VIEWPORT_ZOOMS.includes(zRaw)) ? zRaw : 100;
    vpWidth = w;
    vpZoom = z;
    viewportPresetWidth = w;
    const target = document.body || document.documentElement;
    try {
      const hs = document.documentElement.style;
      hs.removeProperty("max-width"); hs.removeProperty("margin-left"); hs.removeProperty("margin-right"); hs.removeProperty("zoom");
    } catch {}
    const rootStyle = target.style;
    if (w === null) {
      rootStyle.removeProperty("max-width");
      rootStyle.removeProperty("margin-left");
      rootStyle.removeProperty("margin-right");
    } else {
      rootStyle.setProperty("max-width", `${w}px`, "important");
      rootStyle.setProperty("margin-left", "auto", "important");
      rootStyle.setProperty("margin-right", "auto", "important");
    }
    if (z === 100) rootStyle.removeProperty("zoom");
    else rootStyle.setProperty("zoom", String(z / 100), "important");
    host.setAttribute("data-lr-viewport", vpIsDefault() ? "" : JSON.stringify(vpPayload()));
    repositionPins();
    if (draft !== null || adjustPanel !== null) {
      repositionDraft();
      if (adjustPanel !== null) applyPanelPosition(adjustPanel, "adjust");
    }
    updateViewportBtn();
    closeDrawMenu();
    if (opts.push !== false) pushGuestViewport();
  }

  function applyViewportPreset(widthOrNull) {
    const n = Number(widthOrNull);
    const w = (Number.isFinite(n) && (n === 375 || n === 768 || n === 1280)) ? n : null;
    viewportPresetWidth = w;
    vpWidth = w;
    const rootStyle = document.documentElement.style;
    if (w === null) {
      rootStyle.removeProperty("max-width");
      rootStyle.removeProperty("margin-left");
      rootStyle.removeProperty("margin-right");
    } else {
      rootStyle.setProperty("max-width", `${w}px`);
      rootStyle.setProperty("margin-left", "auto");
      rootStyle.setProperty("margin-right", "auto");
    }
    if (typeof repositionPins === "function") repositionPins();
    if ((draft !== null && draft !== undefined) || (adjustPanel !== null && adjustPanel !== undefined)) {
      if (typeof repositionDraft === "function") repositionDraft();
    }
    return viewportPresetWidth;
  }
  void applyViewportPreset;
  function activeViewportWidth() {
    return vpWidth;
  }

  const viewportBus = { token: 0 };
  function syncViewportFromGuest(message) {
    const next = parseVpPayload(message?.width ?? message?.state ?? message);
    if (vpWidth !== next.w || vpZoom !== next.z) {
      applyViewportState(next, { push: false });
    } else {
      host.setAttribute("data-lr-viewport", vpIsDefault() ? "" : JSON.stringify(vpPayload()));
    }
  }
  window.addEventListener("message", (event) => {
    const data = event?.data;
    if (!data || typeof data !== "object" || data.source !== "dsh-redline") return;
    if (data.type === "viewport-set") syncViewportFromGuest(data);
    if (data.type === "viewport-read") {
      const payload = vpIsDefault() ? null : vpPayload();
      try { event.source?.postMessage({ source: "dsh-redline", type: "viewport", width: payload, token: data.token }, "*"); } catch {}
    }
    if (data.type === "locate") revealSelector(data.selector);
  });
  function pushGuestViewport() {
    const payload = vpIsDefault() ? null : vpPayload();
    window.postMessage({ source: "dsh-redline", type: "viewport-set", width: payload, token: ++viewportBus.token }, "*");
  }
  function pullGuestViewport() {
    return new Promise((resolve) => {
      const token = ++viewportBus.token;
      const done = (value) => { window.removeEventListener("message", handler); resolve(value); };
      const timeout = setTimeout(() => done(null), 2000);
      const handler = (event) => {
        const data = event?.data;
        if (!data || data.source !== "dsh-redline" || data.type !== "viewport" || data.token !== token) return;
        clearTimeout(timeout);
        done(data.width ?? null);
      };
      window.addEventListener("message", handler);
      window.postMessage({ source: "dsh-redline", type: "viewport-read", token }, "*");
    });
  }

  function a11yAuditSection(target) {
    const rows = auditElement(target);
    if (rows.length === 0) return null;
    const section = el("div", { class: "lr-a11y" }, el("div", { class: "lr-a11y-title" }, t("a11yTitle")));
    for (const row of rows) {
      const line = el("div", { class: "lr-a11y-row" },
        el("span", { class: "lr-a11y-label" }, t(A11Y_ROW_LABELS[row.check] ?? row.check)),
        el("span", { class: "lr-a11y-value" }, row.value),
        el("span", { class: `lr-a11y-chip ${row.status === "n/a" ? "na" : row.status}` }, t(A11Y_STATUS_KEYS[row.status] ?? row.status)));
      if (row.status === "fail" && a11yFixHandler.current !== null && A11Y_FIXABLE_CHECKS.has(row.check)) {
        line.append(el("button", { class: "lr-a11y-fix", type: "button", onclick: () => showA11yFixPreview(section, line, target, row.check) }, t("a11yFixApply")));
      }
      section.append(line);
    }
    return section;
  }

  function showA11yFixPreview(container, anchor, target, check) {
    const handler = a11yFixHandler.current;
    if (handler === null || !(target instanceof Element)) return;
    container.querySelector(":scope > .lr-a11y-fix-proposal")?.remove();
    container.querySelectorAll(".lr-a11y-fix[data-applied]").forEach((node) => { node.removeAttribute("data-applied"); node.textContent = t("a11yFixApply"); });
    const proposalRow = el("div", { class: "lr-a11y-fix-proposal" });
    if (!A11Y_FIXABLE_CHECKS.has(check)) {
      proposalRow.append(el("span", { class: "lr-a11y-fix-note" }, t("a11yNoAutoFix")));
      anchor.after(proposalRow);
      return;
    }
    if (anchor instanceof Element && anchor.classList?.contains("lr-a11y-fix")) {
      anchor.dataset.applied = "true";
      anchor.textContent = t("a11yFixApplied");
    }
    if (check === "contrast") {
      const proposal = proposeContrastFix(getComputedStyle(target).color ?? "", resolveReadableBackground(target));
      if (proposal === null) {
        proposalRow.append(el("span", { class: "lr-a11y-fix-note" }, t("a11yFixContrastUnavailable")));
        anchor.after(proposalRow);
        return;
      }
      const original = target.style.getPropertyValue("color");
      const ratioText = (value) => String(Math.round(value * 100) / 100);
      target.style.setProperty("color", proposal.after);
      proposalRow.append(
        el("span", { class: "lr-a11y-fix-note" }, t("a11yFixContrastProposal").replace("{before}", proposal.before).replace("{after}", proposal.after).replace("{ratioBefore}", ratioText(proposal.ratioBefore)).replace("{ratioAfter}", ratioText(proposal.ratioAfter))),
        el("button", { type: "button", onclick: () => {
          const pin = handler.ensurePin(target, "contrast");
          if (!Array.isArray(pin.fixes)) pin.fixes = [];
          pin.fixes.push({ check: "contrast", prop: "color", before: proposal.before, after: proposal.after });
          proposalRow.remove();
          toast(t("a11yFixApplied"));
          void postSnapshot();
        } }, t("a11yFixApply")),
        el("button", { type: "button", onclick: () => {
          if (original === "") target.style.removeProperty("color");
          else target.style.setProperty("color", original);
          proposalRow.remove();
          toast(t("a11yFixDiscarded"));
        } }, t("a11yFixDiscard"))
      );
    } else {
      const attr = (name) => {
        const value = target.getAttribute?.(name);
        return typeof value === "string" ? value : undefined;
      };
      const original = attr("alt") ?? null;
      const note = el("span", { class: "lr-a11y-fix-note" });
      const field = el("input", { class: "lr-field", type: "text" });
      field.value = deriveAltText({ alt: attr("alt"), ariaLabel: attr("aria-label"), title: attr("title"), src: attr("src") });
      target.setAttribute("alt", field.value);
      field.addEventListener("input", () => {
        target.setAttribute("alt", field.value);
        note.textContent = t("a11yFixAltProposal").replace("{value}", field.value);
      });
      note.textContent = t("a11yFixAltProposal").replace("{value}", field.value);
      proposalRow.append(
        field,
        note,
        el("button", { type: "button", onclick: () => {
          const pin = handler.ensurePin(target, "imgAlt");
          if (!Array.isArray(pin.fixes)) pin.fixes = [];
          pin.fixes.push({ check: "imgAlt", prop: null, before: original, after: field.value });
          proposalRow.remove();
          toast(t("a11yFixApplied"));
          void postSnapshot();
        } }, t("a11yFixApply")),
        el("button", { type: "button", onclick: () => {
          if (original === null) target.removeAttribute("alt");
          else target.setAttribute("alt", original);
          proposalRow.remove();
          toast(t("a11yFixDiscarded"));
        } }, t("a11yFixDiscard"))
      );
    }
    anchor.after(proposalRow);
  }

  function closePinPanel() {
    openPinId = null;
    pinPanelNode?.remove();
    pinPanelNode = null;
    a11yFixHandler.current = null;
    exitFocusMode();
  }

  let auditPanelNode = null;
  let auditPlaceDefault = null;
  let auditRunToken = 0;
  let auditLimit = 400;
  function closeAuditPanel() {
    auditRunToken += 1;
    auditPanelNode?.remove();
    auditPanelNode = null;
    auditPlaceDefault = null;
  }
  async function runPageAudit(options) {
    const safe = options !== null && typeof options === "object" ? options : {};
    const limit = Number.isFinite(Number(safe.limit)) ? Number(safe.limit) : 400;
    const onProgress = typeof safe.onProgress === "function" ? safe.onProgress : null;
    const shouldStop = typeof safe.shouldStop === "function" ? safe.shouldStop : null;
    const root = document.body ?? document.documentElement;
    const interactive = () => Array.from(root.querySelectorAll(A11Y_AUDIT_FAMILY_SELECTORS.interactive)).slice(0, limit);
    const images = () => Array.from(root.querySelectorAll(A11Y_AUDIT_FAMILY_SELECTORS.images)).slice(0, limit);
    const semantic = () => Array.from(root.querySelectorAll(A11Y_AUDIT_FAMILY_SELECTORS.semantic)).slice(0, limit);
    const textBearing = () => root;
    const collected = collectAuditCandidates({ interactive, images, semantic, textBearing }, 400);
    const inspectionList = pickAuditCandidates(collected, limit);
    const findings = [];
    const chunk = 40;
    let audited = 0;
    for (let index = 0; index < inspectionList.length; index += chunk) {
      if (shouldStop !== null && shouldStop() === true) break;
      const slice = inspectionList.slice(index, index + chunk);
      for (const element of slice) {
        for (const row of auditElement(element)) {
          if (row.status === "fail") findings.push({ check: row.check, status: row.status, value: row.value, selector: cssPath(element), label: quickLabel(element), element });
        }
      }
      audited += slice.length;
      onProgress?.({ done: audited, total: inspectionList.length, findings });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { scanned: audited, collected: collected.length, findings, stopped: shouldStop !== null && shouldStop() === true };
  }
  function openAuditPanel() {
    closeAuditPanel();
    mountShadow();
    const token = auditRunToken + 1;
    auditRunToken = token;
    a11yFixHandler.current = {
      ensurePin: (element, check) => {
        const selector = cssPath(element);
        let pin = pins.find((p) => p.selector === selector);
        if (pin === undefined) {
          const rect = element.getBoundingClientRect();
          pin = {
            id: crypto.randomUUID(),
            tag: element.localName,
            role: element.getAttribute?.("role") ?? "",
            label: element.getAttribute?.("aria-label") ?? "",
            selector,
            text: (element.textContent ?? "").trim().slice(0, 300),
            component: reactComponentName(element) ?? "",
            comment: check === "imgAlt" ? t("auditFixCommentAlt") : t("auditFixComment"),
            changes: [],
            pageUrl: PAGE_URL,
            rect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
            offsets: { ox: rect.width / 2, oy: rect.height / 2 },
            shot: null,
            status: "queued",
            at: Date.now()
          };
          if (viewportPresetWidth !== null) pin.viewportWidth = viewportPresetWidth;
          pins.push(pin);
          savePins();
          renderPins();
        }
        return pin;
      }
    };
    const panel = el("div", { class: "popover composer lr-audit-panel", style: "width:320px" });
    const placeDefault = () => {
      panel.style.left = `${Math.min(Math.max(8, window.innerWidth - 348), Math.max(8, window.innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = `${Math.min(Math.max(8, 64), Math.max(8, window.innerHeight - panel.offsetHeight - 8))}px`;
      panel.style.transform = "none";
    };
    auditPlaceDefault = placeDefault;
    const progressFill = el("div", { class: "lr-audit-progress-fill" });
    const progressLabel = el("span", { class: "lr-audit-progress-label" });
    const progressWrap = el("div", { class: "lr-audit-progress" }, el("div", { class: "lr-audit-progress-track" }, progressFill), progressLabel, el("button", { class: "lr-audit-cancel", type: "button", onclick: () => { auditRunToken += 1; } }, t("auditCancel")));
    const resultsBox = el("div", { class: "lr-audit-results" });
    const body = el("div", { class: "lr-audit-body" }, progressWrap, resultsBox);
    const renderAuditGroups = (findings) => {
      const box = el("div", { class: "lr-audit-results" });
      for (const group of groupAuditFindings(findings)) {
        const section = el("div", { class: "lr-audit-group" }, el("div", { class: "lr-audit-group-title" }, t(group.title), el("span", { class: "lr-audit-count" }, t("a11yAuditIssuesCount").replace("{n}", group.findings.length))));
        for (const finding of group.findings) {
          section.append(el("button", { class: "lr-audit-row", type: "button", onclick: () => revealSelector(finding.selector) },
            el("span", { class: "lr-audit-label" }, finding.label),
            el("span", { class: "lr-audit-value" }, finding.value),
            A11Y_FIXABLE_CHECKS.has(group.check) ? el("button", { class: "lr-a11y-fix", type: "button", onclick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              revealSelector(finding.selector);
              showA11yFixPreview(section, section, finding.element, group.check);
            } }, t("a11yFixApply")) : null));
        }
        box.append(section);
      }
      return box;
    };
    panel.append(
      el("div", { class: "composer-target" }, el("span", { class: "chip" }, ICONS.code, t("a11yAuditPage")), el("button", { class: "lr-close", title: t("panelClose"), type: "button", onclick: () => closeAuditPanel() }, "✕")),
      body
    );
    auditPanelNode = panel;
    fixedLayer.append(panel);
    placeDefault();
    applyPanelPosition(panel, "audit");
    wirePanelDrag(panel, "audit", () => auditPlaceDefault?.());
    runPageAudit({
      limit: auditLimit,
      onProgress: (update) => {
        if (auditRunToken !== token) return;
        progressFill.style.width = `${Math.round((update.done / Math.max(1, update.total)) * 100)}%`;
        progressLabel.textContent = `${update.done}/${update.total}`;
        resultsBox.replaceChildren(renderAuditGroups(update.findings));
      },
      shouldStop: () => auditRunToken !== token
    }).then((result) => {
      if (auditRunToken !== token) return;
      progressWrap.remove();
      const box = el("div", { class: "lr-audit-results" }, el("div", { class: "lr-audit-summary" }, t("a11yAuditScanned").replace("{scanned}", result.scanned).replace("{findings}", result.findings.length)));
      if (result.stopped === true) box.append(el("div", { class: "lr-audit-summary lr-audit-partial" }, t("auditPartial")));
      const groups = renderAuditGroups(result.findings);
      if (groups.children.length === 0) box.append(el("div", { class: "lr-audit-summary" }, t("a11yAuditNoIssues")));
      for (const child of [...groups.children]) box.append(child);
      resultsBox.replaceChildren(box);
    });
  }

  function renderPinPanel(pin) {
    pinPanelNode?.remove();
    pinPanelNode = null;
    if (openPinId !== pin.id) return;
    mountShadow();
    const point = anchorPoint(pin) ?? { x: pin.rect.x, y: pin.rect.y };
    const panel = el("div", { class: "popover composer", style: "width:320px" });
    const changesText = pin.changes.map((c) => `${c.prop}: ${c.before} → ${c.after}`).join(" · ");
    const textChangeText = pin.textChange ? `texto: "${pin.textChange.before}" → "${pin.textChange.after}"` : "";
    const ambiguousCount = countSelectorMatches(pin.selector, (sel) => document.querySelectorAll(sel));
    const textarea = el("textarea", { placeholder: t("editComment") });
    textarea.value = pin.comment;
    const submit = el("button", { class: "send", title: t("saveEdit") }, ICONS.arrowUp);
    submit.addEventListener("click", () => savePinComment(pin, textarea));
    textarea.addEventListener("keydown", (event) => pinCommentKeydown(pin, textarea, event));
    const auditTarget = locate(pin.selector);
    a11yFixHandler.current = auditTarget === null || pin.tag === "canvas" ? null : {
      ensurePin: () => {
        pin.fixes = Array.isArray(pin.fixes) ? pin.fixes : [];
        return pin;
      }
    };
    const trailAncestors = auditTarget === null || pin.selector === "canvas:drawing" ? [] : ancestorTrail(auditTarget);
    const trail = trailAncestors.length === 0 ? null : el("div", { class: "lr-trail", title: t("ancestorTrail"), "aria-label": t("ancestorTrail") }, ...trailAncestors.map((ancestor) => el("button", { type: "button", class: "lr-trail-chip", onclick: () => { reanchorPin(pin, ancestor); renderPinPanel(pin); } }, quickLabel(ancestor))));
    const focusBtn = el("button", {
      onclick: () => {
        toggleFocusMode(pin);
        focusBtn.textContent = focusState.current !== null ? t("focusModeExit") : t("focusMode");
      }
    }, focusState.current !== null ? t("focusModeExit") : t("focusMode"));
    panel.append(
      el("div", { class: "composer-target" }, el("span", { class: "chip" }, ICONS.code, `${pins.filter((p) => p.status !== "resolvido").indexOf(pin) + 1} · ${quickLabel(locate(pin.selector) ?? pin.tag)}`), el("button", { class: "lr-close", title: t("panelClose"), type: "button", onclick: () => closePinPanel() }, "✕")),
      el("div", { class: "pin-bubble-body" }, trail, el("div", { class: "pin-bubble-meta" }, `${pin.selector.slice(0, 90)}${pin.component ? ` · ${pin.component}` : ""}`), el("div", { class: "pin-bubble-meta" }, `${t("pinDimensions")}: ${pinDimensions(pin)} px`), pin.stale === true ? el("div", { class: "pin-bubble-stale" }, t("pinStale")) : null, ambiguousCount > 1 ? el("div", { class: "pin-bubble-warning" }, `${t("ambiguousSelectorWarning").replace("{n}", ambiguousCount)} ${t("ambiguousSelectorDetail").replace("{selector}", pin.selector)}`) : null, changesText !== "" ? el("div", { class: "pin-bubble-changes" }, changesText) : null, textChangeText !== "" ? el("div", { class: "pin-bubble-changes" }, textChangeText) : null),
      auditTarget === null || pin.tag === "canvas" ? null : a11yAuditSection(auditTarget),
      el("div", { class: "prompt-input" }, renderTemplateRow(textarea), textarea, el("div", { class: "prompt-actions" }, el("div", { class: "prompt-extras" }), submit)),
      el(
        "div",
        { class: "pin-bubble-actions" },
        pin.changes.length > 0 ? el("button", { onclick: () => copyCssPatch(pin) }, t("copyCss")) : null,
        el("button", { onclick: () => copySelectorText(pin) }, t("copySelector")),
        el("button", {
          onclick: () => {
            pin.status = pin.status === "resolvido" ? "queued" : "resolvido";
            savePins();
            postSnapshot();
            openPinId = null;
            exitFocusMode();
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
            pinPanelNode?.remove();
            pinPanelNode = null;
            exitFocusMode();
            renderPins();
            toast(t("pinDeleted"));
          }
        }, t("del"))
      ),
      el("div", { class: "pin-bubble-actions pin-bubble-actions-secondary" }, focusBtn, el("button", {
        onclick: () => {
          duplicateArmed = pin;
          setMode("picking");
          setHint(t("duplicateHint"));
        }
      }, t("duplicatePin")))
    );
    const placePinDefault = () => {
      const anchor = anchorPoint(pin) ?? { x: pin.rect.x, y: pin.rect.y };
      panel.style.left = `${Math.min(Math.max(8, anchor.x + 16), window.innerWidth - 336)}px`;
      panel.style.top = `${Math.min(Math.max(8, anchor.y - 40), Math.max(8, window.innerHeight - panel.offsetHeight - 8))}px`;
      panel.style.transform = "none";
    };
    const left = Math.min(Math.max(8, point.x + 16), window.innerWidth - 336);
    pinPanelNode = panel;
    rootDiv.append(panel);
    const top = Math.min(Math.max(8, point.y - 40), Math.max(8, window.innerHeight - panel.offsetHeight - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    applyPanelPosition(panel, "pin");
    wirePanelDrag(panel, "pin", placePinDefault);
  }

  function savePinComment(pin, textarea) {
    pin.comment = textarea.value.trim() || pin.comment;
    pin.status = "queued";
    savePins();
    postSnapshot();
    openPinId = null;
    renderPinPanel(pin);
    renderPins();
  }

  function pinCommentKeydown(pin, textarea, event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      savePinComment(pin, textarea);
    }
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
  function blendColor(color, target, amount) {
    return {
      r: Math.round(color.r + (target.r - color.r) * amount),
      g: Math.round(color.g + (target.g - color.g) * amount),
      b: Math.round(color.b + (target.b - color.b) * amount),
      a: color.a
    };
  }
  function proposeContrastFix(textColor, backgroundColor) {
    const text = typeof textColor === "string" ? parseColor(textColor) : textColor;
    const background = typeof backgroundColor === "string" ? parseColor(backgroundColor) : backgroundColor;
    if (text === null || background === null || (text.a ?? 1) < 1 || (background.a ?? 1) < 1) return null;
    const backgroundLuminance = relativeLuminance(background);
    const target = backgroundLuminance >= 0.25 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    const ratioBefore = contrastRatio(text, background);
    if (ratioBefore === null || ratioBefore >= 4.5) return null;
    const reachesTarget = contrastRatio(target, background);
    if (reachesTarget === null || reachesTarget < 4.5) return null;
    let low = 0;
    let high = 1;
    let best = null;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      const candidate = blendColor(text, target, mid);
      const ratio = contrastRatio(candidate, background);
      if (ratio !== null && ratio >= 4.5) {
        best = candidate;
        high = mid;
      } else {
        low = mid;
      }
    }
    if (best === null) return null;
    return { before: hexOf(text), after: hexOf(best), ratioBefore, ratioAfter: contrastRatio(best, background) };
  }
  function deriveAltText(descriptor) {
    const alt = descriptor?.alt;
    const ariaLabel = descriptor?.ariaLabel;
    const title = descriptor?.title;
    const src = descriptor?.src;
    if (typeof alt === "string" && alt.trim() !== "") return alt.trim();
    if (typeof ariaLabel === "string" && ariaLabel.trim() !== "") return ariaLabel.trim();
    if (typeof title === "string" && title.trim() !== "") return title.trim();
    if (typeof src === "string" && src.trim() !== "") {
      const withoutQuery = src.split(/[?#]/u)[0];
      const parts = withoutQuery.split("/");
      const basename = parts[parts.length - 1] ?? "";
      if (basename !== "") {
        try { return decodeURIComponent(basename); }
        catch { return basename; }
      }
    }
    return "";
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
  async function captureBeforeAfter(target, pin) {
    if ((pin.changes?.length ?? 0) === 0 && !pin.textChange) return;
    if (!screenshotOnSend) return;
    const patch = adjustPatch;
    if (patch === null) return;
    const rect = target.getBoundingClientRect();
    const box = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    const after = await captureCropFor(box);
    if (after !== null) pin.afterShot = after;
    restoreAll(patch);
    if (!captureCancelled) {
      const before = await captureCropFor(box);
      if (before !== null) pin.shot = before;
    }
    applyCommitted(patch, pin.changes, pin.textChange);
  }


  let adjustPatch = null;
  let adjustValues = new Map();
  let adjustText = "";
  let adjustInvalid = new Set();
  let adjustLedger = new Map();
  const adjustSeen = { flex: false, layout: false, positioned: false };
  let adjustUndoStack = [];
  let adjustRedoStack = [];

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
    if (next !== adjustValues.get(prop)) {
      adjustUndoStack.push({ kind: "prop", prop, value: adjustBaseline(prop) });
      adjustRedoStack = [];
    }
    adjustValues.set(prop, next);
    rerenderAdjustRows();
  }
  function restoreAdjustBaseline(prop) {
    const ledger = adjustTarget !== null ? adjustLedger.get(adjustTargetSelector) : undefined;
    const before = ledger?.props?.get(prop);
    const value = before !== undefined ? before : (adjustPatch?.computedBaselines.get(prop) ?? "");
    if (adjustPatch !== null && value === (adjustPatch.computedBaselines.get(prop) ?? "")) restoreStyle(adjustPatch, prop);
    else if (adjustPatch !== null) previewStyle(adjustPatch, prop, value);
    adjustValues.set(prop, value);
    adjustInvalid.delete(prop);
    rerenderAdjustRows();
  }
  function adjustReset(prop) {
    restoreAdjustBaseline(prop);
    adjustRedoStack = [];
  }
  function adjustUpdateText(next) {
    if (adjustText !== next) {
      adjustUndoStack.push({ kind: "text", prop: null, value: adjustText });
      adjustRedoStack = [];
    }
    applyAdjustText(next);
  }
  function applyAdjustText(next) {
    adjustText = next;
    if (adjustPatch === null || adjustPatch.originalText === null) return;
    if (next === adjustPatch.originalText.value) restoreText(adjustPatch);
    else adjustPatch.originalText.node.data = next;
    rerenderAdjustRows();
  }
  function applyAdjustEntry(entry) {
    if (entry.kind === "text") {
      applyAdjustText(entry.value);
      return;
    }
    if (entry.value !== adjustBaseline(entry.prop)) {
      adjustInvalid.delete(entry.prop);
      if (adjustPatch !== null) previewStyle(adjustPatch, entry.prop, entry.value);
      adjustValues.set(entry.prop, entry.value);
      rerenderAdjustRows();
      return;
    }
    restoreAdjustBaseline(entry.prop);
  }
  function adjustUndo() {
    const entry = adjustUndoStack.pop();
    if (entry === undefined) return;
    if (entry.kind === "text") adjustRedoStack.push({ kind: "text", prop: null, value: adjustText });
    else adjustRedoStack.push({ kind: "prop", prop: entry.prop, value: adjustValues.get(entry.prop) ?? "" });
    applyAdjustEntry(entry);
  }
  function adjustRedo() {
    const entry = adjustRedoStack.pop();
    if (entry === undefined) return;
    if (entry.kind === "text") adjustUndoStack.push({ kind: "text", prop: null, value: adjustText });
    else adjustUndoStack.push({ kind: "prop", prop: entry.prop, value: adjustValues.get(entry.prop) ?? "" });
    applyAdjustEntry(entry);
  }

  const FORCE_STATE_CLASSES = { hover: "lr-fh", focus: "lr-ff", active: "lr-fa" };
  let forceTarget = null;
  let forceStates = new Set();

  function forceSubjectSplit(part) {
    let depth = 0;
    let boundary = -1;
    for (let i = 0; i < part.length; i += 1) {
      const char = part[i];
      if (char === "[" || char === "(") depth += 1;
      else if (char === "]" || char === ")") depth -= 1;
      else if (depth === 0 && (char === " " || char === ">" || char === "+" || char === "~")) boundary = i;
    }
    if (boundary === -1) return ["", part];
    return [part.slice(0, boundary + 1), part.slice(boundary + 1).trim()];
  }

  function notPseudoSpans(part) {
    const spans = [];
    let i = part.indexOf(":not(");
    while (i !== -1) {
      let depth = 0;
      for (let j = i + 5; j < part.length; j += 1) {
        if (part[j] === "(") depth += 1;
        else if (part[j] === ")") {
          if (depth === 0) { spans.push([i + 5, j]); break; }
          depth -= 1;
        }
      }
      i = part.indexOf(":not(", i + 1);
    }
    return spans;
  }

  function buildForceRules(target, pseudo) {
    const token = `:${pseudo}`;
    const marker = `.${FORCE_STATE_CLASSES[pseudo]}`;
    const rules = [];
    const walk = (ruleList) => {
      for (const rule of ruleList) {
        if (rule.selectorText === undefined && rule.cssRules !== undefined && rule.cssRules !== null) {
          walk(rule.cssRules);
          continue;
        }
        if (typeof rule.selectorText !== "string" || rule.style === null || rule.style === undefined) continue;
        for (const rawPart of rule.selectorText.split(",")) {
          const part = rawPart.trim();
          if (part === "") continue;
          const spans = notPseudoSpans(part);
          const occurrences = [];
          let at = part.indexOf(token);
          while (at !== -1) {
            const next = part[at + token.length];
            if (!(next !== undefined && /[a-zA-Z-]/.test(next))) occurrences.push(at);
            at = part.indexOf(token, at + 1);
          }
          if (occurrences.length === 0) continue;
          if (occurrences.some((at) => spans.some(([start, end]) => at >= start && at < end))) continue;
          const [prefix, subject] = forceSubjectSplit(part);
          if (!occurrences.some((at) => at >= prefix.length)) continue;
          const subjectWithout = subject.split(token).join("");
          let matched = false;
          try { matched = target.matches(subjectWithout); } catch {}
          if (matched) rules.push(`${prefix}${subject.split(token).join(marker)}{${rule.style.cssText}}`);
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {}
    }
    return rules;
  }

  function applyForceStates() {
    if (forceTarget === null) return;
    let css = "";
    for (const pseudo of Object.keys(FORCE_STATE_CLASSES)) {
      const on = forceStates.has(pseudo);
      forceTarget.classList.toggle(FORCE_STATE_CLASSES[pseudo], on);
      if (on) {
        for (const rule of buildForceRules(forceTarget, pseudo)) css += rule;
      }
    }
    if (forceStates.size === 0) {
      clearForceStates();
      return;
    }
    let tag = document.getElementById("lr-force-states");
    if (css === "") {
      tag?.remove();
      return;
    }
    if (tag === null) {
      tag = document.createElement("style");
      tag.id = "lr-force-states";
      (document.head ?? document.documentElement).append(tag);
    }
    tag.textContent = css;
  }

  function clearForceStates() {
    if (forceTarget !== null) {
      for (const marker of Object.values(FORCE_STATE_CLASSES)) forceTarget.classList.remove(marker);
    }
    document.getElementById("lr-force-states")?.remove();
    forceTarget = null;
    forceStates = new Set();
  }

  function refreshForceChips() {
    if (adjustPanel === null) return;
    for (const chip of adjustPanel.querySelectorAll("[data-lr-pseudo]")) {
      chip.toggleAttribute("data-on", forceStates.has(chip.dataset.lrPseudo));
    }
  }

  function toggleForceState(pseudo) {
    if (forceStates.has(pseudo)) forceStates.delete(pseudo);
    else forceStates.add(pseudo);
    applyForceStates();
    refreshForceChips();
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
    if (opts.tokens) row.append(opts.tokens);
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
    if (typeof opts.filter === "string") row.setAttribute("data-filter", opts.filter);
    return row;
  }
  function normalizeInspectorText(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function applyInspectorFilter(query, entries, emptyNote) {
    const needle = normalizeInspectorText(query.trim());
    let visible = 0;
    for (const entry of entries) {
      const matching = needle === "" ? entry.rows : entry.rows.filter((row) => row.text.includes(needle));
      const hit = needle === "" || matching.length > 0;
      entry.section.style.display = hit ? "" : "none";
      if (entry.head === null) {
        if (hit) visible += matching.length;
        continue;
      }
      if (needle === "") {
        if (entry.wasOpen) entry.section.setAttribute("data-open", "");
        else entry.section.removeAttribute("data-open");
        entry.body.style.display = entry.wasOpen ? "" : "none";
        entry.head.setAttribute("aria-expanded", entry.wasOpen ? "true" : "false");
        for (const row of entry.rows) row.row.style.display = "";
        continue;
      }
      if (!hit) continue;
      entry.section.setAttribute("data-open", "");
      entry.body.style.display = "";
      entry.head.setAttribute("aria-expanded", "true");
      for (const row of entry.rows) row.row.style.display = row.text.includes(needle) ? "" : "none";
      visible += matching.length;
    }
    emptyNote.style.display = needle !== "" && visible === 0 ? "" : "none";
  }
  function wireInspectorFilter(body) {
    const entries = [];
    for (const section of body.children) {
      if (!(section instanceof Element)) continue;
      if (section.classList.contains("lr-row")) {
        const label = section.querySelector(".lr-row-label");
        entries.push({ section, head: null, body: null, wasOpen: false, rows: [{ row: section, text: normalizeInspectorText(`${label?.textContent ?? ""} ${section.getAttribute("data-filter") ?? ""}`) }] });
        continue;
      }
      if (!section.classList.contains("lr-sec")) continue;
      const head = section.querySelector(".lr-sec-head");
      const secBody = section.querySelector(".lr-sec-body");
      if (head === null || secBody === null) continue;
      const rows = [];
      for (const row of secBody.children) {
        if (!(row instanceof Element) || !row.classList.contains("lr-row")) continue;
        const label = row.querySelector(".lr-row-label");
        rows.push({ row, text: normalizeInspectorText(`${label?.textContent ?? ""} ${row.getAttribute("data-filter") ?? ""}`) });
      }
      if (rows.length === 0) continue;
      entries.push({ section, head, body: secBody, rows, wasOpen: section.hasAttribute("data-open") });
    }
    if (entries.length === 0) return;
    const emptyNote = el("div", { class: "lr-filter-empty" }, t("inspectorFilterNoResults"));
    emptyNote.style.display = "none";
    const input = el("input", { class: "lr-filter", type: "text", placeholder: t("inspectorFilterPlaceholder"), "aria-label": t("inspectorFilterPlaceholder") });
    const clearBtn = el("button", { class: "lr-filter-clear", type: "button", title: t("inspectorFilterClear"), "aria-label": t("inspectorFilterClear") }, "✕");
    clearBtn.style.display = "none";
    const run = () => {
      clearBtn.style.display = input.value === "" ? "none" : "";
      applyInspectorFilter(input.value, entries, emptyNote);
    };
    input.addEventListener("input", run);
    clearBtn.addEventListener("click", () => {
      input.value = "";
      run();
      input.focus();
    });
    body.before(el("div", { class: "lr-filter-bar" }, input, clearBtn));
    body.after(emptyNote);
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
      makeMenuToggleable(preset);
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
  function makeMenuToggleable(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    let menuOpen = false;
    const closeMenu = () => { menuOpen = false; };
    select.addEventListener("mousedown", (event) => {
      if (menuOpen) {
        event.preventDefault();
        event.stopPropagation();
        select.blur();
        closeMenu();
      } else {
        menuOpen = true;
      }
    });
    select.addEventListener("blur", closeMenu);
    select.addEventListener("change", closeMenu);
    select.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }
  function menuControl(options, value, onChange) {
    const select = el("select", { class: "lr-menu" });
    const values = options.includes(value) ? options : [value, ...options];
    for (const option of values) select.append(el("option", { value: option }, option));
    select.value = value;
    makeMenuToggleable(select);
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
        label: t("prop." + prop) === "prop." + prop ? (PROP_META[prop]?.label ?? "") : t("prop." + prop),
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
        label: t("prop." + prop) === "prop." + prop ? (PROP_META[prop]?.label ?? "") : t("prop." + prop),
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
    if (adjustUndoBtn !== null) adjustUndoBtn.toggleAttribute("data-disabled", adjustUndoStack.length === 0);
    if (adjustRedoBtn !== null) adjustRedoBtn.toggleAttribute("data-disabled", adjustRedoStack.length === 0);
  }
  function adjustCanConfirm() {
    const comment = adjustCommentInput?.value?.trim() ?? "";
    return comment !== "" || adjustCurrentChanges().length > 0 || (adjustPatch?.originalText !== null && adjustText !== (adjustPatch?.originalText?.value ?? ""));
  }
  const TOKEN_SUGGESTION_PROPS = new Set(["color", "background-color", "border-color", "font-family", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-radius"]);
  function collectCustomProps(target) {
    const style = getComputedStyle(target);
    const props = [];
    for (let index = 0; index < style.length; index += 1) {
      const name = style.item(index);
      if (!/^--[A-Za-z0-9_-]+$/.test(name)) continue;
      props.push({ name, value: style.getPropertyValue(name) });
    }
    return props;
  }
  function matchTokensByValue(props, currentValue) {
    const wanted = typeof currentValue === "string" ? currentValue.trim() : "";
    if (wanted === "") return [];
    return props.filter((prop) => prop.value.trim() === wanted).map((prop) => prop.name);
  }
  function makeTokenProbe(target, props) {
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    for (const prop of props) probe.style.setProperty(prop.name, prop.value);
    (target.parentElement ?? target).append(probe);
    return probe;
  }
  function tokenSuggestionsFor(target, currentValue, makeProbe) {
    const props = collectCustomProps(target);
    if (props.length === 0) return [];
    const probe = makeProbe(target, props);
    const probeStyle = getComputedStyle(probe);
    const names = matchTokensByValue(props.map((prop) => ({ name: prop.name, value: probeStyle.getPropertyValue(prop.name) })), currentValue);
    probe.remove();
    return names;
  }
  function tokenChipRowFromNames(names, applyToken) {
    if (!Array.isArray(names) || names.length === 0) return null;
    const row = el("div", { class: "lr-token-row" });
    row.append(el("span", { class: "lr-token-label" }, t("tokenSuggestions")));
    for (const name of names) {
      const chip = el("button", { type: "button", class: "lr-token-chip", title: name });
      chip.textContent = name;
      chip.addEventListener("click", () => applyToken(name));
      row.append(chip);
    }
    return row;
  }
  function tokenChipRow(target, currentValue, applyToken) {
    return tokenChipRowFromNames(tokenSuggestionsFor(target, currentValue, makeTokenProbe), applyToken);
  }
  function propertyRow(prop) {
    const meta = PROP_META[prop];
    if (meta === undefined) return null;
    const label = t("prop." + prop) === "prop." + prop ? meta.label : t("prop." + prop);
    const value = adjustValues.get(prop) ?? "";
    let control;
    let refreshDisplay = null;
    if (meta.kind === "color") {
      control = colorControl(value, (next) => adjustUpdateProperty(prop, next));
      refreshDisplay = () => control.__refresh(adjustValues.get(prop) ?? "", adjustInvalid.has(prop));
    } else if (meta.kind === "menu") {
      control = menuControl(meta.options ?? [], value, (next) => adjustUpdateProperty(prop, next));
      refreshDisplay = () => {
        const current = adjustValues.get(prop) ?? "";
        if (current !== "" && ![...control.options].some((option) => option.value === current)) control.append(el("option", { value: current }, current));
        control.value = current;
      };
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
      refresh: refreshDisplay,
      filter: `${prop} ${meta.label}`,
      tokens: TOKEN_SUGGESTION_PROPS.has(prop) && value !== "" ? tokenChipRow(adjustTarget, value, (tokenName) => adjustUpdateProperty(prop, `var(${tokenName})`)) : null
    });
  }
  function quadRow(label, props4, badges4, min) {
    const wrap = quadControl(props4, badges4, props4.map((p) => adjustNumericFallback(p)), min, (prop, next) => adjustUpdateProperty(prop, next));
    const source = props4.map((p) => adjustValues.get(p) ?? "").find((v) => v !== "") ?? "";
    const names = source === "" ? [] : tokenSuggestionsFor(adjustTarget, source, makeTokenProbe);
    return inspectorRow(label, wrap, { wide: true, staticLabel: true, filter: props4.join(" "), changed: () => props4.some((p) => adjustChanged(p)), onReset: () => { props4.forEach((p) => adjustReset(p)); wrap.__refresh(); }, rerender: adjustRerender, tokens: tokenChipRowFromNames(names, (tokenName) => {
      for (const p of props4) {
        if ((adjustValues.get(p) ?? "") === source) adjustUpdateProperty(p, `var(${tokenName})`);
      }
      wrap.__refresh();
    }) });
  }

  let adjustCommentInput = null;
  let adjustConfirmBtn = null;
  let adjustUndoBtn = null;
  let adjustRedoBtn = null;
  let adjustTargetSelector = "";

  function closeAdjustPanel(restore) {
    clearForceStates();
    if (adjustPanel !== null && restore && adjustPatch !== null) restoreAll(adjustPatch);
    adjustPanel?.remove();
    adjustPanel = null;
    adjustPatch = null;
    adjustValues = new Map();
    adjustInvalid = new Set();
    adjustRerender = [];
    adjustCommentInput = null;
    adjustConfirmBtn = null;
    adjustUndoBtn = null;
    adjustRedoBtn = null;
    adjustUndoStack = [];
    adjustRedoStack = [];
  }

  function openAdjustPanel(target) {
    closePanels();
    adjustTarget = target ?? document.body;
    forceTarget = adjustTarget;
    forceStates = new Set();
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
    adjustUndoBtn = el("button", { class: "lr-undo", type: "button", title: t("adjustUndo"), onclick: () => adjustUndo() }, t("adjustUndo"));
    adjustRedoBtn = el("button", { class: "lr-redo", type: "button", title: t("adjustRedo"), onclick: () => adjustRedo() }, t("adjustRedo"));
    const targetLine = el("div", { class: "composer-target" }, el("span", { class: "chip" }, ICONS.code, `<${adjustTarget.localName}>`), el("span", { class: "lr-insp-sub" }, adjustTargetSelector.slice(0, 60)), adjustUndoBtn, adjustRedoBtn, el("button", { class: "lr-close", title: t("panelClose"), type: "button", onclick: () => closeAdjustPanel(true) }, "✕"));
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
      const styleRow = inspectorRow(t("prop.font-style"), el("span", { class: "lr-row-ctl" }), { changed: () => adjustChanged("font-weight") || adjustChanged("font-style") || adjustChanged("text-decoration"), onReset: () => { adjustReset("font-weight"); adjustReset("font-style"); adjustReset("text-decoration"); }, rerender: adjustRerender, filter: "font-weight font-style text-decoration" });
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
      const alignRow = inspectorRow(t("prop.text-align"), el("span", { class: "lr-row-ctl" }), { changed: () => adjustChanged("text-align"), onReset: () => adjustReset("text-align"), rerender: adjustRerender });
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
      const shadowRowEl = inspectorRow(t("prop.box-shadow"), shadowWrap, { wide: true, staticLabel: true, filter: "box-shadow", changed: () => adjustChanged("box-shadow"), onReset: () => { adjustReset("box-shadow"); shadowWrap.__render(); }, rerender: adjustRerender });
      const transformRowEl = inspectorRow(t("prop.transform"), transformWrap, { wide: true, staticLabel: true, filter: "transform", changed: () => adjustChanged("transform"), onReset: () => { adjustReset("transform"); transformWrap.__render(); }, rerender: adjustRerender });
      sec.append(shadowRowEl, transformRowEl);
    }));

    body.prepend(inspectorRow(t("inspectorStates"), el("span", { class: "lr-row-ctl" }, ...["hover", "focus", "active"].map((pseudo) => {
      const chip = el("button", { type: "button", class: "lr-tgl", "data-lr-pseudo": pseudo }, `:${pseudo}`);
      chip.toggleAttribute("data-on", forceStates.has(pseudo));
      chip.addEventListener("click", () => toggleForceState(pseudo));
      return chip;
    }), { filter: "hover focus active states" })));

    panel.append(body);
    wireInspectorFilter(body);

    const footer = el("div", { class: "lr-footer" });
    const cancel = el("button", { class: "lr-cancel", type: "button" }, t("cancelBtn"));
    cancel.addEventListener("click", () => closeAdjustPanel(true));
    adjustConfirmBtn = el("button", { class: "lr-confirm", type: "button", title: "Confirmar ajustes" }, t("confirmBtn"));
    adjustConfirmBtn.addEventListener("click", async () => {
      const changes = adjustCurrentChanges();
      const textChanged = adjustPatch !== null && adjustPatch.originalText !== null && adjustText !== adjustPatch.originalText.value;
      if (!adjustCanConfirm()) return;
      const ledger = adjustLedger.get(adjustTargetSelector);


      let pin = pins.find((p) => p.selector === adjustTargetSelector);
      if (!pin) {
        const rect = adjustTarget.getBoundingClientRect();
        const newAdjustPin = {
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
        };
        if (viewportPresetWidth !== null) newAdjustPin.viewportWidth = viewportPresetWidth;
        pins.push(newAdjustPin);
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
      try {
        await captureBeforeAfter(adjustTarget, pin);
      } finally {
        savePins();
        renderPins();
        postSnapshot();
        openPinId = null;
        closeAdjustPanel(false);
        toast(t("adjustSaved"), 3200);
      }
    });
    footer.append(cancel, adjustConfirmBtn);
    panel.append(footer);

    const below = rect.bottom + 12 + 460 < window.innerHeight;
    const placeAdjustDefault = () => {
      const liveRect = (adjustTarget ?? document.body).getBoundingClientRect();
      const fits = liveRect.bottom + 12 + 460 < window.innerHeight;
      panel.style.left = `${Math.min(Math.max(8, liveRect.left), Math.max(8, window.innerWidth - 372))}px`;
      panel.style.top = fits ? `${liveRect.bottom + 12}px` : `${Math.max(8, liveRect.top - 12 - Math.min(560, window.innerHeight - 24))}px`;
      panel.style.transform = "none";
    };
    panel.style.left = `${Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - 372))}px`;
    panel.style.top = below ? `${rect.bottom + 12}px` : `${Math.max(8, rect.top - 12 - Math.min(560, window.innerHeight - 24))}px`;
    adjustPanel = panel;
    rootDiv.append(panel);
    applyPanelPosition(panel, "adjust");
    wirePanelDrag(panel, "adjust", placeAdjustDefault);
    rerenderAdjustRows();
  }


  async function pollStatus() {
    try {
      const data = await bridgeSend("state.get", {});
      if (data === null || typeof data !== "object" || data.ok !== true) return;
      if (typeof data.lang === "string" && data.lang !== "") {
        const next = resolveUiLang(data.lang);
        if (next !== UI_LANG) {
          UI_LANG = next;
          SETTINGS.lang = data.lang;
          applyOverlayLanguage();
        }
      }
      applySettings(data.settings);
      const deliveredIds = Array.isArray(data.deliveredIds) ? data.deliveredIds : [];
      if (deliveredIds.length > 0) {
        const gone = new Set(deliveredIds);
        const before = pins.length;
        pins = pins.filter((p) => !(p.status === "queued" && gone.has(p.id)));
        if (pins.length !== before) {
          savePins();
          discardDraft();
          closePanels();
          clearHighlight();
          toast(t("deliveredToast"), 3200);
        }
      }
      if (data.active === true) lastAgentActivity = Date.now();
      reconcileWithHost(data.pendingIds, data.resolvedIds ?? []);
      renderPins();
    } catch {}
  }


  function reconcileWithHost(ids, resolvedIds) {
    try {
      const known = new Set(Array.isArray(ids) ? ids : []);
      const resolved = new Set(Array.isArray(resolvedIds) ? resolvedIds : []);
      let changed = false;
      pins = pins.filter((p) => {
        if (p.status !== "queued") return true;
        if (resolved.has(p.id)) {
          p.status = "resolvido";
          changed = true;
          return true;
        }
        if (known.has(p.id)) return true;
        if (Date.now() - (p.at ?? 0) < 6000) return true;
        changed = true;
        return false;
      });
      if (changed) savePins();
    } catch {}
  }
  setInterval(pollStatus, 2500);

  const toastStack = el("div", { class: "lr-toast-stack" });
  rootDiv.append(toastStack);

  function pushToast(container, text, ms, makeItem) {
    const stack = container ?? makeItem("div", { class: "lr-toast-stack" });
    stack.className = "lr-toast-stack";
    stack.style.pointerEvents = "none";
    const item = makeItem("div", { class: "toast toast-info", style: "pointer-events: auto" }, String(text));
    item.style.pointerEvents = "auto";
    const dismiss = makeItem("button", { class: "lr-close", title: t("panelClose"), type: "button", onclick: () => item.remove() }, "✕");
    item.append(dismiss);
    stack.append(item);
    setTimeout(() => item.remove(), ms);
    return item;
  }

  function toast(text, ms = 2600) {
    mountShadow();
    pushToast(toastStack, text, ms, el);
  }

  function closePanels() {
    resetMeter();
    pinPanelNode?.remove();
    pinPanelNode = null;
    a11yFixHandler.current = null;
    exitFocusMode();
    closeAuditPanel();
    if (adjustPanel !== null) closeAdjustPanel(true);
  }


  function startup() {
    mountShadow();
    setupDrawCanvas();
    renderPins();
    applyOverlayLanguage();
    void pullGuestViewport().then((raw) => {
      const next = parseVpPayload(raw);
      if (next.w !== vpWidth || next.z !== vpZoom) applyViewportState(next, { push: false });
    }).catch(() => {});
    if (pins.length > 0) toast(t("restoredPins").replace("{n}", pins.length));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startup);
  else startup();
})();
