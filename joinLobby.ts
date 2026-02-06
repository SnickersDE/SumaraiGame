export type JoinLobbyResult = {
    lobby_id: string;
    lobby_code: string;
    player_id: string | null;
    player_index: number | null;
    player_side: string | null;
    state: Record<string, unknown> | null;
} | null;

export async function joinLobby(
    client: any,
    code: string,
    side: string | null = null,
    playerId?: string | null
): Promise<{ data: JoinLobbyResult; error: any }> {
    const p_player_id = playerId ?? null;
    const p_side = side ?? null;
    const { data, error } = await client.rpc('join_lobby', {
        p_code: code,
        p_player_id,
        p_side
    });
    return { data: (data as JoinLobbyResult) ?? null, error };
}
