/**
 * Button Component - CSS-First Implementation
 *
 * Uses CSS classes for all styling. No JavaScript state management
 * for hover/active/focus/disabled states - all handled by native CSS.
 *
 * Generated from Design System file.
 */

import React from 'react';
import './Button.css';

export function Button({
  variant = 'primary',
  size = 'medium',
  leftIcon,
  rightIcon,
  iconOnly = false,
  round = false,
  className = '',
  children,
  ...props
}) {
  const classes = [
    'btn',
    `btn-${size}`,
    `btn-${variant}`,
    iconOnly && 'btn-icon-only',
    round && 'btn-round',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} {...props}>
      {leftIcon && <span className="btn-icon btn-icon-left">{leftIcon}</span>}
      {children && <span className="btn-label">{children}</span>}
      {rightIcon && <span className="btn-icon btn-icon-right">{rightIcon}</span>}
    </button>
  );
}

export function ButtonGroup({
  variant = 'primary',
  size = 'medium',
  className = '',
  children,
}) {
  // Clone children to pass variant and size
  const childrenWithProps = React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      return React.cloneElement(child as React.ReactElement<any>, { variant, size });
    }
    return child;
  });

  // Apply both size class (for corner radius) and variant class (for gap)
  const classes = [
    'btn-group',
    `btn-group-${size}`,
    `btn-group-${variant}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {childrenWithProps}
    </div>
  );
}

export default Button;
