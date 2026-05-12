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
    listeners: [],
    lastPlayedSequenceLength: 0
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
  multiplayerState.lastPlayedSequenceLength = 0;
  
  // ❌ REMOVER: closeAllModals() e openModal('gameRoomModal')
  // ✅ USAR: A mesma interface do single-player!
  closeAllModals();
  
  // Atualizar título para mostrar multiplayer
  document.querySelector('.title').innerHTML = 
    `GE<span class="title-accent">N</span>IUS<br>
     <span style="font-size: 14px; letter-spacing: 2px; color: var(--text-muted);">
       ${multiplayerState.playerName} vs ${multiplayerState.otherPlayerName}
     </span>`;
  
  // Desabilitar botões inicialmente
  setButtons(false);
  
  // Atualizar área de mensagens
  document.getElementById('score-display').textContent = '0';
  document.getElementById('round-display').textContent = '1';
  document.getElementById('round-text').textContent = '1';
  setMessage('Conectando...', 'info');
  
  // Ouvir mudanças no Firebase
  listenToGameState(roomId);

  // Se é host, inicializa o jogo
  if (multiplayerState.isHost) {
    initializeMultiplayerGame(roomId);
  }
}

// ================================================================
// INICIALIZAR JOGO (HOST)
// ================================================================

async function initializeMultiplayerGame(roomId) {
  try {
    multiplayerState.sequence = ['green'];
    multiplayerState.playerSequence = [];
    multiplayerState.gameStarted = false;

    const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);

    await window.firebaseUpdate(roomRef, {
      sequence: multiplayerState.sequence,
      playerSequence: [],
      gameActive: true,
      currentTurn: 1,
      eliminated: null
    });

    console.log('Jogo inicializado no Firebase pelo host');

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
      setMessage('Sala encerrada pelo outro jogador', 'error');
      setButtons(false);
      setTimeout(() => {
        leaveMultiplayer();
        openModal('gameSelectModal');
      }, 2000);
      return;
    }

    const roomData = snapshot.val();
    
    // ❌ Se desconectou um jogador
    if (roomData.gameActive && (!roomData.player1 || !roomData.player2)) {
      setMessage('Outro jogador desconectou', 'error');
      setButtons(false);
      setTimeout(() => {
        leaveMultiplayer();
        openModal('gameSelectModal');
      }, 2000);
      return;
    }

    // Sincroniza dados locais
    multiplayerState.sequence = roomData.sequence || [];
    multiplayerState.playerSequence = roomData.playerSequence || [];
    multiplayerState.currentTurn = roomData.currentTurn || 1;

    // Atualiza visual da sequência
    document.getElementById('round-display').textContent = multiplayerState.sequence.length || 1;
    document.getElementById('round-text').textContent = multiplayerState.sequence.length || 1;
    updateMultiplayerDots();

    // ❌ ALGUÉM ERROU!
    if (roomData.eliminated) {
      endMultiplayerGame(roomId, roomData.eliminated);
      return;
    }

    // Determina se é minha vez
    const isMyTurn = 
      (multiplayerState.currentTurn === 1 && multiplayerState.isHost) ||
      (multiplayerState.currentTurn === 2 && !multiplayerState.isHost);

    // ✅ HOST: Executar sequência automaticamente
    const shouldPlaySequence = 
      multiplayerState.isHost && 
      roomData.gameActive && 
      multiplayerState.currentTurn === 1 && 
      multiplayerState.lastPlayedSequenceLength < multiplayerState.sequence.length;

    if (shouldPlaySequence) {
      multiplayerState.lastPlayedSequenceLength = multiplayerState.sequence.length;
      await playMultiplayerSequence(roomId);
    }

    // ✅ Atualizar mensagem conforme turno
    if (isMyTurn && !multiplayerState.isHost) {
      // Sua vez (Player 2)
      setMessage('Sua Vez! Clique nos Botões', 'success');
      setButtons(true);
    } else if (isMyTurn && multiplayerState.isHost) {
      // Sua vez (Host Player 1) - será manipulado por playMultiplayerSequence
      setButtons(false);
    } else {
      // Vez do outro jogador
      const otherPlayer = multiplayerState.isHost ? multiplayerState.otherPlayerName : multiplayerState.playerName;
      const progress = multiplayerState.playerSequence.length;
      const total = multiplayerState.sequence.length;
      setMessage(`${otherPlayer} está jogando... (${progress}/${total})`, 'info');
      setButtons(false);
    }

  }, (error) => {
    console.error('Erro ao ouvir estado do jogo:', error);
    setMessage('Erro de conexão', 'error');
  });

  multiplayerState.listeners.push(unsubscribe);
}

