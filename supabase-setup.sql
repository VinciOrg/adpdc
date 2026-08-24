-- =============================================================
-- CENTRAL DE MÍDIA — SUPABASE + CLOUDFLARE R2
-- Assembleia de Deus — Ministério Praia dos Cações
-- =============================================================
-- Execute UMA VEZ no SQL Editor do Supabase.
--
-- O Supabase guarda APENAS autenticação e metadados.
-- Os vídeos brutos ficam no Cloudflare R2.
-- =============================================================

create extension if not exists pgcrypto;

-- 1) PERFIS DA EQUIPE
create table if not exists public.media_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  username text not null unique,
  role text not null default 'member' check (role in ('leader', 'editor', 'member')),
  created_at timestamptz not null default now()
);

alter table public.media_profiles enable row level security;

drop policy if exists "media_profiles_select_authenticated" on public.media_profiles;
create policy "media_profiles_select_authenticated"
on public.media_profiles for select
to authenticated
using (true);

drop policy if exists "media_profiles_insert_own" on public.media_profiles;
create policy "media_profiles_insert_own"
on public.media_profiles for insert
to authenticated
with check (auth.uid() = id and role = 'member');

-- Ninguém altera cargo pelo navegador.
drop policy if exists "media_profiles_update_own" on public.media_profiles;

-- 2) ARQUIVOS CONCLUÍDOS NO R2
create table if not exists public.media_files (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users(id) on delete cascade,
  uploader_name text not null,
  original_name text not null,
  storage_path text not null unique, -- chave do objeto no R2
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  service_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists media_files_service_date_created_idx
on public.media_files(service_date, created_at desc);

alter table public.media_files enable row level security;

drop policy if exists "media_files_select_authenticated" on public.media_files;
create policy "media_files_select_authenticated"
on public.media_files for select
to authenticated
using (true);

-- Upload e exclusão de media_files são feitos SOMENTE pelo Worker,
-- usando a chave secreta do Supabase guardada no Cloudflare.
drop policy if exists "media_files_insert_own" on public.media_files;
drop policy if exists "media_files_delete_own_or_leader" on public.media_files;

-- 3) SESSÕES DE MULTIPART UPLOAD NO R2
create table if not exists public.media_uploads (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users(id) on delete cascade,
  uploader_name text not null,
  fingerprint text not null,
  original_name text not null,
  object_key text not null unique,
  r2_upload_id text not null unique,
  mime_type text,
  size_bytes bigint not null check (size_bytes > 0),
  part_size bigint not null check (part_size >= 5242880),
  service_date date not null,
  status text not null default 'uploading'
    check (status in ('uploading', 'completed', 'aborted', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_uploads_resume_idx
on public.media_uploads(uploader_id, fingerprint, status, created_at desc);

alter table public.media_uploads enable row level security;
-- Sem policies: navegador não acessa esta tabela diretamente.

-- 4) PARTES JÁ ENVIADAS
create table if not exists public.media_upload_parts (
  upload_id uuid not null references public.media_uploads(id) on delete cascade,
  part_number integer not null check (part_number >= 1 and part_number <= 10000),
  etag text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  uploaded_at timestamptz not null default now(),
  primary key (upload_id, part_number)
);

alter table public.media_upload_parts enable row level security;
-- Sem policies: navegador não acessa esta tabela diretamente.

-- Permissões explícitas para projetos novos do Supabase.
grant usage on schema public to authenticated;
grant select, insert on public.media_profiles to authenticated;
grant select on public.media_files to authenticated;
revoke all on public.media_uploads from anon, authenticated;
revoke all on public.media_upload_parts from anon, authenticated;
grant all on public.media_profiles, public.media_files, public.media_uploads, public.media_upload_parts to service_role;

-- Remove as policies antigas do Supabase Storage caso você tenha rodado
-- a versão anterior deste projeto. O bucket antigo pode ficar; o novo
-- site simplesmente não o utiliza.
drop policy if exists "media_raw_select_authenticated" on storage.objects;
drop policy if exists "media_raw_insert_own_folder" on storage.objects;
drop policy if exists "media_raw_delete_own_or_leader" on storage.objects;

-- 5) REALTIME: arquivo aparece na hora para os outros membros
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'media_files'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.media_files;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 6) LIMPEZA OPCIONAL DE REGISTROS DE UPLOAD ANTIGOS
-- O R2 aborta multipart incompleto automaticamente após 7 dias por padrão.
-- Esta função remove apenas registros antigos do banco.
create or replace function public.media_cleanup_old_uploads()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.media_uploads
  where status in ('aborted','error')
     or (status = 'uploading' and created_at < now() - interval '8 days')
     or (status = 'completed' and created_at < now() - interval '30 days');
$$;
