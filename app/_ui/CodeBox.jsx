'use client';

import { useState } from 'react';

/** Code or config with a copy button. The button says what it did. */
export default function CodeBox({ text, label = 'Copy', onCopy }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the text is still selectable */
    }
  };
  return (
    <div className='k-codebox'>
      <pre tabIndex={0}>{text}</pre>
      <button type='button' className='k-copy' onClick={copy}>{copied ? 'Copied' : label}</button>
    </div>
  );
}
