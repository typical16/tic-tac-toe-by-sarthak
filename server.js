const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('./'));

const waitingPlayers = new Set();
const games = new Map();
const TURN_TIMEOUT = 10000; // 10 seconds

function getRandomEmptyCell(gameBoard) {
    const emptyCells = gameBoard.reduce((acc, cell, index) => {
        if (cell === '') acc.push(index);
        return acc;
    }, []);
    return emptyCells[Math.floor(Math.random() * emptyCells.length)];
}

function handleMove(gameId, index, socket, isTimeout = false) {
    const game = games.get(gameId);
    if (!game) return;

    const player = Object.entries(game.players).find(([_, p]) => p.id === socket.id);
    if (!player || player[0] !== game.currentTurn) return;

    if (game.gameBoard[index] === '') {
        // Clear any existing timeout
        if (game.timeout) {
            clearTimeout(game.timeout);
        }

        game.gameBoard[index] = game.currentTurn;
        game.currentTurn = game.currentTurn === 'X' ? 'O' : 'X';

        // Broadcast the move to both players
        io.to(game.players.X.id).emit('moveMade', {
            index,
            symbol: player[0],
            nextTurn: game.currentTurn,
            isTimeout
        });
        io.to(game.players.O.id).emit('moveMade', {
            index,
            symbol: player[0],
            nextTurn: game.currentTurn,
            isTimeout
        });

        // Check for winner or draw
        const winner = checkWinner(game.gameBoard);
        if (winner || !game.gameBoard.includes('')) {
            io.to(game.players.X.id).emit('gameOver', { winner });
            io.to(game.players.O.id).emit('gameOver', { winner });
            games.delete(gameId);
        } else {
            // Set timeout for next turn
            game.timeout = setTimeout(() => {
                const randomIndex = getRandomEmptyCell(game.gameBoard);
                if (randomIndex !== undefined) {
                    handleMove(gameId, randomIndex, {
                        id: game.players[game.currentTurn].id
                    }, true);
                }
            }, TURN_TIMEOUT);
        }
    }
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('joinGame', (playerName) => {
        if (waitingPlayers.size > 0) {
            // Match with a waiting player
            const opponent = Array.from(waitingPlayers)[0];
            waitingPlayers.delete(opponent);
            
            // Create a new game
            const gameId = `${socket.id}-${opponent.id}`;
            const game = {
                players: {
                    X: { id: opponent.id, name: opponent.name },
                    O: { id: socket.id, name: playerName }
                },
                gameBoard: ['', '', '', '', '', '', '', '', ''],
                currentTurn: 'X',
                timeout: null
            };
            games.set(gameId, game);

            // Notify both players about the game start
            io.to(opponent.id).emit('gameStart', {
                gameId,
                symbol: 'X',
                opponentName: playerName
            });
            socket.emit('gameStart', {
                gameId,
                symbol: 'O',
                opponentName: opponent.name
            });

            // Start timeout for first turn
            game.timeout = setTimeout(() => {
                const randomIndex = getRandomEmptyCell(game.gameBoard);
                if (randomIndex !== undefined) {
                    handleMove(gameId, randomIndex, {
                        id: game.players.X.id
                    }, true);
                }
            }, TURN_TIMEOUT);

        } else {
            // Add to waiting players
            waitingPlayers.add({
                id: socket.id,
                name: playerName
            });
            socket.emit('waiting');
        }
    });

    socket.on('makeMove', ({ gameId, index }) => {
        handleMove(gameId, index, socket);
    });

    socket.on('disconnect', () => {
        // Remove from waiting players
        for (const player of waitingPlayers) {
            if (player.id === socket.id) {
                waitingPlayers.delete(player);
                break;
            }
        }

        // Handle disconnection during game
        for (const [gameId, game] of games.entries()) {
            if (game.players.X.id === socket.id || game.players.O.id === socket.id) {
                if (game.timeout) {
                    clearTimeout(game.timeout);
                }
                const opponent = game.players.X.id === socket.id ? game.players.O.id : game.players.X.id;
                io.to(opponent).emit('opponentLeft');
                games.delete(gameId);
            }
        }
    });
});

function checkWinner(board) {
    const lines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8],
        [0, 3, 6], [1, 4, 7], [2, 5, 8],
        [0, 4, 8], [2, 4, 6]
    ];

    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
            return board[a];
        }
    }
    return null;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 