/**
 * Checkbox Component - CSS-First Implementation
 */

'use client';

import React, { forwardRef, useState, useEffect } from 'react';
import './Checkbox.css';

const iconConfig = {
  fontFamily: 'Material Symbols Rounded',
  fontUri: 'https://fonts.google.com/download?family=Material+Symbols+Outlined|Material+Symbols+Rounded|Material+Symbols+Sharp',
  checkIconChar: '',
  indeterminateIconChar: '',
};

export const Checkbox = forwardRef(
  function Checkbox(
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
      indeterminate,
      onChange,
      ...props
    },
    ref
  ) {
    const inputId = id || `checkbox-${React.useId()}`;
    const innerRef = React.useRef<HTMLInputElement>(null);
    const checkboxRef = (ref as React.RefObject<HTMLInputElement>) || innerRef;

    useEffect(() => {
      if (checkboxRef.current) {
        checkboxRef.current.indeterminate = !!indeterminate;
      }
    }, [indeterminate, checkboxRef]);

    const isControlled = controlledChecked !== undefined;
    const [internalChecked, setInternalChecked] = useState(defaultChecked || false);
    const isChecked = isControlled ? controlledChecked : internalChecked;

    const handleChange = (e) => {
      if (!isControlled) {
        setInternalChecked(e.target.checked);
      }
      onChange?.(e);
    };

    const labelPositionClass = labelPosition !== 'right' ? `checkbox-label-${labelPosition}` : '';

    const classes = [
      'checkbox-container',
      `checkbox-${size}`,
      labelPositionClass,
      className,
    ].filter(Boolean).join(' ');

    return (
      <label className={classes}>
        <input
          ref={checkboxRef}
          type="checkbox"
          id={inputId}
          className="checkbox-input"
          disabled={disabled}
          checked={isChecked}
          onChange={handleChange}
          {...props}
        />
        <div className="checkbox-box">
          <div className="checkbox-icon" style={{ fontFamily: iconConfig.fontFamily }}>
            {indeterminate ? iconConfig.indeterminateIconChar : iconConfig.checkIconChar}
          </div>
        </div>
        {(label || description) && (
          <div className="checkbox-content">
            {label && <span className="checkbox-label">{label}</span>}
            {description && <span className="checkbox-description">{description}</span>}
          </div>
        )}
      </label>
    );
  }
);

export default Checkbox;
