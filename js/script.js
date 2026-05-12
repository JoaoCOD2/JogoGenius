/* ================================================================
   GENIUS — script.js
   ETAPA 3: Lógica básica com JavaScript
   ETAPA 4: Lógica completa
   Desafio 1: Sons para cada cor (Web Audio API)
   Desafio 2: Sistema de pontuação
   Desafio 3: Tela de derrota bonita (no CSS/HTML)
   Desafio 4: Botão reiniciar
   Desafio 5: Salvar maior pontuação com localStorage
================================================================ */

/* ================================================================
   ETAPA 3 — CONFIGURAÇÃO INICIAL
================================================================ */

// Array com as quatro cores do jogo
const COLORS = ['green', 'red', 'yellow', 'blue'];

// Nomes das cores em português
const COLOR_NAMES = {
    green: 'Verde',
    red: 'Vermelho',
    yellow: 'Amarelo',
    blue: 'Azul'
};

// Nível de velocidade por fase
const SPEED_LEVELS = [
    { min: 1, max: 4, label: 'Fácil', speedPct: 20 },
    { min: 5, max: 9, label: 'Normal', speedPct: 40 },
    { min: 10, max: 14, label: 'Rápido', speedPct: 65 },
    { min: 15, max: 20, label: 'Intenso', speedPct: 82 },
    { min: 21, max: 99, label: 'INSANO', speedPct: 98 },
];

/* ================================================================
   DESAFIO 1 — SONS PARA CADA COR (Web Audio API)
================================================================ */

// Contexto de áudio (criado na primeira interação do usuário)
let audioCtx = null;

// Frequências musicais para cada cor
const FREQS = {
    green: 415.3,   // Sol#4
    red: 311.1,   // Mib4
    yellow: 252.0,   // Si3
    blue: 207.6,   // Sol#3
};

// Inicializa o contexto de áudio (exige interação do usuário)
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Toca o tom correspondente a uma cor
function playTone(color, durationMs = 320) {
    try {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.type = 'sine';
        osc.frequency.value = FREQS[color];

        // Envelope suave: ataque rápido + decaimento lento
        const now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.38, now + 0.012);
        gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);

        osc.start(now);
        osc.stop(now + durationMs / 1000 + 0.05);
    } catch (e) { /* silencia erros de política de autoplay */ }
}

// Som de erro (tons descendentes e distorcidos)
function playErrorSound() {
    try {
        initAudio();
        [195, 170, 148].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sawtooth';
            osc.frequency.value = freq;
            const t = audioCtx.currentTime + i * 0.14;
            gain.gain.setValueAtTime(0.28, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.13);
            osc.start(t);
            osc.stop(t + 0.2);
        });
    } catch (e) { }
}

// Som de vitória (acorde ascendente)
function playSuccessSound() {
    try {
        initAudio();
        [415, 523, 622, 784].forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = audioCtx.currentTime + i * 0.09;
            gain.gain.setValueAtTime(0.22, t);
            gain.gain.linearRampToValueAtTime(0, t + 0.2);
            osc.start(t);
            osc.stop(t + 0.3);
        });
    } catch (e) { }
}

/* ================================================================
   ETAPA 3 — ESTADO DO JOGO
   Uso de arrays e variáveis para controlar o jogo
================================================================ */

let sequence = [];   // Array: sequência gerada pelo jogo
let playerSeq = [];   // Array: sequência digitada pelo jogador
let round = 0;    // Número da rodada atual
let score = 0;    // Pontuação (Desafio 2)
let accepting = false; // Se aceita cliques do jogador
let gameActive = false; // Se o jogo está em andamento

// Desafio 5: Carrega o recorde salvo no localStorage
let record = parseInt(localStorage.getItem('genius_record') || '0');

// Exibe o recorde ao carregar a página
document.getElementById('record-display').textContent = record;

/* ================================================================
   FUNÇÕES AUXILIARES
================================================================ */

// Espera N milissegundos (usada nas lógicas de repetição)
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Atualiza o texto de mensagem na tela (ETAPA 1 — área de mensagem)
function setMessage(texto, tipo = '') {
    const el = document.getElementById('message');
    el.textContent = texto;
    el.className = 'message' + (tipo ? ' ' + tipo : '');
}

// Habilita ou desabilita todos os botões do tabuleiro
function setButtons(habilitado) {
    COLORS.forEach(cor => {
        document.getElementById('btn-' + cor).disabled = !habilitado;
    });
}

// Faz um botão colorido piscar (ativa a classe .active via JS)
// — Retorna uma Promise para encadear com await
function flashButton(cor, duracaoMs = 400) {
    return new Promise(resolve => {
        const btn = document.getElementById('btn-' + cor);
        playTone(cor, duracaoMs - 60);
        btn.classList.add('active');
        setTimeout(() => {
            btn.classList.remove('active');
            resolve();
        }, duracaoMs);
    });
}

