"use client";

import Script from "next/script";
import React, { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
          renderButton(element: HTMLElement, options: { type: "standard"; theme: "outline"; size: "large"; width: number; text: "continue_with" }): void;
        };
      };
    };
  }
}

export default function AuthPanel() {
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleLoaded, setGoogleLoaded] = useState(false);
  const [googleConfigLoaded, setGoogleConfigLoaded] = useState(false);
  const googleButton = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((response) => response.json())
      .then((payload) => setGoogleClientId(String(payload.googleClientId ?? "")))
      .catch(() => setGoogleClientId(""))
      .finally(() => setGoogleConfigLoaded(true));
  }, []);

  async function jsonRequest(url: string, body: object): Promise<{
    error?: string;
    challengeId?: string | null;
    message?: string;
    token?: string;
    [key: string]: unknown;
  }> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const responseText = await response.text();
    let payload: {
      error?: string;
      challengeId?: string | null;
      message?: string;
      token?: string;
      [key: string]: unknown;
    } = {};
    try {
      payload = responseText ? JSON.parse(responseText) as typeof payload : {};
    } catch {
      // Do not expose an HTML framework/proxy error in the sign-in screen.
      throw new Error(response.ok
        ? "The sign-in service returned an invalid response. Please try again."
        : "The sign-in service is temporarily unavailable. Please try again shortly.");
    }
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload;
  }

  async function requestOtp() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await jsonRequest("/api/mobile/auth/request-otp", { mobile });
      setChallengeId(payload.challengeId ?? null);
      setMessage(payload.message || "OTP request accepted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send OTP.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await jsonRequest("/api/mobile/auth/verify-otp", { mobile, otp, challengeId, deviceName: "Web" });
      if (!payload.token) throw new Error("The sign-in response did not include a session token.");
      localStorage.setItem("recruitment_session", payload.token);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to verify OTP.");
    } finally {
      setBusy(false);
    }
  }

  function setupGoogle() {
    if (!googleClientId || !window.google || !googleButton.current) return;
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async ({ credential }) => {
        setBusy(true);
        try {
          const payload = await jsonRequest("/api/auth/google", { idToken: credential, deviceName: "Web" });
          if (!payload.token) throw new Error("The sign-in response did not include a session token.");
          localStorage.setItem("recruitment_session", payload.token);
          window.location.reload();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Unable to sign in with Google.");
        } finally {
          setBusy(false);
        }
      }
    });
    googleButton.current.replaceChildren();
    window.google.accounts.id.renderButton(googleButton.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      width: Math.min(360, googleButton.current.clientWidth || 320),
      text: "continue_with"
    });
  }

  useEffect(() => {
    if (!googleLoaded || !googleClientId || !googleButton.current) return;
    let lastWidth = 0;
    const render = () => {
      const width = Math.min(360, googleButton.current?.clientWidth || 320);
      if (width !== lastWidth) { lastWidth = width; setupGoogle(); }
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(googleButton.current);
    return () => observer.disconnect();
  // setupGoogle intentionally depends on the loaded Google SDK and dynamic client ID.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId, googleLoaded]);

  return (
    <section className="auth-panel" aria-labelledby="sign-in-title" aria-busy={busy}>
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleLoaded(true)} />
      <span className="recruit-secure"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></svg>Secure workspace</span>
      <h1 id="sign-in-title">Welcome back.</h1>
      <p>Sign in to your DropX Recruit workspace.</p>
      <form onSubmit={(event) => { event.preventDefault(); if (!busy) void (challengeId ? verifyOtp() : requestOtp()); }}>
      <label htmlFor="recruit-mobile">Mobile number</label>
      <div className="mobile-field"><b>+91</b><input id="recruit-mobile" name="mobile" type="tel" autoComplete="tel-national" placeholder="Enter your registered number" value={mobile} onChange={(event) => setMobile(event.target.value)} disabled={busy || !!challengeId} inputMode="numeric" required aria-describedby="recruit-otp-help" /></div>
      <p id="recruit-otp-help" className="recruit-field-help">We’ll send a one-time code to your WhatsApp.</p>
      {challengeId ? (
        <>
          <label htmlFor="recruit-otp">WhatsApp verification code</label>
          <input id="recruit-otp" name="otp" className="otp-field" value={otp} onChange={(event) => setOtp(event.target.value)} maxLength={6} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required disabled={busy} />
          <button className="primary" type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify and sign in"}<span aria-hidden="true">→</span></button>
          <button className="recruit-change-number" type="button" disabled={busy} onClick={() => { setChallengeId(null); setOtp(""); setMessage(""); }}>Use a different number</button>
        </>
      ) : <button className="primary" type="submit" disabled={busy}>{busy ? "Sending code…" : "Send WhatsApp OTP"}<span aria-hidden="true">→</span></button>}
      </form>
      {message ? <p className="auth-message" role="status" aria-live="polite">{message}</p> : null}
      <div className="or"><i /><em>or continue with</em><i /></div>
      <div className="google-button" ref={googleButton} role="group" aria-label="Continue with Google" />
      {!googleClientId ? <p className="recruit-google-status" role="status">{googleConfigLoaded ? "Google sign-in is unavailable. Please use WhatsApp above." : "Loading Google sign-in…"}</p> : null}
      <p className="recruit-access-note">Use your authorised DropX account to continue.</p>
      <a className="android-download" href="/downloads/dropx-recruitment-android.apk?v=133" download>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/></svg>
        <span><strong>Recruit, on the go</strong><small>Download for Android · v1.4.1</small></span><b aria-hidden="true">↗</b>
      </a>
    </section>
  );
}
