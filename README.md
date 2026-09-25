# SpendLocal

SpendLocal is a local-first expense tracker for Android. It captures transaction
SMS messages and selected payment-app notifications, parses them on the device,
and stores the resulting ledger in a SQLCipher-encrypted SQLite database.

The repository includes a working sample parser for common Indian bank and card
alerts. Fork owners can replace that parser without changing the Android SMS
receiver, queue, importer, or database.

> **Platform status:** the transaction-capture workflow is Android-first. The
> iOS project is a React Native scaffold; iOS does not expose an equivalent SMS
> inbox or SMS-receiver API.

## What is included

- Automatic Android SMS capture and a 90-day inbox import
- Optional notification capture from selected payment and banking apps
- A durable encrypted native queue for messages received while JavaScript is unavailable
- A replaceable TypeScript parser with confidence scoring
- SQLCipher-backed on-device storage protected by an Android Keystore-wrapped key
- Transaction review, search, categories, manual entries, and duplicate handling
- Budgets, income selection, savings goals, recurring items, and spending insights
- Shared expenses, repayments, cash-flow views, and per-account minimum balances
- No backend, cloud account, analytics SDK, advertising SDK, or release-manifest internet permission

## Data flow

```text
Bank or card sends an SMS
        |
        v
Android TransactionSmsReceiver
        |
        v
Encrypted pending queue
        |
        v
Selected TypeScript parser
        |
        v
ParsedTransaction or null
        |
        v
Encrypted local transaction database
```

Raw SMS text is not inserted directly into the ledger. Only a successful
`ParsedTransaction` is persisted as a transaction record. A parser returning
`null` ignores the message; a parser throwing an error leaves it queued for a
later retry.

## Fork and run

### 1. Fork and clone

Use GitHub's **Fork** button, then clone your fork:

```sh
git clone https://github.com/YOUR-USERNAME/YOUR-FORK.git
cd YOUR-FORK
```

### 2. Install the prerequisites

You need:

- Node.js 22.11 or newer
- npm
- JDK 17 or newer
- Android Studio and Android SDK Platform 37
- Android SDK Build Tools 37.0.0
- An Android emulator with telephony support or a physical Android phone

Let Android Studio create `android/local.properties`, or configure
`ANDROID_HOME`/`ANDROID_SDK_ROOT` for your shell. `local.properties` contains a
machine-specific SDK path and is intentionally ignored by Git.

### 3. Install dependencies

```sh
npm ci
```

### 4. Connect a phone or start an emulator

For a physical phone:

1. Enable **Developer options** and **USB debugging** on the phone.
2. Connect it by USB and accept the debugging prompt.
3. Confirm that ADB can see it:

```sh
adb devices
```

### 5. Run the development build

From the repository root:

```sh
npm run android
```

This builds and installs the debug app and starts Metro. A fresh clone uses
Android's generated debug key automatically. If `android/app/debug.keystore`
already exists locally, the build uses it so that upgrades signed by that key
can preserve existing app data. The file is ignored and must never be committed.

### 6. Complete first-run setup

Open the app and:

1. Allow SMS access when prompted.
2. Use **Settings → Import last 90 days** if you want to import existing alerts.
3. Optionally open **Settings → Transaction alerts → Notification access** and
   enable only the payment or banking apps you trust.
4. Choose a primary account and configure budgets or minimum balances as needed.

An emulator SMS can be tested with synthetic data:

```sh
adb emu sms send HDFCBK "Rs.850.00 debited from A/c XX1204 at SAMPLE CAFE. Avl Bal: Rs.24,350.00"
```

## Replace the SMS parser

Parser integration is intentionally limited to three files:

- `src/features/sms/parserContract.ts` defines the stable interface.
- `src/features/sms/parser.ts` is the bundled sample implementation.
- `src/features/sms/parserConfig.ts` selects the parser used by the app.

A parser receives:

```ts
type PendingSms = {
  id: string;
  sender: string;
  body: string;
  receivedAt: number;
};
```

It must synchronously return a normalized `ParsedTransaction` or `null`:

```ts
type ParsedTransaction = {
  amountMinor: number;
  kind: 'debit' | 'credit' | 'refund' | 'fee' | 'withdrawal' | 'transfer';
  merchant: string;
  category: string;
  accountLastFour: string | null;
  reportedBalanceMinor: number | null;
  occurredAt: number;
  confidence: number;
  referenceId?: string | null;
};
```

To install your own parser:

1. Create a module implementing `TransactionSmsParser`.
2. Add synthetic positive and negative fixtures under `__tests__/`.
3. Import it in `src/features/sms/parserConfig.ts`.
4. Replace only the `parse` value.
5. Change `version` to a new stable value whenever parsing behavior changes.

For example:

