export type Side = 'red' | 'blue';
export type LobbyState = 'waiting' | 'full' | 'started' | 'ended';

export interface JoinLobbyResult {
  player_id: string;
  side: Side;
  lobby_state?: LobbyState;
  lobby_code?: string;
  player_index?: number;
  state?: any;
}

export interface ApplyCommandPayload {
  lobby_code: string;
  player_id: string;
  action: string;
  payload?: Record<string, any> | null;
}

export interface BroadcastEvent {
  type: string;
  actor?: string;
  payload?: any;
  created_at?: string;
}
