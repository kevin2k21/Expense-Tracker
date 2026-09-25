# Contributing

## Local setup

Install Node.js 22.11 or later, JDK 17 or later, and the Android SDK described
in the README. Then run:

```sh
npm ci
npm test -- --runInBand
npx tsc --noEmit
npm run lint -- --max-warnings=0
npm run check:public
cd android && ./gradlew lintRelease assembleDebug
```

## Privacy requirements

Use only synthetic fixtures. Never commit real SMS messages, names, phone
numbers, UPI handles, account or card digits, balances, transaction references,
database files, screenshots, local paths, or signing credentials. Use labels
such as `SAMPLE PERSON`, masked account `XX4242`, and synthetic references in
the `900000000000` range.

## Parser changes

The parser boundary is documented in the README. Implement
`TransactionSmsParser`, select it in `src/features/sms/parserConfig.ts`, and
change the parser version whenever behavior changes. Add positive and negative
fixtures for every new format.

## Pull requests

Keep changes focused, explain privacy or permission changes, and ensure every
check above passes. Security reports must follow `SECURITY.md` rather than a
public issue. Reviewed Android lint warnings are documented in
`docs/android-lint.md`; do not use a baseline to hide new errors.
