
import React from 'react';

export default function Highlight({ children, color }) {
  return (
    <span
      style={{
        backgroundColor: color || '#FFD700',
        borderRadius: '2px',
        color: color ? '#fff' : '#000',
        padding: '0.08rem',
      }}>
      {children}
    </span>
  );
}
