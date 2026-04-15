-- Pre-computed "synopsis" of each bill: short title + findings + major
-- divisions + section 2 + appropriation lines + effective date. Extracted
-- at sync time so the LLM can read a pre-digested overview of omnibus and
-- other long bills that would otherwise overflow the context window.
--
-- Populated by api/billExcerpt.js extractStructuredExcerpt().
-- Null for bills without extractable structure (very short or non-standard).
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS structured_excerpt text;
