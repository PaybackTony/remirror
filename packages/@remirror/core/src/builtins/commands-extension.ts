import { ErrorConstant, ExtensionPriority } from '@remirror/core-constants';
import {
  entries,
  invariant,
  isEmptyArray,
  isFunction,
  isNumber,
  object,
  uniqueArray,
} from '@remirror/core-helpers';
import type {
  AnyFunction,
  CommandFunction,
  CommandFunctionParameter,
  DispatchFunction,
  EditorSchema,
  EmptyShape,
  FromToParameter,
  PrimitiveSelection,
  ProsemirrorAttributes,
  Static,
  Transaction,
  Value,
} from '@remirror/core-types';
import { getTextSelection } from '@remirror/core-utils';
import { TextSelection } from '@remirror/pm/state';
import { Decoration, DecorationSet, EditorView } from '@remirror/pm/view';

import { extensionDecorator } from '../decorators';
import {
  AnyExtension,
  ChainedCommandRunParameter,
  ChainedFromExtensions,
  CommandsFromExtensions,
  PlainExtension,
} from '../extension';
import { throwIfNameNotUnique } from '../helpers';
import type { AnyCombinedUnion, ChainedFromCombined, CommandsFromCombined } from '../preset';
import type {
  CommandShape,
  CreatePluginReturn,
  ExtensionCommandFunction,
  ExtensionCommandReturn,
  StateUpdateLifecycleParameter,
} from '../types';

export interface CommandOptions {
  /**
   * The className that is added to all tracker positions
   *
   * '@default 'remirror-tracker-position'
   */
  trackerClassName?: Static<string>;

  /**
   * The default element that is used for all trackers.
   *
   * @default 'span'
   */
  trackerNodeName?: Static<string>;
}

/**
 * Generate chained and unchained commands for making changes to the editor.
 *
 * @remarks
 *
 * Typically actions are used to create interactive menus. For example a menu
 * can use a command to toggle bold formatting or to undo the last action.
 *
 * @builtin
 */
@extensionDecorator<CommandOptions>({
  defaultPriority: ExtensionPriority.Highest,
  defaultOptions: { trackerClassName: 'remirror-tracker-position', trackerNodeName: 'span' },
  staticKeys: ['trackerClassName', 'trackerNodeName'],
})
export class CommandsExtension extends PlainExtension<CommandOptions> {
  get name() {
    return 'commands' as const;
  }

