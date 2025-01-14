import { createEditor, doc, p } from 'jest-prosemirror';

import { EMPTY_PARAGRAPH_NODE, ExtensionPriority, ExtensionTag } from '@remirror/core-constants';
import type {
  Dispose,
  EditorState,
  FromToParameter,
  KeyBindingCommandFunction,
  NodeExtensionSpec,
  NodeViewMethod,
  ProsemirrorAttributes,
  RemirrorContentType,
} from '@remirror/core-types';
import { fromHtml } from '@remirror/core-utils';
import { Schema } from '@remirror/pm/model';
import { Plugin } from '@remirror/pm/state';
import { EditorView } from '@remirror/pm/view';
import {
  CorePreset,
  createCoreManager,
  HeadingExtension,
  hideConsoleError,
} from '@remirror/testing';

import { NodeExtension, PlainExtension } from '../../extension';
import { Framework } from '../../framework';
import { isRemirrorManager, RemirrorManager } from '../remirror-manager';

describe('Manager', () => {
  let state: EditorState;

  const innerMock = jest.fn();
  const mock = jest.fn((_: ProsemirrorAttributes) => innerMock);
  const getInformation = jest.fn(() => 'information');

  class DummyExtension extends PlainExtension {
    get name() {
      return 'dummy' as const;
    }
    readonly tags = [ExtensionTag.Behavior, ExtensionTag.LastNodeCompatible];

    createCommands() {
      return { dummy: mock };
    }

    createHelpers() {
      return {
        getInformation,
      };
    }

    createAttributes() {
      return {
        class: 'custom',
      };
    }
  }

  class BigExtension extends NodeExtension {
    static disableExtraAttributes = true;

    get name() {
      return 'big' as const;
    }

    createNodeSpec(): NodeExtensionSpec {
      return {
        toDOM: () => ['h1', 0],
      };
    }
  }

  const dummyExtension = new DummyExtension({ priority: ExtensionPriority.Critical });
  const bigExtension = new BigExtension({ priority: ExtensionPriority.Lowest });
  const corePreset = new CorePreset();

  let manager = RemirrorManager.create([dummyExtension, bigExtension, corePreset]);

  let view: EditorView;

  beforeEach(() => {
    manager = RemirrorManager.fromObject({
      extensions: [dummyExtension, bigExtension],
      presets: [new CorePreset()],
    });
    state = manager.createState({ content: EMPTY_PARAGRAPH_NODE });
    view = new EditorView(document.createElement('div'), {
      state,
      editable: () => true,
    });
    manager.addView(view);
  });

  hideConsoleError(true);

  it('enforces constructor privacy', () => {
    // @ts-expect-error
    expect(() => new RemirrorManager({})).toThrow();
  });

  it('supports commands', () => {
    const attributes = { a: 'a' };
    manager.store.commands.dummy(attributes);

    expect(mock).toHaveBeenCalledWith(attributes);
    expect(innerMock).toHaveBeenCalledWith({
      state,
      dispatch: view.dispatch,
      view,
      tr: expect.any(Object),
    });
  });

  it('supports helpers', () => {
    const value = manager.store.helpers.getInformation();

    expect(value).toBe('information');
    expect(getInformation).toHaveBeenCalled();
  });

  describe('#properties', () => {
    it('should sort extensions by priority', () => {
      expect(manager.extensions[0].name).toBe('dummy');
      expect(manager.extensions[manager.extensions.length - 1].name).toBe('big');
    });

    it('should allow overriding the priority', () => {
      manager = manager.recreate([], { priority: { dummy: ExtensionPriority.Lowest } });
      expect(manager.extensions[0].name).not.toBe('dummy');
      expect(manager.extensions[manager.extensions.length - 1].name).toBe('big');
      expect(manager.extensions[manager.extensions.length - 2].name).toBe('dummy');
    });

    it('should provide the schema at instantiation', () => {
      expect(createCoreManager([]).schema).toBeInstanceOf(Schema);
    });

    it('should provide access to `attributes`', () => {
      expect(manager.store.attributes.class).toInclude('custom');
    });
  });

  it('isManager', () => {
    expect(isRemirrorManager({})).toBeFalse();
    expect(isRemirrorManager(null)).toBeFalse();
    expect(isRemirrorManager(dummyExtension)).toBeFalse();
    expect(isRemirrorManager(manager, ['dummy', 'biggest'])).toBeFalse();
    expect(isRemirrorManager(manager, [class A extends DummyExtension {}])).toBeFalse();
    expect(isRemirrorManager(manager)).toBeTrue();
    expect(isRemirrorManager(manager, [DummyExtension, CorePreset])).toBeTrue();
    expect(isRemirrorManager(manager, ['dummy', 'big'])).toBeTrue();
  });

  it('output', () => {
    const manager = createCoreManager([]);
    expect(() => manager.output).toThrowErrorMatchingSnapshot();
    expect(() => (manager.frameworkAttached ? manager.output : false)).not.toThrow();

    class TestFramework extends Framework<any, any, any> {
      #cacheOutput: any;

      get name() {
        return 'test';
      }

      updateState() {}

      createView(state: EditorState, element?: HTMLElement) {
        return new EditorView(element, {
          state,
          nodeViews: this.manager.store.nodeViews,
          dispatchTransaction: this.dispatchTransaction,
          attributes: () => this.getAttributes(),
          editable: () => {
            return this.props.editable ?? true;
          },
        });
      }

      get frameworkOutput() {
        return (this.#cacheOutput ??= this.baseOutput);
      }
    }

    const createStateFromContent = (
      content: RemirrorContentType,
      selection?: FromToParameter | undefined,
    ) =>
      manager.createState({
        content,
        stringHandler: fromHtml,
        selection,
      });

    const framework = new TestFramework({
      createStateFromContent: createStateFromContent,
      getProps: () => ({ manager }),
      initialEditorState: createStateFromContent(manager.createEmptyDoc()),
    });

    manager.attachFramework(framework, () => {});

    expect(manager.output).toBe(framework.frameworkOutput);
  });
});

test('keymaps', () => {
  const mocks = {
    firstEnter: jest.fn((..._: Parameters<KeyBindingCommandFunction>) => false),
    secondEnter: jest.fn((..._: Parameters<KeyBindingCommandFunction>) => false),
    thirdEnter: jest.fn((..._: Parameters<KeyBindingCommandFunction>) => false),
  };

  class FirstExtension extends PlainExtension {
    get name() {
      return 'first' as const;
    }

    createKeymap() {
      return {
        Enter: mocks.firstEnter,
      };
    }
  }

  class SecondExtension extends PlainExtension {
    get name() {
      return 'second' as const;
    }

    createKeymap() {
      return {
        Enter: mocks.secondEnter,
      };
    }
  }

  class ThirdExtension extends PlainExtension {
    get name() {
      return 'third' as const;
    }

    createKeymap() {
      return {
        Enter: mocks.thirdEnter,
      };
    }
  }

  const manager = RemirrorManager.fromObject({
    extensions: [new FirstExtension(), new SecondExtension(), new ThirdExtension()],
    presets: [new CorePreset()],
  });

  createEditor(doc(p('simple<cursor>')), { plugins: manager.store.plugins })
    .insertText('abcd')
    .press('Enter')
    .callback(() => {
      expect(mocks.firstEnter).toHaveBeenCalled();
      expect(mocks.secondEnter).toHaveBeenCalled();
      expect(mocks.thirdEnter).toHaveBeenCalled();

      jest.clearAllMocks();
      mocks.firstEnter.mockImplementation(() => true);
    })
    .press('Enter')
    .callback(() => {
      expect(mocks.firstEnter).toHaveBeenCalled();
      expect(mocks.secondEnter).not.toHaveBeenCalled();
      expect(mocks.thirdEnter).not.toHaveBeenCalled();

      jest.clearAllMocks();
      mocks.firstEnter.mockImplementation(({ next }) => {
        return next();
      });
    })
    .press('Enter')
    .callback(() => {
      expect(mocks.secondEnter).toHaveBeenCalledTimes(1);
      expect(mocks.thirdEnter).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();
      mocks.secondEnter.mockImplementation(() => true);
    })
    .press('Enter')
    .callback(() => {
      expect(mocks.secondEnter).toHaveBeenCalledTimes(1);
      expect(mocks.thirdEnter).not.toHaveBeenCalled();
    });
});

// "getCommands" | "getChain" | "helpers" | "rebuildKeymap" | "getPluginState" | "replacePlugin" | "reconfigureStatePlugins" | "addPlugins" | "schema" | "tags" | "phase" | "getState"

test('lifecycle', () => {
  expect.assertions(6);

  class LifecycleExtension extends PlainExtension {
    static defaultPriority = ExtensionPriority.Lowest;

    get name() {
      return 'test' as const;
    }

    onCreate() {
      expect(this.store.setExtensionStore).toBeFunction();
      expect(this.store.setStoreKey).toBeFunction();
      expect(this.store.getStoreKey).toBeFunction();
      expect(this.store.addPlugins).toBeFunction();
      expect(this.store.tags).toBeObject();
      expect(this.store.schema).toBeInstanceOf(Schema);
    }
  }

  const extension = new LifecycleExtension();
  createCoreManager([extension]);
});

describe('createEmptyDoc', () => {
  it('can create an empty doc', () => {
    const manager = RemirrorManager.create([new CorePreset()]);

    expect(manager.createEmptyDoc().toJSON()).toMatchInlineSnapshot(`
    Object {
      "content": Array [
        Object {
          "type": "paragraph",
        },
      ],
      "type": "doc",
    }
  `);
  });

  it('creates an empty doc with alternative content', () => {
    const headingManager = RemirrorManager.create([
      new CorePreset({ content: 'heading+' }),
      new HeadingExtension(),
    ]);
    expect(headingManager.createEmptyDoc()).toMatchInlineSnapshot(`
      Prosemirror node: {
        "type": "doc",
        "content": [
          {
            "type": "heading",
            "attrs": {
              "level": 1
            }
          }
        ]
      }
    `);
  });
});

describe('options', () => {
  it('can add extra plugins', () => {
    const extraPlugin = new Plugin({});
    const manager = createCoreManager([], { plugins: [extraPlugin] });

    expect(manager.store.plugins).toContain(extraPlugin);
  });

  it('can add additional nodeViews', () => {
    const custom: NodeViewMethod = jest.fn(() => ({}));
    const nodeViews: Record<string, NodeViewMethod> = { custom };
    const manager = createCoreManager([], { nodeViews });

    expect(manager.store.nodeViews.custom).toBe(custom);
  });
});

test('disposes of methods', () => {
  const mocks = {
    create: jest.fn(),
    view: jest.fn(),
  };

  class DisposeExtension extends PlainExtension {
    get name() {
      return 'dispose' as const;
    }

    onCreate(): Dispose {
      return mocks.create;
    }

    onView(): Dispose {
      return mocks.view;
    }
  }

  const manager = RemirrorManager.create(() => [new DisposeExtension(), new CorePreset()]);
  const state = manager.createState({ content: EMPTY_PARAGRAPH_NODE });
  const view = new EditorView(document.createElement('div'), {
    state,
    editable: () => true,
  });
  manager.addView(view);

  manager.destroy();

  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.view).toHaveBeenCalledTimes(1);
});
