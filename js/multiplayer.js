/* ================================================================
   GENIUS — multiplayer.js
   Sistema de Multiplayer com Firebase Realtime Database
   Funcionalidades:
   - Criar e entrar em salas
   - Sincronização em tempo real
   - Revezamento de turnos
   - Eliminação de jogadores (quem errar sai)
================================================================ */

// Variáveis globais de multiplayer
let multiplayerState = {
  roomId: null,
  playerId: null,
  playerName: '',
  otherPlayerName: '',
  isHost: false,
  sequence: [],
  playerSequence: [],
  currentTurn: 1, // 1 ou 2
  scores: { player1: 0, player2: 0 },
  eliminated: null, // null, 1 ou 2
  isActive: false,
  listeners: [] // Para remover listeners depois
};

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// ================================================================
// FUNÇÕES DE UI (Modais)
// ================================================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  const overlay = document.getElementById('modalOverlay');
  if (modal) {
    modal.classList.add('active');
    overlay.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  const overlay = document.getElementById('modalOverlay');
  if (modal) {
    modal.classList.remove('active');
  }
  // Verifica se ainda há modais abertos
  if (!document.querySelector('.modal.active')) {
    overlay.classList.remove('active');
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  document.getElementById('modalOverlay').classList.remove('active');
}

// ================================================================
// SELEÇÃO DE MODO DE JOGO
// ================================================================

function selectGameMode(mode) {
  currentGameMode = mode;
  closeModal('gameSelectModal');

  if (mode === 'single') {
    // Volta ao jogo single-player
    startGame();
  } else if (mode === 'multi') {
    // Abre lobby multiplayer
    openModal('multiplayerLobbyModal');
  }
}

function showCreateRoomModal() {
  closeModal('multiplayerLobbyModal');
  openModal('createRoomModal');
  document.getElementById('playerNameInput').focus();
}

function showJoinRoomModal() {
  closeModal('multiplayerLobbyModal');
  openModal('joinRoomModal');
  document.getElementById('playerNameJoinInput').focus();
}

function leaveMultiplayer() {
  closeAllModals();
  if (multiplayerState.roomId && multiplayerState.listeners.length > 0) {
    // Remove todos os listeners
    multiplayerState.listeners.forEach(unsubscribe => unsubscribe());
    multiplayerState.listeners = [];
    
    // Remove dados da sala do Firebase
    if (multiplayerState.isHost) {
      window.firebaseRemove(window.firebaseRef(window.firebaseDatabase, `rooms/${multiplayerState.roomId}`));
    }
  }
  
  // Reseta estado
  multiplayerState = {
    roomId: null,
    playerId: null,
    playerName: '',
    otherPlayerName: '',
    isHost: false,
    sequence: [],
    playerSequence: [],
    currentTurn: 1,
    scores: { player1: 0, player2: 0 },
    eliminated: null,
    isActive: false,
    listeners: []
  };
  
  currentGameMode = 'single';
}

// ================================================================
// GERAR CÓDIGO DE SALA
// ================================================================

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

// ================================================================
// CRIAR SALA
// ================================================================

async function createRoom() {
  const playerName = document.getElementById('playerNameInput').value.trim();
  
  if (!playerName) {
    alert('Por favor, digite seu nome!');
    return;
  }

  if (!window.firebaseDatabase) {
    alert('Firebase não inicializado. Recarregue a página.');
    return;
  }

  try {
    const roomCode = generateRoomCode();
    const roomId = `room_${roomCode}`;
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    multiplayerState.roomId = roomId;
    multiplayerState.playerId = playerId;
    multiplayerState.playerName = playerName;
    multiplayerState.isHost = true;
    multiplayerState.currentTurn = 1;

    // Cria sala no Firebase
    const roomData = {
      roomCode: roomCode,
      createdAt: Date.now(),
      player1: {
        id: playerId,
        name: playerName,
        status: 'waiting',
        score: 0,
        phase: 1
      },
      player2: null,
      sequence: [],
      currentTurn: 1,
      gameActive: false
    };

    await window.firebaseSet(window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`), roomData);

    // Mostra código da sala
    document.getElementById('playerNameInput').style.display = 'none';
    document.getElementById('roomCodeDisplay').style.display = 'block';
    document.getElementById('roomCodeBox').textContent = roomCode;
    document.getElementById('waitingMessage').style.display = 'block';
    document.getElementById('createRoomSubmit').disabled = true;

    // Aguarda segundo jogador
    listenForSecondPlayer(roomId);

  } catch (error) {
    console.error('Erro ao criar sala:', error);
    alert('Erro ao criar sala. Tente novamente.');
  }
}

// ================================================================
// AGUARDAR SEGUNDO JOGADOR
// ================================================================

function listenForSecondPlayer(roomId) {
  const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);
  
  const unsubscribe = window.firebaseOnValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    
    if (data && data.player2) {
      // Segundo jogador entrou!
      multiplayerState.otherPlayerName = data.player2.name;
      unsubscribe();
      
      // Aguarda um pouco e inicia o jogo
      setTimeout(() => {
        closeAllModals();
        startMultiplayerGame(roomId);
      }, 1000);
    }
  }, (error) => {
    console.error('Erro ao aguardar jogador:', error);
  });

  multiplayerState.listeners.push(unsubscribe);

  // Timeout de 5 minutos
  setTimeout(() => {
    if (multiplayerState.roomId === roomId && !multiplayerState.otherPlayerName) {
      unsubscribe();
      multiplayerState.listeners = multiplayerState.listeners.filter(l => l !== unsubscribe);
      alert('Tempo de espera expirou. Nenhum jogador entrou na sala.');
      leaveMultiplayer();
      openModal('multiplayerLobbyModal');
    }
  }, 5 * 60 * 1000);
}

// ================================================================
// ENTRAR EM SALA
// ================================================================

async function joinRoom() {
  const playerName = document.getElementById('playerNameJoinInput').value.trim();
  const roomCode = document.getElementById('roomCodeInput').value.toUpperCase().trim();

  if (!playerName) {
    alert('Por favor, digite seu nome!');
    return;
  }

  if (!roomCode || roomCode.length !== 5) {
    alert('Por favor, digite um código de sala válido (5 caracteres)!');
    return;
  }

  if (!window.firebaseDatabase) {
    alert('Firebase não inicializado. Recarregue a página.');
    return;
  }

  try {
    const roomId = `room_${roomCode}`;
    const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);
    
    // Obtém dados da sala
    const snapshot = await new Promise((resolve) => {
      window.firebaseOnValue(roomRef, resolve, { onlyOnce: true });
    });

    if (!snapshot.exists()) {
      document.getElementById('joinStatus').style.display = 'block';
      document.getElementById('joinStatusMessage').textContent = '❌ Sala não encontrada!';
      return;
    }

    const roomData = snapshot.val();
    
    if (roomData.player2) {
      document.getElementById('joinStatus').style.display = 'block';
      document.getElementById('joinStatusMessage').textContent = '❌ Sala já está cheia!';
      return;
    }

    if (roomData.gameActive) {
      document.getElementById('joinStatus').style.display = 'block';
      document.getElementById('joinStatusMessage').textContent = '❌ Jogo já começou!';
      return;
    }

    // Entra como player2
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    multiplayerState.roomId = roomId;
    multiplayerState.playerId = playerId;
    multiplayerState.playerName = playerName;
    multiplayerState.isHost = false;
    multiplayerState.otherPlayerName = roomData.player1.name;

    // Atualiza sala com player2
    await window.firebaseUpdate(roomRef, {
      player2: {
        id: playerId,
        name: playerName,
        status: 'ready',
        score: 0,
        phase: 1
      }
    });

    closeAllModals();
    startMultiplayerGame(roomId);

  } catch (error) {
    console.error('Erro ao entrar na sala:', error);
    document.getElementById('joinStatus').style.display = 'block';
    document.getElementById('joinStatusMessage').textContent = '❌ Erro ao conectar!';
  }
}

// ================================================================
// INICIAR JOGO MULTIPLAYER
// ================================================================

function startMultiplayerGame(roomId) {
  console.log('Iniciando jogo multiplayer na sala:', roomId);
  
  multiplayerState.isActive = true;
  
  // Mostra modal do jogo
  openModal('gameRoomModal');

  // Atualiza nomes dos jogadores
  document.getElementById('player1Name').textContent = multiplayerState.isHost 
    ? multiplayerState.playerName 
    : multiplayerState.otherPlayerName;
  document.getElementById('player2Name').textContent = multiplayerState.isHost 
    ? multiplayerState.otherPlayerName 
    : multiplayerState.playerName;

  // Aguarda mudanças no Firebase
  listenToGameState(roomId);

  // Se é host, começa o jogo
  if (multiplayerState.isHost) {
    initializeMultiplayerGame(roomId);
  }
}

// ================================================================
// INICIALIZAR JOGO (HOST)
// ================================================================

async function initializeMultiplayerGame(roomId) {
  try {
    multiplayerState.sequence = ['green']; // Começa com uma cor
    multiplayerState.playerSequence = [];

    const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);

    // Atualiza sala com sequência inicial
    await window.firebaseUpdate(roomRef, {
      sequence: multiplayerState.sequence,
      gameActive: true,
      currentTurn: 1
    });

    // Host começa a jogar
    playMultiplayerSequence(roomId);

  } catch (error) {
    console.error('Erro ao inicializar jogo:', error);
  }
}

// ================================================================
// OUVIR MUDANÇAS NO ESTADO DO JOGO
// ================================================================

function listenToGameState(roomId) {
  const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);

  const unsubscribe = window.firebaseOnValue(roomRef, async (snapshot) => {
    if (!snapshot.exists()) {
      console.log('Sala deletada');
      leaveMultiplayer();
      return;
    }

    const roomData = snapshot.val();
    
    // Atualiza dados locais
    multiplayerState.sequence = roomData.sequence || [];
    multiplayerState.currentTurn = roomData.currentTurn || 1;
    multiplayerState.scores = {
      player1: roomData.player1?.score || 0,
      player2: roomData.player2?.score || 0
    };

    // Atualiza placar na UI
    document.getElementById('player1Score').textContent = multiplayerState.scores.player1;
    document.getElementById('player2Score').textContent = multiplayerState.scores.player2;

    // Verifica se alguém foi eliminado
    if (roomData.eliminated) {
      multiplayerState.eliminated = roomData.eliminated;
      endMultiplayerGame(roomId, roomData.eliminated);
      return;
    }

    // Atualiza status do turno
    if (multiplayerState.currentTurn === 1) {
      document.getElementById('player1Status').textContent = 'Sua vez';
      document.getElementById('player2Status').textContent = 'Aguardando...';
    } else {
      document.getElementById('player1Status').textContent = 'Aguardando...';
      document.getElementById('player2Status').textContent = 'Sua vez';
    }

  }, (error) => {
    console.error('Erro ao ouvir estado:', error);
  });

  multiplayerState.listeners.push(unsubscribe);
}

// ================================================================
// EXECUTAR SEQUÊNCIA (HOST)
// ================================================================

async function playMultiplayerSequence(roomId) {
  try {
    // Reproduz cada cor da sequência
    for (const color of multiplayerState.sequence) {
      await flashButton(color);
      await sleep(200);
    }

    // Muda turno para player 2
    const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);
    await window.firebaseUpdate(roomRef, {
      currentTurn: 2,
      playerSequence: [] // Reseta para o próximo jogador
    });

  } catch (error) {
    console.error('Erro ao executar sequência:', error);
  }
}

// ================================================================
// PROCESSAR CLIQUE DO JOGADOR MULTIPLAYER
// ================================================================

async function handleMultiplayerColorClick(color) {
  if (!multiplayerState.isActive) return;

  // Determina se é a vez do jogador atual
  const isMyTurn = 
    (multiplayerState.currentTurn === 1 && multiplayerState.isHost) ||
    (multiplayerState.currentTurn === 2 && !multiplayerState.isHost);

  if (!isMyTurn) {
    console.log('Não é sua vez!');
    return;
  }

  // Adiciona cor à sequência do jogador
  multiplayerState.playerSequence.push(color);
  flashPlayerButton(color);

  const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${multiplayerState.roomId}`);
  const expectedColor = multiplayerState.sequence[multiplayerState.playerSequence.length - 1];

  // Verifica se acertou
  if (color !== expectedColor) {
    // ERROU! Este jogador é eliminado
    console.log('Jogador errou! Eliminar player:', multiplayerState.currentTurn);
    
    playErrorSound();

    // Marca como eliminado
    const playerNum = (multiplayerState.isHost && multiplayerState.currentTurn === 1) || 
                      (!multiplayerState.isHost && multiplayerState.currentTurn === 2) ? 1 : 2;
    
    await window.firebaseUpdate(roomRef, {
      eliminated: playerNum,
      gameActive: false
    });

    return;
  }

  // Acertou a cor!
  playTone(color);

  // Completou a sequência?
  if (multiplayerState.playerSequence.length === multiplayerState.sequence.length) {
    // SIM! Próximo turno
    await sleep(500);

    // Aumenta sequência
    const newColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    multiplayerState.sequence.push(newColor);

    // Aumenta pontuação
    const currentScore = multiplayerState.isHost ? 'player1' : 'player2';
    multiplayerState.scores[currentScore === 'player1' ? 'player1' : 'player2']++;

    const updates = {
      sequence: multiplayerState.sequence,
      playerSequence: [],
      ['player' + (multiplayerState.isHost ? 1 : 2)]: {
        ...multiplayerState.isHost ? 
          { id: multiplayerState.playerId, name: multiplayerState.playerName } :
          { id: multiplayerState.playerId, name: multiplayerState.playerName },
        status: 'ready',
        score: multiplayerState.scores[currentScore],
        phase: multiplayerState.sequence.length
      }
    };

    // Muda turno
    if (multiplayerState.isHost) {
      updates.currentTurn = 2;
    } else {
      updates.currentTurn = 1;
    }

    await window.firebaseUpdate(roomRef, updates);
  }
}

// ================================================================
// FIM DO JOGO MULTIPLAYER
// ================================================================

function endMultiplayerGame(roomId, eliminatedPlayer) {
  multiplayerState.isActive = false;
  
  // Remove listeners
  multiplayerState.listeners.forEach(unsubscribe => unsubscribe());
  multiplayerState.listeners = [];

  const isWinner = 
    (multiplayerState.isHost && eliminatedPlayer === 2) ||
    (!multiplayerState.isHost && eliminatedPlayer === 1);

  // Mostra resultado
  closeAllModals();
  openModal('multiplayerResultModal');

  document.getElementById('resultTitle').textContent = isWinner ? '🎉 VOCÊ VENCEU!' : '😢 VOCÊ PERDEU!';
  document.getElementById('resultMessage').innerHTML = isWinner 
    ? `<h3>Parabéns! Você derrotou ${multiplayerState.otherPlayerName}!</h3>`
    : `<h3>${multiplayerState.otherPlayerName} errou a sequência!</h3>`;

  const myPlayerNum = multiplayerState.isHost ? 1 : 2;
  document.getElementById('resultScore').textContent = multiplayerState.scores['player' + myPlayerNum];
  document.getElementById('resultPhase').textContent = multiplayerState.sequence.length;

  // Remove sala após 10 segundos
  setTimeout(() => {
    window.firebaseRemove(window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`));
  }, 10000);
}

// ================================================================
// INTEGRAÇÃO COM MODAIS EXISTENTES
// ================================================================

// Substitui funções de modal existentes se necessário
if (!window.openModal) {
  window.openModal = openModal;
}
if (!window.closeModal) {
  window.closeModal = closeModal;
}
if (!window.closeAllModals) {
  window.closeAllModals = closeAllModals;
}
