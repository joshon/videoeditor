'use client';

import React, { useState, useEffect, useRef } from 'react';
import styles from './Surface.module.css';



// Surface configurations - pre-resolved from design system
const surfaceConfigs = {
  'surface-001': {
    modes: {
      '1': {
        base: 'oklch(100% 0 0)',
        onBase: 'oklch(0% 0 0)',
        borderColor: ''
      },
      '2': {
        base: 'oklch(0% 0 0)',
        onBase: 'oklch(100% 0 0)',
        borderColor: ''
      }
    }
  },
  'surface-card': {
    modes: {
      '1': {
        base: 'oklch(100% 0 0)',
        onBase: 'oklch(44.4% 0 none)',
        borderColor: 'oklch(81.03% 0 none)'
      },
      '2': {
        base: 'oklch(37.07% 0 none)',
        onBase: 'oklch(100% 0 0)',
        borderColor: 'none'
      }
    }
  },
  'surface-menu': {
    modes: {
      '1': {
        base: 'oklch(100% 0 0)',
        onBase: 'oklch(22.41% 0 none)',
        borderColor: 'oklch(22.41% 0 none)'
      },
      '2': {
        base: 'oklch(29.74% 0 none)',
        onBase: 'oklch(100% 0 0)',
        borderColor: ''
      }
    }
  },
  'surface-003': {
    modes: {
      '1': {
        base: 'oklch(95.69% 0 none)',
        onBase: 'oklch(29.74% 0 none)',
        borderColor: ''
      },
      '2': {
        base: 'oklch(29.74% 0 none)',
        onBase: 'oklch(95.69% 0 none)',
        borderColor: ''
      }
    }
  },
  'surface-002': {
    modes: {
      '1': {
        base: 'oklch(100% 0 0)',
        onBase: 'oklch(22.41% 0 none)',
        borderColor: ''
      },
      '2': {
        base: 'oklch(0% 0 0)',
        onBase: 'oklch(100% 0 0)',
        borderColor: ''
      }
    }
  },
  'surface-content': {
    modes: {
      '1': {
        base: 'none',
        onBase: 'oklch(0% 0 0)',
        borderColor: ''
      },
      '2': {
        base: 'none',
        onBase: 'oklch(100% 0 0)',
        borderColor: ''
      }
    }
  },
  'surface-plot': {
    modes: {
      '1': {
        base: 'oklch(100% 0 0)',
        onBase: 'oklch(29.74% 0 none)',
        borderColor: 'oklch(81.03% 0 none)'
      },
      '2': {
        base: 'oklch(29.74% 0 none)',
        onBase: 'oklch(95.69% 0 none)',
        borderColor: 'oklch(44.4% 0 none)'
      }
    }
  }
};
const defaultMode = '1';

/**
 * Get the mode key from element hierarchy or fall back to html element
 */
function getModeFromElement(element) {
  if (typeof document === 'undefined') return defaultMode;

  // Walk up the DOM tree to find nearest data-mode
  let current = element;
  while (current) {
    const dataMode = current.getAttribute('data-mode');
    if (dataMode) {
      const firstSurface = Object.values(surfaceConfigs)[0];
      if (firstSurface?.modes?.[dataMode]) {
        return dataMode;
      }
    }
    current = current.parentElement;
  }

  // Fall back to html element
  const htmlMode = document.documentElement.getAttribute('data-mode');
  const firstSurface = Object.values(surfaceConfigs)[0];
  if (htmlMode && firstSurface?.modes?.[htmlMode]) {
    return htmlMode;
  }

  return defaultMode;
}

/**
 * Surface component for creating distinct visual areas.
 * Supports N modes via data-mode attribute on self, ancestor, or html element.
 *
 * @example
 * <Surface variant="surface-001" padding="medium" rounded="large">
 *   Content goes here
 * </Surface>
 *
 * // With explicit mode
 * <Surface variant="surface-001" data-mode="2">
 *   Dark mode content
 * </Surface>
 */
export function Surface({
  variant = 'surface-001',
  padding = 'medium',
  rounded = 'medium',
  shadow = false,
  as: Component = 'div',
  children,
  className = '',
  style: propStyle,
  'data-mode': explicitMode,
  ...props
}) {
  const ref = useRef(null);
  const [currentModeKey, setCurrentModeKey] = useState(explicitMode || defaultMode);

  useEffect(() => {
    // If explicit mode is provided via data-mode prop, use it directly
    if (explicitMode) {
      setCurrentModeKey(explicitMode);
      return;
    }

    // Otherwise, detect mode from DOM hierarchy
    const updateMode = () => {
      if (ref.current) {
        setCurrentModeKey(getModeFromElement(ref.current));
      }
    };

    updateMode();

    // Observe changes to data-mode anywhere in ancestors
    const observer = new MutationObserver(updateMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode'],
      subtree: true
    });
    return () => observer.disconnect();
  }, [explicitMode]);

  // Get surface config for current variant and mode
  const surfaceConfig = surfaceConfigs[variant] || surfaceConfigs['surface-001'];
  // Read through a string-keyed table: the mode key comes from the page, so a typed
  // literal table would not let a strict TypeScript project index it.
  const modeTable = surfaceConfig?.modes || {};
  const modeColors = modeTable[currentModeKey] || modeTable[defaultMode] || Object.values(modeTable)[0] || { base: '#ffffff', onBase: '#000000' };

  const classes = [
    styles.surface,
    styles[`padding-${padding}`],
    styles[`rounded-${rounded}`],
    shadow ? styles.shadow : '',
    className,
  ].filter(Boolean).join(' ');

  // Build inline style with mode-specific colors
  const surfaceStyle = {
    // Use background (not backgroundColor) so gradients render
    background: modeColors.base,
    color: modeColors.onBase,
    ...(modeColors.borderColor && modeColors.borderColor !== 'transparent' ? { border: `1px solid ${modeColors.borderColor}` } : {}),
    ...propStyle,
  };

  return (
    <Component ref={ref} className={classes} style={surfaceStyle} data-mode={explicitMode} {...props}>
      {children}
    </Component>
  );
}

export default Surface;
