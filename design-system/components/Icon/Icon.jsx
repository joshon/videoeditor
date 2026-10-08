/**
 * Icon Component
 *
 * Uses Material Symbols Rounded icon font from the design system.
 * Icons scale with font-size for consistent sizing with text.
 */

import React from 'react';
import './Icon.css';

const iconSizes = {
  'description': '1rem',
  'none': '0rem',
  '2xs': '0.25rem',
  'xs': '0.5rem',
  'sm': '0.75rem',
  'md': '1rem',
  'lg': '1.25rem',
  'xl': '1.5rem',
  '2xl': '1.75rem',
  '3xl': '2rem',
  '4xl': '2.25rem',
  '5xl': '2.5rem'
};

export function Icon({
  name,
  size = 'md',
  className = '',
  style,
}) {
  // Resolve size from predefined sizes or use as custom value
  const fontSize = iconSizes[size] || size;

  return (
    <span
      className={`ds-icon ${className}`.trim()}
      style={{ fontSize, ...style }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

export default Icon;
