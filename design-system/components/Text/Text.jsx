'use client';

import React from 'react';
import styles from './Text.module.css';



/**
 * Text component for typography.
 * 
 * @example
 * <Text variant="headers-h1">Page Title</Text>
 * <Text variant="body-medium" color="muted">Description text</Text>
 */
export function Text({
  variant = 'body-medium',
  align = 'left',
  color = 'default',
  as,
  children,
  className = '',
  ...props
}) {
  // Auto-select element based on variant; a variant not listed renders as a div.
  const elementMap = {
    'headers-h1': 'h1',
    'headers-h2': 'h2',
    'headers-h3': 'h3',
    'headers-h4': 'h4',
    'headers-h5': 'h5',
    'headers-h6': 'h6',
    'body-large': 'p',
    'body-medium': 'p',
    'body-small': 'p',
  };
  
  const Component = as || elementMap[variant] || 'div';
  
  const classes = [
    styles.text,
    styles[`variant-${variant}`],
    styles[`align-${align}`],
    color !== 'default' ? styles[`color-${color}`] : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <Component className={classes} {...props}>
      {children}
    </Component>
  );
}

export default Text;
