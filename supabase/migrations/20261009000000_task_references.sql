insert into storage.buckets (id, name, public, file_size_limit)
values ('task-references', 'task-references', false, 52428800)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

create table if not exists public.task_references (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  path text not null unique,
  file_name text not null,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint task_references_size_limit check (size_bytes is null or size_bytes <= 52428800)
);

create index if not exists task_references_task_id_created_at_idx
  on public.task_references (task_id, created_at);

alter table public.task_references enable row level security;

drop policy if exists "Admins manage task references" on public.task_references;
create policy "Admins manage task references"
on public.task_references
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin = true
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin = true
  )
);

drop policy if exists "Assigned employees read task references" on public.task_references;
create policy "Assigned employees read task references"
on public.task_references
for select
to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_references.task_id
      and t.assigned_to = (select auth.uid())
  )
);

drop policy if exists "Admins manage task reference objects" on storage.objects;
create policy "Admins manage task reference objects"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'task-references'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin = true
  )
)
with check (
  bucket_id = 'task-references'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_admin = true
  )
);

drop policy if exists "Assigned employees read task reference objects" on storage.objects;
create policy "Assigned employees read task reference objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-references'
  and exists (
    select 1
    from public.task_references r
    join public.tasks t on t.id = r.task_id
    where r.path = storage.objects.name
      and t.assigned_to = (select auth.uid())
  )
);
