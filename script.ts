import { createClient } from '@supabase/supabase-js';

const SYMBOLS = {
    e: ''
};

class Game {
    board;
    currentPlayer;
    selectedCell;
    gameOver;
    setupPhase;
    setupPlayer;
    player1Setup;
    player2Setup;
    pendingDuel;
    multiplayer;
    viewerPlayer;
    sendCommand;
    setupStep;
    lastBattleSeq;
    duelModalOpen;
    animationLock;
    animationTimer;
    lobbyReady;
    startAnimationShown;
    onGameEnd;
    constructor(options: any = {}) {
        this.board = Array(6).fill(null).map(() => Array(7).fill(null));
        this.currentPlayer = 1;
        this.selectedCell = null;
        this.gameOver = false;
        this.setupPhase = true;
        this.setupPlayer = 1;
        this.player1Setup = [];
        this.player2Setup = [];
        this.pendingDuel = null;
        this.multiplayer = options.multiplayer ?? false;
        this.viewerPlayer = options.viewerPlayer ?? null;
        this.sendCommand = options.sendCommand ?? null;
        this.setupStep = null;
        this.lastBattleSeq = null;
        this.duelModalOpen = false;
        this.animationLock = false;
        this.animationTimer = null;
        this.lobbyReady = false;
        this.startAnimationShown = false;
        this.onGameEnd = options.onGameEnd ?? null;
        if (!this.multiplayer) {
            this.startSetupPhase();
        }
    }

    startSetupPhase() {
        this.showSetupModal(1);
    }

    applyState(state) {
        const wasGameOver = this.gameOver;
        this.board = state.board;
        this.currentPlayer = state.currentPlayer;
        this.setupPhase = state.setupPhase;
        this.setupPlayer = state.setupPlayer;
        this.gameOver = state.gameOver;
        this.pendingDuel = state.duel || null;
        if (state.battleSeq !== undefined && state.battleSeq !== this.lastBattleSeq && state.lastBattle) {
            this.lastBattleSeq = state.battleSeq;
            this.showBattleAnimation(state.lastBattle.attacker, state.lastBattle.defender, state.lastBattle.winner, () => {});
        }
        if (!wasGameOver && this.gameOver && state.winner) {
            this.endGame(state.winner);
        }
        if (this.multiplayer) {
            if (!this.lobbyReady) {
                this.closeSetupModals();
                this.setupStep = null;
            } else if (!this.setupPhase || this.setupPlayer !== this.viewerPlayer) {
                this.setupStep = null;
            } else {
                const hasFlag = state.flags && state.flags[this.viewerPlayer];
                if (!hasFlag && this.setupStep !== 'flag') {
                    this.setupStep = 'flag';
                    this.showSetupModal(this.viewerPlayer);
                }
                if (hasFlag && this.setupStep !== 'assign') {
                    this.setupStep = 'assign';
                    this.showPieceAssignmentModal(this.viewerPlayer);
                }
            }
            if (!state.duel && this.duelModalOpen) {
                const duelModal = document.getElementById('duel-choice-modal');
                if (duelModal) duelModal.remove();
                this.duelModalOpen = false;
            }
            if (state.duel && state.duel.choices && this.viewerPlayer && !state.duel.choices[this.viewerPlayer]) {
                if (!this.duelModalOpen) {
                    this.showDuelChoiceModal(state.duel);
                }
            }
        }
        if (this.multiplayer && !this.setupPhase && !this.startAnimationShown) {
            this.startAnimationShown = true;
            this.showStartOverlay();
        }
        this.render();
    }

    createSamurai(player, type, hidden = false) {
        const samurai = document.createElement('div');
        samurai.className = `samurai player${player}${hidden ? ' hidden' : ''}`;
        
        samurai.innerHTML = `
            <div class="samurai-image"></div>
            <div class="samurai-symbol"></div>
        `;

        const symbol = samurai.querySelector('.samurai-symbol') as HTMLElement | null;
        this.setSymbol(symbol, type, hidden);
        
        return samurai;
    }

