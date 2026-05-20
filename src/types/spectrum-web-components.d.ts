import type React from 'react';

type SpAttrs<T = HTMLElement> = React.DetailedHTMLProps<
  React.HTMLAttributes<T> & {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    variant?: string;
    size?: string;
    indeterminate?: boolean;
    multiline?: boolean;
    rows?: number;
    type?: string;
    scale?: string;
    color?: string;
    open?: boolean;
    selected?: boolean;
  },
  T
>;

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'sp-theme': SpAttrs;
      'sp-button': SpAttrs;
      'sp-action-button': SpAttrs;
      'sp-textfield': SpAttrs;
      'sp-picker': SpAttrs;
      'sp-menu': SpAttrs;
      'sp-menu-item': SpAttrs;
      'sp-field-label': SpAttrs;
      'sp-progress-circle': SpAttrs;
      'sp-divider': SpAttrs;
    }
  }
}

export {};
