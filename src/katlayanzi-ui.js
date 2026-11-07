import './katlayanzi-ui.css';
import {KatlayanziScene} from './katlayanzi-scene.js';

const GAMES = ['blackjack', 'roulette', 'poker'];
const GAME_LABELS = { blackjack: 'Blackjack', roulette: 'Roulette', poker: 'Poker' };
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function element(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function button(text, className = '') {
  const node = element('button', `katlayanzi-button ${className}`, text);
  node.type = 'button';
  return node;
}

function cardLabel(card) {
  return card ? `${card.rank}${card.suit}` : 'Hidden card';
}

function makeCard(card, selected = false, interactive = false) {
  const node = interactive ? button(card ? cardLabel(card) : 'Hidden card', `katlayanzi-card${card ? '' : ' is-back'}${selected ? ' is-selected' : ''}`) : element('span', `katlayanzi-card${card ? '' : ' is-back'}${selected ? ' is-selected' : ''}`, card ? cardLabel(card) : '');
  node.setAttribute('aria-label', cardLabel(card));
  if(!interactive)node.setAttribute('role','img');
  if (interactive) node.setAttribute('aria-pressed', String(selected));
  if (card && (card.suit === '♥' || card.suit === '♦')) node.classList.add('is-red');
  return node;
}

function safeView(view) {
  const source = view && typeof view === 'object' ? view : {};
  const players = Array.isArray(source.players) ? source.players : [];
  return {
    version: Number.isSafeInteger(source.version)?source.version:0,
    gameVote: source.gameVote && typeof source.gameVote.id==='string' && GAMES.includes(source.gameVote.game) ? source.gameVote : null,
    game: GAMES.includes(source.game) ? source.game : 'blackjack',
    phase: ['betting', 'playing', 'result'].includes(source.phase) ? source.phase : 'betting',
    round: Number.isFinite(source.round) ? source.round : 1,
    players: players.slice(0, 8).map(player => ({
      id: String(player?.id ?? ''), name: String(player?.name ?? 'Driver').slice(0, 32),
      chips: Number.isFinite(player?.chips) ? player.chips : 0,
      bet: Number.isFinite(player?.bet) ? player.bet : 0,
      hand: Array.isArray(player?.hand) ? player.hand.slice(0, 24) : [],
      status: String(player?.status ?? 'seated'), result: String(player?.result ?? ''),
      choice: player?.choice, payout: Number.isFinite(player?.payout) ? player.payout : 0
    })),
    dealer: Array.isArray(source.dealer) ? source.dealer.slice(0, 24) : [],
    roulette: source.roulette && Number.isInteger(source.roulette.number) ? source.roulette : null,
    turnId: source.turnId == null ? null : String(source.turnId),
    message: String(source.message ?? 'Virtual chips only.'),
    meId: String(source.meId ?? ''), isHost: source.isHost === true,
    connected: source.connected === true, roomCode: String(source.roomCode ?? 'Solo practice')
  };
}

function announce(open) {
  globalThis.window?.dispatchEvent?.(new CustomEvent('katlayanzichange', { detail: { open } }));
}

export function mountKatlayanzi({ room, canEnter = () => false } = {}) {
  if (!room || typeof document === 'undefined') return { destroy() {} };
  const target = document.body;
  const root = element('section', 'katlayanzi-root');
  const launch = button('Katlayanzi Casino', 'katlayanzi-launch');
  launch.id = 'katlayanzi-open';
  launch.hidden = true;
  let nearby = false;
  launch.setAttribute('aria-haspopup', 'dialog');
  launch.setAttribute('aria-expanded', 'false');
  root.append(launch);

  const overlay = element('div', 'katlayanzi-overlay');
  overlay.hidden = true;
  overlay.setAttribute('role', 'presentation');
  const dialog = element('div', 'katlayanzi-dialog');
  dialog.id = 'katlayanzi-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'katlayanzi-title');
  const header = element('header', 'katlayanzi-header');
  const headingWrap = element('div', 'katlayanzi-heading');
  const title = element('h2', '', 'Katlayanzi Casino');
  title.id = 'katlayanzi-title';
  headingWrap.append(element('p', 'katlayanzi-eyebrow', 'KATLAYANZI · THE GLASSHOUSE'), title);
  const roomStatus = element('p', 'katlayanzi-room-status');
  const close = button('Close', 'katlayanzi-close');
  close.setAttribute('aria-label', 'Close Katlayanzi Casino');
  const invite = button('Invite friends', 'katlayanzi-invite');
  header.append(headingWrap, roomStatus, invite, close);
  const message = element('p', 'katlayanzi-message', 'Virtual chips only. Take a seat to play.');
  const tabs = element('nav', 'katlayanzi-tabs');
  tabs.setAttribute('aria-label', 'Casino games');
  tabs.setAttribute('role','tablist');
  message.setAttribute('role','status');
  message.setAttribute('aria-live','polite');
  const voteBox=element('section','katlayanzi-vote');
  voteBox.setAttribute('aria-label','Game change vote');voteBox.setAttribute('aria-live','polite');voteBox.hidden=true;
  const stage=element('section','katlayanzi-stage');
  stage.setAttribute('aria-label','3D casino lounge with seated robot players and dealer Elif');
  const sceneContainer=element('div','katlayanzi-scene');sceneContainer.id='katlayanzi-scene';
  const sceneCaption=element('div','katlayanzi-stage-caption');
  const sceneText=element('p','','Glass-roof lounge · Elif, your dealer');
  const handJump=button('My hand ↓','katlayanzi-hand-jump');
  sceneCaption.append(sceneText,handJump);stage.append(sceneContainer,sceneCaption);
  const walkControls=element('div','katlayanzi-walk-controls');
  walkControls.setAttribute('role','group');walkControls.setAttribute('aria-label','Salon hareket kontrolleri');
  const walkHint=element('p','katlayanzi-walk-hint','WASD / yön tuşlarıyla yürü · Masaya yaklaş ve otur');
  walkHint.setAttribute('role','status');walkHint.setAttribute('aria-live','polite');
  const pad=element('div','katlayanzi-walk-pad');
  const walkButtons=[];
  for(const [direction,label] of [['up','↑'],['left','←'],['down','↓'],['right','→']]){
    const b=button(label,`katlayanzi-walk-${direction}`);b.dataset.direction=direction;
    b.setAttribute('aria-label',({up:'İleri yürü',left:'Sola yürü',down:'Geri yürü',right:'Sağa yürü'})[direction]);
    pad.append(b);walkButtons.push(b);
  }
  const sit=button('Masaya yaklaş','katlayanzi-primary katlayanzi-sit');sit.disabled=true;
  const stand=button('Masadan kalk · Salonda gez','katlayanzi-stand');stand.hidden=true;
  walkControls.append(walkHint,pad,sit);stage.append(walkControls);
  const table = element('div', 'katlayanzi-table');
  const rouletteWheel = element('div', 'katlayanzi-wheel', '0');
  rouletteWheel.setAttribute('aria-label', 'Roulette wheel');
  const dealer = element('section', 'katlayanzi-dealer');
  const seats = element('section', 'katlayanzi-seats');
  table.append(rouletteWheel, dealer, seats);
  const actions = element('section', 'katlayanzi-actions');
  const rules = element('aside', 'katlayanzi-rules');
  dialog.append(header, message, tabs, voteBox, stage, stand, table, actions, rules);
  overlay.append(dialog);
  root.append(overlay);
  target.append(root);

  let view = safeView(typeof room.getView === 'function' ? room.getView() : null);
  let open = false;
  let restoreFocus = null;
  let destroyed = false;
  let scene = null;
  let voteTimer = null;
  let walking=true;
  let lobby=null;
  let lobbySeatingSignature=null;
  let lobbyTimer=null;
  let lastNearId=null;
  const pressed=new Set();
  const keyDirections={KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
  function moveInput(){scene?.setMoveInput({x:Number(pressed.has('right'))-Number(pressed.has('left')),z:Number(pressed.has('down'))-Number(pressed.has('up'))});}
  function resetMovement(){pressed.clear();moveInput();}
  function updateWalking(){
    const me=lobby?.players?.find(p=>p.id===lobby.meId);
    walking=!me?.tableId;
    dialog.classList.toggle('is-walking',walking);
    for(const node of [table,actions,rules,handJump])node.hidden=walking;
    tabs.hidden=true;
    walkControls.hidden=!walking;stand.hidden=walking;
    scene?.setWalking(walking);
    sceneText.textContent=walking?'KATLAYANZI · Cam tavanlı salon · 21 / Rulet / Poker':`${GAME_LABELS[view.game]} · Elif, krupiyeniz`;
  }
  function nearbyTable(){
    const nearest=scene?.nearestTable();
    if((nearest?.id??null)!==lastNearId){lastNearId=nearest?.id??null;sit.textContent=nearest?`${nearest.label} · Otur (E)`:'Masaya yaklaş';sit.disabled=!nearest;
      walkHint.textContent=nearest?`${nearest.label} masası · Oturmak için E veya Otur`:'WASD / yön tuşlarıyla yürü · Işıklı oyun masasına yaklaş · Diğer masalar dekoratif';}
  }
  function sitDown(){
    const id=scene?.nearestTable()?.id;if(!id)return;
    resetMovement();const result=room.sitAtTable?.(id);
    if(result?.ok===false)message.textContent=result.error||'Masa değişikliği için oyuncuların oyunu bekleniyor.';
  }
  function standUp(){resetMovement();const result=room.standUp?.();if(result?.ok===false)message.textContent=result.error||'Önce mevcut eli tamamlayın.';}
  const onWalkKey=event=>{
    if(!open)return;
    const direction=keyDirections[event.code];
    if(direction&&walking&&!['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName)){
      event.preventDefault();event.stopImmediatePropagation();pressed.add(direction);moveInput();
    }else if(event.code==='KeyE'&&walking&&!event.repeat){event.preventDefault();event.stopImmediatePropagation();sitDown();}
  };
  const onWalkKeyUp=event=>{const direction=keyDirections[event.code];if(direction){pressed.delete(direction);moveInput();if(open){event.preventDefault();event.stopImmediatePropagation();}}};
  window.addEventListener('keydown',onWalkKey,true);window.addEventListener('keyup',onWalkKeyUp,true);window.addEventListener('blur',resetMovement);
  for(const b of walkButtons){
    b.addEventListener('pointerdown',event=>{event.preventDefault();b.setPointerCapture(event.pointerId);pressed.add(b.dataset.direction);moveInput();});
    const release=()=>{pressed.delete(b.dataset.direction);moveInput();};
    b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);b.addEventListener('lostpointercapture',release);
  }
  sit.addEventListener('click',sitDown);stand.addEventListener('click',standUp);
  const selectedDraw = new Set();
  let stake = 25;
  const background = new Map();
  const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), input, select, [href], [tabindex]:not([tabindex="-1"])')];

  function dispatch(action) {
    if (typeof room.dispatch !== 'function') return;
    const result = room.dispatch({ ...action, round: view.round });
    if (result?.ok === false) message.textContent = String(result.error ?? 'Action unavailable.');
  }

  function updateStatus() {
    roomStatus.textContent = `${view.connected ? '● Live room' : '● Solo table'} · ${view.roomCode}`;
  }

  function renderTabs() {
    tabs.replaceChildren();
    for (const game of GAMES) {
      const tab = button(GAME_LABELS[game], `katlayanzi-tab${view.game === game ? ' is-active' : ''}`);
      tab.setAttribute('aria-selected', String(view.game === game));
      tab.setAttribute('role', 'tab');
      tab.disabled = !view.players.some(p=>p.id===view.meId) || view.phase === 'playing' || Boolean(view.gameVote);
      tab.title = view.phase==='playing'?'Finish this hand before changing games.':'Propose a game change to the table';
      tab.addEventListener('click', () => dispatch({ type: 'choose', game }));
      tabs.append(tab);
    }
  }

  function renderVote() {
    const vote=view.gameVote;voteBox.hidden=!vote;voteBox.replaceChildren();if(!vote)return;
    const proposer=view.players.find(p=>p.id===vote.proposerId)?.name||'A player';
    voteBox.append(element('h3','',`${proposer} proposes ${GAME_LABELS[vote.game]}`));
    const remaining=Math.max(0,Math.ceil((vote.expiresAt-Date.now())/1000));
    voteBox.append(element('p','',`${vote.yes} yes · ${vote.no} no · ${vote.required} yes votes needed · ${remaining}s left`));
    const row=element('div','katlayanzi-vote-actions');
    const eligible=Array.isArray(vote.eligibleIds)&&vote.eligibleIds.includes(view.meId);
    const voted=Object.prototype.hasOwnProperty.call(vote.votes||{},view.meId);
    for(const [label,approve]of [['Yes, switch',true],['Keep this game',false]]){
      const b=button(label,approve?'katlayanzi-primary':'katlayanzi-secondary');b.disabled=!eligible||voted;
      b.addEventListener('click',()=>dispatch({type:'vote',proposalId:vote.id,approve}));row.append(b);
    }
    voteBox.append(row,element('small','',eligible?(voted?'Your vote is recorded.':'Everyone seated can vote.'):"You're watching this vote. Join the next one."));
  }

  function renderDealer() {
    dealer.replaceChildren();
    const title = element('h3', '', 'Dealer');
    const hand = element('div', 'katlayanzi-hand');
    view.dealer.forEach(card => hand.append(makeCard(card)));
    const rouletteNumber = view.roulette?.number;
    rouletteWheel.hidden = view.game !== 'roulette';
    rouletteWheel.replaceChildren();
    if(!rouletteWheel.hidden) {
      const order=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
      rouletteWheel.style.background=`conic-gradient(${order.map((n,i)=>`${n===0?'#176846':RED.has(n)?'#af3535':'#172b29'} ${i*360/37}deg ${(i+1)*360/37}deg`).join(',')})`;
      order.forEach((n,i)=>{const mark=element('span','katlayanzi-pocket',String(n));mark.style.transform=`rotate(${(i+.5)*360/37}deg) translateY(-70px) rotate(${-(i+.5)*360/37}deg)`;rouletteWheel.append(mark);});
      rouletteWheel.append(element('strong','katlayanzi-wheel-hub',Number.isInteger(rouletteNumber)?String(rouletteNumber):'♠'));
    }
    hand.hidden=!view.dealer.length;
    dealer.append(title, hand);
    if (view.game === 'roulette') {
      const result = view.roulette ? `${view.roulette.number} · ${view.roulette.color ?? (RED.has(view.roulette.number) ? 'red' : view.roulette.number === 0 ? 'green' : 'black')}` : 'Awaiting spin';
      dealer.append(element('p', 'katlayanzi-roulette-result', `Roulette result: ${result}`));
    }
  }

  function renderSeats() {
    seats.replaceChildren();
    const seatedPlayers=lobby?view.players.filter(player=>lobby.players.some(peer=>peer.id===player.id&&peer.tableId===view.game)):view.players;
    const title = element('h3', '', `Players · ${seatedPlayers.length}/8`);
    seats.append(title);
    if (!seatedPlayers.length) {
      seats.append(element('p', 'katlayanzi-empty', 'No players seated yet.'));
      return;
    }
    const grid = element('div', 'katlayanzi-seat-grid');
    for (const player of seatedPlayers) {
      const seat = element('article', `katlayanzi-seat${player.id === view.meId ? ' is-me' : ''}${player.id === view.turnId ? ' is-turn' : ''}`);
      const name = element('h4', '', player.name);
      const meta = element('p', 'katlayanzi-seat-meta', `${player.chips} chips · bet ${player.bet}${view.game==='roulette'&&player.bet?' on '+player.choice:''}`);
      const hand = element('div', 'katlayanzi-hand');
      player.hand.forEach((card, index) => {
        const selected = selectedDraw.has(index) && player.id === view.meId;
        const interactive = player.id === view.meId && view.game === 'poker' && view.phase === 'playing' && player.status === 'playing';
        const cardNode = makeCard(card, selected, interactive);
        if (interactive) {
          cardNode.classList.add('is-pickable');
          cardNode.addEventListener('click', () => {
            if (selectedDraw.has(index)) selectedDraw.delete(index); else if (selectedDraw.size < 3) selectedDraw.add(index);
            render();
            seats.querySelectorAll('.is-pickable')[index]?.focus();
          });
        }
        hand.append(cardNode);
      });
      hand.hidden=!player.hand.length;
      const result = player.result ? element('p', 'katlayanzi-result', `${player.result}${player.payout ? ` · +${player.payout}` : ''}`) : null;
      seat.append(name, meta, hand);
      if(view.game==='blackjack'&&player.hand.length&&player.hand.every(Boolean)){let total=0,aces=0;for(const c of player.hand){if(c.rank==='A'){total+=11;aces++;}else total+=['J','Q','K'].includes(c.rank)?10:Number(c.rank);}while(total>21&&aces-->0)total-=10;seat.append(element('span','katlayanzi-total',`Total ${total}`));}
      if (result) seat.append(result);
      if (player.id === view.turnId) seat.append(element('span', 'katlayanzi-turn', player.id === view.meId ? 'Your turn' : `${player.name}'s turn`));
      grid.append(seat);
    }
    seats.append(grid);
  }

  function renderActions() {
    actions.replaceChildren();
    const me=view.players.find(p=>p.id===view.meId);
    const controls=element('div','katlayanzi-control-row');
    if(view.phase==='betting'){
      if(!me){const join=button('Take a seat','katlayanzi-primary');join.addEventListener('click',()=>dispatch({type:'join'}));controls.append(join);}
      else {
        const label=element('label','katlayanzi-stake','Stake '),select=element('select','katlayanzi-stake-select');
        select.setAttribute('aria-label','Virtual chip stake');
        for(const amount of [5,25,50,100,250]){const option=element('option','',String(amount));option.value=String(amount);option.selected=stake===amount;select.append(option);}
        select.addEventListener('change',()=>{stake=Number(select.value);});label.append(select);controls.append(label);
        if(view.game!=='roulette'){const bet=button('Place bet','katlayanzi-primary');bet.addEventListener('click',()=>dispatch({type:'bet',amount:stake}));controls.append(bet);}
      }
      const deal=button(view.isHost?(view.game==='roulette'?'Spin wheel':'Deal cards'):'Waiting for host','katlayanzi-primary');
      deal.disabled=!view.isHost||!view.players.some(p=>p.bet>0);deal.addEventListener('click',()=>dispatch({type:'deal'}));controls.append(deal);
      actions.append(controls);
      if(me&&view.game==='roulette'){
        const bets=element('div','katlayanzi-roulette-bets');
        for(const choice of ['red','black','green',...Array.from({length:37},(_,i)=>i)]){
          const label=typeof choice==='number'?String(choice):choice==='green'?'Zero · 35:1':`${choice} · 1:1`;
          const color=choice==='green'||choice===0?'green':choice==='red'||(typeof choice==='number'&&RED.has(choice))?'red':'black';
          const bet=button(label,`katlayanzi-roulette-bet is-${color}`);bet.classList.toggle('is-chosen',me.bet>0&&me.choice===choice);
          bet.setAttribute('aria-label',`Bet on ${typeof choice==='number'?'number ':''}${choice}`);
          bet.setAttribute('aria-pressed',String(me.bet>0&&me.choice===choice));
          bet.addEventListener('click',()=>dispatch({type:'bet',amount:stake,choice}));bets.append(bet);
        }
        actions.append(bets);
      }
    }else if(view.phase==='playing'){
      const add=(label,action)=>{const b=button(label,'katlayanzi-primary');b.disabled=view.turnId!==view.meId;b.addEventListener('click',()=>dispatch(action));controls.append(b);};
      if(view.game==='blackjack'){add('Hit',{type:'hit'});add('Stand',{type:'stand'});}
      if(view.game==='poker'){
        const draw=button(selectedDraw.size?`Draw ${selectedDraw.size} cards`:'Keep all cards','katlayanzi-primary');draw.disabled=view.turnId!==view.meId;
        draw.addEventListener('click',()=>{const indices=[...selectedDraw];selectedDraw.clear();dispatch({type:'draw',indices});});controls.append(draw);add('Fold',{type:'fold'});
      }
      actions.append(controls);
    }else{
      const next=button(view.isHost?'Next round':'Waiting for next round','katlayanzi-primary');next.disabled=!view.isHost;next.addEventListener('click',()=>dispatch({type:'next'}));controls.append(next);actions.append(controls);
    }
    actions.append(element('span','katlayanzi-control-hint','Virtual chips only · no purchases or cash value.'));
  }

  function renderRules() {
    rules.replaceChildren();
    const title = element('h3', '', 'How to play');
    const copy = view.game === 'blackjack' ? 'Beat the dealer without going over 21. Dealer stands on 17.' : view.game === 'roulette' ? 'Choose red, black, green, or a number. The host spins the shared wheel.' : 'Five-card draw against the dealer. Up to five players bet per hand. Select up to three cards, then draw once. Higher hand wins; ties return your stake.';
    rules.append(title, element('p', '', copy), element('p', 'katlayanzi-small', 'Robot seats are shared with your multiplayer room. Changing games needs a majority vote between hands.'));
  }

  function render() {
    if (destroyed) return;
    table.dataset.game=view.game;
    updateStatus();
    message.textContent = view.message;
    renderTabs(); renderVote(); renderDealer(); renderSeats(); renderActions(); renderRules();
    scene?.update(view);
    updateWalking();
    if(open&&!dialog.contains(document.activeElement))close.focus();
  }

  function setOpen(next) {
    if(next&&(!nearby||!canEnter()))return;
    if(open===next)return;
    open = next;
    overlay.hidden = !open;
    root.classList.toggle('is-open',open);
    launch.setAttribute('aria-expanded', String(open));
    if (open) {
      restoreFocus = document.activeElement;
      for(const child of document.body.children)if(child!==root&&!['SCRIPT','STYLE','LINK'].includes(child.tagName)){background.set(child,child.inert);child.inert=true;}
      room.enterLobby?.();
      if(!scene)scene=new KatlayanziScene({container:sceneContainer,onMove:position=>room.moveLobby?.(position),reducedMotion:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
      scene.update(view);scene.setLobby(lobby??room.getLobby?.());updateWalking();scene.setActive(true);scene.resize();
      lastNearId=null;nearbyTable();lobbyTimer=setInterval(nearbyTable,150);
      voteTimer=setInterval(()=>{if(view.gameVote)renderVote();},1000);
      close.focus();
    } else {
      clearInterval(voteTimer);voteTimer=null;clearInterval(lobbyTimer);lobbyTimer=null;resetMovement();room.leaveLobby?.();scene?.setActive(false);
      for(const [child,inert]of background)child.inert=inert;background.clear();
      restoreFocus?.focus?.();
      restoreFocus = null;
    }
    announce(open);
  }

  const unsubscribe = typeof room.subscribe === 'function' ? room.subscribe(next => { const previous=view; if(next.round!==view.round||next.game!==view.game||next.phase!=='playing')selectedDraw.clear();view = safeView(next); if(view.version!==previous.version||view.message!==previous.message||view.meId!==previous.meId||view.connected!==previous.connected||view.roomCode!==previous.roomCode)render(); }) : () => {};
  const unsubscribeLobby=room.subscribeLobby?.(next=>{lobby=next;scene?.setLobby(next);updateWalking();const signature=JSON.stringify(next.players.map(p=>[p.id,p.tableId]));if(signature!==lobbySeatingSignature){lobbySeatingSignature=signature;renderSeats();}})??(()=>{});
  const onLaunch = () => setOpen(true);
  const onClose = () => setOpen(false);
  const onInvite = () => {
    setOpen(false);
    document.getElementById('multiplayer-toggle')?.click();
  };
  const onBackdrop = event => { if (event.target === overlay) setOpen(false); };
  const onKey = event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key !== 'Tab') return;
    const nodes = focusable(); if (!nodes.length) return;
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const isolateButtonSpace = event => { if(event.code==='Space'&&event.target?.tagName==='BUTTON')event.stopPropagation(); };
  dialog.addEventListener('keydown',isolateButtonSpace);
  const onHandJump=()=>actions.scrollIntoView({block:'center',behavior:'instant'});
  handJump.addEventListener('click',onHandJump);
  launch.addEventListener('click', onLaunch); close.addEventListener('click', onClose); invite.addEventListener('click', onInvite);
  overlay.addEventListener('click', onBackdrop); document.addEventListener('keydown', onKey);
  render();

  return {
    setNearby(access) {
      nearby=Boolean(access?.allowed);launch.hidden=!nearby;
      launch.textContent=nearby?`Katlayanzi · Gir (${Math.round(access.distance)} m)`:'Katlayanzi';
      launch.setAttribute('aria-label','Yakındaki Katlayanzi kumarhanesine gir');
      if(!nearby&&open)setOpen(false);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; clearInterval(voteTimer);clearInterval(lobbyTimer);resetMovement();room.leaveLobby?.();unsubscribeLobby();
      window.removeEventListener('keydown',onWalkKey,true);window.removeEventListener('keyup',onWalkKeyUp,true);window.removeEventListener('blur',resetMovement);
      sit.removeEventListener('click',sitDown);stand.removeEventListener('click',standUp);scene?.dispose();handJump.removeEventListener('click',onHandJump);unsubscribe(); launch.removeEventListener('click', onLaunch); close.removeEventListener('click', onClose); invite.removeEventListener('click', onInvite);
      dialog.removeEventListener('keydown',isolateButtonSpace);
      overlay.removeEventListener('click', onBackdrop); document.removeEventListener('keydown', onKey);
      if(open){for(const [child,inert]of background)child.inert=inert;announce(false);}root.remove();
    }
  };
}