    setSymbol(symbol, type, hidden = false) {
        if (!symbol) return;
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

    showSetupModal(player) {
        if (this.multiplayer && !this.lobbyReady) return;
        if (this.multiplayer && document.getElementById('setup-flag-modal')) return;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'setup-flag-modal';
        modal.innerHTML = `
            <div class="modal">
                <h2>${player === 1 ? '⚔️ Blauer Clan' : '🛡️ Roter Clan'}</h2>
                <p>Platziere deine Fahne <span class="flag-icon"></span></p>
                <div class="setup-grid" id="setup-grid"></div>
                <button id="confirm-flag" disabled>Fahne bestätigen</button>
            </div>
        `;
        document.body.appendChild(modal);

        const grid = modal.querySelector('#setup-grid') as HTMLElement | null;
        const confirmBtn = modal.querySelector('#confirm-flag') as HTMLButtonElement | null;
        let selectedCell = null;
        let selectedElement = null;
        if (!grid || !confirmBtn) return;

        const rows = player === 1 ? [0, 1] : [4, 5];
        
        for (let row of rows) {
            for (let col = 0; col < 7; col++) {
                const cell = document.createElement('div');
                cell.className = 'setup-cell';
                cell.dataset.row = String(row);
                cell.dataset.col = String(col);
                const samurai = this.createSamurai(player, 'a', true);
                cell.appendChild(samurai);
                
                cell.addEventListener('click', () => {
                    grid.querySelectorAll('.setup-cell').forEach(c => c.classList.remove('selected'));
                    if (selectedElement) {
                        const prevSamurai = selectedElement.querySelector('.samurai');
                        const prevSymbol = selectedElement.querySelector('.samurai-symbol') as HTMLElement | null;
                        this.setSymbol(prevSymbol, 'a', true);
                        prevSamurai.classList.add('hidden');
                    }
                    cell.classList.add('selected');
                    selectedCell = { row, col };
                    selectedElement = cell;
                    const symbol = cell.querySelector('.samurai-symbol') as HTMLElement | null;
                    this.setSymbol(symbol, 'e');
                    samurai.classList.remove('hidden');
                    confirmBtn.disabled = false;
                });
                
                grid.appendChild(cell);
            }
        }

        confirmBtn.addEventListener('click', () => {
            if (selectedCell) {
                if (this.multiplayer) {
                    this.sendCommand?.('placeFlag', selectedCell);
                    modal.remove();
                    return;
                }
                this.board[selectedCell.row][selectedCell.col] = { 
                    player, 
                    type: 'e' 
                };
                
                if (player === 1) {
                    this.player1Setup.push(selectedCell);
                } else {
                    this.player2Setup.push(selectedCell);
                }
                
                modal.remove();
                this.showPieceAssignmentModal(player);
            }
        });
    }

    showPieceAssignmentModal(player) {
        if (this.multiplayer && !this.lobbyReady) return;
        if (this.multiplayer && document.getElementById('setup-assign-modal')) return;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'setup-assign-modal';
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

        const pieceSelector = modal.querySelector('#piece-selector') as HTMLElement | null;
        const grid = modal.querySelector('#setup-grid') as HTMLElement | null;
        const confirmBtn = modal.querySelector('#confirm-setup') as HTMLButtonElement | null;
        const shuffleBtn = modal.querySelector('#shuffle-setup') as HTMLButtonElement | null;
        if (!pieceSelector || !grid || !confirmBtn || !shuffleBtn) return;
        
        let selectedPiece = null;
        const pieceCounts = { a: 4, b: 4, c: 4, d: 1 };
        const assignments = {};
        const assignmentCells = [];

        const rows = player === 1 ? [0, 1] : [4, 5];
        const flagPos = player === 1 ? this.player1Setup[0] : this.player2Setup[0];
        
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
                cell.dataset.row = String(row);
                cell.dataset.col = String(col);
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
                    const symbol = cell.querySelector('.samurai-symbol') as HTMLElement | null;
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

        function updatePieceSelector() {
            pieceSelector.querySelectorAll('.piece-option').forEach(option => {
                const optionEl = option as HTMLElement;
                const type = optionEl.dataset.type;
                const count = pieceCounts[type];
                const countEl = optionEl.querySelector('.piece-count') as HTMLElement | null;
                if (countEl) {
                    countEl.textContent = `${count} übrig`;
                }
                
                if (count === 0) {
                    optionEl.classList.add('depleted');
                    if (selectedPiece === type) {
                        selectedPiece = null;
                        optionEl.classList.remove('selected');
                    }
                } else {
                    optionEl.classList.remove('depleted');
                }
            });
        }

        pieceSelector.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            const option = target ? (target.closest('.piece-option') as HTMLElement | null) : null;
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
                const symbol = item.cell.querySelector('.samurai-symbol') as HTMLElement | null;
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
            if (this.multiplayer) {
                this.sendCommand?.('assignSetup', { assignments });
                modal.remove();
                return;
            }
            for (let [key, type] of Object.entries(assignments)) {
                const [row, col] = key.split('-').map(Number);
                const piece: any = { player, type };
                if (type === 'd') {
                    piece.swordLives = 3;
                }
                this.board[row][col] = piece;
            }
            
            modal.remove();
            
            if (player === 1) {
                this.showSetupModal(2);
            } else {
                this.setupPhase = false;
                this.currentPlayer = 1;
                this.render();
            }
        });
    }

    handleCellClick(row, col) {
        if (this.gameOver || this.setupPhase) return;
        if (this.animationLock) return;
        if (this.multiplayer && this.viewerPlayer !== this.currentPlayer) return;

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
        if (this.animationLock) return;
        if (this.multiplayer) {
            this.selectedCell = null;
            this.sendCommand?.('move', { fromRow, fromCol, toRow, toCol });
            this.render();
            return;
        }

        if (targetCell && targetCell.player === this.currentPlayer) {
            this.selectedCell = null;
            this.render();
            return;
        }

        if (targetCell) {
            const result = this.resolveBattle(movingPiece.type, targetCell.type, movingPiece, targetCell);
            
            if (result === 'duel') {
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
            this.render();
        }
    }

    showBattleAnimation(attacker, defender, result, callback) {
        const overlay = document.createElement('div');
        overlay.className = 'battle-overlay';
        this.setAnimationLock(6500);
        
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
        
        setTimeout(() => {
            const effect = document.createElement('div');
            effect.className = 'battle-effect';
            effect.textContent = this.getBattleEffect(attacker.type, defender.type, result);
            arena.appendChild(effect);
        }, 1200);
        
        setTimeout(() => {
            const resultText = document.createElement('div');
            resultText.className = 'battle-result-text';
            resultText.textContent = result === 'attacker' ? 
                `${attacker.player === 1 ? 'Blauer' : 'Roter'} Clan siegt!` : 
                `${defender.player === 1 ? 'Blauer' : 'Roter'} Clan verteidigt!`;
            arena.appendChild(resultText);
        }, 2400);
        
        overlay.appendChild(arena);
        document.body.appendChild(overlay);
        
        setTimeout(() => {
            overlay.remove();
            callback();
        }, 6500);
    }

    setAnimationLock(duration) {
        this.animationLock = true;
        if (this.animationTimer) {
            clearTimeout(this.animationTimer);
        }
        this.animationTimer = setTimeout(() => {
            this.animationLock = false;
            this.animationTimer = null;
        }, duration);
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
        this.render();
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
        if (this.multiplayer) {
            this.showDuelChoiceModal();
            return;
        }
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

        const readyBtn = modal.querySelector('#ready-duel') as HTMLButtonElement | null;
        const duelResult = modal.querySelector('#duel-result') as HTMLElement | null;
        const choicesP1 = modal.querySelector('#duel-choices-p1') as HTMLElement | null;
        const choicesP2 = modal.querySelector('#duel-choices-p2') as HTMLElement | null;
        const status = modal.querySelector('#duel-status') as HTMLElement | null;
        if (!readyBtn || !duelResult || !choicesP1 || !choicesP2 || !status) return;

        readyBtn.addEventListener('click', () => {
            if (duelPhase === 'waiting') {
                duelPhase = 'p1-choosing';
                choicesP1.style.display = 'flex';
                status.innerHTML = '<p style="color: var(--player1);">Blauer Clan wählt...</p>';
                readyBtn.style.display = 'none';
            }
        });

        choicesP1.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            const choice = target ? (target.closest('.duel-choice') as HTMLElement | null) : null;
            if (!choice || duelPhase !== 'p1-choosing') return;
            
            p1Choice = choice.dataset.choice;
            choicesP1.style.display = 'none';
            choicesP2.style.display = 'flex';
            duelPhase = 'p2-choosing';
            status.innerHTML = '<p style="color: var(--player2);">Roter Clan wählt...</p>';
        });

        choicesP2.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            const choice = target ? (target.closest('.duel-choice') as HTMLElement | null) : null;
            if (!choice || duelPhase !== 'p2-choosing') return;
            
            p2Choice = choice.dataset.choice;
            choicesP2.style.display = 'none';
            duelPhase = 'revealing';
            
            this.resolveDuel(p1Choice, p2Choice, modal);
        });
    }

    showDuelChoiceModal(duel = null) {
        if (document.getElementById('duel-choice-modal')) return;
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'duel-choice-modal';
        modal.innerHTML = `
            <div class="modal">
                <h2>⚔️ Samurai-Duell!</h2>
                <p>Wähle deine Waffe</p>
                <div class="duel-choices" id="duel-choices-single">
                    <div class="duel-choice" data-choice="a"><span class="weapon-icon weapon-a"></span></div>
                    <div class="duel-choice" data-choice="b"><span class="weapon-icon weapon-b"></span></div>
                    <div class="duel-choice" data-choice="c"><span class="weapon-icon weapon-c"></span></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.duelModalOpen = true;

        const choices = modal.querySelector('#duel-choices-single') as HTMLElement | null;
        if (!choices) return;
        choices.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            const choice = target ? (target.closest('.duel-choice') as HTMLElement | null) : null;
            if (!choice) return;
            this.sendCommand?.('duelChoice', { choice: choice.dataset.choice });
            modal.remove();
            this.duelModalOpen = false;
        });
    }

    setLobbyReady(ready) {
        this.lobbyReady = ready;
        if (!ready) {
            this.closeSetupModals();
            this.startAnimationShown = false;
        }
    }

    closeSetupModals() {
        const flagModal = document.getElementById('setup-flag-modal');
        const assignModal = document.getElementById('setup-assign-modal');
        if (flagModal) flagModal.remove();
        if (assignModal) assignModal.remove();
    }

    showStartOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'start-overlay';
        overlay.innerHTML = '<div class="start-card">Die Schlacht beginnt</div>';
        document.body.appendChild(overlay);
        setTimeout(() => {
            overlay.remove();
        }, 2000);
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
        setTimeout(() => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            if (this.multiplayer && this.viewerPlayer) {
                const isWinner = winner === this.viewerPlayer;
                modal.innerHTML = `
                    <div class="modal">
                        <h2>${isWinner ? '� DU HAST GEWONNEN!' : '💥 DU HAST VERLOREN!'}</h2>
                        <p>Die feindliche Fahne wurde erobert!</p>
                    </div>
                `;
                document.body.appendChild(modal);
                setTimeout(() => {
                    modal.remove();
                    this.onGameEnd?.({ winner, isWinner });
                }, 2500);
                return;
            }
            modal.innerHTML = `
                <div class="modal">
                    <h2>� 戦いの終わり</h2>
                    <p style="font-size: 2rem; color: ${winner === 1 ? 'var(--player1)' : 'var(--player2)'};">
                        ${winner === 1 ? '⚔️ Roter Clan' : '🛡️ Blauer Clan'} hat gewonnen!
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
                    const viewer = this.viewerPlayer ?? this.currentPlayer;
                    const isHidden = !this.setupPhase && piece.player !== viewer;
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
        
        const p1Figures = document.getElementById('p1-figures');
        const p2Figures = document.getElementById('p2-figures');
        if (p1Figures) p1Figures.textContent = String(this.countFigures(1));
        if (p2Figures) p2Figures.textContent = String(this.countFigures(2));
    }
}

