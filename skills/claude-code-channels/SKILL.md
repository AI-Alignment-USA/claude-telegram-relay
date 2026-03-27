---
name: claude-code-channel-setup
description: >
  Set up Claude Code and Claude Code Channels on any operating system and messaging platform.
  Use this skill whenever someone asks to install Claude Code, set up Claude Code on Windows,
  Mac, or Linux, connect Claude Code to Telegram, Discord, or iMessage, configure Claude Code
  Channels, troubleshoot Claude Code installation, set up WSL for Claude Code, or get Claude Code
  running on a new machine. Also trigger when someone mentions "Claude Code setup", "install claude",
  "claude code windows", "claude code mac", "claude code linux", "claude code telegram",
  "claude code discord", "claude code channels", "claude code imessage", "--channels flag",
  "MCP channel plugin", or any reference to getting Claude Code installed and connected to
  messaging apps. Covers the full setup from system requirements through authentication,
  Channels plugin installation, bot creation, and persistent session configuration.
  Trigger on: "install claude code", "set up claude code", "claude code on windows",
  "claude code channels", "connect claude code to telegram", "claude code discord",
  "claude code setup", "claude --channels", or any reference to Claude Code installation
  or messaging app integration.
---

# Claude Code Channel Setup

## Overview

This skill walks through the complete setup of Claude Code on any operating system, and optionally connects it to messaging platforms (Telegram, Discord, iMessage) via Claude Code Channels. Channels turn Claude Code into a persistent assistant you can message from your phone while the session runs on your local machine.

**Always research the latest docs before running this skill.** Claude Code is actively developed and installation methods change. Check:
- https://code.claude.com/docs/en/setup (installation)
- https://code.claude.com/docs/en/channels (channels)
- https://github.com/anthropics/claude-code (releases)

---

## System Requirements (All Platforms)

