# Recruit identity and sign-in

## Brand boundary

The existing `public/dropx-logo.png` is unchanged. `RecruitBrand` places the original company logo beside a divider and a separate Recruit product mark/wordmark. Corporate website, offer letters and the existing native Android APK retain their existing branding. No authentication APIs, session permissions or database settings change.

The Recruit mark combines a person, an open doorway and an `r` silhouette. Brand colours remain raspberry and amber. It appears in the desktop/mobile sidebar, sign-in and session-loading views, browser tab icons, and web home-screen icons.

## Sign-in design

- Business-focused introduction: “The people behind every delivery.”
- Covers delivery associates, operations teams and corporate talent, without fabricated metrics or candidate records.
- Separate responsive sign-in area; WhatsApp OTP and the official Google-rendered control use the existing endpoints and token storage.
- Labels, autocomplete, submit-on-Enter, pending states, accessible messages and a change-number control.
- Small screens prioritise the brand and sign-in form; no marketing panel ahead of the form.
- The Android download points to the same existing APK; this is not a native-app release.

## Image provenance

Generated with the built-in image-generation tool (not the API/CLI fallback). Only the separate Recruit symbol is used; earlier concepts that altered the DropX logo were discarded after the user's clarification.

Final prompt: “Create one exceptionally clean classy original square app symbol for RECRUIT, a business hiring portal for a logistics company. SYMBOL ONLY, no text, no wordmark, not a DropX company logo and no map pin. Concept: a geometric lowercase r / doorway with a single circular head above it, elegantly combining a person and an open door to opportunity. The silhouette should feel like a distinctive modern R monogram, not a generic user icon: a bold raspberry upright with rounded arch opening toward right, a circular amber head hovering just above its top-left, one subtle forward diagonal cut at the right base. Only two solid colors: raspberry #D4275A and amber #F5A800. No outline border or enclosing square, no gradients, no texture, no shadows. Perfect flat vector-style geometry, smooth exact edges, purposeful beautiful proportions and balanced negative space; strong at 16px. Genuine transparent background. Single centered symbol occupies about 75% of square canvas. Enterprise SaaS recruiting product mark, understated and memorable. Do not include letters as text or any unrelated ornaments.”

Production files: `public/brand/recruit-symbol-v1.png` and `public/brand/recruit-icon-{32,64,180,192,512}-v1.png`. Image sizes are generated mechanically from the selected master; the original DropX image is never regenerated or overwritten.

## Verification

- Brand/sign-in rendering and manifest icon-dimension tests.
- Existing mobile-auth tests and TypeScript checks.
- Desktop and mobile browser checks, keyboard/form validation and accessible labels.
- OTP challenge/error/change-number paths tested against local mocked responses only; no real OTP or real login submitted.
- Check the deployed public Google control and production icon URLs after release.
