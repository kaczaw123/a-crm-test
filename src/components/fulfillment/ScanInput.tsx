import React, { useRef, useEffect } from 'react';

interface ScanInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  autoFocus?: boolean;
}

export const ScanInput: React.FC<ScanInputProps> = ({ value, onChange, onSubmit, disabled, autoFocus = true }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) {
      inputRef.current?.focus();
    }
  }, [autoFocus, disabled]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full relative">
      <div className="flex items-center bg-[#1E222A] rounded-xl border border-[#374151] px-4 py-3 shadow-inner focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition">
        <span className="material-symbols-outlined text-gray-400 mr-3 text-2xl">barcode_scanner</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Zeskanuj EAN produktu..."
          className="bg-transparent border-none text-white w-full text-[17px] focus:outline-none placeholder-gray-500"
          autoComplete="off"
          // Keep it focused so scanner always sends here
          onBlur={() => {
            setTimeout(() => {
              if (autoFocus && !disabled) inputRef.current?.focus();
            }, 100);
          }}
        />
      </div>
    </form>
  );
};