// Atualiza os pontos de progresso visuais na tela
function atualizarPontos() {
    const container = document.getElementById('score-dots');
    container.innerHTML = '';

    // Lógica de repetição: cria um ponto para cada cor da sequência
    for (let i = 0; i < sequence.length; i++) {
        const dot = document.createElement('div');
        dot.className = 'dot ' + sequence[i];
        container.appendChild(dot);
    }
}

// Atualiza o indicador de velocidade conforme a fase
function atualizarVelocidade() {
    const nivel = SPEED_LEVELS.find(n => round >= n.min && round <= n.max)
        || SPEED_LEVELS[SPEED_LEVELS.length - 1];

    document.getElementById('speed-fill').style.width = nivel.speedPct + '%';
    document.getElementById('speed-text').textContent = nivel.label;
}

// Calcula a velocidade de exibição com base na rodada
function calcularVelocidade() {
    return {
        flash: Math.max(180, 520 - round * 20),  // duração do flash
        gap: Math.max(60, 300 - round * 12),  // intervalo entre flashes
    };
}

/* ================================================================
   ETAPA 3 — INICIAR O JOGO (botão iniciar)
================================================================ */
function startGame() {
    // Requer interação antes de usar áudio
    initAudio();

    // Reinicia todos os estados
    sequence = [];
    playerSeq = [];
    round = 0;
    score = 0;
    gameActive = true;

    // Atualiza interface
    document.getElementById('score-display').textContent = 0;
    document.getElementById('round-text').textContent = '—';
    document.getElementById('round-display').textContent = '—';
    document.getElementById('score-dots').innerHTML = '';
    document.getElementById('speed-indicator').style.display = 'flex';
    document.getElementById('keyboard-hint').style.display = 'block';
    document.getElementById('defeat-overlay').classList.remove('show');

    // Desafio 4: Alterna entre botão iniciar e reiniciar
    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('restart-btn').style.display = 'inline-flex';

    // ETAPA 4: começa a primeira rodada
    proximaRodada();
}

/* ================================================================
   ETAPA 4 — LÓGICA COMPLETA
================================================================ */

// Avança para a próxima rodada adicionando uma nova cor à sequência
async function proximaRodada() {
    round++;
    playerSeq = [];

    // Escolhe uma cor aleatória e adiciona ao array de sequência
    const novaCor = COLORS[Math.floor(Math.random() * COLORS.length)];
    sequence.push(novaCor);

    // Atualiza indicadores de fase
    document.getElementById('round-display').textContent = round;
    document.getElementById('round-text').textContent = round;
    atualizarPontos();
    atualizarVelocidade();

    // Mostra a sequência completa ao jogador
    await mostrarSequencia();
}

// Exibe a sequência piscando cada botão na ordem
async function mostrarSequencia() {
    setButtons(false);
    accepting = false;

    // Ativa pulso visual no hub central
    document.querySelector('.center-hub').classList.add('pulsing');

    setMessage('Observe a sequência...', 'info');
    await sleep(650);

    // Velocidade adapta-se à rodada (estrutura condicional implícita)
    const { flash, gap } = calcularVelocidade();

    // Lógica de repetição: percorre toda a sequência
    for (let i = 0; i < sequence.length; i++) {
        await flashButton(sequence[i], flash);
        await sleep(gap);
    }

    // Remove pulso e libera input do jogador
    document.querySelector('.center-hub').classList.remove('pulsing');
    await sleep(300);
    setMessage('Repita a sequência! (' + sequence.length + ' cores)', '');
    setButtons(true);
    accepting = true;
}

// Processa o clique do jogador em um botão colorido (ETAPA 3)
function handleColorClick(cor) {
    if (!accepting || !gameActive) return;

    // Feedback visual e sonoro imediato
    playTone(cor, 200);
    flashButton(cor, 200);

    // Adiciona ao array da sequência do jogador
    playerSeq.push(cor);
    const idx = playerSeq.length - 1;

    // Estrutura condicional: verifica se a cor clicada é a correta
    if (playerSeq[idx] !== sequence[idx]) {
        // Errou!
        errou();
        return;
    }

    // Estrutura condicional: verifica se completou a sequência
    if (playerSeq.length === sequence.length) {
        acertou();
    }
}

// Jogador acertou toda a sequência — avança de fase (ETAPA 4)
async function acertou() {
    accepting = false;
    setButtons(false);

    // Desafio 2: Sistema de pontuação (pontos aumentam por fase)
    const pontosRodada = round * 10;
    score += pontosRodada;
    document.getElementById('score-display').textContent = score;

    // Efeito sonoro de vitória
    playSuccessSound();
    setMessage('Correto! +' + pontosRodada + ' pontos', 'success');

    // Pisca todos os botões em sequência (celebração)
    for (const cor of COLORS) {
        await flashButton(cor, 100);
        await sleep(25);
    }

    await sleep(700);

    // ETAPA 4: adiciona nova cor e continua o jogo
    proximaRodada();
}