const startButton = document.getElementById('start-game') as HTMLButtonElement;
const landing = document.getElementById('landing') as HTMLElement;
const gameUi = document.getElementById('game-ui') as HTMLElement;
const authEmailInput = document.getElementById('auth-email') as HTMLInputElement;
const authPasswordInput = document.getElementById('auth-password') as HTMLInputElement;
const authLoginButton = document.getElementById('auth-login') as HTMLButtonElement;
const authRegisterButton = document.getElementById('auth-register') as HTMLButtonElement;
const authLogoutButton = document.getElementById('auth-logout') as HTMLButtonElement;
const authStatus = document.getElementById('auth-status') as HTMLElement;
const lobbyCodeInput = document.getElementById('lobby-code') as HTMLInputElement;
const createLobbyButton = document.getElementById('create-lobby') as HTMLButtonElement;
const joinLobbyButton = document.getElementById('join-lobby') as HTMLButtonElement;
const refreshLobbiesButton = document.getElementById('refresh-lobbies') as HTMLButtonElement;
const readyLobbyButton = document.getElementById('lobby-ready') as HTMLButtonElement;
const readyStatus = document.getElementById('ready-status') as HTMLElement;
const lobbyStatus = document.getElementById('lobby-status') as HTMLElement;
const lobbyInfo = document.getElementById('lobby-info') as HTMLElement;
const turnTimer = document.getElementById('turn-timer') as HTMLElement;
const lobbyList = document.getElementById('lobby-list') as HTMLElement;

