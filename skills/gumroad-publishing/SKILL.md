---
name: gumroad-publishing
description: "Use this skill whenever creating, editing, publishing, or reviewing a Gumroad product page, profile, or storefront. Triggers include any mention of 'Gumroad', 'product page', 'Gumroad listing', 'publish on Gumroad', 'Gumroad profile', 'Gumroad storefront', selling digital products, or uploading products for sale. Also use when the user says 'list this for sale', 'make a product page', 'set up the store', or references playhouse53.gumroad.com. Use this skill even if the user just says 'put it on Gumroad' or 'make it sellable'. This skill covers the full lifecycle: profile setup, product creation, cover/thumbnail image specs, pricing, SEO, description writing, content upload, checkout customization, and the final QA review before publishing."
---

# Gumroad Publishing Skill

## Overview

This skill ensures every Gumroad product page and profile update is complete, polished, and optimized before going live. It covers both the **profile/storefront** level and the **individual product page** level.

**Owner store:** playhouse53.gumroad.com (Crevita Moody / C.T. Moody)

## Brand Theme: Warm Tech

All visuals and text should follow the Warm Tech palette:

| Token | Hex | Usage |
|-------|-----|-------|
| bg-deep | #17150f | Page background |
| bg-card | #1c1a17 | Card surfaces, hero |
| bg-elevated | #242019 | Hover states |
| border-subtle | #2e2a22 | Borders, dividers |
| gold-muted | rgba(184,134,11,0.15) | Badge/tag backgrounds |
| gold-text | #d4a84b | Accent text, links |
| gold-solid | #b8860b | Buttons, CTA, avatar |
| gold-bright | #e6b84d | Hover states |
| text-primary | #f5f0e8 | Headlines |
| text-secondary | #a09888 | Body copy |
| text-muted | #8a8070 | Captions, metadata |

---

## Part 1: Profile / Storefront Setup

### Profile fields to complete

