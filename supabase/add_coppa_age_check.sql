-- COPPA enforcement: reject profile saves where self-reported age < 13.
-- The frontend already blocks progression, but the Supabase JS client can be
-- called directly with the anon key, so this trigger is defense-in-depth.
--
-- The profile JSONB column stores age in the "grade" field (legacy naming).
-- If grade is missing or not a number, the trigger allows the save (fail-open)
-- because many profiles exist without an age. The trigger only fires when a
-- user explicitly claims to be under 13.

create or replace function check_coppa_age()
returns trigger as $$
declare
  age_val int;
begin
  -- Only check if the profile column has a grade field
  if NEW.profile is not null
     and NEW.profile ? 'grade'
     and NEW.profile->>'grade' is not null
  then
    begin
      age_val := (NEW.profile->>'grade')::int;
    exception when others then
      -- Non-numeric grade (legacy string like "9th") — allow
      return NEW;
    end;

    if age_val < 13 then
      raise exception 'COPPA: cannot store profile for users under 13'
        using errcode = 'P0013';
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;

-- Drop existing trigger if any (idempotent migration)
drop trigger if exists trg_coppa_age_check on user_profiles;

create trigger trg_coppa_age_check
  before insert or update on user_profiles
  for each row
  execute function check_coppa_age();
