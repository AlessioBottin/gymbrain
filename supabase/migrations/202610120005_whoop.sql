-- Server-owned WHOOP integration; no client grants. Apply once after review.
begin;
create table public.whoop_connections (
 user_id uuid primary key references auth.users(id) on delete cascade,
 provider_user text not null unique, tokens text not null,
 cursor jsonb, last_sync timestamptz, retry_at timestamptz, error text,
 connected_at timestamptz not null default now()
);
create table public.whoop_states (state_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade, expires_at timestamptz not null);
create table public.whoop_leases (user_id uuid primary key references auth.users(id) on delete cascade, lease_id uuid not null, expires_at timestamptz not null);
create table public.whoop_records (
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('sleep','recovery','cycle','workout')), provider_id text not null,
 measured_at timestamptz not null, provider_updated_at timestamptz not null, payload jsonb not null,
 deleted boolean not null default false, primary key(user_id,kind,provider_id)
);
create index whoop_records_owner_date on public.whoop_records(user_id,measured_at desc);
create table public.whoop_events (trace_id text primary key, user_id uuid not null references auth.users(id) on delete cascade, kind text not null, provider_id text not null, deleted boolean not null, created_at timestamptz not null default now());
create table public.whoop_links (user_id uuid not null references auth.users(id) on delete cascade, session_id uuid not null, workout_id text not null, primary key(user_id,session_id));
revoke all on public.whoop_connections,public.whoop_states,public.whoop_leases,public.whoop_records,public.whoop_events,public.whoop_links from public,anon,authenticated;
grant select,insert,update,delete on public.whoop_connections,public.whoop_states,public.whoop_leases,public.whoop_records,public.whoop_events,public.whoop_links to service_role;
create function public.whoop_acquire(owner_id uuid, lease uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare acquired boolean;
begin
 insert into public.whoop_leases values(owner_id,lease,now()+interval '3 minutes')
 on conflict(user_id) do update set lease_id=excluded.lease_id, expires_at=excluded.expires_at
 where whoop_leases.expires_at<now() or whoop_leases.lease_id=lease returning true into acquired;
 return coalesce(acquired,false);
end $$;
revoke all on function public.whoop_acquire(uuid,uuid) from public,anon,authenticated;
grant execute on function public.whoop_acquire(uuid,uuid) to service_role;
commit;
