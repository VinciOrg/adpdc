create table if not exists public.media_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.media_accounts(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists media_push_subscriptions_endpoint_unique_idx
  on public.media_push_subscriptions(endpoint);
create index if not exists media_push_subscriptions_user_active_idx
  on public.media_push_subscriptions(user_id, active);
alter table public.media_push_subscriptions enable row level security;
revoke all on public.media_push_subscriptions from anon, authenticated;
grant all on public.media_push_subscriptions to service_role;
