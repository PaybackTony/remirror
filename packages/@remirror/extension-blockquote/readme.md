# @remirror/extension-blockquote

> Add blockquotes to your text editor.

[![Version][version]][npm] [![Weekly Downloads][downloads-badge]][npm] [![Bundled size][size-badge]][size] [![Typed Codebase][typescript]](#) [![MIT License][license]](#)

[version]: https://flat.badgen.net/npm/v/@remirror/extension-blockquote/next
[npm]: https://npmjs.com/package/@remirror/extension-blockquote/v/next
[license]: https://flat.badgen.net/badge/license/MIT/purple
[size]: https://bundlephobia.com/result?p=@remirror/extension-blockquote@next
[size-badge]: https://flat.badgen.net/bundlephobia/minzip/@remirror/extension-blockquote@next
[typescript]: https://flat.badgen.net/badge/icon/TypeScript?icon=typescript&label
[downloads-badge]: https://badgen.net/npm/dw/@remirror/extension-blockquote/red?icon=npm

## Installation

```bash
# yarn
yarn add @remirror/extension-blockquote@next @remirror/pm@next

# pnpm
pnpm add @remirror/extension-blockquote@next @remirror/pm@next

# npm
npm install @remirror/extension-blockquote@next @remirror/pm@next
```

This is included by default when you install the recommended `remirror` package. All exports are also available via the entry-point, `remirror/extension/blockquote`.

## Usage

The following code creates an instance of this extension.

```ts
import { BlockquoteExtension } from 'remirror/extension/blockquote';

const extension = new BlockquoteExtension();
```