const SUPABASE_URL = 'https://gxcwaufhbmygixnssifv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_uts-r0z__XK9IVi6RAuPQQ_smiUmCA_';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4Y3dhdWZoYm15Z2l4bnNzaWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3ODc0NjYsImV4cCI6MjA4NTM2MzQ2Nn0.gl2Q-PZ83shdlsTht6khPiy4p_2GVl_-shkCU_XzEIk';
const PLAYER_ID_KEY = 'myapp_player_id_v1';
const PLAYER_SIDE_KEY = 'myapp_player_side_v1';

let game = null;
let lobbyCode = null;
let lobbyId = null;
let playerId = null;
let playerIndex = null;
let turnTimerInterval = null;
let lobbyListInterval = null;
let supabaseClient = null;
let supabaseBroadcastChannel = null;
let supabaseStateChannel = null;
let authSession = null;
let readyPlayers = new Set();
let localReady = false;
let broadcastReady = false;
let rpcHelper = null;
const xn = (s: typeof fetch = fetch) => {
    const fetchFn = s;
    return async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const headers = new Headers(init.headers || {});
        if (init.body !== undefined && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        const finalInit = {
            ...init,
            headers
        };
        if (finalInit.body && typeof finalInit.body === 'object' && !(finalInit.body instanceof FormData)) {
            finalInit.body = JSON.stringify(finalInit.body);
        }
        const res = await fetchFn(input, finalInit);
        const text = await res.text();
        let json;
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

function setLobbyStatus(text) {
    lobbyStatus.textContent = text;
}

function formatSupabaseError(error, fallback) {
    const message = error?.details?.message || error?.message || fallback || 'Unbekannter Fehler';
    if (message.includes('column "lobby_code" of relation "players" does not exist')) {
        return 'Supabase-Schema passt nicht: players.lobby_code fehlt';
    }
    return message;
}

function getCachedPlayerId() {
    try {
        return localStorage.getItem(PLAYER_ID_KEY);
    } catch {
        return null;
    }
}

function persistPlayerId(id) {
    try {
        if (id) {
            localStorage.setItem(PLAYER_ID_KEY, id);
        } else {
            localStorage.removeItem(PLAYER_ID_KEY);
        }
    } catch {}
}

function getCachedPlayerSide() {
    try {
        return localStorage.getItem(PLAYER_SIDE_KEY);
    } catch {
        return null;
    }
}

function persistPlayerSide(side) {
    try {
        if (side) {
            localStorage.setItem(PLAYER_SIDE_KEY, side);
        } else {
            localStorage.removeItem(PLAYER_SIDE_KEY);
        }
    } catch {}
}

function getOrCreatePlayerSide() {
    const cached = getCachedPlayerSide();
    if (cached === 'red' || cached === 'blue') return cached;
    const side = Math.random() < 0.5 ? 'red' : 'blue';
    persistPlayerSide(side);
    return side;
}

function updateLobbyInfo() {
    lobbyInfo.textContent = lobbyCode ? `Lobby ${lobbyCode} • Spieler ${playerIndex}` : '';
}

function getLobbyChannelKey() {
    return lobbyId || lobbyCode;
}

function applySupabaseInputs() {
    const url = SUPABASE_URL;
    const key = SUPABASE_ANON_KEY;
    if (!url || !key) {
        supabaseClient = null;
        rpcHelper = null;
        return null;
    }
    supabaseClient = createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage },
        global: { headers: { apikey: key } }
    });
    rpcHelper = initRpcHelper(supabaseClient);
    return supabaseClient;
}

