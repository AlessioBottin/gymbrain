-- READ ONLY: execute in a NEW, EMPTY query tab, never appended to migration SQL.
select c.relname as name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('training_records','tracking_records','gymbrain_operations')
order by c.relname;
select schemaname,tablename,policyname,roles,cmd from pg_policies
where (schemaname='public' and tablename in ('training_records','tracking_records','gymbrain_operations'))
or (schemaname='storage' and policyname in ('videos_read','videos_insert','videos_delete'));
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='exercise-videos';
select rolname,rolcanlogin,rolbypassrls from pg_roles where rolname='gymbrain_writer';
