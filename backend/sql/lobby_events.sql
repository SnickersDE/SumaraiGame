create extension if not exists pgcrypto;

create table if not exists public.lobby_members (
    id uuid primary key default gen_random_uuid(),
    lobby_id uuid not null references public.lobbies(id) on delete cascade,
    player_id uuid not null references public.players(id) on delete cascade,
    auth_user_id uuid,
    side text,
    created_at timestamptz default now(),
    unique (lobby_id, player_id)
);

create unique index if not exists idx_lobby_members_side_unique
on public.lobby_members (lobby_id, side)
where side is not null;

create table if not exists public.lobby_events (
    id uuid primary key default gen_random_uuid(),
    lobby_id uuid not null references public.lobbies(id) on delete cascade,
    player_id uuid references public.players(id) on delete set null,
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz default now()
);

create index if not exists idx_lobby_events_lobby_id on public.lobby_events (lobby_id);
create index if not exists idx_lobby_events_created_at on public.lobby_events (created_at);

create or replace function public.create_lobby_event(
    p_lobby_id uuid,
    p_player_id uuid,
    p_event_type text,
    p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
as $$
begin
    if not exists (
        select 1 from public.lobby_members
        where lobby_id = p_lobby_id and player_id = p_player_id
    ) then
        raise exception 'player not member of lobby';
    end if;

    insert into public.lobby_events (lobby_id, player_id, event_type, payload)
    values (p_lobby_id, p_player_id, p_event_type, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.join_lobby(
    p_code text,
    p_player_id uuid default null,
    p_side text default null
) returns table (
    lobby_id uuid,
    lobby_code text,
    player_id uuid,
    player_index int,
    player_side text,
    state jsonb
)
language plpgsql
as $$
declare
    v_lobby_id uuid;
    v_state jsonb;
    v_player_id uuid;
    v_player_index int;
    v_side text;
begin
    select id, state into v_lobby_id, v_state
    from public.lobbies
    where code = p_code;

    if v_lobby_id is null then
        raise exception 'lobby not found';
    end if;

    if p_player_id is not null then
        if not exists (
            select 1 from public.lobby_members
            where lobby_id = v_lobby_id and player_id = p_player_id
        ) then
            raise exception 'player not member of lobby';
        end if;
        v_player_id := p_player_id;
        select player_index into v_player_index from public.players where id = v_player_id;
        select side into v_side from public.lobby_members where lobby_id = v_lobby_id and player_id = v_player_id;
    else
        select count(*) into v_player_index from public.players where lobby_id = v_lobby_id;
        v_player_index := v_player_index + 1;
        if v_player_index > 2 then
            raise exception 'lobby full';
        end if;

        v_player_id := gen_random_uuid();
        insert into public.players (id, lobby_id, player_index)
        values (v_player_id, v_lobby_id, v_player_index);

        if p_side in ('red', 'blue') then
            if exists (
                select 1 from public.lobby_members
                where lobby_id = v_lobby_id and side = p_side
            ) then
                v_side := case when p_side = 'red' then 'blue' else 'red' end;
            else
                v_side := p_side;
            end if;
        else
            if exists (
                select 1 from public.lobby_members
                where lobby_id = v_lobby_id and side = 'red'
            ) then
                v_side := 'blue';
            else
                v_side := 'red';
            end if;
        end if;

        insert into public.lobby_members (lobby_id, player_id, auth_user_id, side)
        values (v_lobby_id, v_player_id, auth.uid(), v_side);

        if v_player_index = 2 then
            update public.lobbies
            set status = 'active',
                state = jsonb_set(
                    coalesce(state, '{}'::jsonb),
                    '{turnStartedAt}',
                    to_jsonb(now()),
                    true
                )
            where id = v_lobby_id;

            insert into public.lobby_events (lobby_id, player_id, event_type, payload)
            values (
                v_lobby_id,
                v_player_id,
                'game_started',
                jsonb_build_object(
                    'lobby_id', v_lobby_id,
                    'lobby_code', p_code,
                    'player_id', v_player_id,
                    'ts', now()
                )
            );
        end if;
    end if;

    return query
    select v_lobby_id, p_code, v_player_id, v_player_index, v_side, v_state;
end;
$$;
