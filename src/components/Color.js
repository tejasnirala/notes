
import React from 'react';

export default function Color({ children, color }) {
  return (
    <span
      style={{
        color: color,
      }}>
      {children}
    </span>
  );
}
