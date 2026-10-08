/**
 * RadioButton Component - CSS-First Implementation
 */

'use client';

import React, { forwardRef } from 'react';
import './RadioButton.css';

export const RadioButton = forwardRef(
  function RadioButton(
    {
      label,
      size = 'medium',
      labelPosition = 'right',
      className = '',
      disabled,
      id,
      ...props
    },
    ref
  ) {
    const inputId = id || `radio-${React.useId()}`;

    const labelPositionClass = labelPosition !== 'right' ? `radio-label-${labelPosition}` : '';

    const classes = [
      'radio-container',
      `radio-${size}`,
      labelPositionClass,
      className,
    ].filter(Boolean).join(' ');

    return (
      <label className={classes}>
        <input
          ref={ref}
          type="radio"
          id={inputId}
          className="radio-input"
          disabled={disabled}
          {...props}
        />
        <div className="radio-circle">
          <div className="radio-dot" />
        </div>
        {label && <span className="radio-label">{label}</span>}
      </label>
    );
  }
);

export default RadioButton;
