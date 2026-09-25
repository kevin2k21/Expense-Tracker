# Android lint notes

`./gradlew lintRelease` must finish with zero errors. The remaining warnings
fall into these reviewed categories:

- `PrivateResource` warnings originate in React Native's generated
  `rn_edit_text_material.xml` compatibility drawable. The file is retained
  until React Native removes the workaround.
- `UnusedResources` reports React Native development-server resources that are
  consumed by development tooling rather than application code.
- `UseKtx` findings are style suggestions for framework APIs, not correctness
  or security findings.
- The Gradle wrapper is kept at the version compatible with the repository's
  React Native and Android Gradle plugin versions. Dependency updates are
  proposed by Dependabot and validated by CI before adoption.

Do not add a lint baseline for new errors. New warnings should either be fixed
or explained here.
