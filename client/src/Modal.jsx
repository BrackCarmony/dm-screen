import React, { useEffect, useRef } from 'react';

// A form over the page, wherever the DM has scrolled to. The browser's modal <dialog> dims the page, keeps focus
// inside and closes on Esc (its cancel event), which we route through onClose so React stays in charge.
export default function Modal({ label, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={label} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {children}
    </dialog>
  );
}
