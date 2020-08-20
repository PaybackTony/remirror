import assert from 'assert';
import { EventEmitter } from 'events';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import React, {
  Dispatch,
  FC,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { debounce } from '@remirror/core-helpers';
import type { EditorState } from 'remirror/core';

import { PlaygroundContext, PlaygroundContextObject } from '../context';
import { generateCodeFromConfiguration } from '../generate-code-from-configuration';
import type { CodeOptions, Exports, RemirrorModules } from '../playground-types';
import { Divide, Main, Panel, PlaygroundCodeEditor, StyledContainer } from '.';
import { SimplePanel } from './configuration-panel';
import { ErrorBoundary } from './error-boundary';
import { createCustomRequire, REQUIRED_MODULES } from './execute';
import { Viewer } from './viewer';

export { useRemirrorPlayground } from '../use-remirror-playground';

/**
 * Returns an object wih only the toggleable extensions returned.
 *
 * This means that we remove the `DocExtension` and the `TextExtension` since
 * they are required for the editor to function.
 */
function removeRequiredExtensions(moduleExports: Exports): Exports {
  const { DocExtension, TextExtension, ...cleansedExports } = moduleExports;

  return cleansedExports;
}

function useDebouncedValue<T>(value: T): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const debouncedUpdateTo = useMemo(
    () =>
      debounce(500, (value: T): void => {
        setDebouncedValue(value);
      }),
    [],
  );
  debouncedUpdateTo(value);
  return debouncedValue;
}

/**
 * A function that defers adds the module in a promise or an error if retrieval
 * of the module failed.
 */
async function deferredModuleAdder(
  moduleName: string,
  setModules: Dispatch<SetStateAction<RemirrorModules>>,
) {
  // Keep track of the error which will be used.
  let error: Error | null = null;
  let moduleExports: Exports | null = null;

  // A function which updates the the modules.
  function moduleSetter(previousModules: RemirrorModules): RemirrorModules {
    if (moduleName in previousModules) {
      // An error occurred there store the error.
      if (error) {
        return {
          ...previousModules,
          [moduleName]: { loading: false, error },
        };
      }

      // The module was exported.
      if (moduleExports) {
        return {
          ...previousModules,
          [moduleName]: {
            loading: false,
            error: null,
            exports: removeRequiredExtensions(moduleExports),
          },
        };
      }
    }

    return previousModules;
  }

  try {
    // Create the require function to use.
    const customRequire = await createCustomRequire([moduleName]);

    // Require the module name and store the module.
    moduleExports = customRequire(moduleName);

    setModules(moduleSetter);
    // eslint-disable-next-line unicorn/catch-error-name
  } catch (err) {
    error = err;
    setModules(moduleSetter);
  }
}