  /**
   * The current transaction which allows for making commands chainable.
   *
   * It is shared by all the commands helpers and can even be used in the
   * [[`KeymapExtension`]].
   */
  get transaction(): Transaction {
    if (this.#customTransaction) {
      return this.#customTransaction;
    }

    // Make sure we have the most up to date state.
    const state = this.store.getState();

    if (!this.#transaction) {
      // Since there is currently no transaction set, make sure to create a new
      // one. Behind the scenes `state.tr` creates a new transaction for us to
      // use.
      this.#transaction = state.tr;
    }

    // Check that the current transaction is valid.
    const isValid = this.#transaction.before.eq(state.doc);

    // Check whether the current transaction has any already applied to it.
    const hasSteps = !isEmptyArray(this.#transaction.steps);

    if (!isValid) {
      // Since the transaction is not valid we create a new one to prevent any
      // `mismatched` transaction errors.
      const tr = state.tr;

      // Now checking if any steps had been added to the previous transaction
      // and adding them to the newly created transaction.
      if (hasSteps) {
        for (const step of this.#transaction.steps) {
          tr.step(step);
        }
      }

      // Make sure to store the transaction value to the instance of this
      // extension.
      this.#transaction = tr;
    }

    return this.#transaction;
  }

  /**
   * This is the holder for the shared transaction which is shared by commands
   * in order to support chaining.
   */
  #transaction?: Transaction;

  /**
   * Sometimes you need some custom transactions.
   */
  #customTransaction?: Transaction;

  onCreate(): void {
    const { setExtensionStore, setStoreKey } = this.store;

    // TODO remove these two.
    setExtensionStore('getCommands', this.getCommands);
    setExtensionStore('getChain', this.getChain);

    // Support forced updates.
    setExtensionStore('forceUpdate', this.forceUpdate);
    setStoreKey('getForcedUpdates', this.getForcedUpdates);

    // Enable retrieval of the current transaction.
    setExtensionStore('getTransaction', () => this.transaction);

    // Enable retrieval of the command parameter.
    setExtensionStore('getCommandParameter', () => ({
      tr: this.transaction,
      dispatch: this.store.view.dispatch,
      state: this.store.view.state,
      view: this.store.view,
    }));
  }

  onView(view: EditorView<EditorSchema>): void {
    const { setStoreKey, setExtensionStore } = this.store;
    const commands: Record<string, CommandShape> = object();
    const names = new Set<string>();
    const chained: Record<string, any> & ChainedCommandRunParameter = object();
    const unchained: Record<string, { command: AnyFunction; isEnabled: AnyFunction }> = object();

    for (const extension of this.store.extensions) {
      // There's no need to continue if the extension has no commands.
      if (!extension.createCommands) {
        continue;
      }

      // Gather the returned commands object from the extension.
      this.addCommands({ names, chained, unchained, commands: extension.createCommands() });
    }

    for (const [commandName, { command, isEnabled }] of entries(unchained)) {
      commands[commandName] = command as CommandShape;
      commands[commandName].isEnabled = isEnabled;
    }

    chained.run = () => view.dispatch(this.transaction);

    setStoreKey('commands', commands);
    setStoreKey('chain', chained as any);

    setExtensionStore('commands', commands as any);
    setExtensionStore('chain', chained as any);
  }

  /**
   * Update the cached transaction whenever the state is updated.
   */
  onStateUpdate({ state }: StateUpdateLifecycleParameter): void {
    this.#customTransaction = undefined;
    this.#transaction = state.tr;
  }

  createHelpers() {
    return {};
  }

  /**
   * Create the default commands available to all extensions.
   */
  createCommands() {
    const commands = {
      /**
       * Enable custom commands to be used within the editor by users.
       *
       * This is preferred to the initial idea of setting commands on the
       * manager or even as a prop. The problem is that there's no typechecking
       * and it should be just fine to add your custom commands here to see the
       * dispatched immediately.
       */
      customDispatch(command: CommandFunction): CommandFunction {
        return command;
      },

      /**
       * Create a custom transaction.
       *
       * Use the command at the beginning of the command chain to override the
       * shared transaction.
       *
       * There are times when you want to be sure of the transaction which is
       * being updated.
       *
       * To restore the previous transaction call the `restore` chained method.
       *
       * @param tr - the transaction to set
       *
       * @remarks
       *
       * This is only intended for use within a chainable command chain.
       *
       * You **MUST** call the `restore` command after using this to prevent
       * cryptic errors.
       */
      custom: (tr: Transaction): CommandFunction => {
        return () => {
          this.#customTransaction = tr;
          return true;
        };
      },

      restore: (): CommandFunction => {
        return () => {
          this.#customTransaction = undefined;
          return true;
        };
      },

      /**
       * Insert text into the dom at the current location by default.
       */
      insertText(text: string, range?: Partial<FromToParameter>): CommandFunction {
        return ({ tr, dispatch }) => {
          const { from, to } = range ?? tr.selection;
          dispatch?.(tr.insertText(text, from, to));

          return true;
        };
      },

      /**
       * Insert text into the dom asynchronously by preserving the current insertion position.
       */
      insertTextAsync: (promise: Promise<string>, range?: Partial<FromToParameter>) =>
        asyncCommand({
          promise,
          immediate: commands.addPositionTracker({ id: promise, ...range }),
          onDone: ({ value, ...rest }) => {
            const range = this.findPositionTracker(promise);
            this.removePositionTracker({ id: promise, tr: rest.tr });

            if (!range) {
              return false;
            }

            return commands.insertText(value, range)(rest);
          },
        }),

      /**
       * Select the text within the provided range.
       */
      selectText: (selection: PrimitiveSelection): CommandFunction => ({ tr, dispatch }) => {
        const textSelection = getTextSelection(selection, tr.doc);

        // TODO: add some safety checks here. If the selection is out of range
        // perhaps silently fail
        dispatch?.(tr.setSelection(textSelection));

        return true;
      },

      /**
       * Delete the provided range or current selection.
       */
      delete(range?: FromToParameter): CommandFunction {
        return ({ tr, dispatch }) => {
          const { from, to } = range ?? tr.selection;
          dispatch?.(tr.delete(from, to));

          return true;
        };
      },

      /**
       * Fire an empty update to trigger an update to all decorations, and state
       * that may not yet have run.
       *
       * This can be used in extensions to trigger updates certain options that
       * affect the editor state have updated.
       */
      emptyUpdate: (): CommandFunction => {
        return ({ tr, dispatch }) => {
          dispatch?.(tr);

          return true;
        };
      },

      /**
       * Force an update of the specific
       */
      forceUpdate: (...keys: UpdatableViewProps[]): CommandFunction => {
        return ({ tr, dispatch }) => {
          dispatch?.(this.forceUpdate(tr, ...keys));

          return true;
        };
      },

      /**
       * Update the attributes for the node at the specified `pos` in the
       * editor.
       */
      updateNodeAttributes: <Type extends object>(
        pos: number,
        attrs: ProsemirrorAttributes<Type>,
      ): CommandFunction => {
        return ({ tr, dispatch }) => {
          dispatch?.(tr.setNodeMarkup(pos, undefined, attrs));

          return true;
        };
      },

      /**
       * Fire an update to remove the current range selection. The cursor will
       * be placed at the beginning of the current range selection.
       */
      clearRangeSelection: (): CommandFunction => {
        return ({ tr, dispatch }) => {
          const { selection } = tr;

          if (selection.empty) {
            return false;
          }

          dispatch?.(tr.setSelection(TextSelection.create(tr.doc, tr.selection.from)));
          return true;
        };
      },

      /**
       * Command to dispatch a transaction adding the tracker position to be tracked.
       * If no position parameter is specified it uses the current position.
       */
      addPositionTracker: (tracker: AddPositionTrackerParameter): CommandFunction => ({
        dispatch,
        tr,
      }) => {
        return this.addPositionTracker({ ...tracker, tr, checkOnly: !dispatch })
          ? (dispatch?.(tr), true)
          : false;
      },

      /**
       * A command to remove the specified tracker position.
       */
      removePositionTracker: (id: unknown): CommandFunction => ({ dispatch, tr }) => {
        return this.removePositionTracker({ id, tr, checkOnly: !dispatch })
          ? (dispatch?.(tr), true)
          : false;
      },

      /**
       * A command to remove all active tracker positions.
       */
      clearPositionTrackers: (): CommandFunction => ({ tr, dispatch }) => {
        return this.clearPositionTrackers({ tr, checkOnly: !dispatch })
          ? (dispatch?.(tr), true)
          : false;
      },
    };

    return commands;
  }

  /**
   * This plugin is here only to keep track of the `forcedUpdates` meta data.
   */
  createPlugin(): CreatePluginReturn {
    return {
      state: {
        init: () => {
          return DecorationSet.empty;
        },
        apply: (tr, decorationSet: DecorationSet) => {
          // Map the decoration based on the changes to the document.
          decorationSet = decorationSet.map(tr.mapping, tr.doc);

          // Get tracker updates from the meta data
          const { added, clearTrackers, removed } = this.getMeta(tr);

          if (clearTrackers) {
            return DecorationSet.empty;
          }

          for (const add of added) {
            const { className, nodeName, id, from, to } = add;

            let deco: Decoration;

            if (from === to) {
              const widget = document.createElement(nodeName);
              widget.classList.add(className);
              deco = Decoration.widget(from, document.createElement(nodeName), {
                id,
                type: this.name,
              });
            } else {
              deco = Decoration.inline(
                from,
                to,
                { nodeName, class: className },
                { id, type: this.name },
              );
            }

            decorationSet = decorationSet.add(tr.doc, [deco]);
          }

          for (const id of removed) {
            const found = decorationSet.find(
              undefined,
              undefined,
              (spec) => spec.id === id && spec.name === this.name,
            );
            decorationSet = decorationSet.remove(found);
          }

          return decorationSet;
        },
      },
      props: {
        decorations: () => {
          return this.getPluginState();
        },
      },
    };
  }

  /**
   * A helper for forcing through updates in the view layer. The view layer can
   * check for the meta data of the transaction with
   * `manager.store.getForcedUpdate(tr)`. If that has a value then it should use
   * the unique symbol to update the key.
   */
  private readonly forceUpdate = (tr: Transaction, ...keys: UpdatableViewProps[]): Transaction => {
    const { forcedUpdates } = this.getMeta(tr);

    this.setMeta(tr, { forcedUpdates: uniqueArray([...forcedUpdates, ...keys]) });
    return tr;
  };

  /**
   * Checks if the transaction has meta data which requires a forced update.
   * This can be used for updating:
   *
   * - `nodeViews`
   * - `editable` status of the editor
   * - `attributes` - for the top level node
   */
  private readonly getForcedUpdates = (tr: Transaction): ForcedUpdateMeta => {
    return this.getMeta(tr).forcedUpdates;
  };

  /**
   * Get the command metadata
   */
  private getMeta(tr: Transaction): Required<CommandExtensionMeta> {
    const meta = tr.getMeta(this.pluginKey) ?? {};
    return { ...DEFAULT_COMMAND_META, ...meta };
  }

  private setMeta(tr: Transaction, update: CommandExtensionMeta) {
    const meta = this.getMeta(tr);
    tr.setMeta(this.pluginKey, { ...meta, ...update });
  }

  /**
   * Add the commands from the provided `commands` property to the `chained` and
   * `unchained` objects.
   */
  private addCommands(parameter: AddCommandsParameter) {
    const { chained, commands, names, unchained } = parameter;

    for (const [name, command] of entries(commands)) {
      // Command names must be unique so this
      throwIfNameNotUnique({ name, set: names, code: ErrorConstant.DUPLICATE_COMMAND_NAMES });

      invariant(!forbiddenNames.has(name), {
        code: ErrorConstant.DUPLICATE_COMMAND_NAMES,
        message: 'The command name you chose is forbidden.',
      });

      unchained[name] = {
        command: this.unchainedFactory({ command }),
        isEnabled: this.unchainedFactory({ command, shouldDispatch: false }),
      };

      chained[name] = this.chainedFactory({ command, chained });
    }
  }

  /**
   * Create an unchained command method.
   */
  private unchainedFactory(parameter: UnchainedFactoryParameter) {
    return (...args: unknown[]) => {
      const { shouldDispatch = true, command } = parameter;
      const { view } = this.store;
      const { state } = view;

      let dispatch: DispatchFunction | undefined;

      if (shouldDispatch) {
        dispatch = view.dispatch;
      }

      return command(...args)({ state, dispatch, view, tr: this.transaction });
    };
  }

  /**
   * Create a chained command method.
   */
  private chainedFactory(parameter: ChainedFactoryParameter) {
    return (...spread: unknown[]) => {
      const { chained, command } = parameter;
      const { view } = this.store;
      const { state } = view;

      /**
       * This function is used in place of the `view.dispatch` method which is
       * passed through to all commands.
       *
       * It is responsible for checking that the transaction which was
       * dispatched is the same as the shared transaction which makes chainable
       * commands possible.
       */
      const dispatch: DispatchFunction = (transaction) => {
        // Throw an error if the transaction being dispatched is not the same as the currently stored transaction.
        invariant(transaction === this.transaction, {
          message:
            'Chaining currently only supports `CommandFunction` methods which do not use the `state.tr` property. Instead you should use the provided `tr` property.',
        });
      };

      command(...spread)({ state, dispatch, view, tr: this.transaction });

      return chained;
    };
  }

  /**
   * Get the chainable commands.
   *
   * @deprecated
   */
  private readonly getChain = <
    ExtensionUnion extends AnyExtension = AnyExtension
  >(): ChainedFromExtensions<CommandsExtension | ExtensionUnion> => {
    const chain = this.store.getStoreKey('chain');
    invariant(chain, { code: ErrorConstant.COMMANDS_CALLED_IN_OUTER_SCOPE });

    return chain as ChainedFromExtensions<CommandsExtension | ExtensionUnion>;
  };

  /**
   * Get the non-chainable commands.
   *
   * @deprecated use `this.store.commands` instead.
   */
  private readonly getCommands = <
    ExtensionUnion extends AnyExtension = AnyExtension
  >(): CommandsFromExtensions<CommandsExtension | ExtensionUnion> => {
    const commands = this.store.getStoreKey('commands');
    invariant(commands, { code: ErrorConstant.COMMANDS_CALLED_IN_OUTER_SCOPE });

    return commands as CommandsFromExtensions<CommandsExtension | ExtensionUnion>;
  };

  /**
   * Add a tracker position with the specified params to the transaction and return the transaction.
   *
   * It is up to you to dispatch the transaction or you can just use the commands.
   */
  private addPositionTracker(
    parameter: AddPositionTrackerParameter & { tr: Transaction; checkOnly?: boolean },
  ): boolean {
    const { tr, checkOnly = false, id, ...rest } = parameter;
    const existingPosition = this.findPositionTracker(id);

    if (existingPosition) {
      return false;
    }

    if (checkOnly) {
      return true;
    }

    const { added } = this.getMeta(tr);
    const { trackerClassName, trackerNodeName } = this.options;
    const { from, to, className, nodeName = trackerNodeName } = rest;

    const classes = (className ? [trackerClassName, className] : [trackerClassName]).join(' ');

    this.setMeta(tr, {
      added: [
        ...added,
        {
          id,
          from: isNumber(from) ? from : tr.selection.from,
          to: isNumber(to) ? to : tr.selection.to,
          nodeName,
          className: classes,
        },
      ],
    });

    return true;
  }

  /**
   * Discards a previously defined tracker once not needed.
   *
   * This should be used to cleanup once the position is no longer needed.
   */
  private removePositionTracker(parameter: {
    id: unknown;
    tr: Transaction;
    checkOnly?: boolean;
  }): boolean {
    const { id, tr, checkOnly = false } = parameter;
    const existingPosition = this.findPositionTracker(id);

    if (!existingPosition) {
      return false;
    }

    if (checkOnly) {
      return true;
    }

    const { removed } = this.getMeta(tr);
    this.setMeta(tr, { removed: uniqueArray([...removed, id]) });

    return true;
  }

  /**
   * This helper returns a transaction that clears all position trackers when any exist.
   *
   * Otherwise it returns undefined.
   */
  private clearPositionTrackers(parameter: { tr: Transaction; checkOnly?: boolean }): boolean {
    const { tr, checkOnly = false } = parameter;
    const positionTrackerState = this.getPluginState();

    if (positionTrackerState === DecorationSet.empty) {
      return false;
    }

    if (checkOnly) {
      return true;
    }

    this.setMeta(tr, { clearTrackers: true });
    return true;
  }

  /**
   * Find the position for the tracker with the ID specified.
   *
   * @param id - the unique position id which can be any type
   */
  private findPositionTracker(id: unknown): FromToParameter | undefined {
    const decorations = this.getPluginState<DecorationSet>();
    const found = decorations.find(undefined, undefined, (spec) => spec.id === id)?.[0];

    return found ? { from: found.from, to: found.to } : undefined;
  }
}

const DEFAULT_COMMAND_META: Required<CommandExtensionMeta> = {
  added: [],
  clearTrackers: false,
  forcedUpdates: [],
  removed: [],
};

/**
 * Provides the list of Prosemirror EditorView props that should be updated/
 */
export type ForcedUpdateMeta = UpdatableViewProps[];
export type UpdatableViewProps = 'attributes' | 'editable' | 'nodeViews';

export interface CommandExtensionMeta {
  forcedUpdates?: UpdatableViewProps[];