function initRpcHelper(supabase) {
    if (!supabase) {
        throw new Error('supabase client required');
    }

    async function callRpc(name, params) {
        if (params !== null && typeof params !== 'object') {
            throw new TypeError('rpc params must be an object');
        }
        const { data, error, status } = await supabase.rpc(name, params);
        if (error) {
            const err: any = new Error(error.message || 'rpc error');
            err.details = error;
            err.status = status;
            throw err;
        }
        return data;
    }

    async function rpcJoinLobby({ lobby_code, player_id }: any = {}) {
        if (!lobby_code || typeof lobby_code !== 'string') {
            throw new TypeError('lobby_code (string) is required');
        }
        try {
            if (player_id) {
                return await callRpc('join_lobby', { p_code: lobby_code, p_player_id: player_id });
            }
            return await callRpc('join_lobby', { lobby_code });
        } catch (error) {
            if (player_id) {
                try {
                    return await callRpc('join_lobby', { lobby_code, player_id });
                } catch {}
            }
            return callRpc('join_lobby', { p_code: lobby_code });
        }
    }

    async function rpcApplyCommand({ lobby_code, player_id, action, payload }: any = {}) {
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
        let jsonPayload = payload ?? {};
        try {
            JSON.stringify(jsonPayload);
        } catch {
            throw new TypeError('payload must be JSON-serializable');
        }
        return callRpc('apply_command', {
            lobby_code,
            player_id,
            action,
            payload: jsonPayload
        });
    }

    async function rpcApplyCommandJson({ lobby_code, player_id, action, payload }: any = {}) {
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
        let jsonPayload = payload ?? {};
        try {
            JSON.stringify(jsonPayload);
        } catch {
            throw new TypeError('payload must be JSON-serializable');
        }
        return callRpc('apply_command_json', {
            payload: {
                lobby_code,
                player_id,
                action,
                payload: jsonPayload
            }
        });
    }

    return {
        rpcJoinLobby,
        rpcApplyCommand,
        rpcApplyCommandJson,
        callRpc
    };
}

