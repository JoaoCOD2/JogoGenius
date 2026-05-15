/* ================================================================
   GENIUS — multiplayer.js  (v2 — sequência compartilhada)

   FLUXO CORRETO:
   1. Host exibe a sequência para os dois
   2. Jogador 1 (host) repete a sequência
   3. Se acertar → Jogador 2 repete A MESMA sequência
   4. Se os dois acertarem → host adiciona +1 cor, volta ao passo 1
   5. Quem errar primeiro é eliminado → o outro vence

   Campos no Firebase:
   - sequence[]        → sequência crescente (só o host escreve)
   - currentInput[]    → input do jogador atual (reseta a cada turno)
   - phase             → 'show' | 'p1' | 'p2'
   - p1Done            → bool, P1 concluiu a rodada
   - p2Done            → bool, P2 concluiu a rodada
   - eliminated        → null | 1 | 2
   - gameActive        → bool
================================================================ */

const ROOM_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// ================================================================
// SELEÇÃO DE MODO
// ================================================================

function selectGameMode(mode) {
  currentGameMode = mode;
  closeModal('gameSelectModal');
  if (mode === 'single') {
    startGame();
  } else {
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
  removeAllListeners();

  if (multiplayerState.waitingTimeoutId) {
    clearTimeout(multiplayerState.waitingTimeoutId);
    multiplayerState.waitingTimeoutId = null;
  }

  if (multiplayerState.roomId && multiplayerState.isHost) {
    window.firebaseRemove(
      window.firebaseRef(window.firebaseDatabase, `rooms/${multiplayerState.roomId}`)
    );
  }

  multiplayerState = {
    roomId: null,
    playerId: null,
    playerName: '',
    otherPlayerName: '',
    isHost: false,
    sequence: [],
    currentInput: [],
    phase: 'show',      // 'show' | 'p1' | 'p2'
    p1Done: false,
    p2Done: false,
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

    const roomData = {
      roomCode,
      createdAt: Date.now(),
      player1: { id: playerId, name: playerName, score: 0 },
      player2: null,
      sequence: [],
      currentInput: [],
      phase: 'show',      // 'show' | 'p1' | 'p2'
      p1Done: false,
      p2Done: false,
      gameActive: false,
      eliminated: null
    };

    await window.firebaseSet(
      window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`),
      roomData
    );

    document.getElementById('playerNameInput').style.display = 'none';
    document.getElementById('roomCodeDisplay').style.display = 'block';
    document.getElementById('roomCodeBox').textContent = roomCode;
    document.getElementById('waitingMessage').style.display = 'block';
    createButton.disabled = true;

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
      multiplayerState.otherPlayerName = data.player2.name;
      if (typeof unsubscribe === 'function') unsubscribe();
      multiplayerState.listeners = multiplayerState.listeners.filter(l => l !== unsubscribe);

      if (multiplayerState.waitingTimeoutId) {
        clearTimeout(multiplayerState.waitingTimeoutId);
        multiplayerState.waitingTimeoutId = null;
      }

      setTimeout(() => {
        closeAllModals();
        startMultiplayerGame(roomId);
      }, 1000);
    }
  }, (error) => {
    console.error('Erro ao aguardar jogador:', error);
    showErrorModal('Erro de conexão', 'Não foi possível aguardar o segundo jogador.');
  });

  multiplayerState.listeners.push(unsubscribe);

  multiplayerState.waitingTimeoutId = setTimeout(() => {
    if (multiplayerState.roomId === roomId && !multiplayerState.otherPlayerName) {
      if (typeof unsubscribe === 'function') unsubscribe();
      multiplayerState.listeners = multiplayerState.listeners.filter(l => l !== unsubscribe);
      showErrorModal(
        'Tempo de espera expirou',
        'Nenhum jogador entrou na sala.',
        'Voltar',
        () => { leaveMultiplayer(); openModal('multiplayerLobbyModal'); }
      );
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

    const snapshot = await Promise.race([window.firebaseGet(roomRef), timeoutPromise]);
    if (typeof timeoutPromise.clear === 'function') timeoutPromise.clear();

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
      player2: { id: playerId, name: playerName, score: 0 }
    });

    closeAllModals();
    startMultiplayerGame(roomId);

  } catch (error) {
    console.error('Erro ao entrar na sala:', error);
    if (error.message === 'timeout') {
      showErrorModal('Tempo esgotado', 'Não foi possível conectar ao servidor.');
    } else {
      showErrorModal('Erro ao conectar', 'Falha ao entrar na sala. Verifique o código.');
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

  closeAllModals();

  document.querySelector('.title').innerHTML =
    `GE<span class="title-accent">N</span>IUS<br>
     <span style="font-size:14px;letter-spacing:2px;color:var(--text-muted)">
       ${multiplayerState.playerName} vs ${multiplayerState.otherPlayerName}
     </span>`;

  setButtons(false);
  document.getElementById('score-display').textContent = '0';
  document.getElementById('round-display').textContent = '1';
  document.getElementById('round-text').textContent = '1';
  setMessage('Conectando...', 'info');

  listenToGameState(roomId);

  if (multiplayerState.isHost) {
    initializeMultiplayerGame(roomId);
  }
}

// ================================================================
// INICIALIZAR JOGO (HOST)
// ================================================================

async function initializeMultiplayerGame(roomId) {
  try {
    const firstColor = COLORS[Math.floor(Math.random() * COLORS.length)];

    await window.firebaseUpdate(
      window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`),
      {
        sequence: [firstColor],
        currentInput: [],
        phase: 'show',
        p1Done: false,
        p2Done: false,
        gameActive: true,
        eliminated: null
      }
    );

    console.log('Jogo inicializado. Sequência inicial:', firstColor);
  } catch (error) {
    console.error('Erro ao inicializar jogo:', error);
    showErrorModal('Erro ao iniciar jogo', 'Não foi possível iniciar o jogo.');
  }
}

