/**
 * Toggle Component - CSS-First Implementation
 */

'use client';

import React, { forwardRef, useState } from 'react';
import './Toggle.css';

export const Toggle = forwardRef(
  function Toggle(
    {
      label,
      description,
      size = 'medium',
      labelPosition = 'right',
      className = '',
      disabled,
      id,
      checked: controlledChecked,
      defaultChecked,
      onChange,
      ...props
    },
    ref
  ) {
    const inputId = id || `toggle-${React.useId()}`;

    const isControlled = controlledChecked !== undefined;
    const [internalChecked, setInternalChecked] = useState(defaultChecked || false);
    const isChecked = isControlled ? controlledChecked : internalChecked;

    const handleChange = (e) => {
      if (!isControlled) {
        setInternalChecked(e.target.checked);
      }
      onChange?.(e);
    };

    const labelPositionClass = labelPosition !== 'right' ? `toggle-label-${labelPosition}` : '';

    const classes = [
      'toggle',
      `toggle-${size}`,
      labelPositionClass,
      className,
    ].filter(Boolean).join(' ');

    return (
      <label className={classes}>
        <input
          ref={ref}
          type="checkbox"
          id={inputId}
          className="toggle-input"
          disabled={disabled}
          checked={isChecked}
          onChange={handleChange}
          {...props}
        />
        <div className="toggle-track">
          <div className="toggle-thumb" />
        </div>
        {(label || description) && (
          <div className="toggle-content">
            {label && <span className="toggle-label">{label}</span>}
            {description && <span className="toggle-description">{description}</span>}
          </div>
        )}
      </label>
    );
  }
);

export default Toggle;