// Jogador errou — fim de jogo (ETAPA 3/4)
async function errou() {
    accepting = false;
    gameActive = false;
    setButtons(false);

    // Efeito sonoro de erro
    playErrorSound();
    setMessage('Errou! A cor correta era: ' + COLOR_NAMES[sequence[playerSeq.length - 1]], 'error');

    // Animação de erro: pisca todos os botões 3 vezes
    for (let i = 0; i < 3; i++) {
        COLORS.forEach(c => document.getElementById('btn-' + c).classList.add('active'));
        await sleep(130);
        COLORS.forEach(c => document.getElementById('btn-' + c).classList.remove('active'));
        await sleep(110);
    }

    await sleep(800);

    // Exibe a tela de derrota
    mostrarDerrota();
}

// Exibe a tela de derrota bonita (Desafio 3)
function mostrarDerrota() {
    // Desafio 5: Verifica e salva o recorde no localStorage
    const novoRecorde = score > record;

    if (novoRecorde) {
        record = score;
        localStorage.setItem('genius_record', record);
        document.getElementById('record-display').textContent = record;
    }

    // Preenche os dados na tela de derrota
    document.getElementById('defeat-score').textContent = score;
    document.getElementById('defeat-phase').textContent = round;

    // Mensagem de recorde
    document.getElementById('defeat-record-msg').textContent = novoRecorde
        ? '🏆  NOVO RECORDE!'
        : 'Recorde: ' + record + ' pontos';

    // Exibe a sequência correta para o jogador aprender
    const replayDots = document.getElementById('replay-dots');
    replayDots.innerHTML = '';
    sequence.forEach(cor => {
        const dot = document.createElement('div');
        dot.className = 'dot ' + cor;
        dot.title = COLOR_NAMES[cor];
        replayDots.appendChild(dot);
    });

    // Cria partículas decorativas (efeito visual da Desafio 3)
    criarParticulas();

    // Exibe a overlay
    document.getElementById('defeat-overlay').classList.add('show');

    // Desafio 4: Volta ao botão iniciar
    document.getElementById('start-btn').style.display = 'inline-flex';
    document.getElementById('restart-btn').style.display = 'none';
}

// Cria partículas animadas na tela de derrota (Desafio 3 — visual)
function criarParticulas() {
    const container = document.getElementById('defeat-particles');
    container.innerHTML = '';

    // Lógica de repetição: cria 30 partículas com posições e delays aleatórios
    for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.top = Math.random() * 100 + 'vh';
        p.style.width = (Math.random() * 3 + 1) + 'px';
        p.style.height = p.style.width;
        p.style.animationDuration = (Math.random() * 4 + 3) + 's';
        p.style.animationDelay = (Math.random() * 2) + 's';

        // Cores variadas nas partículas
        const cores = ['#f87171', '#60a5fa', '#4ade80', '#fde047', '#a78bfa'];
        p.style.background = cores[Math.floor(Math.random() * cores.length)];

        container.appendChild(p);
    }
}

/* ================================================================
   EVENTOS DE CLIQUE — ETAPA 1 (botões coloridos)
   Cada botão chama handleColorClick com sua cor
================================================================ */
COLORS.forEach(cor => {
    document.getElementById('btn-' + cor).addEventListener('click', () => {
        handleColorClick(cor);
    });
});

/* ================================================================
   SUPORTE A TECLADO (acessibilidade e usabilidade extra)
   G = Verde | R = Vermelho | Y = Amarelo | B = Azul
================================================================ */
const TECLAS = {
    KeyG: 'green',
    KeyR: 'red',
    KeyY: 'yellow',
    KeyB: 'blue',
};

document.addEventListener('keydown', e => {
    if (TECLAS[e.code]) {
        handleColorClick(TECLAS[e.code]);
    }
    // Espaço para iniciar/reiniciar
    if (e.code === 'Space' && !gameActive) {
        startGame();
    }
});

/* ================================================================
   INICIALIZAÇÃO
   Exibe o recorde salvo assim que a página carrega
================================================================ */
(function init() {
    document.getElementById('record-display').textContent = record;
})();

/* ================================================================
   SISTEMA DE MODAIS
   Funções para abrir, fechar e gerenciar os modais
================================================================ */

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
    
    // Remove overlay apenas se nenhum modal estiver aberto
    const anyModalOpen = document.querySelector('.modal.active');
    if (!anyModalOpen) {
        overlay.classList.remove('active');
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal.active').forEach(modal => {
        modal.classList.remove('active');
    });
    document.getElementById('modalOverlay').classList.remove('active');
}

function exitGame() {
    // Fecha o modal
    closeAllModals();
    
    // Para o jogo se estiver em andamento
    gameActive = false;
    accepting = false;
    
    // Reseta a interface
    setTimeout(() => {
        window.location.href = 'about:blank';
    }, 300);
}

// Fechar modais ao pressionar ESC
document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
        closeAllModals();
    }
});
