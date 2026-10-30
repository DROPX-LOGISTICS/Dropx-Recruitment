"use client";

import { useId, useRef, useState } from "react";
import { previewUserRole, searchPreviewUsers, type PreviewUser } from "@/lib/preview-user-search";

export default function PreviewUserSearch({ users, viewerProfileId, selectedUser, onChange }: {
  users: PreviewUser[];
  viewerProfileId?: string;
  selectedUser: PreviewUser | null;
  onChange: (profileId: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = searchPreviewUsers(users, viewerProfileId ?? "", query);
  const options: PreviewUser[] = query.trim() ? matches : [{ profileId: "", name: "My view" }, ...matches];
  const index = Math.min(activeIndex, options.length - 1);
  const selectedLabel = selectedUser ? `${selectedUser.name} · ${previewUserRole(selectedUser)}` : "My view";

  function choose(profileId: string) {
    setOpen(false);
    setQuery("");
    onChange(profileId);
  }

  return <div className="owner-preview-switcher" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false);
      setQuery("");
    }
  }}>
    <label htmlFor={id}>View as</label>
    <div className="preview-user-search">
      <input ref={input} id={id} role="combobox" aria-label="View as user" aria-autocomplete="list"
        aria-expanded={open} aria-controls={`${id}-options`}
        aria-activedescendant={open && options.length ? `${id}-option-${index}` : undefined}
        autoComplete="off" placeholder="Search name, email or ID…"
        value={open ? query : selectedLabel}
        onClick={() => setOpen(true)}
        onFocus={() => { setOpen(true); setActiveIndex(0); }}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (!options.length) return;
            const next = !open ? 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
            setActiveIndex(next);
            document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: "nearest" });
          } else if (event.key === "Enter" && open && options.length) {
            event.preventDefault(); choose(options[index].profileId);
          } else if (event.key === "Escape") {
            event.preventDefault(); setOpen(false); setQuery("");
          }
        }}/>
      {open ? <div className="preview-user-results" id={`${id}-options`} role="listbox" aria-label="Preview users">
        {options.map((user, optionIndex) => <div key={user.profileId} id={`${id}-option-${optionIndex}`}
          role="option" aria-selected={(selectedUser?.profileId ?? "") === user.profileId}
          className={index === optionIndex ? "highlighted" : ""}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { choose(user.profileId); input.current?.focus(); }}>
          <strong>{user.name}</strong>
          <small>{user.profileId ? previewUserRole(user) : "Exit preview and return to your account"}</small>
          {user.profileId && (user.employeeId || user.email) ? <small>{[user.employeeId, user.email].filter(Boolean).join(" · ")}</small> : null}
        </div>)}
        {!matches.length ? <p role="status">No matching users. Try another name, email or ID.</p> : null}
      </div> : null}
    </div>
  </div>;
}
