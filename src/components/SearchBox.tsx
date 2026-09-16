import { useEffect, useId, useRef } from "react";

type SearchBoxProps = {
  value: string;
  onChange: (value: string) => void;
  hint: string;
};

export function SearchBox({ value, onChange, hint }: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        onChange("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange]);

  return (
    <section className="search-hero no-print" aria-label="Title search">
      <p className="search-kicker">Search the posted list</p>
      <label className="search-label" htmlFor={id}>
        Title, author, or ISBN
      </label>
      <div className="search-shell">
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16.2 16.2 21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          id={id}
          type="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Try 101 Dalmatians, an author, or an ISBN"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-hint`}
        />
        {value ? (
          <button
            type="button"
            className="search-clear"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
          >
            Clear
          </button>
        ) : (
          <kbd className="search-kbd">/</kbd>
        )}
      </div>
      <p id={`${id}-hint`} className="search-hint">
        {hint}
      </p>
    </section>
  );
}
