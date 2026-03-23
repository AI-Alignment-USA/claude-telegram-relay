// PM2 ecosystem config — all services
module.exports = {
  apps: [
    // ============================================================
    // ALWAYS-ON
    // ============================================================
    {
      name: "command-center",
      script: "dashboard.cjs",
      cwd: __dirname,
      out_file: "logs/command-center.log",
      error_file: "logs/command-center.error.log",
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000,
      windowsHide: true,
    },

    // ============================================================
    // COO BRIEFINGS
    // ============================================================
    {
      name: "coo-morning-briefing",
      script: "coo-morning.cjs",
      cwd: __dirname,
      out_file: "logs/coo-morning-briefing.log",
      error_file: "logs/coo-morning-briefing.error.log",
      autorestart: false,
      cron_restart: "0 5 * * *",
      watch: false,
      windowsHide: true,
    },
    {
      name: "coo-eod-summary",
      script: "coo-eod.cjs",
      cwd: __dirname,
      out_file: "logs/coo-eod-summary.log",
      error_file: "logs/coo-eod-summary.error.log",
      autorestart: false,
      cron_restart: "0 20 * * *",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // MONDAY STANDUP
    // ============================================================
    {
      name: "monday-standup",
      script: "monday-standup.cjs",
      cwd: __dirname,
      out_file: "logs/monday-standup.log",
      error_file: "logs/monday-standup.error.log",
      autorestart: false,
      cron_restart: "30 9 * * 1",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // CFO REPORTS
    // ============================================================
    {
      name: "cfo-daily-report",
      script: "cfo-daily.cjs",
      cwd: __dirname,
      out_file: "logs/cfo-daily-report.log",
      error_file: "logs/cfo-daily-report.error.log",
      autorestart: false,
      cron_restart: "0 5 * * *",
      watch: false,
      windowsHide: true,
    },
    {
      name: "cfo-weekly-report",
      script: "cfo-weekly.cjs",
      cwd: __dirname,
      out_file: "logs/cfo-weekly-report.log",
      error_file: "logs/cfo-weekly-report.error.log",
      autorestart: false,
      cron_restart: "0 19 * * 0",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // EDUCATION
    // ============================================================
    {
      name: "education-digest",
      script: "education-digest.cjs",
      cwd: __dirname,
      out_file: "logs/education-digest.log",
      error_file: "logs/education-digest.error.log",
      autorestart: false,
      cron_restart: "0 19 * * 0",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // HOUSEHOLD
    // ============================================================
    {
      name: "household-reminders",
      script: "household-reminders.cjs",
      cwd: __dirname,
      out_file: "logs/household-reminders.log",
      error_file: "logs/household-reminders.error.log",
      autorestart: false,
      cron_restart: "0 8 * * *",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // NEWS ROOM
    // ============================================================
    {
      name: "newsroom-collect",
      script: "newsroom-collect.cjs",
      cwd: __dirname,
      out_file: "logs/newsroom-collect.log",
      error_file: "logs/newsroom-collect.error.log",
      autorestart: false,
      cron_restart: "0 7,9,11,13,15,17,19,21 * * *",
      watch: false,
      windowsHide: true,
    },
    {
      name: "newsroom-daily-digest",
      script: "newsroom-daily.cjs",
      cwd: __dirname,
      out_file: "logs/newsroom-daily-digest.log",
      error_file: "logs/newsroom-daily-digest.error.log",
      autorestart: false,
      cron_restart: "0 5 * * *",
      watch: false,
      windowsHide: true,
    },
    {
      name: "newsroom-weekly-dive",
      script: "newsroom-weekly.cjs",
      cwd: __dirname,
      out_file: "logs/newsroom-weekly-dive.log",
      error_file: "logs/newsroom-weekly-dive.error.log",
      autorestart: false,
      cron_restart: "0 9 * * 6",
      watch: false,
      windowsHide: true,
    },
    {
      name: "polymarket-checkin",
      script: "polymarket-checkin.cjs",
      cwd: __dirname,
      out_file: "logs/polymarket-checkin.log",
      error_file: "logs/polymarket-checkin.error.log",
      autorestart: false,
      cron_restart: "0 18 * * 0",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // SMART CHECK-IN (existing)
    // ============================================================
    {
      name: "claude-smart-checkin",
      script: "smart-checkin.cjs",
      cwd: __dirname,
      out_file: "logs/claude-smart-checkin.log",
      error_file: "logs/claude-smart-checkin.error.log",
      autorestart: false,
      cron_restart: "*/30 9-18 * * *",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // SECURITY AUDIT (existing)
    // ============================================================
    {
      name: "claude-security-audit",
      script: "security-audit.cjs",
      cwd: __dirname,
      out_file: "logs/claude-security-audit.log",
      error_file: "logs/claude-security-audit.error.log",
      autorestart: false,
      cron_restart: "0 20 * * 0",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // WELLNESS
    // ============================================================
    {
      name: "wellness-checkin",
      script: "wellness-checkin.cjs",
      cwd: __dirname,
      out_file: "logs/wellness-checkin.log",
      error_file: "logs/wellness-checkin.error.log",
      autorestart: false,
      cron_restart: "0 20 * * 3",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // CISO (Chief Information Security Officer)
    // ============================================================
    {
      name: "ciso-patrol",
      script: "ciso-patrol.cjs",
      cwd: __dirname,
      out_file: "logs/ciso-patrol.log",
      error_file: "logs/ciso-patrol.error.log",
      autorestart: false,
      cron_restart: "0 23 * * *",
      watch: false,
      windowsHide: true,
    },
    {
      name: "ciso-brief",
      script: "ciso-brief.cjs",
      cwd: __dirname,
      out_file: "logs/ciso-brief.log",
      error_file: "logs/ciso-brief.error.log",
      autorestart: false,
      cron_restart: "0 5 * * *",
      watch: false,
      windowsHide: true,
    },
    {
      name: "ciso-weekly",
      script: "ciso-weekly.cjs",
      cwd: __dirname,
      out_file: "logs/ciso-weekly.log",
      error_file: "logs/ciso-weekly.error.log",
      autorestart: false,
      cron_restart: "0 5 * * 1",
      watch: false,
      windowsHide: true,
    },
    // ============================================================
    // TWITTER
    // ============================================================
    {
      name: "twitter-drafts",
      script: "twitter-drafts.cjs",
      cwd: __dirname,
      out_file: "logs/twitter-drafts.log",
      error_file: "logs/twitter-drafts.error.log",
      autorestart: false,
      cron_restart: "0 5 * * *",
      watch: false,
      windowsHide: true,
    },

    // ============================================================
    // MEMORY
    // ============================================================
    {
      name: "memory-flush",
      script: "memory-flush.cjs",
      cwd: __dirname,
      out_file: "logs/memory-flush.log",
      error_file: "logs/memory-flush.error.log",
      autorestart: false,
      cron_restart: "0 23 * * *",
      watch: false,
      windowsHide: true,
    },
  ],
};
