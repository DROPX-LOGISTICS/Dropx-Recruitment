# DropX Recruitment Flutter app

The mobile app authenticates only active records from
`recruitment_mobile_users`. OTPs are delivered using the approved DropX
WhatsApp template and verified by the recruitment backend.

The production API is `https://recruit.dropxlogistics.com`. Mobile number is
the primary login and Google is the fallback.

Release validation:

1. Run `flutter pub get`, `flutter analyze` and `flutter test`.
2. The app loads the production Google web OAuth client ID from
   `/api/auth/config`. `GOOGLE_SERVER_CLIENT_ID` remains an optional build-time
   override for offline or recovery builds.
3. Replace the internal debug signing configuration with the DropX Android
   release keystore before Play Store distribution.
4. Configure the iOS Google URL scheme and DropX signing team before producing
   an App Store archive.
