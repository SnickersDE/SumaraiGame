import { createClient } from '@supabase/supabase-js';
import type { Side, LobbyState, JoinLobbyResult, ApplyCommandPayload, BroadcastEvent } from './types';

type GamePhase = 'LOBBY' | 'WEAPON_SELECTION' | 'START_ANIMATION' | 'PLAYING' | 'GAME_OVER';

type InitOptions = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  requireAuth?: boolean;
  onState?: (state: any) => void;
  onPhase?: (phase: GamePhase) => void;
  onWeaponSelection?: (context: {
    lobby_code: string;
    player_id: string;
    side: Side;
    sendCommand: (payload: ApplyCommandPayload) => void;
  }) => void;
  onGameOver?: (context: { winner?: number; isWinner?: boolean }) => void;
};

const SUPABASE_URL = 'https://gxcwaufhbmygixnssifv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y3dhdWZoYm15Z2l4bnNzaWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3ODc0NjYsImV4cCI6MjA4NTM2MzQ2Nn0.gl2Q-PZ83shdlsTht6khPiy4p_2GVl_-shkCU_XzEIk';

const xn = (s?: typeof fetch) => {
  const fetchFn = s || fetch;
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    if (init.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const finalInit: RequestInit = {
      ...init,
      headers
    };
    const bodyAny = finalInit.body as any;
    if (bodyAny && typeof bodyAny === 'object' && !(bodyAny instanceof FormData)) {
      finalInit.body = JSON.stringify(bodyAny);
    }
    const res = await fetchFn(input, finalInit);
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      data: json,
      text,
      raw: res
    };
  };
};

const initRpcHelper = (supabase: ReturnType<typeof createClient>) => {
  if (!supabase) {
    throw new Error('supabase client required');
  }
  const callRpc = async (name: string, params: Record<string, any> | null) => {
    if (params !== null && typeof params !== 'object') {
      throw new TypeError('rpc params must be an object');
    }
    const { data, error, status } = await supabase.rpc(name, params ?? {});
    if (error) {
      const err: any = new Error(error.message || 'rpc error');
      err.details = error;
      err.status = status;
      throw err;
    }
    return data;
  };
  const rpcJoinLobby = async ({ lobby_code }: { lobby_code?: string } = {}) => {
    if (!lobby_code || typeof lobby_code !== 'string') {
      throw new TypeError('lobby_code (string) is required');
    }
    return callRpc('join_lobby', { lobby_code });
  };
  const rpcApplyCommand = async ({ lobby_code, player_id, action, payload }: ApplyCommandPayload = {} as ApplyCommandPayload) => {
    if (!lobby_code || typeof lobby_code !== 'string') {
      throw new TypeError('lobby_code (string) is required');
    }
    if (!player_id || typeof player_id !== 'string') {
      throw new TypeError('player_id (uuid string) is required');
    }
    if (!action || typeof action !== 'string') {
      throw new TypeError('action (string) is required');
    }
    if (payload !== null && typeof payload !== 'object') {
      throw new TypeError('payload must be an object or null');
    }
    const jsonPayload = payload ?? {};
    JSON.stringify(jsonPayload);
    return callRpc('apply_command', { lobby_code, player_id, action, payload: jsonPayload });
  };
  const rpcApplyCommandJson = async ({ lobby_code, player_id, action, payload }: ApplyCommandPayload = {} as ApplyCommandPayload) => {
    if (!lobby_code || typeof lobby_code !== 'string') {
      throw new TypeError('lobby_code (string) is required');
    }
    if (!player_id || typeof player_id !== 'string') {
      throw new TypeError('player_id (uuid string) is required');
    }
    if (!action || typeof action !== 'string') {
      throw new TypeError('action (string) is required');
    }
    if (payload !== null && typeof payload !== 'object') {
      throw new TypeError('payload must be an object or null');
    }
    const jsonPayload = payload ?? {};
    JSON.stringify(jsonPayload);
    return callRpc('apply_command_json', {
      payload: {
        lobby_code,
        player_id,
        action,
        payload: jsonPayload
      }
    });
  };
  return { callRpc, rpcJoinLobby, rpcApplyCommand, rpcApplyCommandJson };
};