function updateAuthUi(session) {
    authSession = session;
    const client = supabaseClient || applySupabaseInputs();
    if (client && session?.access_token) {
        client.realtime.setAuth(session.access_token);
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
}

function resetReadyState() {
    readyPlayers = new Set();
    localReady = false;
    updateReadyStatus();
}

function updateReadyStatus() {
    if (!lobbyCode) {
        readyStatus.textContent = '';
        return;
    }
    if (readyPlayers.size >= 2) {
        readyStatus.textContent = 'Beide bereit';
        return;
    }
    readyStatus.textContent = localReady ? 'Du bist bereit' : 'Warte auf zweiten Spieler';
}

function handleReadyClick() {
    if (!lobbyCode || !supabaseBroadcastChannel) return;
    if (!broadcastReady) {
        setLobbyStatus('Verbindung wird aufgebaut...');
        return;
    }
    if (localReady) return;
    localReady = true;
    readyPlayers.add(playerId);
    updateReadyStatus();
    const message = {
        type: 'broadcast',
        event: 'player_ready',
        payload: { playerId }
    };
    if (typeof supabaseBroadcastChannel.httpSend === 'function') {
        supabaseBroadcastChannel.httpSend(message.event, message.payload);
    } else {
        supabaseBroadcastChannel.send(message);
    }
    if (readyPlayers.size >= 2 && game) {
        game.setLobbyReady(true);
    }
}

async function deleteLobby() {
    const client = supabaseClient || applySupabaseInputs();
    if (!client || !lobbyCode || !rpcHelper) return;
    await rpcHelper.callRpc('delete_lobby', { lobby_code: lobbyCode });
}

function returnToLanding() {
    landing.style.display = 'flex';
    gameUi.classList.remove('active');
    lobbyCode = null;
    lobbyId = null;
    playerId = null;
    playerIndex = null;
    resetReadyState();
    setLobbyStatus('Nicht verbunden');
    updateLobbyInfo();
    if (supabaseBroadcastChannel) {
        supabaseBroadcastChannel.unsubscribe();
        supabaseBroadcastChannel = null;
    }
    if (supabaseStateChannel) {
        supabaseStateChannel.unsubscribe();
        supabaseStateChannel = null;
    }
    game = null;
}

function handleGameEnd({ isWinner }) {
    if (isWinner) {
        deleteLobby().catch(() => {});
    }
    returnToLanding();
}

async function handleLogin() {
    const client = supabaseClient || applySupabaseInputs();
    if (!client) return;
    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value;
    if (!email || !password) {
        authStatus.textContent = 'E-Mail und Passwort nötig';
        return;
    }
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
        authStatus.textContent = error.message || 'Anmeldung fehlgeschlagen';
        return;
    }
    updateAuthUi(data.session);
}

async function handleRegister() {
    const client = supabaseClient || applySupabaseInputs();
    if (!client) return;
    const email = authEmailInput.value.trim();
    const password = authPasswordInput.value;
    if (!email || !password) {
        authStatus.textContent = 'E-Mail und Passwort nötig';
        return;
    }
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
        authStatus.textContent = error.message || 'Registrierung fehlgeschlagen';
        return;
    }
    updateAuthUi(data.session);
    if (!data.session) {
        authStatus.textContent = 'Bestätige die E-Mail zum Einloggen';
    }
}

async function handleLogout() {
    const client = supabaseClient || applySupabaseInputs();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) {
        authStatus.textContent = error.message || 'Abmeldung fehlgeschlagen';
        return;
    }
    updateAuthUi(null);
}

function subscribeSupabaseBroadcast(lobbyCodeValue) {
    const client = supabaseClient || applySupabaseInputs();
    if (!client || !lobbyCodeValue) return;
    if (supabaseBroadcastChannel) {
        supabaseBroadcastChannel.unsubscribe();
    }
    if (authSession?.access_token) {
        client.realtime.setAuth(authSession.access_token);
    }
    const channelKey = getLobbyChannelKey() || lobbyCodeValue;
    supabaseBroadcastChannel = client.channel(`lobby:${channelKey}:players`, { config: { private: true } });
    broadcastReady = false;
    supabaseBroadcastChannel.on('broadcast', { event: 'INSERT' }, () => {
        setLobbyStatus('Neuer Spieler beigetreten');
    });
    supabaseBroadcastChannel.on('broadcast', { event: 'UPDATE' }, () => {});
    supabaseBroadcastChannel.on('broadcast', { event: 'DELETE' }, () => {});
    supabaseBroadcastChannel.on('broadcast', { event: 'player_message' }, (payload) => {
        if (payload?.payload?.text) {
            setLobbyStatus(payload.payload.text);
        }
    });
    supabaseBroadcastChannel.on('broadcast', { event: 'player_ready' }, (payload) => {
        const readyId = payload?.payload?.playerId;
        if (!readyId) return;
        readyPlayers.add(readyId);
        updateReadyStatus();
        if (readyPlayers.size >= 2 && game) {
            game.setLobbyReady(true);
        }
    });
    supabaseBroadcastChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            broadcastReady = true;
            const message = {
                type: 'broadcast',
                event: 'player_message',
                payload: { text: 'Hi' }
            };
            if (typeof supabaseBroadcastChannel.httpSend === 'function') {
                supabaseBroadcastChannel.httpSend(message.event, message.payload);
            } else {
                supabaseBroadcastChannel.send(message);
            }
        }
    });
}

