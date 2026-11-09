# Local folder archives — VPS Sentry Actions

## Purpose and boundary

The **Local Mac** archiver is deliberately **browser-only**. Choose an exact folder, inspect its displayed name/file count/logical size, select ZIP (recommended for court and document collections), TGZ (Unix backup), or Both, and click **Create archive**. Download the resulting archive and its SHA-256 sidecar. Nothing in this local workflow is sent to a VPS Sentry API, a third-party compressor, or cloud storage by this tool.

This fixes the former "Local MBP" mode, which only emitted a terminal command and asked for an absolute macOS path. Browser folder handles do **not** disclose local absolute paths. The Terminal backup is now optional under **Advanced**.

The independently protected **Server (VPS)** workflow is unchanged: it accepts allowlisted VPS paths, requires an ops role, and executes the server-side archiver. It cannot see the Mac.

## Evidence-preservation behaviour

- Archive paths include the selected folder as the top-level directory. Nested directories and file bytes are retained; names and modification dates are included.
- Files are read completely before creating archives. If iCloud hydration, access, or a file-read operation fails, creation fails closed instead of silently omitting documents.
- No ordinary file is excluded by an engineering/source-code ignore list. In particular, legal PDF, email, pages, archives, and spreadsheets remain included.
- ZIP and TGZ are locally generated with a per-archive SHA-256 companion.
- The browser cannot preserve empty directories or all macOS extended attributes, ownership, symlinks, and resource forks. Use a native forensic copy if those attributes become material; the web archiver is a convenient document bundle, **not** a forensically exact disk image.
- The client protects against accidental selection of Desktop/Documents/Downloads and limits use to 10,000 files and 512 MiB logical content. For larger archives use the advanced Terminal fallback or dedicated archival tooling.

## Verification

With the resulting archive and sidecar in the same folder:

```bash
cd "$HOME/Downloads"
shasum -a 256 -c IES-YYYYMMDD-HHmmss.zip.sha256
unzip -t IES-YYYYMMDD-HHmmss.zip
```

For TGZ, replace unzip with `tar -tzf archive.tgz`.

## Source selection

Finder's Get Info **Where** field shows the *parent directory*, not the selected folder itself. For example:

- Parent: `/Users/yourname/Library/Mobile Documents/com~apple~CloudDocs/Desktop`
- Selected folder: `/Users/yourname/Library/Mobile Documents/com~apple~CloudDocs/Desktop/IES`

Choose **IES** directly in the browser. The manual path in Advanced is for **Terminal fallback only** and is intentionally not derived from the browser picker.

## Implementation / tests

- UI: `src/app/actions/ArchiveFolderCard.tsx`
- ZIP/TGZ helper: `src/lib/archive/browser-archive.ts`
- Validation/format tests: `src/__tests__/browser-archive.test.ts`
- Compression implementation: `fflate`, bundled into the client build. No remote archive service.
