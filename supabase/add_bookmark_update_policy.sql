-- Allow users to UPDATE their own bookmarks.
--
-- Why this migration exists: the original bookmarks RLS (create_auth_tables.sql)
-- shipped with SELECT + INSERT + DELETE policies but no UPDATE policy. The
-- frontend uses `.upsert({ onConflict: 'user_id,bill_id' })` to save bookmarks,
-- which Postgres expands to INSERT ... ON CONFLICT DO UPDATE. When a bookmark
-- already exists (e.g. the user re-saves after the bill's analysis refreshed,
-- or the status_stage snapshot changes), the UPDATE branch runs — and RLS
-- silently rejects it because there was no UPDATE policy. The frontend sees a
-- generic "Could not save bookmark" toast with no way to diagnose.
--
-- Fix: add an UPDATE policy scoped to the user's own rows. Matching the
-- existing pattern from the INSERT + DELETE policies.

CREATE POLICY "Users can update own bookmarks"
  ON bookmarks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
