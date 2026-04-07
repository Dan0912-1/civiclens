# Home Page Revamp — Option A: "Interactive Demo"

## Context
The current home page is a standard hero + stats + how-it-works + CTA layout. The revamp shifts to a product-led approach: show what CapitolKey does instead of describing it.

## Design

### Section 1: Hero with Live Demo
- **Left side:** Compact headline "See how laws affect *your* life" + single CTA "Try it with your profile →"
- **Right side (desktop) / Below (mobile):** Animated demo card that cycles through 3 example bills with a typing effect:
  1. A bill title types out letter by letter
  2. A personalized summary fades in below
  3. Topic tag + relevance indicator appear
  4. Holds for 4s, then crossfades to next example
- **Profile chips** above the demo card: "Maryland · 10th Grade · Tech, Healthcare" showing the personalization is tailored
- **Below the demo:** subtle text "This is what your feed looks like"

### Section 2: Topic Cards (horizontal scroll)
- Replace stats bar with a horizontal scroll of 6 topic cards (Education, Healthcare, Economy, Environment, Technology, Civil Rights)
- Each card: colored icon/emoji + topic name + "12 active bills" count
- Cards are tappable — navigate to `/profile` (or `/results` if profile exists)
- On desktop: all 6 visible in a row. On mobile: horizontal scroll with snap

### Section 3: How It Works (condensed timeline)
- Single horizontal timeline instead of 3 separate cards
- 3 connected dots with labels: "60-second profile" → "AI matches bills" → "See your impact"
- Much shorter than current — just one visual line

### Section 4: CTA
- Keep existing dark navy CTA section, update copy to "Your legislation is waiting"
- Subtext: "60 seconds. No account needed."

### Section 5: Footer
- Keep as-is

## Files to modify
- `src/pages/Home.jsx` — full rewrite of JSX structure
- `src/pages/Home.module.css` — full rewrite of styles

## Demo bill data (hardcoded in component)
```js
const DEMO_BILLS = [
  { tag: 'Education', tagColor: '#2563eb', title: 'Student Loan Refinancing Act', summary: 'If this passes, your future federal student loans could drop to 4.5% interest — saving you thousands over a 10-year repayment.', relevance: 9 },
  { tag: 'Technology', tagColor: '#dc2626', title: 'Kids Online Safety Act', summary: 'This bill would require apps you use daily to add safety features and limit data collection for users under 17.', relevance: 8 },
  { tag: 'Economy', tagColor: '#9333ea', title: 'Raise the Wage Act', summary: 'Would increase federal minimum wage to $17/hr by 2028 — directly affecting your paycheck if you work part-time.', relevance: 9 },
]
```

## Topic cards data
```js
const TOPICS = [
  { id: 'education', label: 'Education', emoji: '📚', count: '12 active bills' },
  { id: 'healthcare', label: 'Healthcare', emoji: '🏥', count: '9 active bills' },
  { id: 'economy', label: 'Economy', emoji: '💼', count: '15 active bills' },
  { id: 'environment', label: 'Environment', emoji: '🌿', count: '8 active bills' },
  { id: 'technology', label: 'Technology', emoji: '💻', count: '11 active bills' },
  { id: 'civil_rights', label: 'Civil Rights', emoji: '⚖️', count: '7 active bills' },
]
```

## Animation approach
- Typing effect: `useState` + `useEffect` with `setInterval` adding one character at a time
- Crossfade between bills: CSS opacity transition + `useState` cycling index every ~6s
- Profile chips: static, no animation needed
- Topic cards on mobile: CSS `scroll-snap-type: x mandatory`

## Verification
- Preview at `/` — check hero demo animation cycles through 3 bills
- Check mobile layout (topic cards scroll horizontally, demo card below hero text)
- Verify CTA buttons navigate to `/profile`
