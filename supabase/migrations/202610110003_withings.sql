-- Server-owned integration state; no browser grants or per-user RLS.
begin;
create table public.withings_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 provider_user text not null unique,
 tokens text not null,
 webhook_hash text not null unique,
 subscribed boolean not null default false,
 last_cursor bigint not null default 0,
 scan_offset integer not null default 0,
 scan_started bigint,
 last_sync timestamptz,
 last_attempt timestamptz,
 pending boolean not null default true,
 error text,
 connected_at timestamptz not null default now()
);
create table public.withings_states (
 state_hash text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 expires_at timestamptz not null
);
create table public.withings_leases (
 user_id uuid primary key references auth.users(id) on delete cascade,
 lease_id uuid not null,
 expires_at timestamptz not null
);
revoke all on public.withings_connections,public.withings_states,public.withings_leases from public,anon,authenticated;
grant select,insert,update,delete on public.withings_connections,public.withings_states,public.withings_leases to service_role;
create function public.withings_acquire(owner_id uuid, lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare acquired boolean;
begin
 insert into public.withings_leases(user_id,lease_id,expires_at) values(owner_id,lease,now()+interval '3 minutes')
 on conflict(user_id) do update set lease_id=excluded.lease_id,expires_at=excluded.expires_at
 where withings_leases.expires_at<now() or withings_leases.lease_id=lease returning true into acquired;
 return coalesce(acquired,false);
end $$;
revoke all on function public.withings_acquire(uuid,uuid) from public,anon,authenticated;
grant execute on function public.withings_acquire(uuid,uuid) to service_role;

-- The tracking module owns these records. Same revision lock as ordinary writes.
create unique index tracking_external_weight on public.tracking_records(user_id,(payload->>'externalId'))
where kind='weight' and payload->>'source'='withings';
create function public.tracking_import_weight(owner_id uuid, document jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare existing public.tracking_records; external_id text:=document->>'externalId';
begin
 if owner_id is null or document->>'source' is distinct from 'withings' or external_id is null
 or length(external_id)>200 or (document->>'kg')::numeric<=0 or (document->>'kg')::numeric>500
 or document->>'kg' is null or document->>'measuredAt' is null then raise exception 'Invalid weight' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text||'tracking',0));
 select * into existing from public.tracking_records where user_id=owner_id and kind='weight' and payload->>'externalId'=external_id and payload->>'source'='withings';
 if found then
  -- A local deletion remains a tombstone even on full re-import.
  if existing.deleted or existing.payload=document then return false; end if;
  update public.tracking_records set payload=document,version=version+1,revision=nextval('public.tracking_records_revision_seq'),updated_at=now()
  where user_id=owner_id and id=existing.id;
 else
  insert into public.tracking_records(user_id,id,kind,payload) values(owner_id,gen_random_uuid(),'weight',document);
 end if;
 return true;
end $$;
revoke all on function public.tracking_import_weight(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tracking_import_weight(uuid,jsonb) to service_role;
commit;
