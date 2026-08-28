"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

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
  const googleButton = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/config")
      .then((response) => response.json())
      .then((payload) => setGoogleClientId(String(payload.googleClientId ?? "")))
      .catch(() => setGoogleClientId(""));
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
      width: 320,
      text: "continue_with"
    });
  }

  useEffect(() => {
    if (googleLoaded && googleClientId) setupGoogle();
  // setupGoogle intentionally depends on the loaded Google SDK and dynamic client ID.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId, googleLoaded]);

  return (
    <section className="auth-panel">
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" onLoad={() => setGoogleLoaded(true)} />
      <span>Secure sign in</span>
      <h2>Access DropX Recruitment</h2>
      <p>Use your registered mobile number first. Your OTP will arrive through DropX WhatsApp.</p>
      <label>Mobile number</label>
      <div className="mobile-field"><b>+91</b><input value={mobile} onChange={(event) => setMobile(event.target.value)} disabled={busy || !!challengeId} inputMode="numeric" /></div>
      {challengeId ? (
        <>
          <label>WhatsApp OTP</label>
          <input className="otp-field" value={otp} onChange={(event) => setOtp(event.target.value)} maxLength={6} inputMode="numeric" />
          <button className="primary" onClick={verifyOtp} disabled={busy}>Verify and sign in</button>
        </>
      ) : <button className="primary" onClick={requestOtp} disabled={busy}>Send WhatsApp OTP</button>}
      <div className="or"><i /><em>or</em><i /></div>
      <div className="google-button" ref={googleButton} aria-label="Continue with Google" />
      {message ? <small className="auth-message">{message}</small> : null}
      <a className="android-download" href="/downloads/dropx-recruitment-android.apk?v=131" download>
        Download DropX Recruitment for Android 64-bit · v1.4.1 (build 131)
      </a>
    </section>
  );
}
