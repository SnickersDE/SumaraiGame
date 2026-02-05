const SYMBOLS = {
    e: ''
};

const STORAGE_KEY = 'samurai-state-v1';
const USER_KEY = 'samurai-user-v1';
const LOBBY_KEY = 'samurai-lobby-v1';
const CHANNEL_NAME = 'samurai-realtime-v1';

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;
const supabaseClient = window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;
let lobbyMessagesChannel = null;
let realtimeLobbyId = null;

async function setRealtimeAuthFromSession(session) {
    if (!supabaseClient || !session?.access_token) return;
    supabaseClient.realtime.setAuth(session.access_token);
}

async function ensurePlayerAuthRow(lobbyId) {
    if (!supabaseClient || !currentUser || !lobbyId) return;
    const { data } = await supabaseClient.auth.getSession();
    const session = data?.session;
    if (!session?.user?.id) return;
    await supabaseClient.from('players').upsert({
        id: currentUser.id,
        lobby_id: lobbyId,
        auth_user_id: session.user.id
    }, { onConflict: 'id' });
}

function subscribePrivateLobbyChannel(lobbyId) {
    if (!supabaseClient || !lobbyId) return;
    if (lobbyMessagesChannel) {
        supabaseClient.removeChannel(lobbyMessagesChannel);
    }
    lobbyMessagesChannel = supabaseClient
        .channel(`lobby:${lobbyId}:messages`, { config: { private: true } })
        .on('broadcast', { event: 'message_created' }, payload => {
            if (payload?.payload?.type === 'state_sync') {
                syncStateFromStorage();
            }
        })
        .subscribe();
    realtimeLobbyId = lobbyId;
}

function clearLobbyChannel() {
    if (!supabaseClient || !lobbyMessagesChannel) return;
    supabaseClient.removeChannel(lobbyMessagesChannel);
    lobbyMessagesChannel = null;
    realtimeLobbyId = null;
}

function createId() {
    return `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-5)}`;
}

function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return { users: {}, lobbies: {}, updatedAt: Date.now() };
    }
    try {
        return JSON.parse(raw);
    } catch {
        return { users: {}, lobbies: {}, updatedAt: Date.now() };
    }
}

function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (channel) {
        channel.postMessage({ type: 'state', updatedAt: state.updatedAt });
    }
}

function updateState(updater) {
    const current = loadState();
    const next = updater(current) || current;
    next.updatedAt = Date.now();
    saveState(next);
    return next;
}

function emptyBoard() {
    return Array(6).fill(null).map(() => Array(7).fill(null));
}

function createNewGameState() {
    return {
        board: emptyBoard(),
        currentPlayer: 1,
        selectedCell: null,
        gameOver: false,
        winner: null,
        setupPhase: true,
        setupPlayer: 1,
        player1Setup: [],
        player2Setup: [],
        pendingDuel: null,
        turnIndex: 1,
        turnEndsAt: null,
        lastPenaltyTurnIndex: 0,
        p1Penalties: 0,
        p2Penalties: 0
    };
}

