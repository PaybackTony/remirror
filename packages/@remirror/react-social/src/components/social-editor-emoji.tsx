import { css, cx } from 'linaria';
import { Type, useMultishift } from 'multishift';
import React, { FC, useCallback, useState } from 'react';

import { isEmptyArray } from '@remirror/core';
import { usePositioner } from '@remirror/react-hooks';
import { useEditorFocus } from '@remirror/react-hooks/use-editor-focus';
import { useEmoji } from '@remirror/react-hooks/use-emoji';

import {
  emojiSuggestionsDropdownWrapperStyles,
  emojiSuggestionsItemStyles,
} from '../social-styles';

export interface SocialEmojiComponentProps<
  Data
> {
  /**
   * Which direction to open the suggestion list, either "up" or "down", defaults to "down"
   *
   * @default "down"
   */
  direction?: string;
}

/**
 * This component renders the emoji suggestion dropdown for the user.
 */
export const SocialEmojiComponent: FC<SocialEmojiComponentProps> = ({ direction: 'down' }) => {
  const state = useEmoji();
  const [isFocused, focus] = useEditorFocus();
  const [isClicking, setIsClicking] = useState(false);
  const { ref, active, bottom, left } = usePositioner(
    'popup',
    !!((isFocused || isClicking) && state && !isEmptyArray(state.list)),
  );

  const { getMenuProps, getItemProps, itemHighlightedAtIndex, hoveredIndex } = useMultishift({
    highlightedIndexes: [state?.index ?? 0],
    type: Type.ControlledMenu,
    items: state?.list ?? [],
    isOpen: true,
  });

  const onMouseDown = useCallback(() => {
    setIsClicking(true);
    setTimeout(() => setIsClicking(false), 2000);
  }, []);
  
  const emojiWrapperStyle = (props.direction == 'down') ? {
        top: bottom,
        left: left,
      } : {
        bottom: bottom,
        left: left,
      };

  return (
    <div
      {...getMenuProps({ ref, onMouseDown })}
      className={emojiSuggestionsDropdownWrapperStyles}
      style={emojiWrapperStyle}
    >
      {active &&
        (state?.list ?? []).map((emoji, index) => {
          const isHighlighted = itemHighlightedAtIndex(index);
          const isHovered = index === hoveredIndex;

          return (
            <div
              key={emoji.name}
              className={cx(
                emojiSuggestionsItemStyles,
                isHighlighted && 'highlighted',
                isHovered && 'hovered',
              )}
              {...getItemProps({
                onClick: () => {
                  state?.command(emoji);
                  focus();
                },
                item: emoji,
                index,
              })}
            >
              <span className={emojiSuggestionsItemChar}>{emoji.char}</span>
              <span className={emojiSuggestionsItemName}>:{emoji.name}:</span>
            </div>
          );
        })}
    </div>
  );
};

const emojiSuggestionsItemName = css`
  color: rgb(121, 129, 134);
`;

const emojiSuggestionsItemChar = css`
  font-size: 1.25em;
  padding-right: 5px;
`;
