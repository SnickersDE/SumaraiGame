import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import { Pool } from 'pg';
import crypto from 'crypto';

dotenv.config();

const API_PORT = Number(process.env.API_PORT || 3001);
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 3002);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json());

const lobbyConnections = new Map();
const wsClients = new Map();

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function createBoard() {
    return Array(6).fill(null).map(() => Array(7).fill(null));
}

function createInitialState() {
    return {
        board: createBoard(),
        setupPhase: true,
        setupPlayer: 1,
        currentPlayer: 1,
        gameOver: false,
        winner: null,
        flags: {},
        duel: null,
        battleSeq: 0,
        lastBattle: null,
        turnStartedAt: new Date().toISOString()
    };
}

function resolveBattle(attacker, defender, attackerPiece = null, defenderPiece = null) {
    if (attackerPiece?.type === 'd' && attackerPiece.swordLives <= 0) return 'defender';
    if (defenderPiece?.type === 'd' && defenderPiece.swordLives <= 0) return 'attacker';
    if (attacker === defender) return 'duel';

    if (attacker === 'd' && ['a', 'b', 'c'].includes(defender)) return 'attacker';
    if (defender === 'd' && ['a', 'b', 'c'].includes(attacker)) return 'defender';

    if (attacker === 'a' && defender === 'c') return 'attacker';
    if (defender === 'a' && attacker === 'c') return 'defender';

    if (attacker === 'b' && defender === 'a') return 'attacker';
    if (defender === 'b' && attacker === 'a') return 'defender';

    if (attacker === 'c' && defender === 'b') return 'attacker';
    if (defender === 'c' && attacker === 'b') return 'defender';

    if (defender === 'e') return 'attacker';
    if (attacker === 'e') return 'defender';

    return 'defender';
}

function applySwordLifeLoss(winnerPiece, loserPiece) {
    if (winnerPiece?.type !== 'd') return;
    if (!['a', 'b', 'c'].includes(loserPiece?.type)) return;
    if (winnerPiece.swordLives > 0) {
        winnerPiece.swordLives -= 1;
    }
}

function completeBattle(state, fromRow, fromCol, toRow, toCol, winner, attackerPiece, defenderPiece) {
    const movingPiece = state.board[fromRow][fromCol];
    const targetCell = state.board[toRow][toCol];
    let winningPlayer = null;

    if (winner === 'attacker') {
        if (targetCell?.type === 'e') {
            state.gameOver = true;
            winningPlayer = movingPiece.player;
        }
        applySwordLifeLoss(movingPiece, targetCell);
        state.board[toRow][toCol] = movingPiece;
    } else {
        if (movingPiece?.type === 'e') {
            state.gameOver = true;
            winningPlayer = targetCell.player;
        }
        applySwordLifeLoss(targetCell, movingPiece);
    }
    state.board[fromRow][fromCol] = null;
    state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
    state.turnStartedAt = new Date().toISOString();
    if (state.gameOver) {
        state.winner = winningPlayer;
    }
    state.battleSeq += 1;
    state.lastBattle = {
        attacker: attackerPiece,
        defender: defenderPiece,
        winner,
        fromRow,
        fromCol,
        toRow,
        toCol
    };
}

function getPlayerRows(player) {
    return player === 1 ? [0, 1] : [4, 5];
}

async function getLobbyByCode(code) {
    const { rows } = await pool.query('SELECT * FROM lobbies WHERE code = $1', [code]);
    return rows[0];
}

async function getLobbyPlayers(lobbyId) {
    const { rows } = await pool.query('SELECT * FROM players WHERE lobby_id = $1 ORDER BY player_index', [lobbyId]);
    return rows;
}

async function updateLobbyState(lobbyId, state, status) {
    await pool.query(
        'UPDATE lobbies SET state = $1, status = $2, turn_started_at = $3, updated_at = now() WHERE id = $4',
        [state, status, state.turnStartedAt ? new Date(state.turnStartedAt) : null, lobbyId]
    );
}