export const initGame = (options: InitOptions = {}) => {
  const startButton = document.getElementById('start-game') as HTMLButtonElement | null;
  const landing = document.getElementById('landing') as HTMLDivElement | null;
  const gameUi = document.getElementById('game-ui') as HTMLDivElement | null;
  const authEmailInput = document.getElementById('auth-email') as HTMLInputElement | null;
  const authPasswordInput = document.getElementById('auth-password') as HTMLInputElement | null;
  const authLoginButton = document.getElementById('auth-login') as HTMLButtonElement | null;
  const authRegisterButton = document.getElementById('auth-register') as HTMLButtonElement | null;
  const authLogoutButton = document.getElementById('auth-logout') as HTMLButtonElement | null;
  const authStatus = document.getElementById('auth-status') as HTMLDivElement | null;
  const lobbyCodeInput = document.getElementById('lobby-code') as HTMLInputElement | null;
  const createLobbyButton = document.getElementById('create-lobby') as HTMLButtonElement | null;
  const joinLobbyButton = document.getElementById('join-lobby') as HTMLButtonElement | null;
  const refreshLobbiesButton = document.getElementById('refresh-lobbies') as HTMLButtonElement | null;
  const readyLobbyButton = document.getElementById('lobby-ready') as HTMLButtonElement | null;
  const readyStatus = document.getElementById('ready-status') as HTMLDivElement | null;
  const lobbyStatus = document.getElementById('lobby-status') as HTMLDivElement | null;
  const lobbyInfo = document.getElementById('lobby-info') as HTMLDivElement | null;

  const supabaseUrl = options.supabaseUrl || SUPABASE_URL;
  const supabaseAnonKey = options.supabaseAnonKey || SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage },
    global: { headers: { apikey: supabaseAnonKey } }
  });
  const rpcHelper = initRpcHelper(supabase);

  let phase: GamePhase = 'LOBBY';
  let lobbyCode: string | null = null;
  let playerId: string | null = null;
  let playerIndex: number | null = null;
  let side: Side | null = null;
  let lobbyState: LobbyState = 'waiting';
  let readyPlayers = new Set<string>();
  let localReady = false;
  let channel: any = null;
  let stateChannel: any = null;
  let currentState: any = null;

  const setPhase = (next: GamePhase) => {
    phase = next;
    options.onPhase?.(phase);
    if (phase === 'START_ANIMATION') {
      const overlay = document.createElement('div');
      overlay.className = 'start-overlay';
      overlay.innerHTML = '<div class="start-card">Die Schlacht beginnt</div>';
      document.body.appendChild(overlay);
      setTimeout(() => {
        overlay.remove();
        setPhase('PLAYING');
      }, 2000);
    }
  };

  const setLobbyStatus = (text: string) => {
    if (lobbyStatus) lobbyStatus.textContent = text;
  };

  const updateLobbyInfo = () => {
    if (lobbyInfo) lobbyInfo.textContent = lobbyCode ? `Lobby ${lobbyCode} • Spieler ${playerIndex}` : '';
  };

  const updateReadyStatus = () => {
    if (!readyStatus) return;
    if (!lobbyCode) {
      readyStatus.textContent = '';
      return;
    }
    if (readyPlayers.size >= 2) {
      readyStatus.textContent = 'Beide bereit';
      return;
    }
    readyStatus.textContent = localReady ? 'Du bist bereit' : 'Warte auf zweiten Spieler';
  };

  const sendCommand = async (payload: ApplyCommandPayload) => {
    try {
      await rpcHelper.rpcApplyCommandJson(payload);
    } catch (error: any) {
      const message = error?.details?.message || error.message || '';
      if (message.includes('apply_command_json') || message.includes('function') || error.status === 404) {
        const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
        if (accessToken) {
          const fetchWithJson = xn();
          const url = `${supabaseUrl}/rest/v1/rpc/apply_command_json`;
          const resp = await fetchWithJson(url, {
            method: 'POST',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`
            },
            body: payload
          });
          if (resp.ok) return;
        }
      }
      await rpcHelper.rpcApplyCommand(payload);
    }
  };

  const resetReady = () => {
    readyPlayers = new Set();
    localReady = false;
    updateReadyStatus();
  };

  const enterWeaponSelection = () => {
    if (phase !== 'LOBBY') return;
    setPhase('WEAPON_SELECTION');
    if (lobbyCode && playerId && side) {
      options.onWeaponSelection?.({
        lobby_code: lobbyCode,
        player_id: playerId,
        side,
        sendCommand: (payload) => sendCommand(payload)
      });
    }
  };

  const handleGameOver = (winner?: number) => {
    setPhase('GAME_OVER');
    const isWinner = winner && playerIndex ? winner === playerIndex : false;
    const overlay = document.createElement('div');
    overlay.className = 'start-overlay';
    overlay.innerHTML = `<div class="start-card">${isWinner ? 'DU HAST GEWONNEN!' : 'DU HAST VERLOREN!'}</div>`;
    document.body.appendChild(overlay);
    setTimeout(() => {
      overlay.remove();
      landing && (landing.style.display = 'flex');
      gameUi && gameUi.classList.remove('active');
    }, 2500);
    options.onGameOver?.({ winner, isWinner });
  };

  const subscribeChannels = () => {
    if (!lobbyCode) return;
    channel?.unsubscribe?.();
    stateChannel?.unsubscribe?.();

    channel = supabase.channel(`lobby:${lobbyCode}:players`, { config: { private: true } });
    channel.on('broadcast', { event: 'player_ready' }, (payload: BroadcastEvent) => {
      const readyId = payload?.payload?.playerId;
      if (!readyId) return;
      readyPlayers.add(readyId);
      updateReadyStatus();
      if (readyPlayers.size >= 2) {
        enterWeaponSelection();
      }
    });
    channel.on('broadcast', { event: 'command_applied' }, () => {});
    channel.on('broadcast', { event: 'player_message' }, () => {});
    channel.subscribe();

    stateChannel = supabase.channel(`lobby-state:${lobbyCode}`);
    stateChannel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lobbies', filter: `code=eq.${lobbyCode}` },
      (payload: any) => {
        const state = payload.new?.state;
        currentState = state ?? currentState;
        if (state?.gameOver) {
          handleGameOver(state.winner);
          return;
        }
        if (state?.setupPhase === false && phase === 'WEAPON_SELECTION') {
          setPhase('START_ANIMATION');
        }
        options.onState?.(state);
      }
    );
    stateChannel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'players' },
      () => {}
    );
    stateChannel.subscribe();
  };

  const createLobby = async () => {
    setLobbyStatus('Erstelle Lobby...');
    const data = await rpcHelper.callRpc('create_lobby', {});
    lobbyCode = data.lobby_code;
    playerId = data.player_id;
    playerIndex = data.player_index;
    side = playerIndex === 1 ? 'red' : 'blue';
    lobbyState = 'waiting';
    updateLobbyInfo();
    resetReady();
    subscribeChannels();
    if (data.state) {
      currentState = data.state;
      options.onState?.(data.state);
    }
  };

  const joinLobby = async (code: string) => {
    const data = (await rpcHelper.rpcJoinLobby({ lobby_code: code })) as JoinLobbyResult;
    lobbyCode = data.lobby_code || code;
    playerId = data.player_id;
    playerIndex = data.player_index ?? null;
    side = playerIndex === 1 ? 'red' : 'blue';
    lobbyState = data.lobby_state ?? lobbyState;
    updateLobbyInfo();
    resetReady();
    subscribeChannels();
    if (data.state) {
      currentState = data.state;
      options.onState?.(data.state);
    }
  };

  const handleReady = () => {
    if (!channel || !lobbyCode || !playerId) return;
    if (localReady) return;
    localReady = true;
    readyPlayers.add(playerId);
    updateReadyStatus();
    channel.send({
      type: 'broadcast',
      event: 'player_ready',
      payload: { playerId }
    });
    if (readyPlayers.size >= 2) {
      enterWeaponSelection();
    }
  };

  const updateAuthUi = (session: any) => {
    if (!authStatus || !authLoginButton || !authRegisterButton || !authLogoutButton || !createLobbyButton || !joinLobbyButton || !refreshLobbiesButton || !readyLobbyButton) {
      return;
    }
    if (session?.user?.email) {
      authStatus.textContent = `Angemeldet: ${session.user.email}`;
      authLoginButton.disabled = true;
      authRegisterButton.disabled = true;
      authLogoutButton.disabled = false;
      createLobbyButton.disabled = false;
      joinLobbyButton.disabled = false;
      refreshLobbiesButton.disabled = false;
      readyLobbyButton.disabled = false;
    } else {
      authStatus.textContent = 'Nicht angemeldet';
      authLoginButton.disabled = false;
      authRegisterButton.disabled = false;
      authLogoutButton.disabled = true;
      createLobbyButton.disabled = true;
      joinLobbyButton.disabled = true;
      refreshLobbiesButton.disabled = true;
      readyLobbyButton.disabled = true;
    }
  };

  const handleLogin = async () => {
    const email = authEmailInput?.value.trim();
    const password = authPasswordInput?.value || '';
    if (!email || !password) {
      if (authStatus) authStatus.textContent = 'E-Mail und Passwort nötig';
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (authStatus) authStatus.textContent = error.message || 'Anmeldung fehlgeschlagen';
      return;
    }
    updateAuthUi(data.session);
  };

  const handleRegister = async () => {
    const email = authEmailInput?.value.trim();
    const password = authPasswordInput?.value || '';
    if (!email || !password) {
      if (authStatus) authStatus.textContent = 'E-Mail und Passwort nötig';
      return;
    }
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      if (authStatus) authStatus.textContent = error.message || 'Registrierung fehlgeschlagen';
      return;
    }
    updateAuthUi(data.session);
    if (!data.session && authStatus) {
      authStatus.textContent = 'Bestätige die E-Mail zum Einloggen';
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      if (authStatus) authStatus.textContent = error.message || 'Abmeldung fehlgeschlagen';
      return;
    }
    updateAuthUi(null);
  };

  startButton?.addEventListener('click', () => {
    if (landing) landing.style.display = 'none';
    gameUi?.classList.add('active');
    setLobbyStatus('Lobby erstellen oder beitreten');
  });

  authLoginButton?.addEventListener('click', () => handleLogin());
  authRegisterButton?.addEventListener('click', () => handleRegister());
  authLogoutButton?.addEventListener('click', () => handleLogout());

  createLobbyButton?.addEventListener('click', () => {
    createLobby().catch((error: any) => {
      setLobbyStatus(error.message || 'Lobby konnte nicht erstellt werden');
    });
  });

  joinLobbyButton?.addEventListener('click', () => {
    const code = lobbyCodeInput?.value.trim().toUpperCase();
    if (!code) {
      setLobbyStatus('Lobby-Code fehlt');
      return;
    }
    joinLobby(code).catch((error: any) => {
      setLobbyStatus(error.message || 'Lobby konnte nicht beigetreten werden');
    });
  });

  refreshLobbiesButton?.addEventListener('click', async () => {
    const { data, error } = await supabase
      .from('lobbies')
      .select('code,status,updated_at,players(count)')
      .in('status', ['waiting', 'active'])
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) {
      setLobbyStatus(error.message || 'Lobbys konnten nicht geladen werden');
      return;
    }
    const list = (data || []).map((lobby: any) => ({
      code: lobby.code,
      status: lobby.status,
      players: lobby.players?.[0]?.count ?? 0
    }));
    const lobbyList = document.getElementById('lobby-list');
    if (lobbyList) {
      lobbyList.innerHTML = '';
      list.forEach((item: any) => {
        const row = document.createElement('div');
        row.className = 'lobby-item';
        const info = document.createElement('span');
        info.textContent = `Lobby ${item.code} • ${item.players}/2 • ${item.status === 'active' ? 'läuft' : 'wartet'}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Beitreten';
        btn.addEventListener('click', () => {
          if (lobbyCodeInput) lobbyCodeInput.value = item.code;
          joinLobby(item.code).catch((error: any) => {
            setLobbyStatus(error.message || 'Lobby konnte nicht beigetreten werden');
          });
        });
        row.appendChild(info);
        row.appendChild(btn);
        lobbyList.appendChild(row);
      });
    }
  });

  readyLobbyButton?.addEventListener('click', () => handleReady());

  if (options.requireAuth) {
    supabase.auth.getSession().then(({ data }) => updateAuthUi(data.session));
    supabase.auth.onAuthStateChange((_event, session) => updateAuthUi(session));
  } else {
    updateAuthUi({ user: { email: 'anon' } });
  }

  return {
    supabase,
    rpcHelper,
    getState: () => currentState,
    getPhase: () => phase,
    sendCommand,
    joinLobby,
    createLobby
  };
};

initGame({ requireAuth: true });
