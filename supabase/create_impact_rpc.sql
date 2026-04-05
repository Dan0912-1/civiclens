-- RPC function to count distinct bills that have been personalized
create or replace function count_distinct_bills()
returns bigint
language sql
security definer
as $$
  select count(distinct bill_id) from personalization_cache;
$$;
