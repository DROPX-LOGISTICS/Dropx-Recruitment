"use client";

import { useId, useRef, useState } from "react";
import styles from "./SearchableAdSelect.module.css";

type Option = { value: string; label: string };

export default function SearchableAdSelect({ label, value, options, onChange, placeholder = "Select an option", disabled = false }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const activeIndex = Math.min(active, Math.max(0, filtered.length - 1));
  const selected = options.find(option => option.value === value);
  function close() { setOpen(false); setQuery(""); trigger.current?.focus(); }
  function choose(next: string) { onChange(next); close(); }

  return <div className={styles.field} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setQuery(""); }
  }} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <span id={`${id}-label`}>{label}</span>
    <button ref={trigger} type="button" className={styles.trigger} disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={`${id}-list`} onClick={() => { setQuery(""); setActive(0); setOpen(!open); }}>
      <span id={`${id}-value`}>{selected?.label || placeholder}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && !disabled ? <div className={styles.popup}>
      <input autoFocus type="search" role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={filtered.length ? `${id}-option-${activeIndex}` : undefined} placeholder={`Search ${label.toLowerCase()}…`} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const next = Math.max(0, Math.min(filtered.length - 1, activeIndex + (event.key === "ArrowDown" ? 1 : -1)));
          setActive(next);
          document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: "nearest" });
        } else if (event.key === "Enter") { event.preventDefault(); if (filtered[activeIndex]) choose(filtered[activeIndex].value); }
      }} />
      <div id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className={styles.options}>
        {filtered.map((option, index) => <button key={option.value} id={`${id}-option-${index}`} type="button" role="option" aria-selected={value === option.value} className={index === activeIndex ? styles.active : undefined} onClick={() => choose(option.value)}>{option.label}{value === option.value ? <span aria-hidden="true"> ✓</span> : null}</button>)}
        {!filtered.length ? <p role="status">No matches found.</p> : null}
      </div>
    </div> : null}
  </div>;
}
