---
name: cmo-platform-analytics
description: >
  Monitor, pull, and analyze social media metrics across all of Crevita's platforms, then
  generate cross-platform funnel analysis and actionable recommendations. Use this skill
  whenever the user asks about social media metrics, analytics, platform performance, engagement
  rates, follower growth, content performance, dashboard data, views, likes, impressions,
  reach, subscriber counts, or anything related to tracking how content is performing across
  platforms. Also trigger when the user mentions: "how are my numbers", "analytics", "metrics",
  "dashboard", "engagement", "views", "subscribers", "followers", "reach", "impressions",
  "what's performing", "content report", "weekly report", "monthly report", "platform report",
  "social media report", "funnel metrics", "traffic sources", "which platform is working",
  "ROI on content", "CMO report", or any reference to content/platform performance data.
  This skill pulls data from X, Facebook, Instagram, YouTube (2 channels), LinkedIn (2 profiles),
  Medium, and Substack, then applies the funnel-mastery skill framework to interpret the data
  and make strategic recommendations.
---

# CMO Platform Analytics Skill

## Overview

This skill instructs CMO to collect performance data across all of Crevita's social media and content platforms, compile it into a structured report, analyze it through the lens of the `funnel-mastery` SKILL.md framework, and make specific recommendations for content strategy adjustments.

**Data collection method:** Browser automation via Claude Code + Chrome. CMO does not have API access to most platforms. All data is scraped from platform dashboards and analytics pages by navigating to each platform, logging in, and extracting the visible metrics.

---

## Platforms and Profiles

| Platform | Profile / Channel | Brand | Analytics URL |
|----------|------------------|-------|--------------|
| X (Twitter) | Crevita Moody (@crevitamoody) | Personal | analytics.x.com or x.com/analytics |
| Facebook | Playhouse STEM (How to Raise Your Robot) | Playhouse STEM | facebook.com/insights (page insights) |
| Instagram | How to Raise Your Robot | Playhouse STEM | instagram.com/accounts/insights (professional dashboard) |
| YouTube | Crevita Moody | Personal | studio.youtube.com (Crevita Moody channel) |
| YouTube | How to Raise Your Robot | Playhouse STEM | studio.youtube.com (HTRYR channel) |
| LinkedIn | Crevita Moody (personal) | Personal | linkedin.com/analytics (creator analytics) |
| LinkedIn | Playhouse STEM (company page) | Playhouse STEM | linkedin.com/company/playhousestem/analytics |
| Medium | Crevita Moody | Personal | medium.com/me/stats |
| Substack | Crevita Moody | Personal | substack.com/dashboard (publication analytics) |

---

## Metrics to Collect

### Per Platform

**X (Twitter):**
- Impressions (last 7 days, last 28 days)
- Profile visits
- Follower count and net change
- Top performing posts (by impressions and engagement)
- Engagement rate (engagements / impressions)
- Link clicks (if available)

**Facebook:**
- Page reach (last 7 days, last 28 days)
- Page likes / followers and net change
- Post engagement (reactions, comments, shares)
- Top performing posts
- Video views (if applicable)

**Instagram:**
- Accounts reached (last 7 days, last 28 days)
- Followers and net change
- Content interactions (likes, comments, saves, shares)
- Profile visits
- Top performing posts/reels
- Website clicks from profile

**YouTube (per channel):**
- Views (last 7 days, last 28 days)
- Watch time (hours)
- Subscribers and net change
- Top performing videos (by views and watch time)
- Average view duration
- Click-through rate on thumbnails
- Traffic sources (search, suggested, browse, external)
- Impressions and impressions click-through rate

**LinkedIn (personal profile):**
- Post impressions (last 7 days)
- Post engagement (reactions, comments, reposts)
- Profile views
- Follower count and net change
- Search appearances
- Top performing posts

**LinkedIn (company page):**
- Page views
- Unique visitors
- Follower count and net change
- Post impressions and engagement
- Top performing posts

**Medium:**
- Views (last 7 days, last 30 days)
- Reads (last 7 days, last 30 days)
- Read ratio (reads / views)
- Fans / claps
- Top performing articles
- Follower count and net change
- Referral sources (if visible)