```ts
import type { SmsParserConfig } from './parserContract';
import { parseTransactionSms as myParser } from './myParser';

export const smsParserConfig = {
  version: 'my-parser-v1',
  parse: myParser,
} satisfies SmsParserConfig;
```

Changing the version tells the importer to safely revisit recent messages so a
new parser can repair earlier results. Keep parsing deterministic and on-device;
do not send SMS contents to a network service.

## Build a standalone APK for regular use

Debug builds depend on Metro during development. For an app that continues to
work after disconnecting the computer, build and sign a release APK.

### 1. Create a private signing key

Do this once, outside the repository:

```sh
keytool -genkeypair -v \
  -keystore /secure/private/path/spendlocal-release.jks \
  -alias spendlocal \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Back up this keystore and its passwords securely. Android updates preserve app
data only when every version uses the same application ID and signing key.

### 2. Build the unsigned release APK

```sh
cd android
./gradlew assembleRelease
```

The output is:

```text
android/app/build/outputs/apk/release/app-release-unsigned.apk
```

### 3. Sign and verify it

From the `android` directory, adjust the build-tools version or key path if
needed:

```sh
"$ANDROID_HOME/build-tools/37.0.0/apksigner" sign \
  --ks /secure/private/path/spendlocal-release.jks \
  --ks-key-alias spendlocal \
  --out app/build/outputs/apk/release/app-release-local.apk \
  app/build/outputs/apk/release/app-release-unsigned.apk

"$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --verbose \
  app/build/outputs/apk/release/app-release-local.apk
```

`apksigner` securely prompts for passwords when they are not supplied on the
command line.

### 4. Install it

```sh
adb install -r app/build/outputs/apk/release/app-release-local.apk
```

After installation, the release app works without Metro or a connected
computer.

> **Signing warning:** `INSTALL_FAILED_UPDATE_INCOMPATIBLE` means the installed
> app was signed by a different key. Do not uninstall if you need its local
> data. Rebuild with the original key instead. Uninstalling erases the app's
> ledger because Android backup and device transfer are deliberately disabled.

## Rename a fork

Before distributing your fork, use identifiers that you control:

- Change `applicationId` and `namespace` in `android/app/build.gradle`.
- Move the Kotlin package directory and update its `package` declarations.
- Change the app label in `android/app/src/main/res/values/strings.xml`.
- Update `app.json` if you rename the React Native module.
- Set your own iOS bundle identifier and signing team if you maintain the iOS scaffold.

Changing the Android application ID installs a separate app and cannot access
data created under `com.spendlocal`.

## Verification

Run the same checks used by CI:

```sh
npm run check:public
npx tsc --noEmit
npm run lint -- --max-warnings=0
npm test -- --runInBand
cd android && ./gradlew --no-daemon lintRelease assembleDebug
```

The GitHub Actions workflow also runs Gitleaks and dependency review. Before
committing, make sure real SMS messages, screenshots, databases, signing keys,
account details, and local configuration files are not staged.

## Privacy and security

- Processing and storage are local to the device.
- The release Android manifest has no internet permission.
- The ledger is encrypted with SQLCipher.
- Pending SMS and notification contents are encrypted with AES-GCM using a
  non-exportable Android Keystore key.
- Processed queue entries are removed and stale entries are discarded.
- Android backup and device transfer exclude application data.
- Release signing keys and passwords must remain outside the repository.

SMS permissions are restricted by Google Play policy. Public Play Store
distribution requires approval or a qualifying policy exception; a locally
installed APK does not bypass Android's runtime permission prompts.

Use only synthetic data in tests and bug reports. See
[CONTRIBUTING.md](CONTRIBUTING.md) for fixture rules and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Troubleshooting

### The debug APK needs Metro

That is expected. Use the signed release instructions above for a standalone
phone installation.

### SMS messages are not appearing

- Confirm SMS permission is enabled in Android settings.
- Open the app once after installing or after manually force-stopping it.
- Use the 90-day importer for messages received before installation.
- Check the app's capture-health section in Settings.
- Confirm that your parser recognizes the sender and message format.

### The expected release APK filename does not exist

Public source builds are intentionally unsigned. Gradle creates
`app-release-unsigned.apk`; sign it to produce `app-release-local.apk`.

### A build cannot find the Android SDK

Open the Android project in Android Studio once, or configure
`ANDROID_HOME`/`ANDROID_SDK_ROOT`. Never commit `android/local.properties`.

### A new parser does not reprocess recent messages

Change the `version` value in `src/features/sms/parserConfig.ts`. Do not use a
random or time-based version; keep it stable until parser behavior changes.

## Contributing and license

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), keep fixtures
synthetic, and run the verification commands before opening a pull request.

SpendLocal is available under the [MIT License](LICENSE).