  /**
   * The trackers to add.
   */
  added?: Array<Required<AddPositionTrackerParameter>>;

  /**
   * The trackers to remove.
   */
  removed?: unknown[];

  /**
   * When set to true will delete all the active trackers.
   */
  clearTrackers?: boolean;
}

interface AddPositionTrackerParameter extends Partial<FromToParameter> {
  /**
   * The ID by which this position will be uniquely identified. It can be any
   * unknown value. A string, a function, an object, etc.
   */
  id: unknown;

  /**
   * A custom class name to use for the tracker position. All the trackers
   * will automatically be given the class name `remirror-tracker-position`
   *
   * @default ''
   */
  className?: string;

  /**
   * A custom html element or string for a created element tag name.
   *
   * @default 'tracker'
   */
  nodeName?: string;
}

interface AddCommandsParameter {
  /** The currently amassed commands to mutate with new commands. */
  chained: Record<string, any> & ChainedCommandRunParameter;

  /**
   * The currently amassed unchained commands to mutate with new commands.
   */
  unchained: Record<string, { command: AnyFunction; isEnabled: AnyFunction }>;

  /**
   * The untransformed commands which need to be added to the extension.
   */
  commands: ExtensionCommandReturn;

  /**
   * The names of the commands amassed. This allows for a uniqueness test.
   */
  names: Set<string>;
}

interface UnchainedFactoryParameter {
  /**
   * All the commands.
   */
  command: ExtensionCommandFunction;