**Substack:**
- Subscriber count (free and paid) and net change
- Open rate (last 5 posts average)
- Click rate
- Top performing posts (by opens and engagement)
- New subscriber sources (if visible)

---

## Data Collection Process

### Browser Automation Steps

For each platform:

1. **Navigate** to the analytics page using Claude Code + Chrome
2. **Log in** if needed (use stored credentials or prompt Crevita)
3. **Set date range** to the reporting period (default: last 7 days, with 28-day comparison)
4. **Extract** the metrics listed above by reading the dashboard
5. **Screenshot** the dashboard for the report attachment (optional, if Crevita requests visual proof)
6. **Record** all data in the structured format below

### Data Format

Store collected data in a structured JSON format for processing:

```json
{
  "report_date": "2026-03-26",
  "period": "7_days",
  "platforms": {
    "x_twitter": {
      "profile": "Crevita Moody",
      "impressions_7d": 0,
      "impressions_28d": 0,
      "profile_visits": 0,
      "followers": 0,
      "follower_change": 0,
      "engagement_rate": 0.0,
      "top_posts": []
    }
  }
}
```

### Collection Schedule

- **Weekly report:** Every Monday morning, collect 7-day data from all platforms
- **Monthly report:** First Monday of each month, collect 28/30-day data from all platforms
- **On-demand:** Whenever Crevita asks "how are my numbers" or similar

---

## Report Structure

### Weekly Report Format

```
CMO WEEKLY ANALYTICS REPORT
Period: [Start Date] - [End Date]

EXECUTIVE SUMMARY
[2-3 sentence overview: what's up, what's down, one key insight]

PLATFORM PERFORMANCE

X (Twitter) - @crevitamoody
  Impressions: [number] ([+/- % vs prior week])
  Followers: [number] ([+/- net change])
  Engagement Rate: [%]
  Top Post: "[truncated post text]" -- [impressions] impressions
  
[Repeat for each platform]

CROSS-PLATFORM HIGHLIGHTS
- Best performing content piece across all platforms: [title/post]
- Highest growth platform: [platform] ([metric])
- Lowest performing platform: [platform] ([metric])
- Content that performed differently across platforms: [detail]

FUNNEL ANALYSIS
[See Funnel Analysis section below]

RECOMMENDATIONS
[See Recommendations section below]
```

### Monthly Report Format

Same structure as weekly but with:
- 28/30-day metrics instead of 7-day
- Month-over-month trend comparison
- Quarterly trajectory (are we up or down from 3 months ago?)
- Content audit: which categories of content perform best on which platforms?

---

## Funnel Analysis

This is where the `funnel-mastery` SKILL.md framework gets applied to the raw numbers. CMO must reference the funnel skill when building this section.

### Traffic Temperature Mapping

Classify each platform's audience by traffic temperature (from the funnel-mastery skill):

- **Cold traffic sources:** Platforms where most viewers don't know Crevita yet (organic search on YouTube, X impressions from non-followers, Medium reads from non-followers)
- **Warm traffic sources:** Platforms where the audience knows of Crevita but hasn't bought (newsletter subscribers, YouTube subscribers, LinkedIn connections)
- **Hot traffic sources:** Platforms where the audience has engaged deeply or purchased (Gumroad customers, email list engaged segment, repeat commenters)

### Funnel Stage Metrics

Map platform metrics to funnel stages:

| Funnel Stage | Metric Proxy | Platforms |
|-------------|-------------|-----------|
| **Awareness** (top of funnel) | Impressions, reach, views | X, YouTube, Instagram, LinkedIn |
| **Interest** (engagement) | Likes, comments, shares, saves, read ratio | All platforms |
| **Consideration** (deeper engagement) | Profile visits, follows, subscribes, link clicks | All platforms |
| **Conversion** (action) | Website clicks, Gumroad visits, email signups | Medium, Substack, LinkedIn, X |

### Value Ladder Health Check

Reference the Value Ladder from the funnel-mastery skill and assess:

1. **Bait/Lead Magnet performance:** Are free content pieces (blog posts, YouTube videos) attracting new people into the ecosystem?
2. **Frontend offer visibility:** Is the Gumroad storefront getting traffic from content platforms?
3. **Email list growth:** Are Substack/Mailchimp subscribers growing? What's driving signups?
4. **Cross-platform movement:** Are people discovering Crevita on one platform and following on another?

### Dream 100 Tracking

If CMO has visibility into engagement from Dream 100 targets (influential accounts in AI/parenting/education space):
- Which Dream 100 members have engaged with Crevita's content this period?
- Any collaboration opportunities surfaced?
- Which Dream 100 content is performing well that Crevita could respond to or reference?

---

## Recommendations Framework

Every report ends with 3-5 specific, actionable recommendations. Each recommendation must:

1. **Reference specific data** from the report (not generic advice)
2. **Connect to the funnel** using funnel-mastery framework language
3. **Include a concrete next step** (not "post more" but "create 2 threads on X about [specific topic] based on the engagement pattern from [specific post]")
4. **Specify which brand** the recommendation applies to (Playhouse STEM or Crevita Moody personal)

### Recommendation Categories

- **Double down:** Content or platforms showing strong signals -- do more of what's working
- **Fix the leak:** Points in the funnel where attention is dropping off (high impressions but low clicks, high views but low subscribes)
- **Test this:** New content formats, posting times, or platform strategies worth experimenting with
- **Stop doing:** Content types or platforms consuming effort without returning results
- **Cross-pollinate:** Opportunities to move audience from one platform to another (e.g., "Your Medium articles on AI safety get 3x the read ratio of other topics -- repurpose the top 3 as YouTube scripts")

---

## Brand Separation in Reporting

Always maintain clear separation between the two brands:

**Crevita Moody (Personal Brand):**
- X, LinkedIn (personal), Medium, Substack, YouTube (Crevita Moody channel)
- Content: AI safety, ethics, policy, professional consulting, technical products
- Funnel destination: crevita.gumroad.com (professional products)

**Playhouse STEM:**
- Facebook, Instagram, LinkedIn (company page), YouTube (How to Raise Your Robot channel)
- Content: Children's AI education, parenting guides, family products
- Funnel destination: Playhouse STEM products (children's book, parenting resources)

Report each brand's performance separately, then provide a combined view only when showing cross-brand insights.

---

## Dashboard Integration

Compile the report data into the Tamille Executive Dashboard so Crevita can see platform performance alongside other business metrics. The dashboard should display:

- Platform performance summary cards (one per platform)
- Trend lines for key metrics (followers, impressions, engagement) over time
- Funnel stage visualization (awareness > interest > consideration > conversion)
- Comparison view (this week vs last week, this month vs last month)
- Alert flags for significant changes (+/- 20% in any key metric)

---

## Error Handling

- **Platform login expired:** Notify Crevita: "I need you to re-authenticate on [platform]. Can you log in so I can access the analytics?"
- **Analytics page UI changed:** If the dashboard layout doesn't match expected structure, screenshot what you see and describe the issue. Do not guess at numbers
- **Platform temporarily unavailable:** Skip that platform, note it in the report, and collect the data on next run
- **Metrics look anomalous** (sudden 10x spike or drop): Flag it in the report rather than treating it as normal. Ask Crevita if she ran any promotions, paid ads, or had viral content that would explain the anomaly
- **Missing historical data:** Some platforms only show limited historical data. Note the limitation and establish a baseline going forward by saving each report's data

---

## Related Skills

- **`funnel-mastery`** -- The strategic framework for interpreting all analytics data. CMO must read this skill to understand traffic temperature, Value Ladder stages, Dream 100, and funnel math
- **`personal-brand-mastery`** -- The brand strategy framework. Use this to evaluate whether content is building brand correctly (depth vs width content, Brand Journey stages)
- **`twitter-posting`** -- X/Twitter content creation guidelines. Cross-reference top performing X posts with the Hook Point techniques in this skill to identify what's working
