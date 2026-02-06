create extension if not exists pgcrypto;

alter table public.players
add column if not exists auth_user_id uuid;

alter table public.lobbies
add column if not exists is_public boolean not null default false;

create index if not exists idx_players_lobby_id on public.players (lobby_id);
create index if not exists idx_players_auth_user_id on public.players (auth_user_id);

create or replace function public.extract_lobby_id(topic text)
returns uuid
language sql
stable
as $$
select
    case
        when topic ~* '^[0-9a-f-]{36}$' then topic::uuid
        when topic ~* '^lobby:[0-9a-f-]{36}:players$' then substring(topic from 'lobby:([0-9a-f-]{36}):players')::uuid
        else null
    end
$$;

alter table realtime.messages enable row level security;

drop policy if exists rt_read_members_only on realtime.messages;
drop policy if exists rt_write_members_only on realtime.messages;
drop policy if exists rt_read_anon on realtime.messages;
drop policy if exists rt_read_anon_public_lobbies on realtime.messages;

create policy rt_read_members_only
on realtime.messages
for select
to authenticated
using (
    exists (
        select 1
        from public.players p
        where p.lobby_id = public.extract_lobby_id(realtime.messages.topic)
          and p.auth_user_id = auth.uid()
    )
);

create policy rt_write_members_only
on realtime.messages
for insert
to authenticated
with check (
    exists (
        select 1
        from public.players p
        where p.lobby_id = public.extract_lobby_id(realtime.messages.topic)
          and p.auth_user_id = auth.uid()
    )
);

create policy rt_read_anon_public_lobbies
on realtime.messages
for select
to anon
using (
    exists (
        select 1
        from public.lobbies l
        where l.id = public.extract_lobby_id(realtime.messages.topic)
          and l.is_public = true
    )
);
