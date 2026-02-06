create or replace function public.apply_command_guard(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
    v_lobby_code text := payload->>'lobby_code';
    v_player_id uuid := (payload->>'player_id')::uuid;
    v_lobby_id uuid;
    v_state jsonb;
    v_player_index int;
    v_current int;
    v_setup_player int;
    v_setup_phase boolean;
begin
    select id, state into v_lobby_id, v_state
    from public.lobbies
    where code = v_lobby_code;

    if v_lobby_id is null then
        raise exception 'lobby not found';
    end if;

    select player_index into v_player_index
    from public.players
    where id = v_player_id and lobby_id = v_lobby_id;

    if v_player_index is null then
        raise exception 'player not in lobby';
    end if;

    v_setup_phase := coalesce((v_state->>'setupPhase')::boolean, false);
    v_setup_player := (v_state->>'setupPlayer')::int;
    v_current := (v_state->>'currentPlayer')::int;

    if v_setup_phase then
        if v_setup_player is not null and v_setup_player <> v_player_index then
            raise exception 'not your setup turn';
        end if;
    else
        if v_current is not null and v_current <> v_player_index then
            raise exception 'not your turn';
        end if;
    end if;

    return public.apply_command_json(payload);
end;
$$;
