# Security policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this
repository. Do not include SMS contents, account identifiers, transaction
references, database files, screenshots, or signing material in a public
issue.

Include the affected version, platform, reproduction steps using synthetic
data, and the expected security impact. Maintainers should acknowledge a
report within seven days and coordinate disclosure after a fix is available.

## Sensitive data model

SpendLocal processes financial notifications locally. The transaction ledger
uses SQLCipher. Raw SMS and notification text in the short-lived native capture
queues is encrypted with an Android Keystore-backed AES-GCM key. Android backup
and device-transfer rules exclude application data.

Release signing keys must never be committed. Public source builds are
unsigned; distributors are responsible for securely configuring their own
release signing process.