function subscribeLobbyState(lobbyCodeValue) {
    const client = supabaseClient || applySupabaseInputs();
    if (!client || !lobbyCodeValue) return;
    if (supabaseStateChannel) {
        supabaseStateChannel.unsubscribe();
    }
    if (authSession?.access_token) {
        client.realtime.setAuth(authSession.access_token);
    }
    supabaseStateChannel = client.channel(`lobby-state:${lobbyCodeValue}`);
    supabaseStateChannel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lobbies', filter: `code=eq.${lobbyCodeValue}` },
        (payload) => {
            const state = payload.new?.state;
            const status = payload.new?.status;
            if (status === 'waiting') {
                resetReadyState();
                if (game) {
                    game.setLobbyReady(false);
                }
            }
            if (game && readyPlayers.size >= 2) {
                game.setLobbyReady(true);
            }
            if (!state) return;
            if (!game) {
                game = new Game({ multiplayer: true, viewerPlayer: playerIndex, sendCommand, onGameEnd: handleGameEnd });
            }
            game.viewerPlayer = playerIndex;
            game.applyState(state);
            updateTurnTimer(state);
        }
    );
    supabaseStateChannel.subscribe();
}

function renderLobbyList(lobbies) {
    lobbyList.innerHTML = '';
    if (!lobbies.length) {
        lobbyList.textContent = 'Keine offenen Lobbys';
        return;
    }
    lobbies.forEach((lobby) => {
        const item = document.createElement('div');
        item.className = 'lobby-item';
        const info = document.createElement('span');
        const status = lobby.status === 'active' ? 'läuft' : 'wartet';
        info.textContent = `Lobby ${lobby.code} • ${lobby.players}/2 • ${status}`;
        const joinButton = document.createElement('button');
        joinButton.type = 'button';
        joinButton.textContent = 'Beitreten';
        joinButton.addEventListener('click', () => {
            lobbyCodeInput.value = lobby.code;
            joinLobby().catch(() => setLobbyStatus('Lobby konnte nicht beigetreten werden'));
        });
        item.appendChild(info);
        item.appendChild(joinButton);
        lobbyList.appendChild(item);
    });
}

async function fetchLobbies() {
    const client = supabaseClient || applySupabaseInputs();
    if (!client) {
        lobbyList.textContent = 'Supabase fehlt';
        return;
    }
    const { data, error } = await client
        .from('lobbies')
        .select('code,status,updated_at,players(count)')
        .in('status', ['waiting', 'active'])
        .order('updated_at', { ascending: false })
        .limit(50);
    if (error) {
        lobbyList.textContent = error.message || 'Lobbys konnten nicht geladen werden';
        return;
    }
    const mapped = (data || []).map((lobby) => ({
        code: lobby.code,
        status: lobby.status,
        players: lobby.players?.[0]?.count ?? 0
    }));
    renderLobbyList(mapped);
}

function updateTurnTimer(state) {
    if (turnTimerInterval) {
        clearInterval(turnTimerInterval);
        turnTimerInterval = null;
    }
    if (!state.turnStartedAt || state.setupPhase || state.gameOver) {
        turnTimer.textContent = '';
        return;
    }
    const update = () => {
        const startedAt = new Date(state.turnStartedAt).getTime();
        const remaining = Math.max(0, 120000 - (Date.now() - startedAt));
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        turnTimer.textContent = `Zug-Timer: ${minutes}:${String(seconds).padStart(2, '0')}`;
    };
    update();
    turnTimerInterval = setInterval(update, 1000);
}

function sendCommand(action, payload) {
    const client = supabaseClient || applySupabaseInputs();
    if (!client || !lobbyCode || !playerId || !rpcHelper) return;
    rpcHelper
        .rpcApplyCommandJson({ lobby_code: lobbyCode, player_id: playerId, action, payload })
        .catch((error) => {
            const message = error?.details?.message || error.message || '';
            if (message.includes('apply_command_json') || message.includes('function') || error.status === 404) {
                const accessToken = authSession?.access_token;
                if (accessToken) {
                    const fetchWithJson = xn();
                    const url = `${SUPABASE_URL}/rest/v1/rpc/apply_command_json`;
                    return fetchWithJson(url, {
                        method: 'POST',
                        headers: {
                            apikey: SUPABASE_ANON_KEY,
                            Authorization: `Bearer ${accessToken}`
                        },
                        body: {
                            lobby_code: lobbyCode,
                            player_id: playerId,
                            action,
                            payload: payload ?? {}
                        } as any
                    }).then((resp) => {
                        if (resp.ok) return;
                        return rpcHelper
                            .rpcApplyCommand({ lobby_code: lobbyCode, player_id: playerId, action, payload })
                            .catch((fallbackError) => {
                                setLobbyStatus(fallbackError.message || 'Aktion abgelehnt');
                            });
                    });
                }
                return rpcHelper
                    .rpcApplyCommand({ lobby_code: lobbyCode, player_id: playerId, action, payload })
                    .catch((fallbackError) => {
                        setLobbyStatus(fallbackError.message || 'Aktion abgelehnt');
                    });
            }
            setLobbyStatus(error.message || 'Aktion abgelehnt');
        });
}

