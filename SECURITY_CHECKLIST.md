# Weekly Security Checklist

Run through this list every week to keep your bot secure.

---

## Quick Checks (2 minutes)

- [ ] **Bot is running:** `pm2 status` shows `claude-telegram-relay` as online
- [ ] **No crashes:** `pm2 logs --lines 20` shows no repeated error messages
- [ ] **User ID enforced:** `.env` still has `TELEGRAM_USER_ID` set to your ID (7813177139)
- [ ] **.env not committed:** Run `git status` and confirm `.env` does not appear in tracked files
- [ ] **No unknown files staged:** Run `git diff --cached` to check nothing unexpected is staged

## Monthly Checks (10 minutes)

- [ ] **Rotate API keys** if you suspect any exposure:
  - Telegram bot token (revoke via @BotFather, generate new)
  - Supabase anon key (Project Settings > API)
  - Groq API key (console.groq.com)
  - Supabase access token (supabase.com/dashboard/account/tokens)
- [ ] **Update dependencies:** `bun update` and check for breaking changes
- [ ] **Check Supabase logs:** Dashboard > Logs for any unauthorized access attempts
- [ ] **Review Edge Function invocations:** Dashboard > Edge Functions for unexpected call patterns
- [ ] **Verify BitLocker:** Run `manage-bde -status` in an admin PowerShell to confirm disk encryption

## After Any Code Change

- [ ] Run `git diff` before committing to review for accidentally added secrets
- [ ] Confirm `.env` and `config/profile.md` are still in `.gitignore`
- [ ] Restart the relay: `pm2 restart claude-telegram-relay`

## If You Suspect a Breach

1. **Immediately revoke** all API keys listed above
2. Stop the bot: `pm2 stop claude-telegram-relay`
3. Check Supabase logs for unauthorized reads
4. Check `git log` for unexpected commits
5. Generate new keys and update `.env`
6. Restart the bot after confirming the source of the breach

## Environment Hardening Reminders

- [ ] BitLocker is enabled on your Windows 11 machine
- [ ] `.env` is excluded from OneDrive / cloud sync
- [ ] Your WiFi network uses WPA3 or WPA2 with a strong password
- [ ] Windows Defender is active and up to date
- [ ] Your Supabase project is not shared with other users
