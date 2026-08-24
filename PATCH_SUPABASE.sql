-- PATCH 3 - Central de Mídia
-- Idempotente: pode rodar mais de uma vez.
-- No projeto MIDIA do usuário este patch já foi aplicado.

alter table public.media_files add column if not exists title text;
alter table public.media_files add column if not exists category text not null default 'outro';
alter table public.media_files add column if not exists media_kind text not null default 'video';
alter table public.media_files add column if not exists thumbnail_path text;

alter table public.media_uploads add column if not exists title text;
alter table public.media_uploads add column if not exists category text not null default 'outro';
alter table public.media_uploads add column if not exists media_kind text not null default 'video';
alter table public.media_uploads add column if not exists thumbnail_path text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'media_files_kind_check') then
    alter table public.media_files add constraint media_files_kind_check check (media_kind in ('video','photo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'media_uploads_kind_check') then
    alter table public.media_uploads add constraint media_uploads_kind_check check (media_kind in ('video','photo'));
  end if;
end $$;

update public.media_files
set title = regexp_replace(original_name, '\.[^.]+$', '')
where title is null or btrim(title) = '';

update public.media_uploads
set title = regexp_replace(original_name, '\.[^.]+$', '')
where title is null or btrim(title) = '';

alter table public.media_files alter column title set default '';
alter table public.media_uploads alter column title set default '';

create index if not exists media_files_kind_category_idx
on public.media_files(service_date, media_kind, category, created_at desc);