async function createLobby() {
    setLobbyStatus('Erstelle Lobby...');
    const client = supabaseClient || applySupabaseInputs();
    if (!client || !rpcHelper) {
        setLobbyStatus('Supabase fehlt');
        return;
    }
    let data;
    try {
        data = await rpcHelper.callRpc('create_lobby', {});
    } catch (error) {
        setLobbyStatus(formatSupabaseError(error, 'Lobby konnte nicht erstellt werden'));
        return;
    }
    lobbyCode = data.lobby_code;
    lobbyId = data.lobby_id || null;
    playerId = data.player_id;
    playerIndex = data.player_index;
    persistPlayerId(playerId);
    lobbyCodeInput.value = lobbyCode;
    updateLobbyInfo();
    resetReadyState();
    subscribeSupabaseBroadcast(lobbyCode);
    subscribeLobbyState(lobbyCode);
    if (data.state) {
        game = new Game({ multiplayer: true, viewerPlayer: playerIndex, sendCommand, onGameEnd: handleGameEnd });
        game.setLobbyReady(false);
        game.applyState(data.state);
        updateTurnTimer(data.state);
    }
}

async function joinLobby() {
    const code = lobbyCodeInput.value.trim().toUpperCase();
    if (!code) {
        setLobbyStatus('Lobby-Code fehlt');
        return;
    }
    setLobbyStatus('Trete Lobby bei...');
    const client = supabaseClient || applySupabaseInputs();
    if (!client || !rpcHelper) {
        setLobbyStatus('Supabase fehlt');
        return;
    }
    let data;
    try {
        const cachedPlayerId = getCachedPlayerId();
        const side = getOrCreatePlayerSide();
        if (cachedPlayerId) {
            try {
                data = await rpcHelper.callRpc('join_lobby', { p_code: code, p_player_id: cachedPlayerId, p_side: side });
            } catch {
                data = await rpcHelper.callRpc('join_lobby', { p_code: code, p_side: side });
            }
        } else {
            data = await rpcHelper.callRpc('join_lobby', { p_code: code, p_side: side });
        }
    } catch (error) {
        setLobbyStatus(formatSupabaseError(error, 'Lobby konnte nicht beigetreten werden'));
        return;
    }
    lobbyCode = data.lobby_code;
    lobbyId = data.lobby_id || null;
    playerId = data.player_id;
    playerIndex = data.player_index;
    if (playerId && playerId !== getCachedPlayerId()) {
        persistPlayerId(playerId);
    }
    updateLobbyInfo();
    resetReadyState();
    subscribeSupabaseBroadcast(lobbyCode);
    subscribeLobbyState(lobbyCode);
    if (data.state) {
        game = new Game({ multiplayer: true, viewerPlayer: playerIndex, sendCommand, onGameEnd: handleGameEnd });
        game.setLobbyReady(false);
        game.applyState(data.state);
        updateTurnTimer(data.state);
    }
}

startButton.addEventListener('click', () => {
    landing.style.display = 'none';
    gameUi.classList.add('active');
    setLobbyStatus('Lobby erstellen oder beitreten');
    if (!lobbyListInterval) {
        fetchLobbies().catch(() => {});
        lobbyListInterval = setInterval(() => {
            fetchLobbies().catch(() => {});
        }, 5000);
    }
});

authLoginButton.addEventListener('click', () => {
    handleLogin().catch(() => {
        authStatus.textContent = 'Anmeldung fehlgeschlagen';
    });
});

authRegisterButton.addEventListener('click', () => {
    handleRegister().catch(() => {
        authStatus.textContent = 'Registrierung fehlgeschlagen';
    });
});

authLogoutButton.addEventListener('click', () => {
    handleLogout().catch(() => {
        authStatus.textContent = 'Abmeldung fehlgeschlagen';
    });
});

readyLobbyButton.addEventListener('click', () => {
    handleReadyClick();
});

createLobbyButton.addEventListener('click', () => {
    createLobby().catch(() => setLobbyStatus('Lobby konnte nicht erstellt werden'));
});

joinLobbyButton.addEventListener('click', () => {
    joinLobby().catch(() => setLobbyStatus('Lobby konnte nicht beigetreten werden'));
});

refreshLobbiesButton.addEventListener('click', () => {
    fetchLobbies().catch(() => {});
});

applySupabaseInputs();
updateAuthUi(null);
if (supabaseClient) {
    supabaseClient.auth.getSession().then(({ data }) => {
        updateAuthUi(data.session);
    });
    supabaseClient.auth.onAuthStateChange((_event, session) => {
        updateAuthUi(session);
    });
}
