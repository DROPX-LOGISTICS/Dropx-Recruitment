"use client";

import { useEffect, useRef, useState } from "react";

type Ad = { id: string; ad_name: string; meta_ad_id?: string | null; status?: string; recruitment_locations?: { code?: string; name?: string }; recruitment_roles?: { code?: string; name?: string } };
export default function MetaAdAudiencePicker({ ads, select, close }: { ads: Ad[]; select: (ad: Ad) => void; close: () => void }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; input.current?.focus(); return () => previous?.focus(); }, []);
  const needle = query.trim().toLowerCase();
  const matches = ads.filter(ad => ad.meta_ad_id && [ad.ad_name, ad.recruitment_locations?.code, ad.recruitment_locations?.name, ad.recruitment_roles?.code, ad.recruitment_roles?.name].join(" ").toLowerCase().includes(needle));
  return <div className="modal-backdrop"><section className="modal audience-ad-picker" role="dialog" aria-modal="true" aria-label="Choose an ad to edit" onKeyDown={event => {
    if (event.key === "Escape") close();
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])'));
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
  }}>
    <header className="modal-header"><div><span className="audience-eyebrow">EXISTING ADS</span><h2>Edit ad audience</h2><p>Choose an ad to change its location pin and radius.</p></div><button type="button" aria-label="Close ad picker" onClick={close}>×</button></header>
    <div className="audience-ad-search"><input ref={input} aria-label="Search existing ads" placeholder="Search ad, station or designation" value={query} onChange={event => setQuery(event.target.value)}/><small role="status">{matches.length} matching ads</small></div>
    <div className="audience-ad-results">{matches.map(ad => <button type="button" key={ad.id} onClick={() => select(ad)}><span><b>{ad.ad_name}</b><small>{ad.recruitment_locations?.code || "Unmapped"} · {ad.recruitment_roles?.name || ad.recruitment_roles?.code || "Role not mapped"} · {ad.status?.toLowerCase() || "unknown"}</small></span><em>Edit audience →</em></button>)}{!matches.length ? <p>No linked Meta ads match this search.</p> : null}</div>
    <footer><button type="button" onClick={close}>Cancel</button></footer>
  </section></div>;
}