async function deleteLobby(lobbyId) {
    await pool.query('DELETE FROM lobbies WHERE id = $1', [lobbyId]);
}

function broadcast(lobbyCode, payload) {
    const clients = lobbyConnections.get(lobbyCode);
    if (!clients) return;
    const data = JSON.stringify(payload);
    clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
            client.send(data);
        }
    });
}

async function generateLobbyCode() {
    for (let i = 0; i < 10; i++) {
        let code = '';
        for (let j = 0; j < 5; j++) {
            code += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        const existing = await getLobbyByCode(code);
        if (!existing) return code;
    }
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

app.post('/lobbies', async (req, res) => {
    try {
        const lobbyId = crypto.randomUUID();
        const lobbyCode = await generateLobbyCode();
        const playerId = crypto.randomUUID();
        const state = createInitialState();
        await pool.query(
            'INSERT INTO lobbies (id, code, status, state, turn_started_at) VALUES ($1, $2, $3, $4, $5)',
            [lobbyId, lobbyCode, 'waiting', state, new Date(state.turnStartedAt)]
        );
        await pool.query(
            'INSERT INTO players (id, lobby_id, player_index) VALUES ($1, $2, $3)',
            [playerId, lobbyId, 1]
        );
        res.json({ lobbyId, lobbyCode, playerId, playerIndex: 1, state });
    } catch (error) {
        res.status(500).json({ message: 'Lobby konnte nicht erstellt werden' });
    }
});

app.post('/lobbies/:code/join', async (req, res) => {
    try {
        const code = req.params.code.toUpperCase();
        const lobby = await getLobbyByCode(code);
        if (!lobby) {
            res.status(404).json({ message: 'Lobby nicht gefunden' });
            return;
        }
        if (lobby.status === 'finished') {
            res.status(410).json({ message: 'Lobby bereits beendet' });
            return;
        }
        const players = await getLobbyPlayers(lobby.id);
        if (players.length >= 2) {
            res.status(409).json({ message: 'Lobby ist voll' });
            return;
        }
        const playerId = crypto.randomUUID();
        await pool.query(
            'INSERT INTO players (id, lobby_id, player_index) VALUES ($1, $2, $3)',
            [playerId, lobby.id, 2]
        );
        const state = lobby.state;
        await updateLobbyState(lobby.id, state, 'active');
        res.json({ lobbyId: lobby.id, lobbyCode: lobby.code, playerId, playerIndex: 2, state });
        broadcast(lobby.code, { type: 'state', state });
    } catch (error) {
        res.status(500).json({ message: 'Lobby konnte nicht beigetreten werden' });
    }
});

app.get('/lobbies', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `
            SELECT l.code, l.status, l.updated_at, COUNT(p.id)::int AS players
            FROM lobbies l
            LEFT JOIN players p ON p.lobby_id = l.id
            WHERE l.status IN ('waiting', 'active')
            GROUP BY l.id
            ORDER BY l.updated_at DESC
            LIMIT 50
            `
        );
        res.json({ lobbies: rows });
    } catch (error) {
        res.status(500).json({ message: 'Lobbys konnten nicht geladen werden' });
    }
});

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

const wss = new WebSocketServer({ port: GATEWAY_PORT });

wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
        let message;
        try {
            message = JSON.parse(data.toString());
        } catch (error) {
            ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Nachricht' }));
            return;
        }

        if (message.type === 'hello') {
            const lobby = await getLobbyByCode(message.lobbyCode);
            if (!lobby) {
                ws.send(JSON.stringify({ type: 'error', message: 'Lobby nicht gefunden' }));
                return;
            }
            const { rows } = await pool.query(
                'SELECT * FROM players WHERE lobby_id = $1 AND id = $2',
                [lobby.id, message.playerId]
            );
            if (!rows.length) {
                ws.send(JSON.stringify({ type: 'error', message: 'Spieler nicht gefunden' }));
                return;
            }
            const playerIndex = rows[0].player_index;
            wsClients.set(ws, { lobbyCode: lobby.code, playerId: message.playerId, playerIndex });
            if (!lobbyConnections.has(lobby.code)) {
                lobbyConnections.set(lobby.code, new Set());
            }
            lobbyConnections.get(lobby.code).add(ws);
            ws.send(JSON.stringify({ type: 'state', state: lobby.state }));
            return;
        }

        if (message.type !== 'command') return;
        const client = wsClients.get(ws);
        if (!client) return;

        const lobby = await getLobbyByCode(client.lobbyCode);
        if (!lobby) {
            ws.send(JSON.stringify({ type: 'error', message: 'Lobby nicht gefunden' }));
            return;
        }
        const state = lobby.state;
        const playerIndex = client.playerIndex;
        let updated = false;

        if (message.action === 'placeFlag') {
            if (!state.setupPhase || state.setupPlayer !== playerIndex) {
                ws.send(JSON.stringify({ type: 'error', message: 'Nicht deine Phase' }));
                return;
            }
            if (state.flags[playerIndex]) {
                ws.send(JSON.stringify({ type: 'error', message: 'Fahne bereits platziert' }));
                return;
            }
            const { row, col } = message.payload || {};
            if (row === undefined || col === undefined) {
                ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Position' }));
                return;
            }
            const rows = getPlayerRows(playerIndex);
            if (!rows.includes(row)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Reihe' }));
                return;
            }
            state.board[row][col] = { player: playerIndex, type: 'e' };
            state.flags[playerIndex] = { row, col };
            updated = true;
        }

        if (message.action === 'assignSetup') {
            if (!state.setupPhase || state.setupPlayer !== playerIndex) {
                ws.send(JSON.stringify({ type: 'error', message: 'Nicht deine Phase' }));
                return;
            }
            if (!state.flags[playerIndex]) {
                ws.send(JSON.stringify({ type: 'error', message: 'Fahne fehlt' }));
                return;
            }
            const assignments = message.payload?.assignments;
            if (!assignments || Object.keys(assignments).length !== 13) {
                ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Aufstellung' }));
                return;
            }
            const counts = { a: 0, b: 0, c: 0, d: 0 };
            const rows = getPlayerRows(playerIndex);
            const flag = state.flags[playerIndex];
            rows.forEach((row) => {
                for (let col = 0; col < 7; col++) {
                    if (row === flag.row && col === flag.col) continue;
                    state.board[row][col] = null;
                }
            });
            for (const [key, type] of Object.entries(assignments)) {
                const [row, col] = key.split('-').map(Number);
                if (!rows.includes(row)) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Reihe' }));
                    return;
                }
                if (row === flag.row && col === flag.col) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Fahnenfeld belegt' }));
                    return;
                }
                if (!['a', 'b', 'c', 'd'].includes(type)) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Ungültiger Typ' }));
                    return;
                }
                counts[type] += 1;
                const piece = { player: playerIndex, type };
                if (type === 'd') {
                    piece.swordLives = 3;
                }
                state.board[row][col] = piece;
            }
            if (counts.a !== 4 || counts.b !== 4 || counts.c !== 4 || counts.d !== 1) {
                ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Anzahl' }));
                return;
            }
            state.setupPlayer = playerIndex === 1 ? 2 : 1;
            if (playerIndex === 2) {
                state.setupPhase = false;
                state.currentPlayer = 1;
                state.turnStartedAt = new Date().toISOString();
            }
            updated = true;
        }

        if (message.action === 'move') {
            if (state.setupPhase || state.gameOver) {
                ws.send(JSON.stringify({ type: 'error', message: 'Spiel nicht bereit' }));
                return;
            }
            if (state.currentPlayer !== playerIndex) {
                ws.send(JSON.stringify({ type: 'error', message: 'Nicht dein Zug' }));
                return;
            }
            const { fromRow, fromCol, toRow, toCol } = message.payload || {};
            const movingPiece = state.board[fromRow]?.[fromCol];
            if (!movingPiece || movingPiece.player !== playerIndex) {
                ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Figur' }));
                return;
            }
            const rowDiff = Math.abs(toRow - fromRow);
            const colDiff = Math.abs(toCol - fromCol);
            if (!((rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1))) {
                ws.send(JSON.stringify({ type: 'error', message: 'Ungültiger Zug' }));
                return;
            }
            const targetCell = state.board[toRow]?.[toCol] || null;
            if (targetCell && targetCell.player === playerIndex) {
                ws.send(JSON.stringify({ type: 'error', message: 'Feld belegt' }));
                return;
            }
            if (targetCell) {
                const result = resolveBattle(movingPiece.type, targetCell.type, movingPiece, targetCell);
                if (result === 'duel') {
                    state.duel = {
                        fromRow,
                        fromCol,
                        toRow,
                        toCol,
                        attacker: movingPiece,
                        defender: targetCell,
                        choices: { 1: null, 2: null }
                    };
                    updated = true;
                } else {
                    completeBattle(state, fromRow, fromCol, toRow, toCol, result, movingPiece, targetCell);
                    updated = true;
                }
            } else {
                state.board[toRow][toCol] = movingPiece;
                state.board[fromRow][fromCol] = null;
                state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
                state.turnStartedAt = new Date().toISOString();
                updated = true;
            }
        }

        if (message.action === 'duelChoice') {
            if (!state.duel) {
                ws.send(JSON.stringify({ type: 'error', message: 'Kein Duell aktiv' }));
                return;
            }
            const choice = message.payload?.choice;
            if (!['a', 'b', 'c'].includes(choice)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Ungültige Wahl' }));
                return;
            }
            if (state.duel.choices[playerIndex]) {
                ws.send(JSON.stringify({ type: 'error', message: 'Bereits gewählt' }));
                return;
            }
            state.duel.choices[playerIndex] = choice;
            updated = true;
            const p1Choice = state.duel.choices[1];
            const p2Choice = state.duel.choices[2];
            if (p1Choice && p2Choice) {
                if (p1Choice === p2Choice) {
                    state.duel.choices = { 1: null, 2: null };
                } else {
                    const winner = resolveBattle(p1Choice, p2Choice);
                    const { fromRow, fromCol, toRow, toCol, attacker, defender } = state.duel;
                    completeBattle(state, fromRow, fromCol, toRow, toCol, winner, attacker, defender);
                    state.duel = null;
                }
                updated = true;
            }
        }

        if (updated) {
            const status = state.gameOver ? 'finished' : lobby.status;
            await updateLobbyState(lobby.id, state, status);
            broadcast(lobby.code, { type: 'state', state });
            if (state.gameOver) {
                setTimeout(() => deleteLobby(lobby.id).catch(() => {}), 5000);
            }
        }
    });

    ws.on('close', () => {
        const client = wsClients.get(ws);
        wsClients.delete(ws);
        if (!client) return;
        const set = lobbyConnections.get(client.lobbyCode);
        if (set) {
            set.delete(ws);
            if (set.size === 0) lobbyConnections.delete(client.lobbyCode);
        }
    });
});

setInterval(async () => {
    try {
        const { rows } = await pool.query(
            "SELECT id, code, state FROM lobbies WHERE status = 'active' AND turn_started_at < now() - interval '2 minutes'"
        );
        for (const lobby of rows) {
            broadcast(lobby.code, { type: 'lobbyClosed', reason: 'timeout' });
            await deleteLobby(lobby.id);
        }
    } catch (error) {}
}, 5000);

app.listen(API_PORT, () => {
    console.log(`API listening on ${API_PORT}`);
});