  /**
   * When false the dispatch is not provided (making this an `isEnabled` check).
   *
   * @default true
   */
  shouldDispatch?: boolean;
}

interface ChainedFactoryParameter {
  /**
   * All the commands.
   */
  command: ExtensionCommandFunction;

  /**
   * All the chained commands
   */
  chained: Record<string, any>;
}

interface AsyncCommandParameter<Value> {
  immediate?: CommandFunction;
  promise: (() => Promise<Value>) | Promise<Value>;
  onDone: CommandFunction<EditorSchema, { value: Value }>;
  onCancel?: () => void;
}

/**
 * Support async commands in the editor.
 *
 * This is where the commands can be placed.
 *
 * @experimental This is still being worked on and subject to changes in
 * structure.
 *
 * A possible better way would be have a separate extension for asynchronous
 * commands and a method called `createAsyncCommands`.
 */
export function asyncCommand<Value>({
  immediate,
  promise,
  onDone,
  onCancel,
}: AsyncCommandParameter<Value>): CommandFunction {
  return (parameter) => {
    const { view } = parameter;

    if (immediate?.(parameter) === false) {
      onCancel?.();
      return false;
    }

    if (!view) {
      return true;
    }

    const deferred = isFunction(promise) ? promise() : promise;

    deferred.then((value) => {
      // Run the command
      onDone({ state: view.state, tr: view.state.tr, dispatch: view.dispatch, view, value });
    });

    return true;
  };
}

/**
 * The names that are forbidden from being used as a command name.
 */
const forbiddenNames = new Set(['run', 'chain']);

declare global {
  namespace Remirror {
    interface ManagerStore<Combined extends AnyCombinedUnion> {
      /**
       * Enables the use of custom commands created by extensions which extend
       * the functionality of your editor in an expressive way.
       *
       * @remarks
       *
       * Commands are synchronous and immediately dispatched. This means that
       * they can be used to create menu items when the functionality you need
       * is already available by the commands.
       *
       * ```ts
       * if (commands.toggleBold.isEnabled()) {
       *   commands.toggleBold();
       * }
       * ```
       */
      commands: CommandsFromCombined<Combined>;

      /**
       * Chainable commands for composing functionality together in quaint and
       * beautiful ways
       *
       * @remarks
       *
       * You can use this property to create expressive and complex commands
       * that build up the transaction until it can be run.
       *
       * The way chainable commands work is by adding multiple steps to a shared
       * transaction which is then dispatched when the `run` command is called.
       * This requires making sure that commands within your code use the `tr`
       * that is provided rather than the `state.tr` property. `state.tr`
       * creates a new transaction which is not shared by the other steps in a
       * chainable command.
       *
       * The aim is to make as many commands as possible chainable as explained
       * [here](https://github.com/remirror/remirror/issues/418#issuecomment-666922209).
       *
       * There are certain commands that can't be made chainable.
       *
       * - undo
       * - redo
       *
       * ```ts
       * chain
       *   .toggleBold()
       *   .insertText('Hi')
       *   .setSelection('all')
       *   .run();
       * ```
       *
       * The `run()` method ends the chain and dispatches the command.
       */
      chain: ChainedFromCombined<Combined>;

      /**
       * Check for a forced update in the transaction. This pulls the meta data
       * from the transaction and if it is true then it was a forced update.
       *
       * ```ts
       * const forcedUpdates = this.manager.store.getForcedUpdates(tr);
       *
       * if (forcedUpdates) {
       *   // React updates when the state is updated.
       *   setState({ key: Symbol() })
       * }
       * ```
       */
      getForcedUpdates: (tr: Transaction) => UpdatableViewProps[];
    }

    interface ExtensionCreatorMethods {
      /**
       * `ExtensionCommands`
       *
       * This pseudo property makes it easier to infer Generic types of this
       * class.
       *
       * @internal
       */
      ['~C']: this['createCommands'] extends AnyFunction
        ? ReturnType<this['createCommands']>
        : EmptyShape;

      /**
       * Create and register commands for that can be called within the editor.
       *
       * These are typically used to create menu's actions and as a direct
       * response to user actions.
       *
       * @remarks
       *
       * The `createCommands` method should return an object with each key being
       * unique within the editor. To ensure that this is the case it is
       * recommended that the keys of the command are namespaced with the name
       * of the extension.
       *
       * ```ts
       * import { ExtensionFactory } from '@remirror/core';
       *
       * const MyExtension = ExtensionFactory.plain({
       *   name: 'myExtension',
       *   version: '1.0.0',
       *   createCommands() {
       *     return {
       *       haveFun() {
       *         return ({ state, dispatch }) => {
       *           if (dispatch) {
       *             dispatch(tr.insertText('Have fun!'));
       *           }
       *
       *           return true; // True return signifies that this command is enabled.
       *         }
       *       },
       *     }
       *   }
       * })
       * ```
       *
       * The actions available in this case would be `undoHistory` and
       * `redoHistory`. It is unlikely that any other extension would override
       * these commands.
       *
       * Another benefit of commands is that they are picked up by typescript
       * and can provide code completion for consumers of the extension.
       */
      createCommands?(): ExtensionCommandReturn;
    }

    interface ExtensionStore {
      /**
       * Updates the meta information of a transaction to cause that transaction
       * to force through an update.
       */
      forceUpdate: (tr: Transaction, ...keys: UpdatableViewProps[]) => Transaction;

      /**
       * Get the shared transaction for all commands in the editor.
       *
       * This transaction makes chainable commands possible.
       */
      getTransaction: () => Transaction;

      /**
       * A short hand way of getting the `view`, `state`, `tr` and `dispatch` methods.
       */
      getCommandParameter: () => Required<CommandFunctionParameter>;

      /**
       * A property containing all the available commands in the editor.
       *
       * This should only be accessed after the `onView` lifecycle method
       * otherwise it will throw an error. If you want to use it in the
       * `createCommands` function then make sure it is used within the returned
       * function scope and not in the outer scope.
       */
      commands: CommandsFromExtensions<Value<AllExtensions> | AnyExtension>;

      /** @deprecated Use `this.store.commands` instead. */
      getCommands: <ExtensionUnion extends AnyExtension = AnyExtension>() => CommandsFromExtensions<
        CommandsExtension | ExtensionUnion
      >;

      /**
       * A method that returns an object with all the chainable commands
       * available to be run.
       *
       * @remarks
       *
       * Each chainable command mutates the states transaction so after running
       * all your commands. you should dispatch the desired transaction.
       *
       * This should only be called when the view has been initialized (i.e.)
       * within the `createCommands` method calls.
       *
       * ```ts
       * import { ExtensionFactory } from '@remirror/core';
       *
       * const MyExtension = ExtensionFactory.plain({
       *   name: 'myExtension',
       *   version: '1.0.0',
       *   createCommands: () => {
       *     // This will throw since it can only be called within the returned methods.
       *     const chain = this.store.chain; // ❌
       *
       *     return {
       *       // This is good 😋
       *       haveFun() {
       *         return ({ state, dispatch }) => this.store.chain.insertText('fun!').run(); ✅
       *       },
       *     }
       *   }
       * })
       * ```
       *
       * This should only be accessed after the `onView` lifecycle method
       * otherwise it will throw an error.
       */
      chain: ChainedFromExtensions<Value<AllExtensions> | AnyExtension>;

      /** @deprecated Use `this.store.chain` instead. */
      getChain: <ExtensionUnion extends AnyExtension = AnyExtension>() => ChainedFromExtensions<
        Value<AllExtensions> | ExtensionUnion
      >;
    }

    interface AllExtensions {
      commands: CommandsExtension;
    }
  }
}