// ================================================================
// EXECUTAR SEQUÊNCIA (HOST)
// ================================================================

async function playMultiplayerSequence(roomId) {
  try {
    setButtons(false);
    setMessage('Observe a Sequência', 'info');
    updateMultiplayerDots();
    
    // Aguarda um pouco antes de começar
    await sleep(500);

    // Reproduz cada cor da sequência
    for (let i = 0; i < multiplayerState.sequence.length; i++) {
      const color = multiplayerState.sequence[i];
      
      // Destaca o ponto sendo tocado
      highlightSequenceAt(i);
      
      // Flash do botão
      await flashButton(color, 400);
      await sleep(200);
    }

    // Remove destaque
    clearSequenceHighlight();

    // Muda turno para player 2
    const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);
    await window.firebaseUpdate(roomRef, {
      currentTurn: 2,
      playerSequence: []
    });

  } catch (error) {
    console.error('Erro ao executar sequência:', error);
    setMessage('Erro ao executar sequência', 'error');
  }
}

// Helpers para destacar sequência
function highlightSequenceAt(index) {
  const dots = document.querySelectorAll('#score-dots .dot');
  dots.forEach((dot, i) => {
    if (i === index) {
      dot.style.transform = 'scale(1.4)';
      dot.style.opacity = '1';
    } else {
      dot.style.transform = 'scale(1)';
      dot.style.opacity = '0.4';
    }
  });
}

function clearSequenceHighlight() {
  const dots = document.querySelectorAll('#score-dots .dot');
  dots.forEach(dot => {
    dot.style.transform = 'scale(1)';
    dot.style.opacity = '1';
  });
}

// ================================================================
// PROCESSAR CLIQUE DO JOGADOR MULTIPLAYER
// ================================================================

async function handleMultiplayerColorClick(color) {
  if (!multiplayerState.isActive) return;

  // Verifica se é a vez do jogador
  const isMyTurn = 
    (multiplayerState.currentTurn === 1 && multiplayerState.isHost) ||
    (multiplayerState.currentTurn === 2 && !multiplayerState.isHost);

  if (!isMyTurn) {
    return; // Ignora clique se não for sua vez
  }

  // Flash visual imediato
  await flashButton(color, 200);

  // Adiciona à sequência do jogador
  multiplayerState.playerSequence.push(color);

  const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${multiplayerState.roomId}`);
  const expectedColor = multiplayerState.sequence[multiplayerState.playerSequence.length - 1];

  // ❌ ERROU!
  if (color !== expectedColor) {
    playErrorSound();
    setMessage(`Errou! Era ${COLOR_NAMES[expectedColor]}`, 'error');
    setButtons(false);

    const playerNum = multiplayerState.isHost ? 1 : 2;
    
    await window.firebaseUpdate(roomRef, {
      eliminated: playerNum,
      gameActive: false
    });

    return;
  }

  // ✅ ACERTOU!
  playTone(color);
  
  // Completou a sequência?
  if (multiplayerState.playerSequence.length === multiplayerState.sequence.length) {
    // ✅ AVANÇA DE FASE
    playSuccessSound();
    await sleep(500);

    // Nova cor aleatória
    const newColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    multiplayerState.sequence.push(newColor);

    // Aumenta pontuação
    const playerKey = multiplayerState.isHost ? 'player1' : 'player2';
    multiplayerState.scores[playerKey]++;

    // Atualiza Firebase
    const updates = {
      sequence: multiplayerState.sequence,
      playerSequence: [],
      [playerKey]: {
        id: multiplayerState.playerId,
        name: multiplayerState.playerName,
        status: 'ready',
        score: multiplayerState.scores[playerKey],
        phase: multiplayerState.sequence.length,
        playerSequence: []
      },
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
  
  // Remove listeners
  removeAllListeners();

  const isWinner = 
    (multiplayerState.isHost && eliminatedPlayer === 2) ||
    (!multiplayerState.isHost && eliminatedPlayer === 1);

  // Mostra resultado na tela principal
  if (isWinner) {
    setMessage(`🎉 VOCÊ VENCEU! ${multiplayerState.otherPlayerName} errou!`, 'success');
  } else {
    setMessage(`😢 VOCÊ PERDEU! Fase ${multiplayerState.sequence.length}`, 'error');
  }

  setButtons(false);

  // Após 3 segundos, volta ao menu
  setTimeout(() => {
    leaveMultiplayer();
    openModal('gameSelectModal');
  }, 3000);

  // Remove sala do Firebase
  setTimeout(() => {
    window.firebaseRemove(window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`));
  }, 5000);
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
