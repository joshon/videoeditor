/**
 * TextField, TextArea, and Select Components - CSS-First Implementation
 */

'use client';

import React, { forwardRef, useState, useRef, useEffect } from 'react';
import { Button } from '../Button';
import './TextField.css';

export const TextField = forwardRef(
  function TextField({ label, inlineLabel, error, size = 'medium', instructions, notes, leftIcon, rightIcon, className = '', wrapperClassName = '', ...props }, ref) {
    const hasIcons = leftIcon || rightIcon;
    return (
      <div className={`input-wrapper input-${size} ${error ? 'input-error' : ''} ${inlineLabel ? 'input-inline' : ''} ${wrapperClassName}`}>
        {label && <label className="input-label">{label}</label>}
        {instructions && <span className="input-instructions">{instructions}</span>}
        <div className="input-row">
          {inlineLabel && <label className="input-inline-label">{inlineLabel}</label>}
          <div className={`input-field-wrapper ${hasIcons ? 'has-icons' : ''}`}>
            {leftIcon && <span className="input-icon input-icon-left">{leftIcon}</span>}
            <input
              ref={ref}
              className={`input-base ${leftIcon ? 'has-left-icon' : ''} ${rightIcon ? 'has-right-icon' : ''} ${className}`}
              {...props}
            />
            {rightIcon && <span className="input-icon input-icon-right">{rightIcon}</span>}
          </div>
        </div>
        {notes && <span className="input-notes">{notes}</span>}
        {error && <span className="input-error-message">{error}</span>}
      </div>
    );
  }
);

export const TextArea = forwardRef(
  function TextArea({ label, inlineLabel, error, size = 'medium', instructions, notes, leftIcon, rightIcon, resize = 'vertical', maxCharacters, className = '', wrapperClassName = '', onChange, ...props }, ref) {
    const [charCount, setCharCount] = useState(0);
    const hasIcons = leftIcon || rightIcon;
    const handleChange = (e) => {
      setCharCount(e.target.value.length);
      if (onChange) onChange(e);
    };
    return (
      <div className={`input-wrapper input-${size} ${error ? 'input-error' : ''} ${inlineLabel ? 'input-inline' : ''} ${wrapperClassName}`}>
        {label && <label className="input-label">{label}</label>}
        {instructions && <span className="input-instructions">{instructions}</span>}
        <div className="input-row">
          {inlineLabel && <label className="input-inline-label">{inlineLabel}</label>}
          <div className={`input-field-wrapper ${hasIcons ? 'has-icons' : ''}`}>
            {leftIcon && <span className="input-icon input-icon-left">{leftIcon}</span>}
            <textarea
              ref={ref}
              className={`input-base textarea ${leftIcon ? 'has-left-icon' : ''} ${rightIcon ? 'has-right-icon' : ''} ${className}`}
              style={{ resize }}
              maxLength={maxCharacters}
              onChange={handleChange}
              {...props}
            />
            {rightIcon && <span className="input-icon input-icon-right textarea-icon">{rightIcon}</span>}
          </div>
        </div>
        <div className="input-footer">
          <div className="input-footer-left">
            {notes && <span className="input-notes">{notes}</span>}
            {error && <span className="input-error-message">{error}</span>}
          </div>
          {maxCharacters && <span className="input-char-count">{charCount}/{maxCharacters}</span>}
        </div>
      </div>
    );
  }
);

export function Select({
  label,
  inlineLabel,
  error,
  instructions,
  notes,
  options = [],
  value,
  defaultValue,
  placeholder = 'Select an option',
  size = 'medium',
  disabled = false,
  onChange,
  name,
  className = '',
  wrapperClassName = '',
  fullWidth = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(value ?? defaultValue ?? '');
  const containerRef = useRef(null);

  useEffect(() => {
    if (value !== undefined) setInternalValue(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optionValue) => {
    if (disabled) return;
    setInternalValue(optionValue);
    setIsOpen(false);
    if (onChange) {
      onChange({ target: { value: optionValue, name } });
    }
  };

  const selectedOption = options.find(opt => opt.value === internalValue && !opt.isHeader);
  const displayText = selectedOption ? selectedOption.label : placeholder;

  return (
    <div ref={containerRef} className={`input-wrapper input-${size} ${error ? 'input-error' : ''} ${inlineLabel ? 'input-inline' : ''} ${wrapperClassName}`} style={fullWidth ? { width: '100%' } : {}}>
      {label && <label className="input-label">{label}</label>}
      {instructions && <span className="input-instructions">{instructions}</span>}
      <div className="input-row">
        {inlineLabel && <label className="input-inline-label">{inlineLabel}</label>}
        <button
          type="button"
          className={`input-base dropdown-trigger ${className}`}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span>{displayText}</span>
          <svg className="dropdown-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {isOpen && !disabled && (
        <ul className="dropdown-menu" role="listbox">
          {options.map((opt, idx) => (
            opt.isHeader ? (
              <li key={`header-${idx}`} className="dropdown-section-header">{opt.label}</li>
            ) : (
              <li key={opt.value} role="option" aria-selected={opt.value === internalValue}>
                <Button
                  variant="option_menu"
                  size="medium"
                  disabled={opt.disabled}
                  onClick={() => handleSelect(opt.value)}
                  className={opt.value === internalValue ? 'active' : ''}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                >
                  {opt.leftIcon && <span className="dropdown-option-icon">{opt.leftIcon}</span>}
                  <span style={{ flex: 1 }}>{opt.label}</span>
                  {opt.rightIcon && <span className="dropdown-option-icon">{opt.rightIcon}</span>}
                </Button>
              </li>
            )
          ))}
        </ul>
      )}

      {notes && <span className="input-notes">{notes}</span>}
      {error && <span className="input-error-message">{error}</span>}
    </div>
  );
}
