const SYMBOLS = {
    e: ''
};

class Game {
    constructor() {
        this.board = Array(6).fill(null).map(() => Array(7).fill(null));
        this.currentPlayer = 1;
        this.selectedCell = null;
        this.gameOver = false;
        this.setupPhase = true;
        this.setupPlayer = 1;
        this.player1Setup = [];
        this.player2Setup = [];
        this.pendingDuel = null;
        this.startSetupPhase();
    }

    startSetupPhase() {
        this.showSetupModal(1);
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

    showSetupModal(player) {
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
            if (selectedCell) {
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

        function updatePieceSelector() {
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
        }

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
            for (let [key, type] of Object.entries(assignments)) {
                const [row, col] = key.split('-').map(Number);
                const piece = { player, type };
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
        
        // Kampf-Effekt
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
                    const isHidden = !this.setupPhase && piece.player !== this.currentPlayer;
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

const startButton = document.getElementById('start-game');
const landing = document.getElementById('landing');
const gameUi = document.getElementById('game-ui');
let game = null;

startButton.addEventListener('click', () => {
    landing.style.display = 'none';
    gameUi.classList.add('active');
    if (!game) {
        game = new Game();
    }
});