1. **Profile name**: Crevita Moody
2. **Bio text**: Must include a bold value proposition (not a resume). Current approved copy:

   > AI that works while you sleep. Built for your business, not the masses.
   >
   > I engineer custom software solutions and deploy autonomous AI systems designed to solve your most complex operational bottlenecks. From multi-agent networks to API integrations and security frameworks, I build the infrastructure that lets you scale.
   >
   > Data Scientist. AI Developer. Author of "How to Raise Your Robot" (#1 Amazon Bestseller).

3. **Profile image/avatar**: Initials "CM" on gold-solid (#b8860b) background, or branded icon
4. **Cover/banner image**: 1280x400px, dark background (#1c1a17), name in #f5f0e8, subtitle in #8a8070, subtle decorative pattern in #2e2a22
5. **Social links**: Add X handle, YouTube channel, personal website
6. **Custom CSS**: Apply warm tech color overrides (see references/custom-css.md if available, or use the CSS from the implementation brief)

### Profile font and color settings

Gumroad has built-in font and color pickers under profile settings. Set:
- **Font**: Use the cleanest sans-serif option available
- **Background color**: #17150f (or closest dark option)
- **Accent color**: #b8860b (gold)
- **Text color**: #f5f0e8

---

## Part 2: Product Page Checklist

The Gumroad product editor has four tabs across the top: **Product**, **Content**, **Receipt**, and **Share**. Complete ALL sections across all four tabs before publishing. The "Publish" / "Unpublish" and "Save changes" buttons are in the top-right corner.

### Tab 1: Product

This tab scrolls through several distinct sections from top to bottom. Walk through every section.

#### Section: Cover image area (top of page)

- [ ] **Cover image(s)**: Horizontal, at least 1280x720px, 72 DPI. JPG, PNG, or GIF.
  - First image is what customers see on landing -- make it count
  - Multiple covers allowed (click the + icon to add more, drag to reorder)
  - Cannot use PDF as cover image
  - Filenames must NOT contain: # $ _ + & ; : %
  - All covers auto-adjust to match the height of the first one -- use equal heights
  - Follow the warm tech palette: dark background, gold accents, clean typography
  - Video covers supported via YouTube/Vimeo embed URL (click the video embed icon)

#### Section: Product name and description (below cover)

- [ ] **Product name/title**: Clear, benefit-focused. Not generic. Should communicate value immediately.
  - Good: "CISO Agent Security Skill -- AI Agent Red Teaming and Defense Framework"
  - Bad: "Security Guide"

- [ ] **Description**: Rich text editor with formatting toolbar (Bold, Italic, Underline, Strikethrough, Blockquote, Link, Video embed, Upload files, Insert, + Page).
  - Lead with the problem you solve, not features
  - Include: what it is, who it is for, what they get, why it matters
  - Use formatting but keep it scannable
  - Do NOT stuff keywords unnaturally

- [ ] **Custom URL/permalink**: Edit the gray text under the description to set a clean, keyword-rich URL slug.
  - Example: playhouse53.gumroad.com/l/ciso-agent-skill (not /l/abc123)
  - This impacts SEO -- use product keywords

#### Section: Thumbnail

- [ ] **Thumbnail image**: Square, at least 600x600px. JPG, PNG, or GIF.
  - Shows in: Gumroad Library, Discover, and Profile pages
  - Completely separate from cover images -- must be uploaded independently
  - Should be recognizable at small sizes
  - Has its own upload area with a delete (trash) icon

#### Section: Product info

- [ ] **Call to action**: Dropdown selector. Options include "I want this!", "Buy this", "Pay", "Get access", etc. Pick the most appropriate CTA for the product type.

- [ ] **Summary**: Text field with placeholder "You'll get...". This appears below the CTA button on the product page. Write a concise description of what the buyer receives.
  - Example: "A complete .md skill file implementing MITRE ATLAS, OWASP LLM, and 4 other security frameworks. Drop into your agent's skills directory. No code, no dependencies."

- [ ] **Additional details**: Key-value pairs (e.g., "Size" = "9.65 KB", "Format" = ".md skill file", "Pages" = "45"). Click "+ Add detail" to add more rows. Use the trash icon to remove.
  - Always include: file format, file size, and any other relevant specs
  - These show on the product page as structured metadata

#### Section: Amount (pricing)

- [ ] **Amount**: Dollar amount field with currency selector dropdown.
  - $0 = free product (triggers "pay what you want" requirement)
  - Note: "Free products require a pay what you want price" (shown as blue info banner)

- [ ] **Allow customers to pay what they want**: Toggle. When enabled, shows:
  - **Minimum amount**: The floor price ($0 for free, or set a minimum)
  - **Suggested amount**: The recommended price shown to customers

- [ ] **Allow customers to pay in installments**: Toggle for payment plans

- [ ] **Automatically apply discount code**: Toggle. If enabled, a discount is auto-applied at checkout.

#### Section: Versions

- [ ] **Versions**: Optional. Click "+ Add version" to create tiers (e.g., Basic vs Pro).
  - Each version gets: name, description, additional amount over base price, optional quantity limit
  - Content tab lets you assign different files to each version

#### Section: Settings (bottom of Product tab)

- [ ] **Limit product sales**: Toggle. When enabled, shows "Maximum number of purchases" field (default infinity symbol). Use for limited editions or scarcity.

- [ ] **Allow customers to choose a quantity**: Toggle. Enable if buyers might want multiples.

- [ ] **Publicly show the number of sales on your product page**: Toggle. Social proof -- turn on once you have sales.

- [ ] **Mark product as e-publication for VAT purposes**: Toggle. Enable for ebooks/digital publications sold to EU customers.

- [ ] **Specify a refund policy for this product**: Toggle. Set a custom refund policy if needed.

- [ ] **Require shipping information**: Toggle. Only for physical products -- leave OFF for digital.

- [ ] **Custom domain**: Text field for custom domain mapping (e.g., shop.yourdomain.com).

#### Section: Gumroad Discover (below Settings)

Gumroad Discover recommends products to prospective customers for a flat 30% fee on each sale. When enabled, the product also joins the Gumroad affiliate program.

- [ ] **Category**: Dropdown selector. Choose the most accurate category (not "Other"). Available categories include Software, Education, Design, Music, Writing, and more. "Other" is the default and hurts discoverability -- always pick a specific one.

- [ ] **Tags**: Text input field ("Begin typing to add a tag..."). Add multiple relevant tags for search visibility.
  - Good tags: "AI security", "CISO", "red teaming", "Claude skill", "agent framework", "LLM security"
  - Bad tags: "cool", "good", "new", "best"
  - Be specific and think about what a buyer would search for

- [ ] **Display your product's 1-5 star rating to prospective customers**: Toggle (pink when on). Enable once you have positive reviews to show social proof. Can leave off for new products until reviews come in.

- [ ] **This product contains content meant only for adults, including the preview**: Toggle. Leave OFF for professional/technical products.

### Tab 2: Content

This is what the customer receives after purchase. Has its own rich text editor and file management.

- [ ] **Files uploaded**: Upload deliverable files using "Upload files" in the toolbar or drag-and-drop.
  - Each file shows: filename, file type, file size, and a Download button
  - Verify the correct final version is uploaded (not drafts)
  - Check file opens correctly after upload
- [ ] **Content description**: Rich text area below the files. Add context, instructions, or bonus info the buyer sees after purchase.
- [ ] **Pages**: Click "+ Page" to create multiple content pages (e.g., "Downloads", "Instructions", "Bonus Materials"). Pages appear as tabs for the buyer.
- [ ] **Folders**: Drag files together to create folders with clear names.
- [ ] **Stamped PDFs**: Enable if you want customer info watermarked on PDFs.
- [ ] **Review section**: The left sidebar shows "Liked it? Give it a rating:" with star rating, text review, and video review options. This is buyer-facing and auto-generated -- no action needed, but be aware it exists.
- [ ] **Library section**: Left sidebar also shows Library link. No action needed.

### Tab 3: Receipt

The Receipt tab has two fields on the left and a live Preview panel on the right.

- [ ] **Button text**: Text field (max 26 characters). This is the download button label shown on receipts and product pages. Default is "View content". Customize to match the product (e.g., "Download skill", "Get the handbook", "Access framework").

- [ ] **Custom message**: Large text area. Placeholder: "Add any additional information you'd like to include on the receipt." Write a personal thank-you, setup instructions, next steps, links to related products, or bonus discount codes. This appears on the receipt the buyer sees after purchase.

- [ ] **Preview panel (right side)**: Review the live receipt preview before saving. It shows:
  - Order ID, Order date, Total
  - Product thumbnail and name
  - The button text you set
  - Product price
  - Contact line: "Questions about your product? Contact Crevita Moody at [email]"
  - Payment info section
  - Verify the preview looks professional and the contact email is correct

### Tab 4: Share

- [ ] **Publish status**: Click "Publish" (top-right button) to make the product live. Button changes to "Unpublish" when live.
- [ ] **Profile section**: Add to a profile section so it appears on your storefront.
- [ ] **Share links**: Copy the direct product URL for promotion.
- [ ] **Embed/widget options**: Gumroad provides embed code and overlay widget options for external sites.

### Checkout customization (global or per-product)

- [ ] **Discount codes**: Set up any active promo codes (e.g., LAUNCH)
- [ ] **Custom fields**: Add if you need additional customer info (company name, use case, etc.)
- [ ] **Upsells**: Configure "More like this" recommendations or specific upsell products
- [ ] **Name field optimization**: Gumroad auto-hides the name field on mobile for higher conversion. Override only if you need customer names.

---

## Part 3: Pre-Publish QA Review

**DO NOT publish until every item below passes inspection.** Navigate through the product page as a customer would see it and verify each item.

### Visual QA

- [ ] Cover image loads correctly at full size
- [ ] Cover image is not pixelated, cropped badly, or stretched
- [ ] Thumbnail displays correctly (check profile page preview)
- [ ] All text is readable against the background (no contrast issues)
- [ ] Color theme is consistent with warm tech palette
- [ ] No placeholder text remaining ("Lorem ipsum", "TODO", "CHANGE THIS")
- [ ] No typos in title, description, or summary
- [ ] Formatting is clean -- no orphaned bold tags, broken links, or raw HTML

### Content QA

- [ ] Product title is compelling and clear
- [ ] Description answers: What is it? Who is it for? What do they get?
- [ ] Price is set correctly (not $0 unless intentional)
- [ ] Custom URL is clean and keyword-rich
- [ ] CTA button text makes sense for this product
- [ ] All uploaded files are the correct, final versions (not drafts)
- [ ] File download works (do a test purchase if possible)

### Receipt QA

- [ ] Button text is customized (not still "View content" unless intentional)
- [ ] Custom message is filled in with a thank-you or next steps
- [ ] Receipt preview looks professional (check the right-side preview panel)
- [ ] Contact email shown in receipt preview is correct

### Discover QA

- [ ] Category is set to something specific (NOT "Other")
- [ ] Tags are added (at least 3-5 relevant tags)
- [ ] Star rating display toggle is set appropriately
- [ ] Adult content toggle is OFF (for professional/technical products)

### SEO QA

- [ ] URL slug contains relevant keywords
- [ ] Title is descriptive (appears in search results)
- [ ] Description includes natural keyword usage
- [ ] Category and tags are set for Discover visibility

### Cross-references

- [ ] Product appears on the profile page (added to a section)
- [ ] Related products are set up for upsells/cross-sells if applicable
- [ ] Discount codes are tested and working
- [ ] Social share preview looks correct (title, image, description)

---

## Part 4: Common Mistakes to Avoid

1. **Publishing without a thumbnail** -- the product shows a blank square on the profile and Discover
2. **Using the default URL slug** -- random characters hurt SEO and look unprofessional
3. **Forgetting the summary field** -- leaves blank space below the CTA
4. **Leaving category as "Other"** -- product is nearly invisible on Gumroad Discover
5. **No tags added** -- product won't appear in Discover search results
6. **Leaving receipt button as "View content"** -- generic and unhelpful for the buyer
7. **Empty custom message on receipt** -- missed opportunity to thank customers, give setup instructions, or offer next steps
4. **Uploading draft files** -- always double-check you are uploading the FINAL version
5. **Not adding to a profile section** -- product is live but invisible on your storefront
6. **No receipt message** -- missed opportunity to thank customers and offer next steps
7. **Skipping tags/category** -- product won't appear in Gumroad Discover search
8. **Cover image too small** -- anything under 1280x720 looks blurry on desktop
9. **Inconsistent branding** -- cover image colors or style don't match your storefront theme

---

## Image Specifications Quick Reference

| Image type | Minimum size | Aspect ratio | Format |
|-----------|-------------|-------------|--------|
| Cover image | 1280x720px | 16:9 (horizontal) | JPG, PNG, GIF |
| Thumbnail | 600x600px | 1:1 (square) | JPG, PNG, GIF |
| Profile banner | 1280x400px | ~3.2:1 (wide) | JPG, PNG |
| Profile avatar | 200x200px | 1:1 (square) | JPG, PNG |

---

## Post-Publish Steps

After publishing, do not forget:

1. Copy the product URL for sharing
2. Test the purchase flow (use a test purchase)
3. Share on social channels (X, YouTube community post, email list)
4. Verify the product shows on the profile page
5. Commit any code changes to GitHub
