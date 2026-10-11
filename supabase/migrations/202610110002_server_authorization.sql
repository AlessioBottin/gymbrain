-- Supersedes per-user RLS. Only Fastify holds the server key and verifies owner identity.
-- Browser roles cannot read tables, mutate data, or access media without a server-signed URL.
begin;
revoke all on public.training_records,public.tracking_records,public.gymbrain_operations from anon,authenticated,gymbrain_writer;
revoke execute on function public.gymbrain_apply(text,uuid,uuid,text,uuid,integer,jsonb,boolean),public.training_apply(uuid,uuid,text,uuid,integer,jsonb,boolean),public.tracking_apply(uuid,uuid,text,uuid,integer,jsonb,boolean) from public,anon,authenticated;
alter table public.training_records disable row level security;
alter table public.tracking_records disable row level security;
alter table public.gymbrain_operations disable row level security;
grant select,insert,update on public.training_records,public.tracking_records,public.gymbrain_operations to service_role;
grant usage,select on sequence public.training_records_revision_seq,public.tracking_records_revision_seq to service_role;
create function public.gymbrain_server_apply(owner_id uuid,module text,operation_id uuid,record_id uuid,record_kind text,parent_id uuid,base_version integer,document jsonb,is_deleted boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=owner_id; existing jsonb; result jsonb; previous_request jsonb; request_doc jsonb; parent_kind text; parent_deleted boolean; table_name text;
begin
 if uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if module not in ('training','tracking') or base_version<0 or record_id is null or operation_id is null then raise exception 'Invalid request' using errcode='22023'; end if;
 table_name:=module||'_records';
 -- Serialize writes per owner/module. Revisions cannot be committed out of order for a user.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text||module,0));
 request_doc:=jsonb_build_object('id',record_id,'kind',record_kind,'parent',parent_id,'base',base_version,'document',document,'deleted',is_deleted);
 select o.response,o.request into result,previous_request from public.gymbrain_operations o where o.user_id=uid and o.module=gymbrain_server_apply.module and o.operation_id=gymbrain_server_apply.operation_id;
 if found then
  if previous_request<>request_doc then raise exception 'Operation ID already used' using errcode='22023'; end if;
  return result;
 end if;
 execute format('select to_jsonb(r) from public.%I r where user_id=$1 and id=$2',table_name) into existing using uid,record_id;
 if coalesce((existing->>'version')::integer,0)<>base_version then return jsonb_build_object('conflict',true,'record',existing); end if;
 if existing is not null and (existing->>'kind'<>record_kind or (existing->>'parent_id')::uuid is distinct from parent_id) then raise exception 'Record type/parent immutable' using errcode='22023'; end if;
 if module='training' and parent_id is not null then
  select r.kind,r.deleted into parent_kind,parent_deleted from public.training_records r where r.user_id=uid and r.id=gymbrain_server_apply.parent_id;
  if not found or parent_deleted or (record_kind='plan' and parent_kind<>'cycle') or (record_kind='workout' and parent_kind<>'plan') then raise exception 'Invalid parent' using errcode='23503'; end if;
 end if;
 if module='training' and is_deleted and exists(select 1 from public.training_records r where r.user_id=uid and r.parent_id=record_id and not r.deleted) then raise exception 'Delete children first' using errcode='23503'; end if;
 if jsonb_typeof(document)<>'object' or document is null or octet_length(document::text)>524288 then raise exception 'Invalid document' using errcode='22023'; end if;
 if existing is null then
  execute format('insert into public.%I(user_id,id,kind,parent_id,payload,deleted) values($1,$2,$3,$4,$5,$6) returning to_jsonb(%I.*)',table_name,table_name) into result using uid,record_id,record_kind,parent_id,document,is_deleted;
 else
  execute format('update public.%I set payload=$3,deleted=$4,version=version+1,revision=nextval(%L::regclass),updated_at=now() where user_id=$1 and id=$2 returning to_jsonb(%I.*)',table_name,'public.'||table_name||'_revision_seq',table_name) into result using uid,record_id,document,is_deleted;
 end if;
 result:=jsonb_build_object('record',result,'conflict',false);
 insert into public.gymbrain_operations(user_id,module,operation_id,request,response) values(uid,module,operation_id,request_doc,result);
 return result;
end $$;
revoke all on function public.gymbrain_server_apply(uuid,text,uuid,uuid,text,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.gymbrain_server_apply(uuid,text,uuid,uuid,text,uuid,integer,jsonb,boolean) to service_role;
create function public.training_server_apply(owner_id uuid,operation_id uuid,record_id uuid,record_kind text,parent_id uuid,base_version integer,document jsonb,is_deleted boolean)
returns jsonb language sql security invoker set search_path='' as $$ select public.gymbrain_server_apply(owner_id,'training',operation_id,record_id,record_kind,parent_id,base_version,document,is_deleted) $$;
revoke all on function public.training_server_apply(uuid,uuid,uuid,text,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.training_server_apply(uuid,uuid,uuid,text,uuid,integer,jsonb,boolean) to service_role;
create function public.tracking_server_apply(owner_id uuid,operation_id uuid,record_id uuid,record_kind text,parent_id uuid,base_version integer,document jsonb,is_deleted boolean)
returns jsonb language sql security invoker set search_path='' as $$ select public.gymbrain_server_apply(owner_id,'tracking',operation_id,record_id,record_kind,parent_id,base_version,document,is_deleted) $$;
revoke all on function public.tracking_server_apply(uuid,uuid,uuid,text,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.tracking_server_apply(uuid,uuid,uuid,text,uuid,integer,jsonb,boolean) to service_role;
drop policy if exists videos_read on storage.objects;
drop policy if exists videos_insert on storage.objects;
drop policy if exists videos_delete on storage.objects;
commit;
