-- Operator SQL for public.review_accounts (see
-- supabase/migrations/20261119100000_review_account_live_join.sql).
-- Run by hand in the Supabase SQL Editor, one block at a time. Nothing here
-- prints a user id.
--
-- A listed account may join the drop as a participant while it is live, so
-- it can buy at any time. Keep the list to PG reviewer test accounts only,
-- and empty it when the review is over.

-- ── Add: replace the e-mail with the reviewer test account's sign-in e-mail ─
insert into public.review_accounts (user_id, note)
select u.id, 'PG review ' || to_char(now(), 'YYYY-MM-DD')
from auth.users u
where u.email = 'REVIEWER_EMAIL_HERE'
  and coalesce(u.is_anonymous, false) = false
on conflict (user_id) do nothing;

-- ── Check: how many are listed (expect the number you added) ───────────────
select count(*) as review_accounts from public.review_accounts;

-- ── Remove all when the review is over ─────────────────────────────────────
-- delete from public.review_accounts;