function formatTime(ms) {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getPlayerNumber(lobby, userId) {
    const index = lobby.players.indexOf(userId);
    return index === -1 ? null : index + 1;
}

function generateRandomSetup(player) {
    const rows = player === 1 ? [0, 1] : [4, 5];
    const cells = [];
    rows.forEach(row => {
        for (let col = 0; col < 7; col++) {
            cells.push({ row, col });
        }
    });
    const flagIndex = Math.floor(Math.random() * cells.length);
    const flagPos = cells.splice(flagIndex, 1)[0];
    const pool = [
        ...Array(4).fill('a'),
        ...Array(4).fill('b'),
        ...Array(4).fill('c'),
        ...Array(1).fill('d')
    ];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const assignments = {};
    cells.forEach((cell, idx) => {
        assignments[`${cell.row}-${cell.col}`] = pool[idx];
    });
    return { flagPos, assignments };
}

function applySetupToState(gameState, player, setupData) {
    const nextState = { ...gameState, board: gameState.board.map(row => row.map(cell => (cell ? { ...cell } : null))) };
    nextState.board[setupData.flagPos.row][setupData.flagPos.col] = { player, type: 'e' };
    if (player === 1) {
        nextState.player1Setup = [setupData.flagPos];
    } else {
        nextState.player2Setup = [setupData.flagPos];
    }
    Object.entries(setupData.assignments).forEach(([key, type]) => {
        const [row, col] = key.split('-').map(Number);
        const piece = { player, type };
        if (type === 'd') {
            piece.swordLives = 3;
        }
        nextState.board[row][col] = piece;
    });
    return nextState;
}

class Game {
    constructor(options = {}) {
        this.multiplayer = options.multiplayer ?? false;
        this.playerNumber = options.playerNumber ?? 1;
        this.onStateChange = options.onStateChange ?? null;
        this.onGameEnd = options.onGameEnd ?? null;
        this.suppressSync = false;
        this.setupInProgress = false;
        this.endModalShown = false;
        if (options.initialState) {
            this.setState(options.initialState);
        } else {
            this.initializeNewGame();
        }
        if (!this.multiplayer) {
            this.startSetupPhase();
        } else {
            this.render();
        }
    }

    initializeNewGame() {
        this.board = emptyBoard();
        this.currentPlayer = 1;
        this.selectedCell = null;
        this.gameOver = false;
        this.winner = null;
        this.setupPhase = true;
        this.setupPlayer = 1;
        this.player1Setup = [];
        this.player2Setup = [];
        this.pendingDuel = null;
        this.turnIndex = 1;
        this.turnEndsAt = null;
        this.lastPenaltyTurnIndex = 0;
        this.p1Penalties = 0;
        this.p2Penalties = 0;
        this.endModalShown = false;
        this.render();
    }

    setState(state) {
        this.board = state.board || emptyBoard();
        this.currentPlayer = state.currentPlayer ?? 1;
        this.selectedCell = state.selectedCell ?? null;
        this.gameOver = state.gameOver ?? false;
        this.winner = state.winner ?? null;
        this.setupPhase = state.setupPhase ?? true;
        this.setupPlayer = state.setupPlayer ?? 1;
        this.player1Setup = state.player1Setup ?? [];
        this.player2Setup = state.player2Setup ?? [];
        this.pendingDuel = state.pendingDuel ?? null;
        this.turnIndex = state.turnIndex ?? 1;
        this.turnEndsAt = state.turnEndsAt ?? null;
        this.lastPenaltyTurnIndex = state.lastPenaltyTurnIndex ?? 0;
        this.p1Penalties = state.p1Penalties ?? 0;
        this.p2Penalties = state.p2Penalties ?? 0;
    }

    exportState() {
        return {
            board: this.board,
            currentPlayer: this.currentPlayer,
            selectedCell: this.selectedCell,
            gameOver: this.gameOver,
            winner: this.winner,
            setupPhase: this.setupPhase,
            setupPlayer: this.setupPlayer,
            player1Setup: this.player1Setup,
            player2Setup: this.player2Setup,
            pendingDuel: this.pendingDuel,
            turnIndex: this.turnIndex,
            turnEndsAt: this.turnEndsAt,
            lastPenaltyTurnIndex: this.lastPenaltyTurnIndex,
            p1Penalties: this.p1Penalties,
            p2Penalties: this.p2Penalties
        };
    }

    applyRemoteState(state) {
        const wasGameOver = this.gameOver;
        this.suppressSync = true;
        this.setState(state);
        this.suppressSync = false;
        this.render();
        if (!wasGameOver && this.gameOver && this.winner) {
            if (this.onGameEnd) {
                this.onGameEnd(this.winner);
            }
            this.showEndModal(this.winner);
        }
    }

    syncState() {
        if (this.suppressSync) return;
        if (this.onStateChange) {
            this.onStateChange(this.exportState());
        }
    }

    startSetupPhase() {
        this.showSetupModal(1, flagPos => {
            this.showPieceAssignmentModal(1, flagPos, assignments => {
                this.applySetupToBoard(1, flagPos, assignments);
                this.showSetupModal(2, flagPos2 => {
                    this.showPieceAssignmentModal(2, flagPos2, assignments2 => {
                        this.applySetupToBoard(2, flagPos2, assignments2);
                        this.setupPhase = false;
                        this.currentPlayer = 1;
                        this.turnIndex = 1;
                        this.turnEndsAt = Date.now() + 30000;
                        this.p1Penalties = 0;
                        this.p2Penalties = 0;
                        this.lastPenaltyTurnIndex = 0;
                        this.winner = null;
                        this.endModalShown = false;
                        this.render();
                        this.syncState();
                    });
                });
            });
        });
    }

    beginPlayerSetup(player, onConfirmed) {
        if (this.setupInProgress) return;
        this.setupInProgress = true;
        this.showSetupModal(player, flagPos => {
            this.showPieceAssignmentModal(player, flagPos, assignments => {
                this.applySetupToBoard(player, flagPos, assignments);
                this.setupInProgress = false;
                if (onConfirmed) {
                    onConfirmed({ flagPos, assignments });
                }
                this.render();
                this.syncState();
            });
        });
    }

    autoSetupPlayer(player, setup) {
        this.applySetupToBoard(player, setup.flagPos, setup.assignments);
        this.render();
        this.syncState();
    }

    applySetupToBoard(player, flagPos, assignments) {
        this.board[flagPos.row][flagPos.col] = { player, type: 'e' };
        if (player === 1) {
            this.player1Setup = [flagPos];
        } else {
            this.player2Setup = [flagPos];
        }
        Object.entries(assignments).forEach(([key, type]) => {
            const [row, col] = key.split('-').map(Number);
            const piece = { player, type };
            if (type === 'd') {
                piece.swordLives = 3;
            }
            this.board[row][col] = piece;
        });
    }

    createSamurai(player, type, hidden = false) {
        const samurai = document.createElement('div');
        samurai.className = `samurai player${player}${hidden ? ' hidden' : ''}`;
        
        samurai.innerHTML = `
            <div class="samurai-image"></div>
            <div class="samurai-symbol"></div>
        `;

        const symbol = samurai.querySelector('.samurai-symbol');
        this.setSymbol(symbol, type, hidden);
        
        return samurai;
    }

    setSymbol(symbol, type, hidden = false) {
        symbol.className = 'samurai-symbol';
        symbol.textContent = '';
        const samuraiElement = symbol.closest('.samurai');
        if (samuraiElement) {
            samuraiElement.classList.remove('flag-carrier');
        }

        if (hidden) {
            symbol.textContent = '?';
            return;
        }

        if (type === 'e') {
            symbol.classList.add('flag-icon');
            if (samuraiElement) {
                samuraiElement.classList.add('flag-carrier');
            }
            return;
        }

        symbol.classList.add('weapon-icon', `weapon-${type}`);
    }

    getChoiceMarkup(type) {
        if (type === 'e') return '';
        return `<span class="weapon-icon weapon-${type}"></span>`;
    }

    showSetupModal(player, onConfirmed) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <h2>${player === 1 ? '⚔️ Blauer Clan' : '🛡️ Roter Clan'}</h2>
                <p>Platziere deine Fahne <span class="flag-icon"></span></p>
                <div class="setup-grid" id="setup-grid"></div>
                <button id="confirm-flag" disabled>Fahne bestätigen</button>
            </div>
        `;
        document.body.appendChild(modal);

        const grid = modal.querySelector('#setup-grid');
        const confirmBtn = modal.querySelector('#confirm-flag');
        let selectedCell = null;
        let selectedElement = null;

        const rows = player === 1 ? [0, 1] : [4, 5];
        
        for (let row of rows) {
            for (let col = 0; col < 7; col++) {
                const cell = document.createElement('div');
                cell.className = 'setup-cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                const samurai = this.createSamurai(player, 'a', true);
                cell.appendChild(samurai);
                
                cell.addEventListener('click', () => {
                    grid.querySelectorAll('.setup-cell').forEach(c => c.classList.remove('selected'));
                    if (selectedElement) {
                        const prevSamurai = selectedElement.querySelector('.samurai');
                        const prevSymbol = selectedElement.querySelector('.samurai-symbol');
                        this.setSymbol(prevSymbol, 'a', true);
                        prevSamurai.classList.add('hidden');
                    }
                    cell.classList.add('selected');
                    selectedCell = { row, col };
                    selectedElement = cell;
                    const symbol = cell.querySelector('.samurai-symbol');
                    this.setSymbol(symbol, 'e');
                    samurai.classList.remove('hidden');
                    confirmBtn.disabled = false;
                });
                
                grid.appendChild(cell);
            }
        }

        confirmBtn.addEventListener('click', () => {
            if (!selectedCell) return;
            modal.remove();
            if (onConfirmed) {
                onConfirmed(selectedCell);
            }
        });
    }

    showPieceAssignmentModal(player, flagPos, onConfirmed) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <h2>${player === 1 ? '⚔️ Blauer Clan' : '🛡️ Roter Clan'}</h2>
                <p>Weise deinen Samurai ihre Waffen zu</p>
                <div class="piece-selector" id="piece-selector">
                    <div class="piece-option" data-type="a">
                        <span class="weapon-icon weapon-a"></span>
                        <span class="piece-label">Schere</span>
                        <span class="piece-count">4 übrig</span>
                    </div>
                    <div class="piece-option" data-type="b">
                        <span class="weapon-icon weapon-b"></span>
                        <span class="piece-label">Stein</span>
                        <span class="piece-count">4 übrig</span>
                    </div>
                    <div class="piece-option" data-type="c">
                        <span class="weapon-icon weapon-c"></span>
                        <span class="piece-label">Papier</span>
                        <span class="piece-count">4 übrig</span>
                    </div>
                    <div class="piece-option" data-type="d">
                        <span class="weapon-icon weapon-d"></span>
                        <span class="piece-label">Schwert</span>
                        <span class="piece-count">1 übrig</span>
                    </div>
                </div>
                <div class="setup-grid" id="setup-grid"></div>
                <div class="setup-actions">
                    <button id="shuffle-setup" type="button">Zufall</button>
                    <button id="confirm-setup" disabled>Aufstellung bestätigen</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const pieceSelector = modal.querySelector('#piece-selector');
        const grid = modal.querySelector('#setup-grid');
        const confirmBtn = modal.querySelector('#confirm-setup');
        const shuffleBtn = modal.querySelector('#shuffle-setup');
        
        let selectedPiece = null;
        const pieceCounts = { a: 4, b: 4, c: 4, d: 1 };
        const assignments = {};
        const assignmentCells = [];

        const rows = player === 1 ? [0, 1] : [4, 5];
        
        for (let row of rows) {
            for (let col = 0; col < 7; col++) {
                if (row === flagPos.row && col === flagPos.col) {
                    const flagCell = document.createElement('div');
                    flagCell.className = 'setup-cell flag-cell';
                    const flagSamurai = this.createSamurai(player, 'e', false);
                    flagCell.appendChild(flagSamurai);
                    grid.appendChild(flagCell);
                    continue;
                }
                
                const cell = document.createElement('div');
                cell.className = 'setup-cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                const samurai = this.createSamurai(player, 'a', true);
                cell.appendChild(samurai);
                assignmentCells.push({ cell, samurai, row, col });
                
                cell.addEventListener('click', () => {
                    if (!selectedPiece) return;
                    
                    const key = `${row}-${col}`;
                    
                    if (assignments[key]) {
                        pieceCounts[assignments[key]]++;
                        updatePieceSelector();
                    }
                    
                    assignments[key] = selectedPiece;
                    pieceCounts[selectedPiece]--;
                    const symbol = cell.querySelector('.samurai-symbol');
                    this.setSymbol(symbol, selectedPiece);
                    samurai.classList.remove('hidden');
                    cell.classList.add('selected');
                    
                    updatePieceSelector();
                    
                    if (Object.keys(assignments).length === 13) {
                        confirmBtn.disabled = false;
                    }
                });
                
                grid.appendChild(cell);
            }
        }

        const updatePieceSelector = () => {
            pieceSelector.querySelectorAll('.piece-option').forEach(option => {
                const type = option.dataset.type;
                const count = pieceCounts[type];
                option.querySelector('.piece-count').textContent = `${count} übrig`;
                
                if (count === 0) {
                    option.classList.add('depleted');
                    if (selectedPiece === type) {
                        selectedPiece = null;
                        option.classList.remove('selected');
                    }
                } else {
                    option.classList.remove('depleted');
                }
            });
        };

        pieceSelector.addEventListener('click', (e) => {
            const option = e.target.closest('.piece-option');
            if (!option || option.classList.contains('depleted')) return;
            
            pieceSelector.querySelectorAll('.piece-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            selectedPiece = option.dataset.type;
        });

        shuffleBtn.addEventListener('click', () => {
            Object.keys(assignments).forEach(key => delete assignments[key]);
            pieceCounts.a = 4;
            pieceCounts.b = 4;
            pieceCounts.c = 4;
            pieceCounts.d = 1;
            selectedPiece = null;
            pieceSelector.querySelectorAll('.piece-option').forEach(o => o.classList.remove('selected'));

            const pool = [
                ...Array(4).fill('a'),
                ...Array(4).fill('b'),
                ...Array(4).fill('c'),
                ...Array(1).fill('d')
            ];

            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [pool[i], pool[j]] = [pool[j], pool[i]];
            }

            assignmentCells.forEach((item, index) => {
                const type = pool[index];
                const key = `${item.row}-${item.col}`;
                assignments[key] = type;
                const symbol = item.cell.querySelector('.samurai-symbol');
                this.setSymbol(symbol, type);
                item.samurai.classList.remove('hidden');
                item.cell.classList.add('selected');
            });

            pieceCounts.a = 0;
            pieceCounts.b = 0;
            pieceCounts.c = 0;
            pieceCounts.d = 0;
            updatePieceSelector();
            confirmBtn.disabled = false;
        });

        confirmBtn.addEventListener('click', () => {
            modal.remove();
            if (onConfirmed) {
                onConfirmed(assignments);
            }
        });
    }

    handleCellClick(row, col) {
        if (this.gameOver || this.setupPhase) return;
        if (this.multiplayer && this.currentPlayer !== this.playerNumber) return;

        const cell = this.board[row][col];

        if (!this.selectedCell) {
            if (cell && cell.player === this.currentPlayer) {
                this.selectedCell = { row, col };
                this.render();
            }
            return;
        }

        const { row: fromRow, col: fromCol } = this.selectedCell;
        
        if (fromRow === row && fromCol === col) {
            this.selectedCell = null;
            this.render();
            return;
        }

        if (this.isValidMove(fromRow, fromCol, row, col)) {
            this.makeMove(fromRow, fromCol, row, col);
        } else {
            if (cell && cell.player === this.currentPlayer) {
                this.selectedCell = { row, col };
                this.render();
            }
        }
    }

    isValidMove(fromRow, fromCol, toRow, toCol) {
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        
        return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        const movingPiece = this.board[fromRow][fromCol];
        const targetCell = this.board[toRow][toCol];

        if (targetCell && targetCell.player === this.currentPlayer) {
            this.selectedCell = null;
            this.render();
            return;
        }

        if (targetCell) {
            const result = this.resolveBattle(movingPiece.type, targetCell.type, movingPiece, targetCell);
            
            if (result === 'duel') {
                if (this.multiplayer) {
                    const choices = ['a', 'b', 'c'];
                    const attackerChoice = choices[Math.floor(Math.random() * choices.length)];
                    let defenderChoice = choices[Math.floor(Math.random() * choices.length)];
                    while (defenderChoice === attackerChoice) {
                        defenderChoice = choices[Math.floor(Math.random() * choices.length)];
                    }
                    const duelWinner = this.resolveBattle(attackerChoice, defenderChoice);
                    this.showBattleAnimation(movingPiece, targetCell, duelWinner, () => {
                        this.completeBattle(fromRow, fromCol, toRow, toCol, duelWinner);
                    });
                    return;
                }
                this.pendingDuel = {
                    fromRow, fromCol, toRow, toCol,
                    attacker: movingPiece,
                    defender: targetCell
                };
                this.showDuelModal();
                return;
            }
            
            this.showBattleAnimation(movingPiece, targetCell, result, () => {
                this.completeBattle(fromRow, fromCol, toRow, toCol, result);
            });
        } else {
            this.board[toRow][toCol] = movingPiece;
            this.board[fromRow][fromCol] = null;
            this.selectedCell = null;
            this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
            this.turnIndex = (this.turnIndex ?? 0) + 1;
            this.turnEndsAt = Date.now() + 30000;
            this.render();
            this.syncState();
        }
    }

    showBattleAnimation(attacker, defender, result, callback) {
        const overlay = document.createElement('div');
        overlay.className = 'battle-overlay';
        
        const arena = document.createElement('div');
        arena.className = 'battle-arena';
        
        const attackerSamurai = this.createSamurai(attacker.player, attacker.type);
        attackerSamurai.classList.add('battle-samurai', 'attacker');
        
        const defenderSamurai = this.createSamurai(defender.player, defender.type);
        defenderSamurai.classList.add('battle-samurai', 'defender');

        const battleVideos = [];
        const attackerVideo = this.createBattleVideo(attacker.type);
        if (attackerVideo) {
            attackerSamurai.appendChild(attackerVideo.wrapper);
            battleVideos.push(attackerVideo.video);
        }
        const defenderVideo = this.createBattleVideo(defender.type);
        if (defenderVideo) {
            defenderSamurai.appendChild(defenderVideo.wrapper);
            battleVideos.push(defenderVideo.video);
        }
        
        arena.appendChild(attackerSamurai);
        arena.appendChild(defenderSamurai);
        
        battleVideos.forEach(video => {
            video.currentTime = 0;
            video.play().catch(() => {});
        });
        const countdown = document.createElement('div');
        countdown.className = 'battle-countdown';
        countdown.textContent = '3';
        arena.appendChild(countdown);

        const crown = document.createElement('div');
        const winnerPlayer = result === 'attacker' ? attacker.player : defender.player;
        crown.className = `battle-crown player${winnerPlayer}`;
        crown.textContent = '👑';
        arena.appendChild(crown);

        setTimeout(() => {
            countdown.textContent = '2';
        }, 1000);

        setTimeout(() => {
            countdown.textContent = '1';
        }, 2000);

        setTimeout(() => {
            countdown.style.opacity = '0';
            crown.classList.add('show');
            const resultText = document.createElement('div');
            resultText.className = 'battle-result-text';
            resultText.textContent = winnerPlayer === 1 ? 'Blauer Clan siegt!' : 'Roter Clan siegt!';
            arena.appendChild(resultText);
        }, 3000);
        
        overlay.appendChild(arena);
        document.body.appendChild(overlay);
        
        setTimeout(() => {
            overlay.remove();
            callback();
        }, 5000);
    }

    createBattleVideo(type) {
        const videoSources = {
            a: 'Video Schere.mp4',
            b: 'Video Stein.mp4',
            c: 'Video Blatt.mp4'
        };
        const src = videoSources[type];
        if (!src) return null;

        const wrapper = document.createElement('div');
        wrapper.className = 'battle-video';
        const video = document.createElement('video');
        video.src = src;
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.preload = 'auto';

        const hideVideo = () => {
            wrapper.classList.add('fade-out');
            setTimeout(() => wrapper.remove(), 500);
        };

        video.addEventListener('ended', hideVideo);

        if (type === 'b') {
            setTimeout(hideVideo, 2000);
        }

        wrapper.appendChild(video);
        return { wrapper, video };
    }

    getBattleEffect(attackerType, defenderType, result) {
        return '💥';
    }

    completeBattle(fromRow, fromCol, toRow, toCol, winner) {
        const movingPiece = this.board[fromRow][fromCol];
        const targetCell = this.board[toRow][toCol];
        
        if (winner === 'attacker') {
            if (targetCell.type === 'e') {
                this.endGame(movingPiece.player);
            }
            this.applySwordLifeLoss(movingPiece, targetCell);
            this.board[toRow][toCol] = movingPiece;
        } else {
            if (movingPiece.type === 'e') {
                this.endGame(targetCell.player);
            }
            this.applySwordLifeLoss(targetCell, movingPiece);
        }
        this.board[fromRow][fromCol] = null;

        this.selectedCell = null;
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.turnIndex = (this.turnIndex ?? 0) + 1;
        this.turnEndsAt = Date.now() + 30000;
        this.render();
        this.syncState();
    }

    resolveBattle(attacker, defender, attackerPiece = null, defenderPiece = null) {
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

    applySwordLifeLoss(winnerPiece, loserPiece) {
        if (winnerPiece?.type !== 'd') return;
        if (!['a', 'b', 'c'].includes(loserPiece?.type)) return;
        if (winnerPiece.swordLives > 0) {
            winnerPiece.swordLives -= 1;
        }
    }

    showDuelModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'duel-modal';
        modal.innerHTML = `
            <div class="modal">
                <h2>⚔️ Samurai-Duell!</h2>
                <p>Beide Krieger sind gleich stark - wählt eure Waffen!</p>
                <div id="duel-status">
                    <p style="color: var(--player1);">Blauer Clan: Bereit...</p>
                    <p style="color: var(--player2);">Roter Clan: Bereit...</p>
                </div>
                <div class="duel-choices" id="duel-choices-p1" style="display: none;">
                    <div class="duel-choice" data-choice="a"><span class="weapon-icon weapon-a"></span></div>
                    <div class="duel-choice" data-choice="b"><span class="weapon-icon weapon-b"></span></div>
                    <div class="duel-choice" data-choice="c"><span class="weapon-icon weapon-c"></span></div>
                </div>
                <div class="duel-choices" id="duel-choices-p2" style="display: none;">
                    <div class="duel-choice" data-choice="a"><span class="weapon-icon weapon-a"></span></div>
                    <div class="duel-choice" data-choice="b"><span class="weapon-icon weapon-b"></span></div>
                    <div class="duel-choice" data-choice="c"><span class="weapon-icon weapon-c"></span></div>
                </div>
                <button id="ready-duel">Duell beginnen</button>
                <div id="duel-result" class="duel-result" style="display: none;"></div>
            </div>
        `;
        document.body.appendChild(modal);

        let duelPhase = 'waiting';
        let p1Choice = null;
        let p2Choice = null;

        const readyBtn = modal.querySelector('#ready-duel');
        const duelResult = modal.querySelector('#duel-result');
        const choicesP1 = modal.querySelector('#duel-choices-p1');
        const choicesP2 = modal.querySelector('#duel-choices-p2');
        const status = modal.querySelector('#duel-status');

        readyBtn.addEventListener('click', () => {
            if (duelPhase === 'waiting') {
                duelPhase = 'p1-choosing';
                choicesP1.style.display = 'flex';
                status.innerHTML = '<p style="color: var(--player1);">Blauer Clan wählt...</p>';
                readyBtn.style.display = 'none';
            }
        });

        choicesP1.addEventListener('click', (e) => {
            const choice = e.target.closest('.duel-choice');
            if (!choice || duelPhase !== 'p1-choosing') return;
            
            p1Choice = choice.dataset.choice;
            choicesP1.style.display = 'none';
            choicesP2.style.display = 'flex';
            duelPhase = 'p2-choosing';
            status.innerHTML = '<p style="color: var(--player2);">Roter Clan wählt...</p>';
        });

        choicesP2.addEventListener('click', (e) => {
            const choice = e.target.closest('.duel-choice');
            if (!choice || duelPhase !== 'p2-choosing') return;
            
            p2Choice = choice.dataset.choice;
            choicesP2.style.display = 'none';
            duelPhase = 'revealing';
            
            this.resolveDuel(p1Choice, p2Choice, modal);
        });
    }

    resolveDuel(p1Choice, p2Choice, modal) {
        const duelResult = modal.querySelector('#duel-result');
        const status = modal.querySelector('#duel-status');
        
        status.innerHTML = `
            <p style="color: var(--player1);">Blauer Clan: ${this.getChoiceMarkup(p1Choice)}</p>
            <p style="color: var(--player2);">Roter Clan: ${this.getChoiceMarkup(p2Choice)}</p>
        `;
        duelResult.style.display = 'block';

        if (p1Choice === p2Choice) {
            duelResult.innerHTML = '🔄 Beide wählten gleich! Duell wird wiederholt...';
            setTimeout(() => {
                modal.remove();
                this.showDuelModal();
            }, 2500);
            return;
        }

        const winner = this.resolveBattle(p1Choice, p2Choice);
        const { fromRow, fromCol, toRow, toCol, attacker, defender } = this.pendingDuel;
        
        if (winner === 'attacker') {
            duelResult.innerHTML = '⚔️ Blauer Clan (Angreifer) triumphiert!';
        } else {
            duelResult.innerHTML = '🛡️ Roter Clan (Verteidiger) hält stand!';
        }

        setTimeout(() => {
            modal.remove();
            this.showBattleAnimation(attacker, defender, winner, () => {
                this.completeBattle(fromRow, fromCol, toRow, toCol, winner);
                this.pendingDuel = null;
            });
        }, 2500);
    }

    endGame(winner) {
        this.gameOver = true;
        this.winner = winner;
        this.syncState();
        if (this.onGameEnd) {
            this.onGameEnd(winner);
        }
        this.showEndModal(winner);
    }

    showEndModal(winner) {
        if (this.endModalShown) return;
        this.endModalShown = true;
        setTimeout(() => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            modal.innerHTML = `
                <div class="modal">
                    <h2>🏆 戦いの終わり</h2>
                    <p style="font-size: 2rem; color: ${winner === 1 ? 'var(--player1)' : 'var(--player2)'};">
                        ${winner === 1 ? '⚔️ Blauer Clan' : '🛡️ Roter Clan'} hat gewonnen!
                    </p>
                    <p>Die feindliche Fahne wurde erobert!</p>
                    <button onclick="location.reload()">Neue Schlacht</button>
                </div>
            `;
            document.body.appendChild(modal);
        }, 500);
    }

    getValidMoves(row, col) {
        const moves = [];
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        
        for (const [dRow, dCol] of directions) {
            const newRow = row + dRow;
            const newCol = col + dCol;
            
            if (newRow >= 0 && newRow < 6 && newCol >= 0 && newCol < 7) {
                const targetCell = this.board[newRow][newCol];
                if (!targetCell || targetCell.player !== this.currentPlayer) {
                    moves.push([newRow, newCol]);
                }
            }
        }
        
        return moves;
    }

    countFigures(player) {
        let count = 0;
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 7; col++) {
                if (this.board[row][col]?.player === player) {
                    count++;
                }
            }
        }
        return count;
    }

    render() {
        const boardEl = document.getElementById('board');
        boardEl.innerHTML = '';

        const validMoves = this.selectedCell ? 
            this.getValidMoves(this.selectedCell.row, this.selectedCell.col) : [];

        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 7; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                
                const piece = this.board[row][col];
                if (piece) {
                    const isHidden = this.multiplayer
                        ? !this.setupPhase && piece.player !== this.playerNumber
                        : !this.setupPhase && piece.player !== this.currentPlayer;
                    const samurai = this.createSamurai(piece.player, piece.type, isHidden);
                    cell.appendChild(samurai);
                    cell.classList.add(piece.player === 1 ? 'team1' : 'team2');
                    if (!isHidden && piece.type === 'd') {
                        const lifeBadge = document.createElement('div');
                        lifeBadge.className = 'sword-lives';
                        lifeBadge.textContent = `❤️ ${piece.swordLives ?? 3}x`;
                        cell.appendChild(lifeBadge);
                    }
                }

                if (this.selectedCell && 
                    this.selectedCell.row === row && 
                    this.selectedCell.col === col) {
                    cell.classList.add('selected');
                }

                if (validMoves.some(([r, c]) => r === row && c === col)) {
                    cell.classList.add('valid-move');
                }

                cell.addEventListener('click', () => this.handleCellClick(row, col));
                boardEl.appendChild(cell);
            }
        }

        document.getElementById('player1-info').classList.toggle('active', this.currentPlayer === 1);
        document.getElementById('player2-info').classList.toggle('active', this.currentPlayer === 2);
        
        document.getElementById('p1-figures').textContent = this.countFigures(1);
        document.getElementById('p2-figures').textContent = this.countFigures(2);
    }
}

const landing = document.getElementById('landing');
const gameUi = document.getElementById('game-ui');
const authPanel = document.getElementById('auth-panel');
const rulesPanel = document.getElementById('rules-panel');
const boardContainer = document.getElementById('board-container');
const loginBtn = document.getElementById('login-btn');
const usernameInput = document.getElementById('username-input');
const createLobbyBtn = document.getElementById('create-lobby');
const lobbyNameInput = document.getElementById('lobby-name-input');
const landingLobbyList = document.getElementById('landing-lobby-list');
const lobbyList = document.getElementById('lobby-list');
const leaderboard = document.getElementById('leaderboard');
const currentLobbyEl = document.getElementById('current-lobby');
const currentUserEl = document.getElementById('current-user');
const currentTeamEl = document.getElementById('current-team');
const setupStatusEl = document.getElementById('setup-status');
const setupTimerEl = document.getElementById('setup-timer');
const turnTimerEl = document.getElementById('turn-timer');
const p1PenaltiesEl = document.getElementById('p1-penalties');
const p2PenaltiesEl = document.getElementById('p2-penalties');
const leaveLobbyBtn = document.getElementById('leave-lobby');

let state = loadState();
let currentUser = null;
let currentLobbyId = localStorage.getItem(LOBBY_KEY);
let game = null;
let timerHandle = null;
let turnTimerHandle = null;

function loadUser() {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function saveUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function syncStateFromStorage() {
    state = loadState();
    renderAll();
}

if (channel) {
    channel.onmessage = () => {
        syncStateFromStorage();
    };
}

window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) {
        syncStateFromStorage();
    }
});

function renderLobbyList(container, lobbies) {
    container.innerHTML = '';
    const items = Object.values(lobbies).sort((a, b) => b.createdAt - a.createdAt);
    if (!items.length) {
        container.innerHTML = '<div class="lobby-card">Keine Lobbys aktiv</div>';
        return;
    }
    items.forEach(lobby => {
        const card = document.createElement('div');
        card.className = 'lobby-card';
        const meta = document.createElement('div');
        meta.className = 'lobby-meta';
        const title = document.createElement('strong');
        title.textContent = lobby.name;
        const status = document.createElement('div');
        status.className = 'lobby-status';
        status.textContent = `${lobby.players.length}/2 Spieler · ${getLobbyStatusLabel(lobby)}`;
        meta.appendChild(title);
        meta.appendChild(status);
        const isMember = lobby.players.includes(currentUser?.id);
        if (!isMember) {
            if (lobby.players.length < 2 && currentUser) {
                const action = document.createElement('button');
                action.type = 'button';
                action.textContent = 'Beitreten';
                action.addEventListener('click', () => joinLobby(lobby.id));
                card.appendChild(meta);
                card.appendChild(action);
            } else {
                const pill = document.createElement('span');
                pill.className = 'lobby-pill';
                pill.textContent = 'Voll';
                card.appendChild(meta);
                card.appendChild(pill);
            }
        } else {
            card.appendChild(meta);
        }
        container.appendChild(card);
    });
}

function renderLeaderboard() {
    leaderboard.innerHTML = '';
    const players = Object.values(state.users).sort((a, b) => (b.wins || 0) - (a.wins || 0));
    if (!players.length) {
        leaderboard.innerHTML = '<div class="leaderboard-item">Noch keine Siege</div>';
        return;
    }
    players.forEach(player => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        item.innerHTML = `<span>${player.name}</span><span>🏆 ${player.wins || 0}</span>`;
        leaderboard.appendChild(item);
    });
}

function getLobbyStatusLabel(lobby) {
    if (lobby.status === 'setup') return 'Aufstellung';
    if (lobby.status === 'playing') return 'Im Spiel';
    if (lobby.status === 'finished') return 'Beendet';
    return 'Warten';
}

function renderSessionInfo() {
    if (!currentLobbyId || !state.lobbies[currentLobbyId]) {
        currentLobbyEl.textContent = '—';
        currentUserEl.textContent = currentUser ? currentUser.name : '—';
        currentTeamEl.textContent = '—';
        setupStatusEl.textContent = '—';
        setupTimerEl.textContent = '02:00';
        turnTimerEl.textContent = '00:30';
        p1PenaltiesEl.textContent = '0';
        p2PenaltiesEl.textContent = '0';
        return;
    }
    const lobby = state.lobbies[currentLobbyId];
    const playerNumber = getPlayerNumber(lobby, currentUser?.id);
    currentLobbyEl.textContent = lobby.name;
    currentUserEl.textContent = currentUser ? currentUser.name : '—';
    currentTeamEl.textContent = playerNumber === 1 ? 'Blau' : playerNumber === 2 ? 'Rot' : '—';
    setupStatusEl.textContent = getLobbyStatusLabel(lobby);
    if (lobby.setupEndsAt) {
        setupTimerEl.textContent = formatTime(lobby.setupEndsAt - Date.now());
    } else {
        setupTimerEl.textContent = '00:00';
    }
    const gameState = lobby.gameState || createNewGameState();
    turnTimerEl.textContent = gameState.turnEndsAt ? formatTime(gameState.turnEndsAt - Date.now()) : '00:30';
    p1PenaltiesEl.textContent = String(gameState.p1Penalties ?? 0);
    p2PenaltiesEl.textContent = String(gameState.p2Penalties ?? 0);
}

function renderAll() {
    renderLobbyList(landingLobbyList, state.lobbies);
    renderLobbyList(lobbyList, state.lobbies);
    renderLeaderboard();
    renderSessionInfo();
    const inLobby = currentLobbyId && state.lobbies[currentLobbyId] && state.lobbies[currentLobbyId].players.includes(currentUser?.id);
    landing.style.display = inLobby ? 'none' : 'flex';
    if (rulesPanel) {
        const lobbyStatus = inLobby ? state.lobbies[currentLobbyId]?.status : null;
        rulesPanel.style.display = !inLobby || lobbyStatus !== 'playing' ? 'block' : 'none';
    }
    if (boardContainer) {
        const lobbyStatus = inLobby ? state.lobbies[currentLobbyId]?.status : null;
        boardContainer.style.display = inLobby && lobbyStatus === 'playing' ? 'block' : 'none';
    }
    const player1Info = document.getElementById('player1-info');
    const player2Info = document.getElementById('player2-info');
    if (player1Info && player2Info) {
        const lobbyStatus = inLobby ? state.lobbies[currentLobbyId]?.status : null;
        const showPlayers = inLobby && lobbyStatus === 'playing';
        player1Info.style.display = showPlayers ? 'block' : 'none';
        player2Info.style.display = showPlayers ? 'block' : 'none';
    }
    if (inLobby) {
        gameUi.classList.add('active');
        startLobbySession(state.lobbies[currentLobbyId]);
    } else {
        gameUi.classList.remove('active');
        stopSetupTimer();
        stopTurnTimer();
    }
}

function startLobbySession(lobby) {
    const playerNumber = getPlayerNumber(lobby, currentUser.id);
    if (!playerNumber) return;
    if (!game) {
        game = new Game({
            multiplayer: true,
            playerNumber,
            initialState: lobby.gameState || createNewGameState(),
            onStateChange: nextState => {
                updateLobbyGameState(lobby.id, nextState);
            },
            onGameEnd: winner => {
                recordWin(lobby.id, winner);
            }
        });
    } else {
        game.applyRemoteState(lobby.gameState || createNewGameState());
    }
    if (lobby.status === 'setup' && !lobby.setupConfirmed?.[currentUser.id]) {
        game.beginPlayerSetup(playerNumber, setupData => {
            confirmPlayerSetup(lobby.id, setupData);
        });
    }
    if (lobby.status === 'setup') {
        startSetupTimer(lobby);
        stopTurnTimer();
    } else {
        stopSetupTimer();
        startTurnTimer();
    }
}

function updateLobbyGameState(lobbyId, nextState) {
    state = updateState(current => {
        const lobby = current.lobbies[lobbyId];
        if (!lobby) return current;
        lobby.gameState = nextState;
        if (lobby.status === 'playing' && nextState.gameOver) {
            lobby.status = 'finished';
        }
        return current;
    });
}

function confirmPlayerSetup(lobbyId, setupData) {
    state = updateState(current => {
        const lobby = current.lobbies[lobbyId];
        if (!lobby || !currentUser) return current;
        lobby.setups = lobby.setups || {};
        lobby.setupConfirmed = lobby.setupConfirmed || {};
        lobby.setups[currentUser.id] = setupData;
        lobby.setupConfirmed[currentUser.id] = true;
        lobby.gameState = game ? game.exportState() : lobby.gameState;
        const allReady = lobby.players.every(playerId => lobby.setupConfirmed?.[playerId]);
        if (allReady) {
            lobby.status = 'playing';
            lobby.setupEndsAt = null;
            lobby.gameState.setupPhase = false;
            lobby.gameState.currentPlayer = 1;
            lobby.gameState.turnIndex = 1;
            lobby.gameState.turnEndsAt = Date.now() + 30000;
            lobby.gameState.lastPenaltyTurnIndex = 0;
            lobby.gameState.p1Penalties = 0;
            lobby.gameState.p2Penalties = 0;
            lobby.gameState.winner = null;
            lobby.gameId = lobby.gameId || createId();
        }
        return current;
    });
}

function autoCompleteSetup(lobby) {
    const missingPlayers = lobby.players.filter(id => !lobby.setupConfirmed?.[id]);
    if (!missingPlayers.length) return;
    const updatedState = updateState(current => {
        const currentLobby = current.lobbies[lobby.id];
        if (!currentLobby) return current;
        currentLobby.setups = currentLobby.setups || {};
        currentLobby.setupConfirmed = currentLobby.setupConfirmed || {};
        missingPlayers.forEach(playerId => {
            const playerNumber = getPlayerNumber(currentLobby, playerId);
            if (!playerNumber) return;
            const setupData = generateRandomSetup(playerNumber);
            currentLobby.setups[playerId] = setupData;
            currentLobby.setupConfirmed[playerId] = true;
            if (game && playerId === currentUser?.id) {
                game.autoSetupPlayer(playerNumber, setupData);
            }
            if (!game && currentLobby.gameState) {
                currentLobby.gameState = applySetupToState(currentLobby.gameState, playerNumber, setupData);
            }
        });
        const allReady = currentLobby.players.every(playerId => currentLobby.setupConfirmed?.[playerId]);
        if (allReady) {
            currentLobby.status = 'playing';
            currentLobby.setupEndsAt = null;
            currentLobby.gameState.setupPhase = false;
            currentLobby.gameState.currentPlayer = 1;
            currentLobby.gameState.turnIndex = 1;
            currentLobby.gameState.turnEndsAt = Date.now() + 30000;
            currentLobby.gameState.lastPenaltyTurnIndex = 0;
            currentLobby.gameState.p1Penalties = 0;
            currentLobby.gameState.p2Penalties = 0;
            currentLobby.gameState.winner = null;
            currentLobby.gameId = currentLobby.gameId || createId();
        }
        return current;
    });
    state = updatedState;
}

function startSetupTimer(lobby) {
    stopSetupTimer();
    if (!lobby.setupEndsAt) return;
    timerHandle = setInterval(() => {
        const updatedLobby = state.lobbies[currentLobbyId];
        if (!updatedLobby || updatedLobby.status !== 'setup') {
            stopSetupTimer();
            return;
        }
        const remaining = updatedLobby.setupEndsAt - Date.now();
        setupTimerEl.textContent = formatTime(remaining);
        if (remaining <= 0) {
            stopSetupTimer();
            autoCompleteSetup(updatedLobby);
            renderAll();
        }
    }, 1000);
}

function stopSetupTimer() {
    if (timerHandle) {
        clearInterval(timerHandle);
        timerHandle = null;
    }
}

function startTurnTimer() {
    stopTurnTimer();
    turnTimerHandle = setInterval(() => {
        const lobby = state.lobbies[currentLobbyId];
        if (!lobby || lobby.status !== 'playing') {
            stopTurnTimer();
            return;
        }
        const gameState = lobby.gameState;
        if (!gameState) return;
        if (!gameState.turnEndsAt) {
            state = updateState(current => {
                const currentLobby = current.lobbies[currentLobbyId];
                if (!currentLobby || !currentLobby.gameState) return current;
                currentLobby.gameState.turnIndex = currentLobby.gameState.turnIndex || 1;
                currentLobby.gameState.turnEndsAt = Date.now() + 30000;
                return current;
            });
            return;
        }
        turnTimerEl.textContent = formatTime(gameState.turnEndsAt - Date.now());
        p1PenaltiesEl.textContent = String(gameState.p1Penalties ?? 0);
        p2PenaltiesEl.textContent = String(gameState.p2Penalties ?? 0);
        if (Date.now() <= gameState.turnEndsAt || gameState.gameOver) return;

        const updated = updateState(current => {
            const currentLobby = current.lobbies[currentLobbyId];
            if (!currentLobby || !currentLobby.gameState) return current;
            const gs = currentLobby.gameState;
            if (gs.gameOver) return current;
            const currentTurn = gs.turnIndex ?? 1;
            if ((gs.lastPenaltyTurnIndex ?? 0) >= currentTurn) return current;
            const currentPlayer = gs.currentPlayer ?? 1;
            if (currentPlayer === 1) {
                gs.p1Penalties = (gs.p1Penalties ?? 0) + 1;
            } else {
                gs.p2Penalties = (gs.p2Penalties ?? 0) + 1;
            }
            gs.lastPenaltyTurnIndex = currentTurn;
            const penaltyCount = currentPlayer === 1 ? gs.p1Penalties : gs.p2Penalties;
            if (penaltyCount >= 2) {
                gs.gameOver = true;
                gs.winner = currentPlayer === 1 ? 2 : 1;
                currentLobby.status = 'finished';
                return current;
            }
            gs.currentPlayer = currentPlayer === 1 ? 2 : 1;
            gs.turnIndex = currentTurn + 1;
            gs.turnEndsAt = Date.now() + 30000;
            return current;
        });
        state = updated;
        renderAll();
    }, 500);
}

function stopTurnTimer() {
    if (turnTimerHandle) {
        clearInterval(turnTimerHandle);
        turnTimerHandle = null;
    }
}

function recordWin(lobbyId, winner) {
    const lobby = state.lobbies[lobbyId];
    if (!lobby) return;
    const winnerUserId = lobby.players[winner - 1];
    if (!winnerUserId || winnerUserId !== currentUser?.id) return;
    if (lobby.recordedGameId === lobby.gameId) return;
    state = updateState(current => {
        const currentLobby = current.lobbies[lobbyId];
        if (!currentLobby) return current;
        const winnerId = currentLobby.players[winner - 1];
        if (!winnerId) return current;
        current.users[winnerId] = current.users[winnerId] || { name: currentUser.name, wins: 0 };
        current.users[winnerId].wins = (current.users[winnerId].wins || 0) + 1;
        currentLobby.recordedGameId = currentLobby.gameId;
        return current;
    });
}

function joinLobby(lobbyId) {
    if (!currentUser) return;
    const updated = updateState(current => {
        const lobby = current.lobbies[lobbyId];
        if (!lobby) return current;
        if (!lobby.players.includes(currentUser.id) && lobby.players.length < 2) {
            lobby.players.push(currentUser.id);
        }
        if (lobby.players.length === 2 && lobby.status === 'waiting') {
            lobby.status = 'setup';
            lobby.setupEndsAt = Date.now() + 120000;
            lobby.gameState = createNewGameState();
            lobby.gameId = createId();
            lobby.setupConfirmed = {};
            lobby.setups = {};
        }
        return current;
    });
    state = updated;
    currentLobbyId = lobbyId;
    localStorage.setItem(LOBBY_KEY, lobbyId);
    subscribePrivateLobbyChannel(lobbyId);
    ensurePlayerAuthRow(lobbyId);
    renderAll();
}

function createLobby() {
    if (!currentUser) return;
    const lobbyName = lobbyNameInput.value.trim() || `Lobby ${Object.keys(state.lobbies).length + 1}`;
    const lobbyId = createId();
    const updated = updateState(current => {
        current.lobbies[lobbyId] = {
            id: lobbyId,
            name: lobbyName,
            status: 'waiting',
            players: [currentUser.id],
            createdAt: Date.now(),
            setupConfirmed: {},
            setups: {},
            gameState: createNewGameState(),
            gameId: null,
            recordedGameId: null,
            setupEndsAt: null
        };
        return current;
    });
    state = updated;
    currentLobbyId = lobbyId;
    localStorage.setItem(LOBBY_KEY, lobbyId);
    lobbyNameInput.value = '';
    renderAll();
}

function leaveLobby() {
    if (!currentLobbyId || !currentUser) return;
    const updated = updateState(current => {
        const lobby = current.lobbies[currentLobbyId];
        if (!lobby) return current;
        lobby.players = lobby.players.filter(id => id !== currentUser.id);
        if (lobby.players.length === 0) {
            delete current.lobbies[currentLobbyId];
            return current;
        }
        lobby.status = 'waiting';
        lobby.setupEndsAt = null;
        lobby.setupConfirmed = {};
        lobby.setups = {};
        lobby.gameState = createNewGameState();
        lobby.gameId = null;
        lobby.recordedGameId = null;
        return current;
    });
    state = updated;
    currentLobbyId = null;
    localStorage.removeItem(LOBBY_KEY);
    clearLobbyChannel();
    game = null;
    renderAll();
}

loginBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (!name) return;
    const user = { id: currentUser?.id || createId(), name, wins: currentUser?.wins || 0 };
    currentUser = user;
    saveUser(user);
    updateState(current => {
        current.users[user.id] = current.users[user.id] || { name: user.name, wins: user.wins || 0 };
        return current;
    });
    renderAll();
});

createLobbyBtn.addEventListener('click', () => {
    createLobby();
});

leaveLobbyBtn.addEventListener('click', () => {
    leaveLobby();
});

currentUser = loadUser();
const externalUserName = window.SAMURAI_USER_NAME || window.AUTH_USER_NAME || window.SAMURAI_USER?.name;
const externalUserId = window.SAMURAI_USER_ID || window.SAMURAI_USER?.id;
if (externalUserName) {
    currentUser = {
        id: externalUserId || currentUser?.id || createId(),
        name: externalUserName,
        wins: currentUser?.wins || 0
    };
    saveUser(currentUser);
    updateState(current => {
        current.users[currentUser.id] = current.users[currentUser.id] || { name: currentUser.name, wins: currentUser.wins || 0 };
        return current;
    });
    if (authPanel) {
        authPanel.style.display = 'none';
    }
}
if (currentUser) {
    usernameInput.value = currentUser.name;
}
if (supabaseClient) {
    supabaseClient.auth.getSession().then(({ data }) => {
        setRealtimeAuthFromSession(data?.session);
        if (currentLobbyId) {
            subscribePrivateLobbyChannel(currentLobbyId);
            ensurePlayerAuthRow(currentLobbyId);
        }
    });
    supabaseClient.auth.onAuthStateChange((_event, session) => {
        setRealtimeAuthFromSession(session);
        if (currentLobbyId) {
            subscribePrivateLobbyChannel(currentLobbyId);
            ensurePlayerAuthRow(currentLobbyId);
        } else if (realtimeLobbyId) {
            clearLobbyChannel();
        }
    });
}
renderAll();