- **Internet connection** required (all AI processing happens on Anthropic's servers)
- **RAM:** 4GB minimum, 8GB recommended for larger codebases
- **Account:** Claude Pro ($20/mo), Claude Max ($100-200/mo), Teams, Enterprise, or Anthropic Console with API credits. The free Claude.ai plan does NOT include Claude Code access
- **Shell:** Bash, Zsh, PowerShell, or CMD
- **No GPU required** -- your machine only runs the CLI client

---

## Installation by Operating System

### Windows (Native -- Recommended)

As of 2026, Claude Code runs natively on Windows 10 (version 1809+) and Windows 11 without WSL. Git for Windows is the only prerequisite.

**Step 1: Install Git for Windows**

Download from https://git-scm.com/download/win and install with default settings. Make sure "Add Git to PATH" stays checked (it is by default). Git for Windows includes Git Bash, which Claude Code uses internally to run commands.

**Step 2: Install Claude Code**

Open PowerShell (you do NOT need to run as Administrator) and run:

```powershell
irm https://claude.ai/install.ps1 | iex
```

Alternative via Windows CMD:

```cmd
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

Alternative via WinGet (does NOT auto-update):

```powershell
winget install Anthropic.ClaudeCode
```

**Step 3: Close and reopen your terminal**

This is required so your shell picks up the new PATH entry. The installer places the binary in `%USERPROFILE%\.local\bin`.

**Step 4: Verify installation**

```powershell
claude --version
```

If you see "claude is not recognized as a cmdlet," the PATH wasn't set. Fix it:

```powershell
[Environment]::SetEnvironmentVariable("PATH", "$env:PATH;$env:USERPROFILE\.local\bin", [EnvironmentVariableTarget]::User)
$env:PATH = "$env:PATH;$env:USERPROFILE\.local\bin"
```

**Step 5: Authenticate**

```powershell
claude
```

This opens a browser window. Sign in with your Anthropic account. The auth token saves to `~\.claude\session.json` and persists across sessions.

**Step 6: Run diagnostics**

```powershell
claude doctor
```

This auto-detects most configuration issues and suggests fixes.

#### Windows Notes

- Claude Code uses Git Bash internally even when launched from PowerShell or CMD
- PowerShell native execution is available as an opt-in preview
- If Claude Code can't find Git Bash, set the path in your `settings.json`
- You do NOT need Administrator privileges for installation
- Native installations auto-update in the background
- WinGet installations require manual updates: `winget upgrade Anthropic.ClaudeCode`
- Image paste: use ALT+V (not Ctrl+V) to paste images from clipboard. Ctrl+V only pastes text

### Windows (WSL Alternative)

Use WSL if you want sandboxing (WSL 2 only), Docker integration, or prefer a Linux environment. Not required for basic Claude Code usage.

**Step 1: Install WSL**

Open PowerShell as Administrator:

```powershell
wsl --install
```

This installs WSL and Ubuntu by default. Reboot when prompted.

**Step 2: Set up Ubuntu**

Open Ubuntu from the Start menu. Create a username and password (separate from your Windows credentials).

**Step 3: Install Claude Code inside WSL**

In the Ubuntu terminal:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Step 4: Reload shell and verify**

```bash
source ~/.bashrc
claude --version
```

**Performance tip:** Store projects inside the Linux filesystem (`~/projects/`) rather than on mounted Windows drives (`/mnt/c/`). File operations are noticeably faster.

**WSL Notes:**
- WSL 2 supports sandboxing for enhanced security. WSL 1 does not
- Both WSL 1 and WSL 2 are supported
- To connect VS Code to WSL: run `code .` from the WSL terminal, or use the Remote WSL extension

### macOS

Supports both Apple Silicon (M1/M2/M3/M4) and Intel. Requires macOS 13.0 (Ventura) or later.

**Option A: Native installer (recommended)**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Auto-updates in the background. No dependencies required.

**Option B: Homebrew**

```bash
brew install --cask claude-code
```

Does NOT auto-update. Run `brew upgrade claude-code` periodically.

**Option C: Desktop app**

Download the Desktop app from Anthropic's website for a graphical interface without the terminal.

**After installation:**

```bash
claude --version
claude
```

Follow the browser authentication prompt on first run.

### Linux

Supports Ubuntu 20.04+, Debian 10+, and most modern distributions.

**Native installer:**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Verify:**

```bash
claude --version
```

**Alpine and musl-based distributions:**

The native installer requires additional packages:

```bash
apk add libgcc libstdc++ ripgrep
export USE_BUILTIN_RIPGREP=0
curl -fsSL https://claude.ai/install.sh | bash
```

**npm method (if native installer isn't suitable):**

Requires Node.js 18+.

```bash
# Set up user-level npm directory (prevents sudo issues)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Install
npm install -g @anthropic-ai/claude-code
claude --version
```

NEVER use `sudo npm install -g`. If you get permission errors, use `nvm` instead.

---

## Post-Installation (All Platforms)

### CLAUDE.md Setup

After authenticating, navigate to your project directory and run:

```
/init
```

This auto-generates a `CLAUDE.md` file in your project root. This file gives Claude persistent context about your project: build commands, code conventions, architecture patterns. It is the most important post-install configuration step.

### MCP Server Configuration

Connect Claude Code to external tools and services:

```bash
# Add an HTTP-based MCP server
claude mcp add --transport http notion https://mcp.notion.com/mcp

# Add a local stdio-based MCP server
claude mcp add github -- npx -y @modelcontextprotocol/server-github

# List configured servers
claude mcp list

# Test a specific server
claude mcp get github

# Remove a server
claude mcp remove github
```

### Model Selection

Claude Code uses Claude Opus 4.6 by default. To specify a different model:

```bash
claude --model claude-sonnet-4-6
```

---

## Claude Code Channels Setup

Channels let you message a running Claude Code session from Telegram, Discord, or iMessage. Your session runs locally with full filesystem, MCP, and git access. Messages arrive in real-time and Claude responds through the same app.

**Channels is a research preview as of March 2026.** The protocol and plugin commands may change.

### Channel Prerequisites

Before setting up any channel, verify ALL of these:

1. **Claude Code v2.1.80 or later:** Run `claude --version` and update if needed
2. **Bun runtime installed:** Channel plugins are Bun scripts and will NOT run on Node.js or Deno

```bash
# Check if Bun is installed
bun --version

# Install Bun if needed
curl -fsSL https://bun.sh/install | bash
```

3. **Claude.ai login (not API key):** Channels require browser-based OAuth authentication, not `ANTHROPIC_API_KEY`
4. **Plugin marketplace configured:**

```
/plugin marketplace add anthropics/claude-plugins-official
/plugin marketplace update claude-plugins-official
```

### Important: How Channels Work

- A Channel is an MCP server that pushes events INTO your running Claude Code session
- The channel plugin runs locally on your machine and polls the messaging platform's Bot API
- No inbound ports open on your machine, no webhook endpoints exposed
- Messages only arrive while the session is open. If the session is down, messages are lost
- For always-on operation, run Claude Code inside `tmux` or `screen`

### Critical Gotcha: Permission Prompts

Claude pauses silently on permission prompts. If Claude encounters a file write or command execution requiring approval while you're away from the terminal, the session stops and waits. It does NOT notify you through Telegram or Discord. It does not time out. You cannot approve prompts remotely in the current research preview.

**Workarounds:**
- Configure auto-approve rules for trusted operations before leaving the terminal
- Run inside tmux/screen so you can reconnect and approve if needed
- Accept that some operations may stall until you return

### Test with Fakechat First

Before connecting a real messaging platform, validate the channel architecture works on your machine:

```
/plugin install fakechat@claude-plugins-official
claude --channels plugin:fakechat@claude-plugins-official
```

Fakechat is a localhost demo that confirms the channel plugin flow works. 10 minutes here saves hours debugging Telegram or Discord configuration.

---

### Telegram Channel Setup

**Step 1: Create a Telegram bot**

Open Telegram and message @BotFather:

```
/newbot
```

Give it a display name and a unique username ending in `bot`. Copy the token BotFather returns.

**Step 2: Install the Telegram plugin**

In your Claude Code terminal:

```
/plugin install telegram@claude-plugins-official
```

**Step 3: Configure credentials**

```
/telegram:configure <your-bot-token>
```

**Step 4: Launch with Channels**

```bash
claude --channels plugin:telegram@claude-plugins-official
```

**Step 5: Pair your account**

Open Telegram and DM your new bot. It sends a pairing code. In Claude Code:

```
/telegram:access pair <code>
```

**Step 6: Switch to allowlist mode**

After pairing, switch from "pairing" to "allowlist" mode immediately. Default pairing mode means anyone who messages your bot gets a pairing code reply.

```
/telegram:access mode allowlist
```

**You're connected.** Messages you send to the bot in Telegram are forwarded to your Claude Code session. Claude's responses appear in the same Telegram chat.

#### Telegram Notes

- The bot only sees messages as they arrive in real-time -- no message history access
- If the session was down when a message was sent, that message is gone permanently
- Photos/attachments are downloaded eagerly on arrival (no way to fetch them later)
- DM the bot directly for single-user setups (no server invite step needed)
- For multi-user access, configure the `access.json` policy system

---

### Discord Channel Setup

**Step 1: Create a Discord application**

Go to https://discord.com/developers/applications and click "New Application." Name it.

**Step 2: Create the bot**

In the application settings, go to "Bot" section. Create a username, then click "Reset Token" and copy the token.

**Step 3: Enable Message Content Intent**

This is the step most people miss. In Bot settings, scroll to "Privileged Gateway Intents" and enable **Message Content Intent**. Without this, the bot receives messages but cannot read their contents -- a silent failure.

**Step 4: Generate invite URL**

Go to OAuth2 > URL Generator. Select the `bot` scope and enable these permissions:
- View Channels
- Send Messages
- Send Messages in Threads
- Read Message History
- Attach Files
- Add Reactions

Open the generated URL to add the bot to your server.

**Step 5: Install the Discord plugin**

```
/plugin install discord@claude-plugins-official
```

**Step 6: Configure and launch**

```
/discord:configure <your-bot-token>
claude --channels plugin:discord@claude-plugins-official
```

**Step 7: Pair your account**

Send any message to the bot in Discord. It sends a pairing code. In Claude Code:

```
/discord:access pair <code>
```

Switch to allowlist mode after pairing:

```
/discord:access mode allowlist
```

---

### iMessage Channel Setup

iMessage works differently from Telegram and Discord:
- Texting yourself bypasses the pairing gate automatically
- You add other contacts by handle with `/imessage:access allow`
- macOS only (iMessage requires Apple ecosystem)

```
/plugin install imessage@claude-plugins-official
claude --channels plugin:imessage@claude-plugins-official
```

---

### Running Multiple Channels

You can run multiple channels simultaneously:

```bash
claude --channels plugin:telegram@claude-plugins-official,plugin:discord@claude-plugins-official
```

---

### Persistent Sessions (Always-On)

For Claude Code to receive messages while you're away, the session must stay alive. Use `tmux` or `screen`:

**tmux:**

```bash
tmux new -s claude-session
claude --channels plugin:telegram@claude-plugins-official
# Detach: Ctrl+B then D
# Reattach: tmux attach -t claude-session
```

**screen:**

```bash
screen -S claude-session
claude --channels plugin:telegram@claude-plugins-official
# Detach: Ctrl+A then D
# Reattach: screen -r claude-session
```

For Windows, use Windows Terminal with tabs, or run inside WSL with tmux.

---

### Channel Security Model

Three layers of protection:

1. **Plugin allowlist:** During the research preview, `--channels` only loads Anthropic-approved plugins. Use `--dangerously-load-development-channels` for custom plugins (not recommended for production)
2. **Sender allowlist:** Only user IDs you've explicitly paired and approved can push messages. Everyone else is silently dropped
3. **Permission relay:** Anyone on the allowlist can approve/deny tool use in your session. Only allowlist senders you trust with that authority

**Team and Enterprise:** Channels are off by default. Admins must enable them via managed settings (`channelsEnabled`) before any individual setup works.

---

## Update Management

| Method | Auto-Updates | Update Command |
|--------|-------------|----------------|
| Native installer (all platforms) | Yes, background | Automatic |
| Homebrew (macOS/Linux) | No | `brew upgrade claude-code` |
| WinGet (Windows) | No | `winget upgrade Anthropic.ClaudeCode` |
| npm (legacy) | No | `npm update -g @anthropic-ai/claude-code` |

Native installations check for updates on startup and periodically while running. Updates download in the background and take effect on next launch.

---

## VS Code Integration

Claude Code works alongside VS Code even though it lives in the terminal:

**Native Windows or macOS:**

Open VS Code's integrated terminal (Ctrl+`` ` ``) and run `claude` from there.

**WSL:**

Use the Remote WSL extension. Run `code .` from the WSL terminal to open the current folder in VS Code, then use the integrated terminal for Claude Code.

---

## Migration from npm to Native Installer

If you're currently on the npm version:

```bash
# Install native binary alongside npm version
claude install

# Remove npm version
npm uninstall -g @anthropic-ai/claude-code
```

Settings in `~/.claude/` are preserved during migration.

---

## Quick Reference

| Task | Command |
|------|---------|
| Install (macOS/Linux) | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Install (Windows PowerShell) | `irm https://claude.ai/install.ps1 \| iex` |
| Install (Windows CMD) | `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` |
| Verify | `claude --version` |
| Authenticate | `claude` (first run opens browser) |
| Diagnostics | `claude doctor` |
| Initialize project | `/init` (inside Claude Code) |
| Add MCP server | `claude mcp add --transport http name url` |
| List MCP servers | `claude mcp list` |
| Launch with Telegram | `claude --channels plugin:telegram@claude-plugins-official` |
| Launch with Discord | `claude --channels plugin:discord@claude-plugins-official` |
| Pair sender | `/telegram:access pair <code>` or `/discord:access pair <code>` |
| Lock to allowlist | `/telegram:access mode allowlist` |
