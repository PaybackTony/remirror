import * as crypto from 'crypto';
import React, { FC, useContext, useEffect, useRef } from 'react';
import { render, unmountComponentAtNode } from 'react-dom';

import type { Shape } from 'remirror/core';

import { PlaygroundContext, PlaygroundContextObject } from '../context';
import { IMPORT_CACHE, INTERNAL_MODULES } from '../generated/modules';
import type { Exports } from '../playground-types';
import { loadScript } from '../playground-utils';
import { ErrorBoundary } from './error-boundary';

// Start with these and cannot remove them
export const REQUIRED_MODULES = INTERNAL_MODULES.map((mod) => mod.moduleName);

const fetchedModules: {
  [id: string]: {
    name: string;
    modulePromise: Promise<unknown>;
  };
} = {};

/**
 * Create the hash of a module name.
 *
 * This is used to ensure the module names are unique on the window.
 */
function createIdHash(str: string): string {
  return `_${crypto.createHash('sha1').update(str).digest('hex')}`;
}

/**
 * Load the required module from the `bundle.run` website.
 *
 * TODO update this to use the playground specific url after forking the bundler
 * project.
 *
 * @param moduleName - the name of the module to load
 * @param id - the name on the window to give to the module once loaded.
 */
async function loadBundledPackage(moduleName: string, id: string): Promise<any> {
  try {
    await loadScript(
      `http://bundle.run/${encodeURIComponent(moduleName)}@latest?name=${encodeURIComponent(id)}`,
    );

    console.info(`LOADED: ${moduleName}`);
    return (window as Shape)[id];
  } catch (error) {
    console.warn(`Failed to load ${moduleName} - ${error.message as string}`);
  }
}

/**
 * This takes an array of string and creates a require function from it which is
 * used to require modules.
 */
export async function createCustomRequire(requires: string[]): Promise<(name: string) => Exports> {
  // A list of promises where all the tasks to load modules are stored.
  const moduleLoadingTasks: Array<Promise<void>> = [];

  // A store for the loaded modules.
  const modules: { [moduleName: string]: any } = {};

  for (const moduleName of requires) {
    if (IMPORT_CACHE[moduleName]) {
      modules[moduleName] = IMPORT_CACHE[moduleName];
      continue;
    }

    // Create the id from the hash of the
    const id = createIdHash(moduleName);

    if (!fetchedModules[id]) {
      fetchedModules[id] = {
        name: moduleName,
        modulePromise: loadBundledPackage(moduleName, id),
      };
    }

    moduleLoadingTasks.push(
      fetchedModules[id].modulePromise.then((remoteModule) => {
        modules[moduleName] = remoteModule;
      }),
    );
  }

  // Load all the modules required.
  await Promise.all(moduleLoadingTasks);

  return function require(moduleName: string) {
    if (modules[moduleName]) {
      return modules[moduleName];
    }

    throw new Error(`Could not require('${moduleName}')`);
  };
}

/**
 * Evaluate the code as if in a CommonJS environment.
 *
 * @param code - the code which is created by the user in the monaco editor
 * after it has been run through the babel compiler to get a common js
 * compatible output.
 * @param customRequire - the require method used to require code that is
 * imported.
 */
function runCode(code: string, customRequire: (mod: string) => unknown) {
  // This is the module that the main file for the playground exports.
  const userModule = { exports: {} as any };

  // Eval the user code. Which in any other context would be a huge no-no!
  eval(`(function userCode(require, module, exports) {${code}})`)(
    customRequire,
    userModule,
    userModule.exports,
  );

  return userModule;
}

interface RunCodeOptions {
  code: string;
  requires: string[];
  playground: PlaygroundContextObject;
}

function executeCodeInElement(div: HTMLDivElement, options: RunCodeOptions) {
  const { code, requires, playground } = options;
  let active = true;

  (async function doIt() {
    try {
      // Create the method which will be used to require all the code needed.
      const customRequire = await createCustomRequire(requires);

      if (!active) {
        return;
      }

      // Then run the code to generate the React element
      const userModule = runCode(code, customRequire);
      const Component = userModule.exports.default || userModule.exports;

      // Then mount the React element into the div
      render(
        <ErrorBoundary>
          <PlaygroundContext.Provider value={playground}>
            <Component />
          </PlaygroundContext.Provider>
        </ErrorBoundary>,
        div,
      );
    } catch (error) {
      console.error(error);
      render(
        <div>
          <h1>Error occurred</h1>
          <pre>
            <code>{String(error)}</code>
          </pre>
        </div>,
        div,
      );
    }
  })();

  return () => {
    active = false;
    unmountComponentAtNode(div);
  };
}

export interface ExecuteProps {
  /** The JavaScript code to execute (in CommonJS syntax) */
  code: string;

  /** A list of the modules this code `require()`s */
  requires: string[];
}

/**
 * Executes the given `code`, mounting the React component that it exported (via
 * `export default`) into the DOM. Is automatically debounced to prevent
 * over-fetching npm modules during typing.
 */
export const Execute: FC<ExecuteProps> = function (props) {
  const { code, requires } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  const playground = useContext(PlaygroundContext);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    return executeCodeInElement(ref.current, { code, requires, playground });
  }, [code, requires, playground]);

  return <div ref={ref} style={{ height: '100%' }} />;
};
