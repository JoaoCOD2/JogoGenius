/* ================================================================
   GENIUS — multiplayer.js
   Sistema de Multiplayer com Firebase Realtime Database
   Funcionalidades:
   - Criar e entrar em salas
   - Sincronização em tempo real
   - Revezamento de turnos
   - Eliminação de jogadores (quem errar sai)
================================================================ */

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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

  // Remove listeners registrados com segurança
  removeAllListeners();

  if (multiplayerState.waitingTimeoutId) {
    clearTimeout(multiplayerState.waitingTimeoutId);
    multiplayerState.waitingTimeoutId = null;
  }

  // Remove dados da sala do Firebase se for host
  if (multiplayerState.roomId && multiplayerState.isHost) {
    window.firebaseRemove(window.firebaseRef(window.firebaseDatabase, `rooms/${multiplayerState.roomId}`));
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
    waitingTimeoutId: null,
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
  const createButton = document.getElementById('createRoomSubmit');
  const cancelButton = document.getElementById('createRoomCancel');

  if (!playerName) {
    showErrorModal('Nome obrigatório', 'Por favor, digite seu nome antes de criar a sala.');
    return;
  }

  if (!window.firebaseDatabase) {
    showErrorModal('Firebase indisponível', 'Firebase não foi inicializado. Recarregue a página.');
    return;
  }

  createButton.disabled = true;
  cancelButton.disabled = true;
  const originalText = createButton.textContent;
  createButton.textContent = 'Criando...';

  try {
    const roomCode = generateRoomCode();
    const roomId = `room_${roomCode}`;
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    multiplayerState.roomId = roomId;
    multiplayerState.playerId = playerId;
    multiplayerState.playerName = playerName;
    multiplayerState.isHost = true;
    multiplayerState.currentTurn = 1;

    // Cria sala no Firebase com estrutura básica e sequência sincronizada
    const roomData = {
      roomCode: roomCode,
      createdAt: Date.now(),
      player1: {
        id: playerId,
        name: playerName,
        status: 'waiting',
        score: 0,
        phase: 1,
        playerSequence: []
      },
      player2: null,
      sequence: [],
      playerSequence: [],
      currentTurn: 1,
      gameActive: false,
      eliminated: null
    };

    await window.firebaseSet(window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`), roomData);

    // Mostra código da sala
    document.getElementById('playerNameInput').style.display = 'none';
    document.getElementById('roomCodeDisplay').style.display = 'block';
    document.getElementById('roomCodeBox').textContent = roomCode;
    document.getElementById('waitingMessage').style.display = 'block';
    createButton.disabled = true;

    // Aguarda segundo jogador
    listenForSecondPlayer(roomId);

  } catch (error) {
    console.error('Erro ao criar sala:', error);
    showErrorModal('Erro ao criar sala', 'Não foi possível criar a sala. Tente novamente.');
    createButton.disabled = false;
  } finally {
    cancelButton.disabled = false;
    createButton.textContent = originalText;
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
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      multiplayerState.listeners = multiplayerState.listeners.filter(l => l !== unsubscribe);

      if (multiplayerState.waitingTimeoutId) {
        clearTimeout(multiplayerState.waitingTimeoutId);
        multiplayerState.waitingTimeoutId = null;
      }

      // Aguarda um pouco e inicia o jogo
      setTimeout(() => {
        closeAllModals();
        startMultiplayerGame(roomId);
      }, 1000);
    }
  }, (error) => {
    console.error('Erro ao aguardar jogador:', error);
    showErrorModal('Erro de conexão', 'Não foi possível aguardar o segundo jogador. Tente novamente.');
  });

  multiplayerState.listeners.push(unsubscribe);

  // Timeout de 5 minutos para evitar listener indefinido
  multiplayerState.waitingTimeoutId = setTimeout(() => {
    if (multiplayerState.roomId === roomId && !multiplayerState.otherPlayerName) {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      multiplayerState.listeners = multiplayerState.listeners.filter(l => l !== unsubscribe);
      showErrorModal('Tempo de espera expirou', 'Nenhum jogador entrou na sala. Você será redirecionado ao lobby.', 'Voltar', () => {
        leaveMultiplayer();
        openModal('multiplayerLobbyModal');
      });
    }
  }, 5 * 60 * 1000);
}

// ================================================================
// ENTRAR EM SALA
// ================================================================

async function joinRoom() {
  const playerName = document.getElementById('playerNameJoinInput').value.trim();
  const roomCode = document.getElementById('roomCodeInput').value.toUpperCase().trim();
  const joinButton = document.getElementById('joinRoomSubmit');
  const cancelButton = document.querySelector('#joinRoomModal .modal-btn-cancel');
  const joinStatus = document.getElementById('joinStatus');
  const joinStatusMessage = document.getElementById('joinStatusMessage');

  joinStatus.style.display = 'none';
  joinStatusMessage.textContent = '';

  if (!playerName) {
    showErrorModal('Nome obrigatório', 'Por favor, digite seu nome antes de entrar na sala.');
    return;
  }

  if (!roomCode || roomCode.length !== 5) {
    showErrorModal('Código inválido', 'Digite um código de sala válido com 5 caracteres.');
    return;
  }

  if (!window.firebaseDatabase) {
    showErrorModal('Firebase indisponível', 'Firebase não foi inicializado. Recarregue a página.');
    return;
  }

  joinButton.disabled = true;
  cancelButton.disabled = true;
  const originalText = joinButton.textContent;
  joinButton.textContent = 'Conectando...';

  try {
    const roomId = `room_${roomCode}`;
    const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('timeout')), 10000);
    });
    timeoutPromise.clear = () => clearTimeout(timeoutId);

    const snapshot = await Promise.race([
      window.firebaseGet(roomRef),
      timeoutPromise
    ]);

    if (typeof timeoutPromise.clear === 'function') {
      timeoutPromise.clear();
    }

    if (!snapshot.exists()) {
      joinStatus.style.display = 'block';
      joinStatusMessage.textContent = '❌ Sala não encontrada!';
      return;
    }

    const roomData = snapshot.val();

    if (roomData.player2) {
      joinStatus.style.display = 'block';
      joinStatusMessage.textContent = '❌ Sala já está cheia!';
      return;
    }

    if (roomData.gameActive) {
      joinStatus.style.display = 'block';
      joinStatusMessage.textContent = '❌ Jogo já começou!';
      return;
    }

    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    multiplayerState.roomId = roomId;
    multiplayerState.playerId = playerId;
    multiplayerState.playerName = playerName;
    multiplayerState.isHost = false;
    multiplayerState.otherPlayerName = roomData.player1.name;

    await window.firebaseUpdate(roomRef, {
      player2: {
        id: playerId,
        name: playerName,
        status: 'ready',
        score: 0,
        phase: 1,
        playerSequence: []
      }
    });

    closeAllModals();
    startMultiplayerGame(roomId);

  } catch (error) {
    console.error('Erro ao entrar na sala:', error);
    if (error.message === 'timeout') {
      showErrorModal('Tempo esgotado', 'Não foi possível conectar ao servidor. Tente novamente.');
    } else {
      showErrorModal('Erro ao conectar', 'Falha ao entrar na sala. Verifique o código e tente novamente.');
    }
  } finally {
    joinButton.disabled = false;
    cancelButton.disabled = false;
    joinButton.textContent = originalText;
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
      playerSequence: [],
      gameActive: true,
      currentTurn: 1,
      eliminated: null
    });

    // Host começa a jogar
    playMultiplayerSequence(roomId);

  } catch (error) {
    console.error('Erro ao inicializar jogo:', error);
    showErrorModal('Erro ao iniciar jogo', 'Não foi possível iniciar o jogo multiplayer. Tente novamente.');
  }
}

// ================================================================
// OUVIR MUDANÇAS NO ESTADO DO JOGO
// ================================================================

function listenToGameState(roomId) {
  const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);

  const unsubscribe = window.firebaseOnValue(roomRef, async (snapshot) => {
    if (!snapshot.exists()) {
      showErrorModal('Sala encerrada', 'A sala foi fechada pelo outro jogador. Você será redirecionado ao menu.', 'Voltar ao menu', () => {
        leaveMultiplayer();
        openModal('gameSelectModal');
      });
      return;
    }

    const roomData = snapshot.val();

    // Detecta desconexão de um jogador após o jogo ter iniciado
    if (roomData.gameActive && (!roomData.player1 || !roomData.player2)) {
      showErrorModal('Conexão perdida', 'Um jogador desconectou. O jogo foi interrompido.', 'Voltar ao menu', () => {
        leaveMultiplayer();
        openModal('gameSelectModal');
      });
      return;
    }

    // Atualiza dados locais
    multiplayerState.sequence = roomData.sequence || [];
    multiplayerState.playerSequence = roomData.playerSequence || [];
    multiplayerState.currentTurn = roomData.currentTurn || 1;
    multiplayerState.scores = {
      player1: roomData.player1?.score || 0,
      player2: roomData.player2?.score || 0
    };

    // Deu para sincronizar o playerSequence de cada jogador também
    const player1Progress = roomData.player1?.playerSequence?.length || 0;
    const player2Progress = roomData.player2?.playerSequence?.length || 0;

    // Atualiza placar na UI
    document.getElementById('player1Score').textContent = multiplayerState.scores.player1;
    document.getElementById('player2Score').textContent = multiplayerState.scores.player2;

    if (multiplayerState.currentTurn === 1) {
      document.getElementById('player1Status').textContent = 'Sua vez';
      document.getElementById('player2Status').textContent = `Progresso: ${player2Progress}/${multiplayerState.sequence.length}`;
    } else {
      document.getElementById('player1Status').textContent = `Progresso: ${player1Progress}/${multiplayerState.sequence.length}`;
      document.getElementById('player2Status').textContent = 'Sua vez';
    }

  }, (error) => {
    console.error('Erro ao ouvir estado:', error);
    showErrorModal('Erro de escuta', 'Ocorreu um problema ao sincronizar o estado do jogo.');
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

    // Aumenta pontuação do jogador atual
    const playerKey = multiplayerState.isHost ? 'player1' : 'player2';
    multiplayerState.scores[playerKey]++;

    const currentPlayerData = {
      id: multiplayerState.playerId,
      name: multiplayerState.playerName,
      status: 'ready',
      score: multiplayerState.scores[playerKey],
      phase: multiplayerState.sequence.length,
      playerSequence: multiplayerState.playerSequence
    };

    const updates = {
      sequence: multiplayerState.sequence,
      playerSequence: multiplayerState.playerSequence,
      [playerKey]: currentPlayerData,
      currentTurn: multiplayerState.isHost ? 2 : 1
    };

    await window.firebaseUpdate(roomRef, updates);
  }
}

// ================================================================
// FIM DO JOGO MULTIPLAYER
// ================================================================

function endMultiplayerGame(roomId, eliminatedPlayer) {
  multiplayerState.isActive = false;
  
  // Fecha o modal de jogo se ainda estiver aberto
  closeModal('gameRoomModal');

  // Remove listeners
  multiplayerState.listeners.forEach(unsubscribe => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });
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
