import React from "react";
import AuthPanel from "./AuthPanel";
import RecruitBrand from "./RecruitBrand";

export default function RecruitLogin({ checking = false }: { checking?: boolean }) {
  return <main className="recruit-login">
    <section className="recruit-story" aria-labelledby="recruit-welcome">
      <RecruitBrand />
      <div className="recruit-story-copy">
        <span className="recruit-eyebrow">THE NEXT CHAPTER STARTS WITH PEOPLE</span>
        <h2 id="recruit-welcome">The people<br />behind every<br /><em>delivery.</em></h2>
        <p>From the first conversation to the first day.<br />Build the teams that keep DropX moving.</p>
        <div className="recruit-team-types"><span>Delivery associates</span><span>Operations teams</span><span>Corporate talent</span></div>
      </div>
      <div className="recruit-journey" role="group" aria-label="Your recruitment journey">
        <span><b>01</b>Source</span><i aria-hidden="true">→</i><span><b>02</b>Connect</span><i aria-hidden="true">→</i><span><b>03</b>Onboard</span>
      </div>
      <div className="recruit-story-footer"><span className="recruit-status-dot" aria-hidden="true" />Built for Workforce &amp; HR recruitment</div>
      <div className="recruit-orbit recruit-orbit-one" aria-hidden="true" /><div className="recruit-orbit recruit-orbit-two" aria-hidden="true" />
    </section>
    <section className="recruit-entry" aria-label="Sign in to DropX Recruit">
      <div className="recruit-mobile-brand"><RecruitBrand /></div>
      {checking ? <div className="recruit-session-check" role="status"><div className="loader" /><p>Opening your recruitment workspace…</p></div> : <AuthPanel />}
      <footer className="recruit-entry-footer">DropX Recruit <span aria-hidden="true">·</span> From opportunity to onboarding.</footer>
    </section>
  </main>;
}