// ================================================================
// OUVIR MUDANÇAS NO ESTADO DO JOGO
// ================================================================

function listenToGameState(roomId) {
  const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`);

  const unsubscribe = window.firebaseOnValue(roomRef, async (snapshot) => {
    if (!snapshot.exists()) {
      setMessage('Sala encerrada pelo outro jogador.', 'error');
      setButtons(false);
      setTimeout(() => { leaveMultiplayer(); openModal('gameSelectModal'); }, 2000);
      return;
    }

    const room = snapshot.val();

    if (room.gameActive && (!room.player1 || !room.player2)) {
      setMessage('Outro jogador desconectou.', 'error');
      setButtons(false);
      setTimeout(() => { leaveMultiplayer(); openModal('gameSelectModal'); }, 2000);
      return;
    }

    // Alguém foi eliminado
    if (room.eliminated) {
      endMultiplayerGame(roomId, room.eliminated);
      return;
    }

    if (!room.gameActive) return;

    // Sincroniza estado local
    multiplayerState.sequence = room.sequence || [];
    multiplayerState.currentInput = room.currentInput || [];
    multiplayerState.phase = room.phase || 'show';
    multiplayerState.p1Done = room.p1Done || false;
    multiplayerState.p2Done = room.p2Done || false;

    const len = multiplayerState.sequence.length;
    document.getElementById('round-display').textContent = len;
    document.getElementById('round-text').textContent = len;
    updateMultiplayerDots();

    // ── FASE: 'show' ── Host exibe a sequência ──────────────────
    if (multiplayerState.phase === 'show') {
      setButtons(false);

      const shouldPlay =
        multiplayerState.isHost &&
        multiplayerState.lastPlayedSequenceLength < len;

      if (shouldPlay) {
        multiplayerState.lastPlayedSequenceLength = len;
        await playSharedSequence(roomId);
      } else if (!multiplayerState.isHost) {
        setMessage('Observe a sequência...', 'info');
      }
      return;
    }

    // ── FASE: 'p1' ── Vez do Jogador 1 (host) ──────────────────
    if (multiplayerState.phase === 'p1') {
      if (multiplayerState.isHost) {
        const progress = multiplayerState.currentInput.length;
        setMessage(`Sua vez! (${progress}/${len})`, 'success');
        setButtons(true);
      } else {
        const name = multiplayerState.otherPlayerName;
        const progress = multiplayerState.currentInput.length;
        setMessage(`${name} está jogando... (${progress}/${len})`, 'info');
        setButtons(false);
      }
      return;
    }

    // ── FASE: 'p2' ── Vez do Jogador 2 ─────────────────────────
    if (multiplayerState.phase === 'p2') {
      if (!multiplayerState.isHost) {
        const progress = multiplayerState.currentInput.length;
        setMessage(`Sua vez! (${progress}/${len})`, 'success');
        setButtons(true);
      } else {
        const name = multiplayerState.otherPlayerName;
        const progress = multiplayerState.currentInput.length;
        setMessage(`${name} está jogando... (${progress}/${len})`, 'info');
        setButtons(false);
      }
      return;
    }

  }, (error) => {
    console.error('Erro ao ouvir estado:', error);
    setMessage('Erro de conexão.', 'error');
  });

  multiplayerState.listeners.push(unsubscribe);
}

// ================================================================
// EXIBIR SEQUÊNCIA (HOST) → depois passa para fase 'p1'
// ================================================================

async function playSharedSequence(roomId) {
  setButtons(false);
  setMessage('Observe a sequência!', 'info');
  updateMultiplayerDots();

  await sleep(600);

  for (let i = 0; i < multiplayerState.sequence.length; i++) {
    const color = multiplayerState.sequence[i];
    highlightSequenceAt(i);
    await flashButton(color, 400);
    await sleep(200);
  }

  clearSequenceHighlight();

  // Passa para a vez do Jogador 1
  await window.firebaseUpdate(
    window.firebaseRef(window.firebaseDatabase, `rooms/${roomId}`),
    {
      phase: 'p1',
      currentInput: [],
      p1Done: false,
      p2Done: false
    }
  );
}

// ================================================================
// PROCESSAR CLIQUE DO JOGADOR
// ================================================================

async function handleMultiplayerColorClick(color) {
  if (!multiplayerState.isActive) return;

  const phase = multiplayerState.phase;

  // Verifica se é a vez deste jogador
  const isMyTurn =
    (phase === 'p1' && multiplayerState.isHost) ||
    (phase === 'p2' && !multiplayerState.isHost);

  if (!isMyTurn) return;

  // Flash visual imediato
  await flashButton(color, 200);

  // Adiciona ao input local e sincroniza
  const newInput = [...multiplayerState.currentInput, color];
  const step = newInput.length - 1;
  const expected = multiplayerState.sequence[step];
  const roomRef = window.firebaseRef(window.firebaseDatabase, `rooms/${multiplayerState.roomId}`);

  // ── ERROU ────────────────────────────────────────────────────
  if (color !== expected) {
    playErrorSound();
    setMessage(`Errou! Era ${COLOR_NAMES[expected]}`, 'error');
    setButtons(false);

    const playerNum = multiplayerState.isHost ? 1 : 2;

    await window.firebaseUpdate(roomRef, {
      eliminated: playerNum,
      gameActive: false
    });
    return;
  }

  // Acertou — atualiza input no Firebase
  await window.firebaseUpdate(roomRef, { currentInput: newInput });
  playTone(color);

  // ── COMPLETOU A SEQUÊNCIA ────────────────────────────────────
  if (newInput.length === multiplayerState.sequence.length) {

    if (phase === 'p1') {
      // Jogador 1 terminou — passa para Jogador 2 repetir a MESMA sequência
      await window.firebaseUpdate(roomRef, {
        phase: 'p2',
        currentInput: [],
        p1Done: true
      });

    } else if (phase === 'p2') {
      // Jogador 2 também terminou — os dois acertaram!
      playSuccessSound();

      // Adiciona nova cor à sequência
      const newColor = COLORS[Math.floor(Math.random() * COLORS.length)];
      const newSequence = [...multiplayerState.sequence, newColor];

      await window.firebaseUpdate(roomRef, {
        sequence: newSequence,
        currentInput: [],
        phase: 'show',
        p1Done: false,
        p2Done: false
      });
    }
  }
}

// ================================================================
// FIM DO JOGO
// ================================================================

function endMultiplayerGame(roomId, eliminatedPlayer) {
  if (!multiplayerState.isActive) return;
  multiplayerState.isActive = false;

  removeAllListeners();
  setButtons(false);

  const isWinner =
    (multiplayerState.isHost && eliminatedPlayer === 2) ||
    (!multiplayerState.isHost && eliminatedPlayer === 1);

  const len = multiplayerState.sequence.length;

  if (isWinner) {
    setMessage(`🎉 Você venceu! ${multiplayerState.otherPlayerName} errou na fase ${len}!`, 'success');
  } else {
    setMessage(`😢 Você perdeu na fase ${len}. ${multiplayerState.otherPlayerName} venceu!`, 'error');
  }

  setTimeout(() => {
    setMessage('A partida acabou. A sala permanece aberta para novos jogos.', 'info');
  }, 3500);
}

// ================================================================
// HELPERS DE DESTAQUE NA SEQUÊNCIA
// ================================================================

function highlightSequenceAt(index) {
  const dots = document.querySelectorAll('#score-dots .dot');
  dots.forEach((dot, i) => {
    dot.style.transform = i === index ? 'scale(1.4)' : 'scale(1)';
    dot.style.opacity = i === index ? '1' : '0.4';
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
// HELPERS DE PONTOS MULTIPLAYER
// ================================================================

function updateMultiplayerDots() {
  // Reutiliza a função existente do jogo se disponível,
  // passando o tamanho atual da sequência como referência visual
  if (typeof updateScoreDots === 'function') {
    updateScoreDots(multiplayerState.sequence.length);
  }
}

// ================================================================
// COMPATIBILIDADE COM MODAIS EXISTENTES
// ================================================================

if (!window.openModal) window.openModal = openModal;
if (!window.closeModal) window.closeModal = closeModal;
if (!window.closeAllModals) window.closeAllModals = closeAllModals;