export const Playground: FC = () => {
  const [value, setValue] = useState('// Add some code here\n');
  const [contentValue, setContentValue] = useState<Readonly<EditorState> | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [modules, setModules] = useState<RemirrorModules>({});

  // Add a module to the playground.
  const addModule = useCallback((moduleName: string) => {
    // Set the module as loading.
    setModules((oldModules) => ({
      ...oldModules,
      [moduleName]: {
        loading: true,
      },
    }));

    // This is a promise that loads the module and saves the error, or resolved
    // module to the editor state.
    deferredModuleAdder(moduleName, setModules);
  }, []);

  // Remove ta module from the loaded modules.
  const removeModule = useCallback((moduleName: string) => {
    // Remove the module from the current modules via destructuring.
    setModules(({ [moduleName]: _, ...remainingModules }) => remainingModules);
  }, []);

  // Load all of the required modules.
  useEffect(() => {
    for (const requiredModule of REQUIRED_MODULES) {
      if (!modules[requiredModule]) {
        addModule(requiredModule);
      }
    }
  }, [addModule, modules]);

  const [options, setOptions] = useState({
    extensions: [],
    presets: [],
  } as CodeOptions);

  const handleToggleAdvanced = useCallback(() => {
    if (
      confirm(
        advanced
          ? 'Going back to simple mode will discard your code - are you sure?'
          : "Are you sure you want to enter advanced mode? You'll lose access to the configuration panel",
      )
    ) {
      if (!advanced) {
        setValue(generateCodeFromConfiguration(options));
        setAdvanced(true);
      } else {
        setAdvanced(false);
      }
    }
  }, [advanced, options]);

  const [debouncedValue, setDebouncedValue] = useState(value);

  const debouncedValueToSet = useDebouncedValue(value);
  useEffect(() => {
    setDebouncedValue(debouncedValueToSet);
  }, [debouncedValueToSet]);

  const code = useMemo(() => (advanced ? debouncedValue : generateCodeFromConfiguration(options)), [
    advanced,
    debouncedValue,
    options,
  ]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copy(code);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  }, [code]);

  const windowHash = window.location.hash;
  const ourHash = useRef('');
  const [readyToSetUrlHash, setReadyToSetUrlHash] = useState(false);

  const setPlaygroundState = useCallback(
    (state) => {
      assert(typeof state === 'object' && state, 'Expected state to be an object');
      assert(typeof state.m === 'number', 'Expected mode to be a number');

      if (state.m === 0) {
        /* basic mode */
        setAdvanced(false);
        setOptions({ extensions: state.e, presets: state.p });

        if (Array.isArray(state.a)) {
          state.a.forEach((moduleName: string) => addModule(moduleName));
        }
      } else if (state.m === 1) {
        /* advanced mode */
        assert(typeof state.c === 'string', 'Expected code to be a string');
        const code = state.c;
        setAdvanced(true);
        setValue(code);
        setDebouncedValue(code);
      }
    },
    [addModule],
  );
  useEffect(() => {
    if (windowHash && ourHash.current !== windowHash) {
      ourHash.current = windowHash;
      const parts = windowHash.replace(/^#+/, '').split('&');
      const part = parts.find((p) => p.startsWith('o/'));

      if (part) {
        try {
          const state = decode(part.slice(2));
          setPlaygroundState(state);
        } catch (error) {
          console.error(part.slice(2));
          console.error('Failed to parse above state; failed with following error:');
          console.error(error);
        }
      }
    }

    setReadyToSetUrlHash(true);
  }, [windowHash, setPlaygroundState]);

  const getPlaygroundState = useCallback(() => {
    let state;

    if (!advanced) {
      state = {
        m: 0,
        a: Object.keys(modules).filter((n) => !REQUIRED_MODULES.includes(n)),
        e: options.extensions,
        p: options.presets,
      };
    } else {
      state = {
        m: 1,
        c: value,
      };
    }

    return state;
  }, [advanced, value, options, modules]);

  useEffect(() => {
    if (!readyToSetUrlHash) {
      /* Premature, we may not have finished reading it yet */
      return;
    }

    const state = getPlaygroundState();
    const encoded = encode(state);
    const hash = `#o/${encoded}`;

    if (hash !== ourHash.current) {
      ourHash.current = hash;
      window.location.hash = hash;
    }
  }, [readyToSetUrlHash, getPlaygroundState]);

  const [textareaValue, setTextareaValue] = useState('');
  const { playground, eventEmitter } = useMemo((): {
    playground: PlaygroundContextObject;
    eventEmitter: EventEmitter;
  } => {
    const eventEmitter = new EventEmitter();
    const playground: PlaygroundContextObject = {
      setContent: (state: Readonly<EditorState>) => {
        setContentValue(state);
      },
      onContentChange: (callback) => {
        eventEmitter.on('change', callback);
        return () => {
          eventEmitter.removeListener('change', callback);
        };
      },
    };
    return { playground, eventEmitter };
  }, [setContentValue]);

  const updateContent = useCallback<React.ChangeEventHandler<HTMLTextAreaElement>>(
    (e) => {
      const text = e.target.value;
      setTextareaValue(text);
      try {
        const json = JSON.parse(text);
        setPlaygroundState(json.playground);
        setTimeout(() => {
          // Trigger the change after a re-render
          eventEmitter.emit('change', json.doc);
        }, 0);
      } catch {
        // TODO: indicate JSON error
      }
    },
    [eventEmitter, setPlaygroundState],
  );

  const [textareaIsFocussed, setTextareaIsFocussed] = useState(false);

  useEffect(() => {
    if (!textareaIsFocussed) {
      const doc = contentValue ? contentValue.doc.toJSON() : null;
      const playgroundState = doc
        ? {
            doc,
            playground: getPlaygroundState(),
          }
        : null;
      setTextareaValue(playgroundState ? JSON.stringify(playgroundState, null, 2) : '');
    }
  }, [contentValue, textareaIsFocussed, getPlaygroundState]);

  return (
    <PlaygroundContext.Provider value={playground}>
      <StyledContainer>
        <Main>
          {advanced ? null : (
            <>
              <Panel flex='0 0 18rem' overflow>
                <SimplePanel
                  options={options}
                  setOptions={setOptions}
                  modules={modules}
                  addModule={addModule}
                  removeModule={removeModule}
                  onAdvanced={handleToggleAdvanced}
                />
              </Panel>
              <Divide />
            </>
          )}
          <Panel vertical>
            <ErrorBoundary>
              <div
                style={{
                  flex: '3 0 0',
                  overflow: 'hidden',
                  backgroundColor: 'white',
                  display: 'flex',
                  position: 'relative',
                }}
              >
                <PlaygroundCodeEditor />
                <div style={{ position: 'absolute', bottom: '1rem', right: '2rem' }}>
                  {advanced ? (
                    <button onClick={handleToggleAdvanced}>☑️ Enter simple mode</button>
                  ) : (
                    <button onClick={handleToggleAdvanced}>🤓 Enter advanced mode</button>
                  )}
                  <button onClick={handleCopy} style={{ marginLeft: '0.5rem' }}>
                    📋 {copied ? 'Copied code!' : 'Copy code'}
                  </button>
                </div>
              </div>
            </ErrorBoundary>
            <Divide />
            <div style={{ flex: '2 0 0', display: 'flex', width: '100%', height: 0 }}>
              <ErrorBoundary>
                <div style={{ padding: '1rem', overflow: 'auto', flex: '1' }}>
                  <Viewer options={options} code={code} />
                </div>
              </ErrorBoundary>
              <Divide />
              <ErrorBoundary>
                <div style={{ overflow: 'auto', flex: '1' }}>
                  <textarea
                    value={textareaValue}
                    onChange={updateContent}
                    onFocus={() => setTextareaIsFocussed(true)}
                    onBlur={() => setTextareaIsFocussed(false)}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 0,
                      outline: 0,
                      margin: 0,
                      padding: 0,
                    }}
                  />
                </div>
              </ErrorBoundary>
            </div>
          </Panel>
        </Main>
      </StyledContainer>
    </PlaygroundContext.Provider>
  );
};

/** Copies text to the clipboard */
const copy = (text: string) => {
  const textarea = document.createElement('textarea');
  textarea.style.position = 'absolute';
  textarea.style.top = '0';
  textarea.style.left = '-10000px';
  textarea.style.opacity = '0.0001';
  document.body.append(textarea);
  textarea.value = text;
  textarea.select();
  textarea.setSelectionRange(0, 999999);
  document.execCommand('copy');
  textarea.remove();
};

/**
 * Decodes a URL component string to POJO.
 */
function decode(data: string) {
  const json = decompressFromEncodedURIComponent(data);

  if (!json) {
    throw new Error('Failed to decode');
  }

  const obj = JSON.parse(json);
  return obj;
}

/**
 * Encodes a POJO to a URL component string
 */
function encode(obj: object): string {
  const json = JSON.stringify(obj);
  const data = compressToEncodedURIComponent(json);
  return data;
}
