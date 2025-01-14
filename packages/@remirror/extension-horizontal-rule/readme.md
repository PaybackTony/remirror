# @remirror/extension-horizontal-rule

> Allow your users to divide their content with horizontal lines. Nice!

[![Version][version]][npm] [![Weekly Downloads][downloads-badge]][npm] [![Bundled size][size-badge]][size] [![Typed Codebase][typescript]](#) [![MIT License][license]](#)

[version]: https://flat.badgen.net/npm/v/@remirror/extension-horizontal-rule/next
[npm]: https://npmjs.com/package/@remirror/extension-horizontal-rule/v/next
[license]: https://flat.badgen.net/badge/license/MIT/purple
[size]: https://bundlephobia.com/result?p=@remirror/extension-horizontal-rule@next
[size-badge]: https://flat.badgen.net/bundlephobia/minzip/@remirror/extension-horizontal-rule@next
[typescript]: https://flat.badgen.net/badge/icon/TypeScript?icon=typescript&label
[downloads-badge]: https://badgen.net/npm/dw/@remirror/extension-horizontal-rule/red?icon=npm

## Installation

```bash
# yarn
yarn add @remirror/extension-horizontal-rule@next @remirror/pm@next

# pnpm
pnpm add @remirror/extension-horizontal-rule@next @remirror/pm@next

# npm
npm install @remirror/extension-horizontal-rule@next @remirror/pm@next
```

This is included by default when you install the recommended `remirror` package. All exports are also available via the entry-point, `remirror/extension/horizontal-rule`.

## Usage

The following code creates an instance of this extension.

```ts
import { HorizontalRuleExtension } from 'remirror/extension/horizontal-rule';

const extension = new HorizontalRuleExtension();
```
