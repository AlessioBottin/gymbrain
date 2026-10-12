-- Catalog v2. Preserve IDs/references, names, notes, media and historical session snapshots.
begin;
create table public.catalog_v2_backup (
 user_id uuid not null references auth.users(id) on delete cascade,
 id uuid not null, original_record jsonb not null, migrated_at timestamptz not null default now(),
 primary key(user_id,id)
);
revoke all on public.catalog_v2_backup from public,anon,authenticated;
grant select on public.catalog_v2_backup to service_role;
create function public.normalize_catalog_exercise() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.kind='exercise' then
  new.payload := (new.payload-'mode') || jsonb_build_object(
    'exerciseType',coalesce(new.payload->>'exerciseType',case when new.payload->>'mode'='external' then 'weights' else 'bodyweight' end),
    'variants',coalesce(new.payload->'variants','[]'::jsonb));
 end if;
 return new;
end $$;
revoke all on function public.normalize_catalog_exercise() from public,anon,authenticated;
create trigger catalog_exercise_v2 before insert or update of payload on public.training_records
for each row execute function public.normalize_catalog_exercise();
-- Use the ordinary per-user lock/revision ordering; an offline stale edit becomes an explicit conflict.
do $$
declare owner uuid;
begin
 for owner in select distinct user_id from public.training_records where kind='exercise' loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner::text||'training',0));
  insert into public.catalog_v2_backup(user_id,id,original_record)
   select user_id,id,to_jsonb(r) from public.training_records r where user_id=owner and kind='exercise';
  update public.training_records set payload=payload,version=version+1,
   revision=nextval('public.training_records_revision_seq'),updated_at=now()
   where user_id=owner and kind='exercise';
 end loop;
end $$;
commit;
