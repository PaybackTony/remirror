/**
 * @overview
 *
 * This is not usable yet. I'm leaving it here for reference.
 */

/// <reference lib="webworker" />

import { Linter } from 'eslint';

const linter = new Linter();

// Taken from
// https://blog.expo.io/building-a-code-editor-with-monaco-f84b3a06deaf
addEventListener('message', (event) => {
  const { code, version } = event.data;

  try {
    const markers = linter
      .verify(code, {
        /* ESLint config */
      })
      .map((err) => ({
        startLineNumber: err.line,
        endLineNumber: err.line,
        startColumn: err.column,
        endColumn: err.column,
        message: `${err.message} (${err.ruleId})`,
        severity: 3,
        source: 'ESLint',
      }));

    postMessage({ markers, version });
  } catch {
    /* Ignore error */
  }
});
