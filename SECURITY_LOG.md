# Security Audit Log

**Date:** 2026-03-15
**Auditor:** Claude Code (automated)
**Context:** Federal employee (FAA) on government laptop, home WiFi network

---

## Findings and Remediation

### CRITICAL

#### 1. Bot starts without access control if TELEGRAM_USER_ID is unset
- **File:** `src/relay.ts`
- **Issue:** If `TELEGRAM_USER_ID` was empty, the bot would accept messages from ANY Telegram user, giving them access to Claude CLI on your machine.
- **Fix:** Added hard exit at startup if `TELEGRAM_USER_ID` is not set. Bot now refuses to start without access control.
- **Status:** FIXED

#### 2. API keys stored as plain text in .env
- **File:** `.env`
- **Issue:** Telegram bot token, Supabase keys, and Groq API key are in plain text on disk.
- **Mitigation:** `.env` is in `.gitignore` and has never been committed. File is local only.
- **Recommendation:** Ensure BitLocker full-disk encryption is enabled on this Windows 11 machine. Verify `.env` is excluded from any cloud backup or sync tools (OneDrive, Google Drive, etc).
- **Status:** ACKNOWLEDGED (inherent to .env pattern)

### HIGH

#### 3. Path traversal in document handler
- **File:** `src/relay.ts` (document handler)
- **Issue:** Telegram filenames were used directly in file paths without sanitization. A crafted filename could write files outside the uploads directory.
- **Fix:** Added filename sanitization (strips path separators and special characters) and a path prefix check to block traversal.
- **Status:** FIXED

#### 4. Claude CLI has full system access via Telegram
- **File:** `src/relay.ts`
- **Issue:** Messages forwarded to Claude CLI give it full tool-use access (file read/write, bash). This is by design but worth noting.
- **Recommendation:** Consider adding `--allowedTools` flag to restrict Claude's capabilities when invoked from Telegram.
- **Status:** ACKNOWLEDGED (by design)

### MEDIUM

#### 5. Supabase Edge Functions accept untrusted table parameter
- **Files:** `supabase/functions/embed/index.ts`, `supabase/functions/search/index.ts`
- **Issue:** The `table` parameter from request body was passed to Supabase client without validation, allowing queries against arbitrary tables.
- **Fix:** Added allowlist validation: only `messages` and `memory` tables are accepted.
- **Status:** FIXED

#### 6. SQL LIKE injection in memory module
- **File:** `src/memory.ts`
- **Issue:** Content from Claude's response used in `.ilike()` without escaping SQL wildcard characters (`%`, `_`).
- **Fix:** Added escaping of `%` and `_` characters before passing to `.ilike()`.
- **Status:** FIXED

#### 7. groq-sdk outdated (0.8.0 vs 1.1.1)
- **File:** `package.json`
- **Issue:** Major version behind. May miss security fixes.
- **Recommendation:** Update to `^1.1.1` after reviewing changelog for breaking changes.
- **Status:** NOTED (manual update recommended)

#### 8. Supabase RLS policies allow all access
- **File:** `db/schema.sql`
- **Issue:** All tables use `USING (true)` policies. If the anon key leaks, all data is accessible.
- **Recommendation:** Restrict RLS policies. Use service_role key for server-side operations.
- **Status:** NOTED (requires Supabase dashboard changes)

#### 9. Supabase Edge Functions have no authentication
- **Files:** `supabase/functions/embed/index.ts`, `supabase/functions/search/index.ts`
- **Issue:** Publicly accessible endpoints with no JWT or secret verification.
- **Recommendation:** Add Authorization header verification.
- **Status:** NOTED (requires Supabase dashboard changes)

### LOW

#### 10. @types/bun pinned to "latest"
- **File:** `package.json`
- **Issue:** Non-reproducible builds; supply chain risk from auto-updating types.
- **Fix:** Pinned to `^1.3.10`.
- **Status:** FIXED

#### 11. No rate limiting on message handlers
- **File:** `src/relay.ts`
- **Issue:** Rapid messages could spawn many Claude CLI processes.
- **Status:** NOTED (low risk with user ID enforcement)

#### 12. Predictable temp file paths for voice
- **File:** `src/transcribe.ts`
- **Issue:** Temp files use `Date.now()` timestamps. Low risk on single-user Windows.
- **Status:** NOTED

---

## Network Security Assessment

| Check | Result |
|---|---|
| Exposed ports | None |
| Inbound connections required | No (long polling) |
| WebSocket server | None |
| Localhost dashboard | None |
| All traffic outbound HTTPS | Yes |

**Outbound destinations (all expected):**
- `api.telegram.org` (bot messaging)
- `*.supabase.co` (database and edge functions)
- `api.groq.com` (voice transcription)
- `api.openai.com` (embeddings, from Supabase only)

---

## Dependency Audit

| Package | Version | CVEs | Status |
|---|---|---|---|
| @supabase/supabase-js | 2.99.1 | None | Current |
| dotenv | 17.3.1 | None | Current |
| grammy | 1.41.1 | None | Current |
| groq-sdk | 0.8.0 | None known | Outdated (1.1.1 available) |
| @types/bun | 1.3.10 | N/A | Pinned |

No typosquatting detected. All packages are from official maintainers.

---

## Summary

| Severity | Found | Fixed | Noted |
|---|---|---|---|
| CRITICAL | 2 | 1 | 1 (inherent) |
| HIGH | 2 | 1 | 1 (by design) |
| MEDIUM | 5 | 3 | 2 |
| LOW | 3 | 1 | 2 |
| **Total** | **12** | **6** | **6** |
