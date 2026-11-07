# dsh-redline

[English](README.md) · Português (Brasil) · [简体中文](README.zh-CN.md)

**Aponte para qualquer elemento da página. Seu agente corrige o código.**

`dsh-redline` é um plugin do [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) que traz a revisão visual para dentro do navegador do harness: selecione um elemento, escreva um comentário, ajuste estilos ao vivo e confirme — as anotações chegam ao agente como contexto estruturado anexado à sua próxima mensagem, com um recorte de screenshot exatamente da região marcada.

```
dsh plugin --profile web add dsh-redline
```

## Por que existe

Descrever um problema de UI em palavras perde o ponteiro. "O botão do meio parece errado" faz o agente adivinhar. O Redline mantém o feedback ligado ao elemento: seletor, role, texto, seu comentário, um recorte de screenshot e cada ajuste de estilo que você tentou — tudo em um bloco estruturado.

## Como usar

1. Em qualquer página aberta no navegador do harness, pressione **C** (comentário) ou **V** (ajuste).
2. Clique em um elemento; o popover abre ancorado nele.
3. Escreva o comentário ou abra o inspetor e ajuste texto, cores, tipografia, tamanho, espaçamento, bordas e efeitos — cada mudança faz preview ao vivo.
4. Confirme. O card acima do composer coleta seus pins. Envie e as anotações chegam ao agente como snapshot junto da sua mensagem — renderizadas nativamente no chat.

## Funcionalidades

- Picking de elementos com highlight de hover em qualquer página
- Comentários por pin, editáveis no lugar, com resolver/reabrir/excluir
- Inspetor de estilos ao vivo com rollback: números por arraste, color picker, predefinições, box model e raio com link, sombra e transformação, reset por linha
- Screenshots recortadas por pin (não a viewport inteira)
- Anotações anexam à próxima mensagem da sessão visualizada, renderizadas como card nativo
- Reconciliação: remover um pin no card remove também na página
- Interface em English / Português (Brasil) / 简体中文, escolhida pelo idioma do navegador

## Desenvolvimento

```bash
npm install
npm run build
npm test
```

`overlay.template.js` + `tencil-overlay.css` são os fontes; `lib/overlay.js` é gerado — nunca edite direto.

## Créditos

O design do overlay contém código derivado do sistema de overlay do [tencil](https://tencil.dev/) (Apache-2.0 — veja [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)). Inspirado por [dsh-web-review](https://github.com/CanglongCl/dsh-web-review) e [dsh-annotate](https://github.com/BrambleXu/dsh-annotate).

## Licença

[MIT](LICENSE)
