-- Run this AFTER 0001_init.sql (Dashboard -> SQL Editor -> New query -> Run).
--
-- Why: 0001 snapshotted the library on every single save and kept 30 of them. The editor
-- autosaves about a second after each keystroke, so those 30 snapshots could all be from the
-- last two minutes of typing — useless as history, and expensive. A 44-entry library is ~50KB,
-- so 300 students x 30 snapshots is up to 450MB, which overruns Supabase's 500MB free database.
--
-- This replaces the trigger so that it:
--   * only takes a snapshot if the newest one is older than 5 minutes, and
--   * keeps 10 per student.
-- History now spans real editing sessions instead of keystrokes, and worst-case storage drops
-- to roughly 300 x 10 x 50KB = 150MB, with a typical student far below that.

create or replace function public.libraries_on_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_snapshot timestamptz;
begin
  new.rev        := old.rev + 1;
  new.updated_at := now();

  select max(created_at) into last_snapshot
    from public.library_versions
   where user_id = old.user_id;

  -- One snapshot per editing session, not per keystroke.
  if last_snapshot is null or last_snapshot < now() - interval '5 minutes' then
    insert into public.library_versions (user_id, rev, data)
    values (old.user_id, old.rev, old.data);

    delete from public.library_versions
     where user_id = old.user_id
       and id not in (
         select id from public.library_versions
          where user_id = old.user_id
          order by id desc
          limit 10
       );
  end if;

  return new;
end;
$$;

-- Trim anything already accumulated under the old rule.
delete from public.library_versions v
 where v.id not in (
   select id from (
     select id, row_number() over (partition by user_id order by id desc) as rn
       from public.library_versions
   ) ranked
   where ranked.rn <= 10
 );
