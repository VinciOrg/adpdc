-- CENTRAL DE MÍDIA — AUTENTICAÇÃO POR USUÁRIO + SENHA (SEM E-MAIL)
-- Execute apenas em um projeto novo. No projeto MIDIA esta estrutura já foi aplicada.

create extension if not exists pgcrypto;

create table if not exists public.media_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  name text not null,
  role text not null default 'member' check (role in ('leader','editor','member')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_accounts_username_format check (username ~ '^[a-z0-9._-]{3,32}$')
);
create unique index if not exists media_accounts_username_unique_idx on public.media_accounts(lower(username));

create table if not exists public.media_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.media_accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.media_files (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.media_accounts(id) on delete restrict,
  uploader_name text not null, original_name text not null, storage_path text not null unique,
  mime_type text, size_bytes bigint not null default 0, service_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.media_uploads (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.media_accounts(id) on delete cascade,
  uploader_name text not null, fingerprint text not null, original_name text not null,
  object_key text not null unique, r2_upload_id text not null unique, mime_type text,
  size_bytes bigint not null, part_size bigint not null, service_date date not null,
  status text not null default 'uploading', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_upload_parts (
  upload_id uuid not null references public.media_uploads(id) on delete cascade,
  part_number integer not null, etag text not null, size_bytes bigint not null,
  uploaded_at timestamptz not null default now(), primary key(upload_id, part_number)
);

alter table public.media_accounts enable row level security;
alter table public.media_sessions enable row level security;
alter table public.media_files enable row level security;
alter table public.media_uploads enable row level security;
alter table public.media_upload_parts enable row level security;
revoke all on public.media_accounts, public.media_sessions, public.media_files, public.media_uploads, public.media_upload_parts from anon, authenticated;
grant all on public.media_accounts, public.media_sessions, public.media_files, public.media_uploads, public.media_upload_parts to service_role;

create or replace function public.media_check_credentials(p_username text, p_password text)
returns table(id uuid, name text, username text, role text)
language sql security definer set search_path=public,extensions as $$
  select a.id,a.name,a.username,a.role from public.media_accounts a
  where lower(a.username)=lower(trim(p_username)) and a.active=true
    and a.password_hash=crypt(p_password,a.password_hash) limit 1;
$$;
revoke all on function public.media_check_credentials(text,text) from public,anon,authenticated;
grant execute on function public.media_check_credentials(text,text) to service_role;
