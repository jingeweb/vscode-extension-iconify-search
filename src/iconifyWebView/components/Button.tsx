import { cx, type JNode, type MouseEventHandler, type WithOptChildren } from 'jinge';

export type ButtonProps = WithOptChildren<JNode> & {
  primary?: boolean;
  quiet?: boolean;
  small?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
  htmlType?: 'button' | 'submit';
  'on:click'?: MouseEventHandler<HTMLButtonElement>;
};
export function Button(props: ButtonProps) {
  return (
    <button
      type={props.htmlType ?? 'button'}
      disabled={props.disabled}
      className={cx(
        'ui-button',
        props.primary && 'primary',
        props.quiet && 'quiet',
        props.small && 'small',
        props.className,
      )}
      aria-label={props.label}
      title={props.label}
      on:click={props['on:click']}
    >
      {props.children}
    </button>
  );
}
