# dsh-redline

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · 简体中文

[![npm](https://img.shields.io/npm/v/dsh-redline)](https://www.npmjs.com/package/dsh-redline) [![downloads](https://img.shields.io/npm/dm/dsh-redline)](https://www.npmjs.com/package/dsh-redline) [![license](https://img.shields.io/github/license/klaus-2/dsh-redline)](LICENSE) [![release](https://img.shields.io/github/v/release/klaus-2/dsh-redline)](https://github.com/klaus-2/dsh-redline/releases) [![discussions](https://img.shields.io/github/discussions/klaus-2/dsh-redline)](https://github.com/klaus-2/dsh-redline/discussions)

**指向页面上的任意元素，你的智能体直接改代码。**

`dsh-redline` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件，把可视化评审放进内置浏览器：选中元素、写批注、实时调整样式并确认——批注会作为结构化上下文附加到你的下一条消息，并附带精确裁剪的截图。

```
dsh plugin --profile web add dsh-redline
```

## 为什么做这个

用文字描述 UI 问题会丢失指针。"中间那个按钮看起来不对" 只能让智能体去猜。Redline 把反馈绑定到元素本身：选择器、角色、文本、你的评论、裁剪截图，以及你尝试过的每一项样式调整，一次性以结构化块发送。

## 使用方式

1. 在内置浏览器打开的任意页面按 **C**（评论）或 **V**（调整）。
2. 点击元素，弹出的面板会锚定在元素上。
3. 写评论，或打开检查器实时调整文本、颜色、排版、尺寸、间距、边框和效果——每次修改都会即时预览。
4. 确认后，composer 上方的卡片收集所有标注；发送时，标注作为快照随消息一起送达智能体，并在聊天中原生渲染。
5. 按 **D** 打开自由批注画布：画笔、直线、箭头、矩形、椭圆、编号步骤和文字——发送整页截图，所有批注都会合成在截图上。

## 功能

- 任意页面上的元素拾取与悬停高亮
- 每个标注可就地编辑评论，支持解决/重新打开/删除
- 带回滚的实时样式检查器：拖拽数值、取色器、预设、联动盒模型与圆角、阴影与变换，逐行重置
- 每个标注独立裁剪截图（不是整个视口）
- 标注附加到当前查看会话的下一条消息，在聊天中原生渲染为卡片
- 卡片与页面浮层之间的双向同步
- 界面支持 English / Português (Brasil) / 简体中文，按浏览器语言自动选择

## 开发

```bash
npm install
npm run build
npm test
```

`overlay.template.js` + `tencil-overlay.css` 是源文件；`lib/overlay.js` 由构建生成，请勿直接修改。

## 许可

[MIT](LICENSE)
