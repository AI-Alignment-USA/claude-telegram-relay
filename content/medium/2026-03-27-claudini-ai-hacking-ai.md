# AI Is Now Hacking AI -- And It's Better at It Than We Are

## What if the biggest threat to AI safety isn't a hacker in a hoodie -- but another AI?

That's no longer a hypothetical. A team of researchers just built an AI system that autonomously discovers new ways to break through the safety guardrails of every major AI chatbot on the market. No human involvement needed. No clever prompt engineering. Just one AI systematically figuring out how to manipulate other AIs.

The system is called Claudini, and it just outperformed every known attack method that humans have ever designed.

---

## What Was Discovered

Researchers from institutions including EPFL and the University of Maryland built an automated pipeline that uses an AI agent (powered by Claude Code) to design, test, and refine adversarial attacks against large language models -- the technology behind ChatGPT, Claude, Gemini, and others.

Here's what the numbers look like:

- The AI-designed attacks achieved up to **40% success rate** on models specifically hardened against dangerous queries (like those related to chemical, biological, radiological, and nuclear threats). For context, the best human-designed attacks only managed about 10% on the same models.
- When attacks were designed on one model and tested on a completely different one, they achieved a **100% success rate** against safety-aligned models. The best human method managed just 56%.
- Claudini outperformed **all 30+ existing attack methods** that researchers have developed over years of work.

The paper was published on arXiv on March 25, 2026, authored by Alexander Panfilov, Peter Romov, Igor Shilov, and others -- including Maksym Andriushchenko and Jonas Geiping, two of the most respected names in AI security research.

---

## Why This Matters

Think of AI safety guardrails like the locks on your front door. For years, security researchers have been testing those locks by trying to pick them -- one technique at a time, designed by humans who understand how the locks work.

What Claudini does is hand the lockpicks to a robot and say "figure it out yourself." And the robot not only figured it out -- it invented entirely new lockpicking techniques that humans never thought of.

This matters for three reasons:

**1. The speed advantage is real.** It took years for human researchers to develop 30+ attack techniques. Claudini's AI agent discovered methods that beat all of them in a fraction of the time. As AI models get updated and patched, the attackers can now keep pace automatically.

**2. Safety testing just became a moving target.** Companies like OpenAI, Anthropic, and Google test their models against known attack patterns before releasing them. But if an AI can invent entirely new attack patterns faster than humans can anticipate them, those pre-release safety tests may not catch what matters most.

**3. The tools are public.** The researchers released all of their discovered attacks alongside the code. This is standard practice in security research (you share vulnerabilities so they can be fixed), but it also means anyone can study and build on these techniques.

---

## Reality Check

Before the alarm bells get too loud, some important context:

**This is how security research is supposed to work.** Finding vulnerabilities before bad actors do is the entire point of red-teaming. The researchers published responsibly and their goal is to make AI safer, not more dangerous.

**White-box vs. real-world access.** Many of the most effective attacks required "white-box" access -- meaning the attacker needs access to the model's internal code and parameters. Most people using ChatGPT or Claude in a browser don't have that kind of access. However, the transfer attacks (designing on one model, testing on another) worked without it.

**AI companies are already working on this.** Anthropic, OpenAI, and Google all invest heavily in red-teaming and adversarial testing. Research like this helps them improve. It's a cat-and-mouse game, and papers like Claudini help the "cat" side keep up.

**The 40% number has context.** While 40% sounds high, it was specifically measured against CBRN-hardened models (the toughest targets). Most everyday misuse attempts are far simpler and are caught by existing safeguards.

---

## What Needs to Happen

**AI Model Developers**
- Invest in automated red-teaming pipelines as a standard part of the development cycle, not just pre-release testing
- Treat adversarial robustness as a continuous process, not a one-time checkbox
- Share findings across companies through coordinated disclosure frameworks
- Build models that can detect and adapt to novel attack patterns in real-time

**Researchers and Policymakers**
- Fund research into defensive AI that can counter automated attacks at the same speed
- Develop standardized benchmarks for measuring adversarial robustness that evolve as attack methods evolve
- Create clear guidelines for responsible disclosure of AI vulnerabilities
- Support international cooperation on AI safety research

**Business Leaders Deploying AI**
- Don't assume the AI product you're using is "safe" just because the company says it passed safety testing
- Ask your AI vendors about their red-teaming practices and how often they update their defenses
- Build monitoring systems that can detect when AI outputs seem manipulated or unusual
- Have human oversight processes for high-stakes AI decisions

**Everyday Users**
- Understand that AI safety guardrails are not perfect walls -- they're more like speed bumps
- Be cautious about trusting AI outputs for critical decisions (medical, legal, financial) without verification
- If an AI chatbot says something that seems wildly out of character or inappropriate, report it
- Stay informed about AI safety developments -- this is a fast-moving field that affects everyone

---

## The Bottom Line

Claudini proves something the AI security community has suspected for a while: the best way to find holes in AI safety is to use AI itself. The attackers now have the same automation advantages as the defenders. This doesn't mean AI is doomed or unsafe -- it means the industry needs to treat security as an arms race that requires continuous, automated investment, not a problem that gets solved once and forgotten. The researchers who built Claudini did the right thing by publishing openly. Now it's on the companies building these systems to respond accordingly.

---

**Source:** Panfilov, A., Romov, P., Shilov, I., de Montjoye, Y-A., Geiping, J., & Andriushchenko, M. (2026). "Claudini: Autoresearch Discovers State-of-the-Art Adversarial Attack Algorithms for LLMs." arXiv:2603.24511. https://arxiv.org/abs/2603.24511

**Conflict of Interest Disclosure:** This article discusses research that used Anthropic's Claude Code as the base agent for the Claudini pipeline. The author uses Claude-based tools in her work. This article is written independently and does not represent the views of Anthropic or any other AI company mentioned.
