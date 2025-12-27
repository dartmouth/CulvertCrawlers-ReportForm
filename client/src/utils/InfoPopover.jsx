import React, { useEffect, useRef, useState, useId } from 'react';

export default function InfoPopover({ title, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('keydown', onKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative inline-block ml-2" ref={ref}>
      <button
        type="button"
        className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        title={`What is ${title}?`}
      >
        i
      </button>

      {open && (
        <div
          id={id}
          role="dialog"
          className="absolute z-20 mt-2 right-0 w-72 max-w-sm rounded border bg-white p-3 shadow-lg text-sm"
        >
          <div className="font-medium mb-1">{title}</div>
          <div className="text-gray-700">{children}</div>
        </div>
      )}
    </div>
  );
}