# Email draft — Plural Open API access request

**To:** support@pluralpolicy.com
**Subject:** Nonprofit API access request — high school student building a civic education app

---

Hi Plural team,

My name is [Your Name] and I'm a high school student. For the past several months I've been building **CapitolKey** — a free, nonpartisan civic education platform that takes real federal and state legislation and translates it into plain language for students my age. The goal is simple: help other high schoolers actually understand the laws being written about their schools, their futures, and their communities, instead of feeling locked out of the process.

CapitolKey works like this: students answer a short onboarding about their state, grade, job status, family situation, and the issues they care about. The app then pulls recent bills from Congress and their state legislature, weighted toward their interests, and uses Anthropic's Claude API to rewrite each one into a student-friendly card — a headline, a plain-language summary, what changes if it passes, what changes if it fails, a relevance score, a topic tag, and a short list of concrete civic actions they can take (contacting a legislator, attending a school board meeting, registering to pre-vote, etc.). Everything is strictly nonpartisan — the AI prompt explicitly prohibits evaluative language, advocacy, and invented facts.

## What's already shipped

- **Personalized, interest-weighted bill feeds** for both federal and state legislation, with interaction history subtly re-ranking future feeds so students see more of what they actually engage with
- **Bill detail pages** with full text, sponsors, status, and student-friendly explanations
- **Free-text search** across federal and state bills
- **Bookmarks and reading history** that work anonymously via sessionStorage and upgrade seamlessly if a student signs in
- **iOS and Android apps** built with Capacitor, alongside the web app
- **Email digests** with status-change notifications when a bookmarked bill moves forward, powered by Resend
- **Push notifications** via Firebase Cloud Messaging for the mobile apps
- **Supabase-backed auth** (Google OAuth + email/password) with a Postgres schema for profiles, bookmarks, and personalization caching

## What I'm building next

- **An Executive Orders section** powered by the Federal Register API, so students can see not just legislation but the presidential actions reshaping the policies around them — with the same plain-language personalization pipeline
- **Local and municipal coverage** — city councils, school boards, county commissions. This is genuinely where a high schooler's civic agency starts, and it's the feature I'm most excited about. Plural's municipal data is a huge part of why I want to move off my current provider and onto you.
- **A "civics classroom" mode** so teachers can create a class code, assign bills, and see which students engaged with which legislation — turning CapitolKey into a drop-in tool for government and civics courses
- **Roll-call votes tied to each student's own representatives**, so when a bill moves, they see exactly how the people representing *them* voted
- **A lightweight "explain my ballot" feature** before each election, using the same personalization engine on candidate positions and ballot measures
- **Accessibility and reading-level tuning** — letting students toggle between a grade-8, grade-11, and "give it to me straight" reading level, because civic education shouldn't require a law degree or a perfect SAT vocabulary
- **Open-sourcing the whole project** under a permissive license once it's stable, so any teacher, student, or civic-tech group can fork it for their own community

## The problem I'm writing about

The legislative data layer. I'm currently using **LegiScan**, and while their free tier was enough to prototype, the paid tiers to get meaningful query volume for federal + all 50 states are priced for lobbying firms and government affairs teams — **hundreds to thousands of dollars a month**. That is completely unattainable for a student like me. I don't have revenue, I don't have institutional backing, I don't have a grant, and I'm not about to ask my parents to underwrite an API bill that costs more than our monthly grocery budget so that other high schoolers can read a bill summary.

Every time I hit LegiScan's rate limit, I'm engineering around it instead of building features for the students who actually need the app. And every time I look at their pricing page, it's a quiet reminder that civic data — the stuff that's supposed to belong to all of us — has been fenced off from the people it's about. That's the gap CapitolKey is trying to close, and I can't close it on an API that costs more than I can ever reasonably pay.

## Why I'm asking Plural specifically

Open States has always felt like the exception. A project that treats legislative data as a public good, built in the open, with scrapers anyone can read on GitHub. I know the hosted API costs real money to run — the servers, the 50 state scrapers breaking at 2am when Texas changes their HTML, the engineers on call — and I'm not asking for something for nothing. I'm asking whether there's a path for a student-built, nonprofit, civic-education project to get above the default 500/day and 10/min limits, in exchange for whatever we can offer back.

A few details about my usage profile:

- **Purpose:** Nonpartisan civic education for U.S. high school students. No ads. No political endorsements. No monetization. The app is free and will stay free.
- **Scale today:** Low — tens to low hundreds of daily users, with most traffic clustered around school hours
- **Caching:** Aggressive server-side caching. Every student with the same state + grade + interest combination shares a single cached bill list, refreshed hourly. One cache entry serves dozens of students. Realistic outbound API volume is a few hundred to low thousands of calls per day at current scale, and the per-minute burst is the bigger concern than daily total
- **What we'd hit:** Bill search across ~6 interest topics per state, bill detail fetches for personalization, and a nightly status-change sweep for the email digest
- **Attribution:** Happy to prominently credit "Powered by Plural Open" anywhere you'd like — footer, bill detail pages, About page, iOS and Android app store descriptions, the teacher-facing classroom mode, any press or school outreach we do
- **Tech stack:** Node/Express backend on Railway, Supabase Postgres, React + Vite frontend on Vercel, Capacitor iOS/Android apps

## What I'd love to ask

1. Are the free-tier limits (500/day, 10/min) still current in 2026, or have they been adjusted?
2. Is there an **educational / student / nonprofit exception** I can formally apply for? Even a modest bump to something like bronze-tier limits would let me stop engineering around rate limits and go back to building for students.
3. If a tier upgrade isn't possible, would **bulk data downloads** be appropriate for my use case? I'd be comfortable running a nightly Supabase import if that's the sustainable path.
4. If I did hit a paid tier eventually — what does pricing actually look like for a project at my scale? Even a rough range would help me plan.

I know you get a lot of requests, and I don't want to take more of your time than necessary. But if there's any way Plural can help a high schooler put real legislative data in front of other high schoolers, it would genuinely change what CapitolKey can become. Civic education shouldn't depend on who can afford the API key, and your team is one of the only groups in this whole space that seems to believe that too.

Thank you for reading this, and thank you for keeping Open States free in the first place. Whatever you decide, I'm grateful the project exists — it's already the reason I believe this app is possible at all.

All the best,
[Your Name]
[Your email]
[Link to CapitolKey, if live]
[Link to GitHub repo, if public]

---

## Notes before sending

- **Personalize the bracketed fields** — name, email, any live URL, GitHub link
- **Trim if needed.** The "What's already shipped" and "What I'm building next" sections are detailed on purpose so Plural sees this is a serious project, not a class assignment. If the email feels too long, the first section to trim is "What I'm building next" — keep the executive orders, municipal, and classroom-mode bullets, cut the rest
- **Be honest about numbers.** If your actual user count is 5, say tens. If it's 300, say hundreds. Don't inflate — Plural's team can sniff that out and it hurts credibility more than a small real number would
- **Attach a screenshot or two** if you have them. Visuals of a real student-facing UI sell this in a way no paragraph can
- **Send from a personal email, not a noreply or project alias.** They want to know there's a human behind this
