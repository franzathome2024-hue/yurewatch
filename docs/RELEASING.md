# Releasing YureWatch

How releases are built, signed, verified and published — and what users can
expect when updating.

## Versioning

One version, two carriers that must agree:

- `package.json` → `version` (shown in the app UI via `__APP_VERSION__`)
- `android/app/AndroidManifest.xml` → `versionName` (shown by Android) and
  `versionCode` (must **increase** with every release or Android refuses
  the update)

CI enforces `package.json version == versionName`
("Assert version consistency" in `.github/workflows/web.yml`). Bumping
`versionCode` remains a manual step in the same commit as the version bump.

## Android signing strategy

Android only installs an update over an existing app when the signing
certificate is identical. That makes the signing key part of the app's
identity — losing it means every user must uninstall/reinstall.

| Build | Key | Installs over previous? |
| --- | --- | --- |
| Tagged release (`v*`) | **Project release key** (repository secrets) | Yes — over any earlier release-key build |
| Branch / PR CI artefact | Throwaway key generated on the runner | No — smoke-test artefact; publishable only on an explicitly labelled pre-release (see *Pre-releases* below) |
| v0.4.0 and earlier releases | Ephemeral CI key (historical) | No — one-time uninstall required (see Migration in `CHANGELOG.md`) |

Rules, enforced by `.github/workflows/android.yml`:

1. A **tag build without the key secrets fails the build** — it must never
   silently fall back to an ephemeral key and strand installed users.
2. The key is decoded into `$RUNNER_TEMP` for the job only; it is never
   committed (`android/keystore/` and `*.jks` are git-ignored) and never
   leaves the runner.
3. Non-tag builds may use the throwaway key so contributors get a runnable
   artefact without access to secrets.

### Pre-releases

Rule 1 governs **full releases**. There is exactly one exception, made so
testers can run real builds before the project release key exists:

- A branch-CI (throwaway-key) APK may be attached to a GitHub release only
  when that release is flagged **Pre-release**, the tag is the commit the
  artefact was built from, and the release notes state plainly that the APK
  is **not signed with the project release key**, so it cannot be installed
  as an update over any other build (including v0.4.0 and earlier) and
  later release-key builds cannot update over it — uninstall first, in
  both directions. `SHA256SUMS` must be attached so the download can be
  verified exactly like a full release.
- Cutting the `v*` tag for such a pre-release still triggers the tag
  pipeline, whose signing-key step fails until the secrets are configured.
  That failure is Rule 1 working as intended — the pre-release APK comes
  from the branch CI artefact of the same commit, not from the tag build.
- The moment the release key is set up, this exception is moot: tag builds
  produce release-key-signed APKs, and a pre-release is just an early
  signed build. Never present a throwaway-key build as a stable release.

### Setting up the release key (one time, repository owner)

```bash
# Generate the key (use a strong, unique password; RSA 4096, long validity)
keytool -genkeypair -v -keystore yurewatch-release.jks \
  -alias yurewatch -keyalg RSA -keysize 4096 -validity 10000

# Add to the repository (Settings → Secrets and variables → Actions), or:
base64 -w0 yurewatch-release.jks   # → secret ANDROID_KEYSTORE_BASE64
#   ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
```

**Back the keystore and its passwords up outside GitHub** (password manager
or offline media, two copies). If they are lost, no future build can ever
update an installed copy of the app. Treat the key as compromised if it
leaks: there is no rotation path for a sideloaded app other than a new
package name.

## Checksums

Every CI build writes `SHA256SUMS` (bare filename) next to the APK and
verifies it in the same job (`sha256sum --check`). Both files are attached
to the GitHub Release. Users verify a download with:

```bash
sha256sum -c SHA256SUMS        # expects: yurewatch-X.Y.Z.apk: OK
```

The published v0.4.0 checksum (`6a334093…2afac3`) was independently
re-verified against the release asset during the Milestone 6 audit.

## Workflow independence

Three workflows, three triggers, no shared jobs — each can fail alone:

| Workflow | Triggers | Publishes |
| --- | --- | --- |
| `web.yml` | push to `main`, PRs, manual | Nothing (test/map-QA gates + artefacts) |
| `android.yml` | push to `main`, tags `v*`, PRs, manual | APK artefact; release assets **only on tags** |
| `pages.yml` | push to `main`, manual — **never tags** | GitHub Pages site |

Consequences: a Pages failure cannot block or corrupt an APK release (a tag
push does not even start `pages.yml`); an Android failure cannot take the
website down; a web-test failure blocks neither publisher (it gates merges,
not deployments).

## Reproducible builds

- **Web bundle:** deterministic. Two consecutive local builds are
  byte-identical (SHA-256 `296ba7ca…` for v0.4.0), and the file extracted
  from the published APK is byte-identical to a local build of the tag.
- **APK:** same inputs + same signing key produce the same APK
  (`zipalign` + APK Signature Scheme v2 are deterministic). Differences to
  expect between a local and a CI build: the signing certificate (until the
  release key is used in both places), and toolchain patch versions
  (CI pins Temurin JDK 21, build-tools 35.0.0, Node 20; a local build uses
  whatever `build-apk.sh` finds). The exact tree is always recoverable from
  the tag.

## Release checklist

1. Bump `package.json` version, `versionName`, and `versionCode` together.
2. Move `CHANGELOG.md` "Unreleased" notes into a new version section
   (user-facing changes, known limitations, migration notes).
3. Regenerate screenshots if the UI changed
   (`npm run build && node tools/screenshots.mjs`) and keep
   `docs/screenshots/README.md` accurate.
4. Confirm CI is green on `main` (web, Android, Pages).
5. Tag `vX.Y.Z` and push the tag. The Android workflow builds, signs with
   the release key, verifies the checksum, and attaches APK + `SHA256SUMS`
   to the release.
6. Download the published APK, run `sha256sum -c SHA256SUMS`, and
   smoke-install it over the previous release on a device.
