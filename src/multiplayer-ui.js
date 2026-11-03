import './multiplayer.css';

const MAX_NAME = 24;

function make(tag, attrs = {}, content = '') {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') element.className = value;
    else element.setAttribute(key, value);
  }
  if (content) element.textContent = content;
  return element;
}

function button(label, attrs = {}) {
  return make('button', { type: 'button', ...attrs }, label);
}

function field(label, input) {
  const wrapper = make('label', { className: 'mp-field' });
  wrapper.append(make('span', {}, label), input);
  return wrapper;
}

function randomRoom() {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, value => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[value % 32]).join('');
}

function isLoopback(hostname) {
  return ['localhost', '[::1]', '0.0.0.0', '[::]'].includes(hostname) || /^127\./.test(hostname);
}

function networkAddresses(addresses = []) {
  return addresses.filter(address => {
    try {
      const url = new URL(address);
      return ['http:', 'https:'].includes(url.protocol) && !isLoopback(url.hostname);
    } catch { return false; }
  }).slice(0, 6);
}

/** Mounts transport-independent multiplayer controls. Forward session callbacks to the returned update methods. */
export function mountMultiplayerUI({ session, getState = () => null, onJoinPeer = () => {} }) {
  const trigger = button('Multiplayer', { id: 'multiplayer-toggle', 'aria-controls': 'multiplayer-panel', 'aria-expanded': 'false' });
  const backdrop = make('div', { className: 'mp-backdrop', hidden: '' });
  const panel = make('section', { id: 'multiplayer-panel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'multiplayer-title', tabindex: '-1' });
  const heading = make('div', { className: 'mp-heading' });
  const headingText = make('div');
  headingText.append(make('p', { className: 'mp-kicker' }, 'Drive together'), make('h2', { id: 'multiplayer-title' }, 'Multiplayer'));
  const closeButton = button('×', { className: 'mp-close', 'aria-label': 'Close multiplayer' });
  heading.append(headingText, closeButton);

  const intro = make('p', { className: 'mp-intro' }, 'Up to 8 drivers. Join your friends, then use Meet to start on the same road.');
  const status = make('p', { id: 'multiplayer-status', className: 'mp-status', role: 'status', 'aria-live': 'polite' }, 'Not connected');
  const error = make('p', { className: 'mp-error', role: 'alert', hidden: '' });
  const nameInput = make('input', { id: 'multiplayer-name', type: 'text', maxlength: String(MAX_NAME), autocomplete: 'nickname', placeholder: 'Your driver name' });
  try { nameInput.value = localStorage.getItem('earth-drive-driver-name') || ''; } catch { /* Storage can be disabled. */ }
  const nameField = field('Driver name', nameInput);
  const choices = make('div', { className: 'mp-choice', 'aria-label': 'Connection method' });
  const lanChoice = button('Same Wi-Fi · room link', { 'aria-pressed': 'true' });
  const codeChoice = button('Connection codes', { 'aria-pressed': 'false' });
  choices.append(lanChoice, codeChoice);

  const lanSection = make('section', { className: 'mp-method', 'aria-label': 'Local network rooms' });
  const lanIntro = make('p', { className: 'mp-muted' }, 'Checking for a local multiplayer server…');
  const retryServer = button('Check local server again', { id: 'multiplayer-check-server', className: 'mp-server-retry' });
  retryServer.disabled = true;
  const roomInput = make('input', { id: 'multiplayer-room', type: 'text', maxlength: '24', autocapitalize: 'characters', autocomplete: 'off', placeholder: 'e.g. AKANZI', pattern: '[A-Za-z0-9]{3,24}' });
  const lanActions = make('div', { className: 'mp-actions' });
  const createRoom = button('Create room', { className: 'mp-primary' });
  const joinRoom = button('Join room');
  createRoom.disabled = joinRoom.disabled = true;
  lanActions.append(createRoom, joinRoom);
  const roomShare = make('div', { className: 'mp-share', hidden: '' });
  const roomShareLabel = make('p', { className: 'mp-muted' });
  const roomLink = make('input', { id: 'multiplayer-invite-link', type: 'url', readonly: '', 'aria-label': 'Room invite link' });
  const copyLink = button('Copy invite link');
  roomShare.append(roomShareLabel, roomLink, copyLink);
  const addressList = make('div', { className: 'mp-addresses', hidden: '' });
  const serverHelp = make('details', { className: 'mp-help' });
  const helpSummary = make('summary', {}, 'How to host on your Wi-Fi');
  const helpText = make('p', {}, 'On one computer, run the game’s local server. Keep that computer awake and let friends open the printed network address on the same Wi-Fi.');
  const command = make('code', {}, 'npm run multiplayer');
  const helpMore = make('p', {}, 'Allow the local server through your firewall. Guest Wi-Fi or client isolation may prevent devices from connecting.');
  const docsLink = make('a', { href: 'https://github.com/egulsen10k-lgtm/kayanzi/blob/emncnglsn/feat-bmw-world-drive/docs/MULTIPLAYER.md', target: '_blank', rel: 'noopener noreferrer' }, 'Full multiplayer setup');
  serverHelp.append(helpSummary, helpText, command, helpMore, docsLink);
  lanSection.append(lanIntro, retryServer, field('Room code · 3–24 letters or numbers', roomInput), lanActions, roomShare, addressList, serverHelp);

  const codeSection = make('section', { className: 'mp-method', 'aria-label': 'Server-free connection codes', hidden: '' });
  codeSection.append(make('p', { className: 'mp-muted' }, 'Works from this published page without a server. Both devices should open the game on the same Wi-Fi. Send codes privately using a message or email.'));
  const steps = make('ol', { className: 'mp-steps' });
  for (const step of ['Host creates an invitation and sends it to a friend.', 'Friend pastes the invitation, creates an answer and sends it back.', 'Host pastes the answer and connects. Repeat for each friend.']) steps.append(make('li', {}, step));
  codeSection.append(steps);

  const hostSection = make('section', { className: 'mp-code-card', 'aria-label': 'Host with connection codes' });
  hostSection.append(make('h3', {}, 'I’m hosting'));
  const createInvitation = button('Create invitation', { className: 'mp-primary' });
  const offerShare = make('div', { className: 'mp-share', hidden: '' });
  const offerOutput = make('textarea', { id: 'multiplayer-offer-code', readonly: '', rows: '3', 'aria-label': 'Invitation code' });
  const copyOffer = button('Copy invitation');
  offerShare.append(make('p', { className: 'mp-muted' }, 'Send this entire invitation to one friend. Keep this page open.'), offerOutput, copyOffer);
  const answerInput = make('textarea', { id: 'multiplayer-answer-input', rows: '3', spellcheck: 'false', placeholder: 'Paste your friend’s answer here', 'aria-label': 'Friend’s answer code' });
  const connectAnswer = button('Connect friend');
  const answerField = field('Their answer', answerInput);
  answerField.hidden = connectAnswer.hidden = true;
  hostSection.append(createInvitation, offerShare, answerField, connectAnswer);

  const guestSection = make('details', { className: 'mp-code-card' });
  guestSection.append(make('summary', {}, 'I have an invitation · join a friend'));
  const offerInput = make('textarea', { id: 'multiplayer-offer-input', rows: '3', spellcheck: 'false', placeholder: 'Paste the host’s complete invitation here', 'aria-label': 'Host’s invitation code' });
  const createAnswer = button('Create answer');
  const answerShare = make('div', { className: 'mp-share', hidden: '' });
  const answerOutput = make('textarea', { id: 'multiplayer-answer-code', readonly: '', rows: '3', 'aria-label': 'Your answer code' });
  const copyAnswer = button('Copy answer');
  answerShare.append(make('p', { className: 'mp-muted' }, 'Send this entire answer back to the host. Keep the game open while they connect.'), answerOutput, copyAnswer);
  guestSection.append(field('Host’s invitation', offerInput), createAnswer, answerShare);
  codeSection.append(hostSection, guestSection, make('p', { className: 'mp-muted' }, 'Connection codes connect devices directly. Some Wi-Fi networks block this; use the local-server option if pairing fails. Traffic and collisions are simulated separately on each device.'));

  const playersSection = make('section', { className: 'mp-players', 'aria-label': 'Connected drivers' });
  const playersTitle = make('h3', {}, 'Drivers · 1 / 8');
  const playersList = make('ul');
  const leaveButton = button('Leave multiplayer', { className: 'mp-leave', hidden: '' });
  playersSection.append(playersTitle, playersList, leaveButton);
  panel.append(heading, intro, status, error, nameField, choices, lanSection, codeSection, playersSection);
  backdrop.append(panel);
  (document.getElementById('main-viewport') || document.body).append(trigger);
  document.body.append(backdrop);

  let info = null;
  let infoRequested = false;
  let infoAbort = null;
  let lastFocus = null;
  let latestStatus = { state: 'offline' };
  let currentPeers = [];
  let rosterSignature = '';
  let activeMethod = 'lan';
  let methodSelection = 0;
  let destroyed = false;
  const initialRoom = new URL(location.href).searchParams.get('room');
  if (initialRoom && /^[a-z0-9]{3,24}$/i.test(initialRoom)) roomInput.value = initialRoom.toUpperCase();

  function showError(message) {
    error.textContent = message || '';
    error.hidden = !message;
  }

  function displayName() {
    const name = nameInput.value.trim().slice(0, MAX_NAME) || 'Driver';
    try { localStorage.setItem('earth-drive-driver-name', name); } catch { /* Storage can be disabled. */ }
    return name;
  }

  function selectMethod(method) {
    activeMethod = method;
    lanSection.hidden = method !== 'lan';
    codeSection.hidden = method !== 'webrtc';
    lanChoice.setAttribute('aria-pressed', String(method === 'lan'));
    codeChoice.setAttribute('aria-pressed', String(method === 'webrtc'));
    showError('');
  }

  function inviteURL() {
    const localHost = isLoopback(location.hostname);
    const preferredAddress = localHost && networkAddresses(info?.addresses)[0];
    const url = new URL(preferredAddress || location.href);
    url.searchParams.set('room', session.room || roomInput.value.trim().toUpperCase());
    url.hash = '';
    return url.href;
  }

  function updateShare() {
    const lanConnected = latestStatus.state === 'connected' && latestStatus.transport === 'lan';
    roomShare.hidden = !lanConnected;
    if (lanConnected) {
      const noNetworkAddress = isLoopback(location.hostname) && !networkAddresses(info?.addresses).length;
      roomShareLabel.textContent = `Room ${session.room || latestStatus.room || roomInput.value} · send this link to friends on your Wi-Fi`;
      if (noNetworkAddress) roomShareLabel.textContent = 'No shareable network address yet. Connect this computer to Wi-Fi or Ethernet, then check the local server again.';
      roomLink.hidden = copyLink.hidden = noNetworkAddress;
      roomLink.value = inviteURL();
    }
  }

  async function detectServer({ retry = false } = {}) {
    if (infoRequested) return;
    infoRequested = true;
    const selectionAtStart = methodSelection;
    const controller = new AbortController();
    infoAbort = controller;
    retryServer.disabled = true;
    createRoom.disabled = joinRoom.disabled = true;
    lanIntro.textContent = 'Checking for a local multiplayer server…';
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(new URL('/api/multiplayer-info', location.origin), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('No local server');
      const value = await response.json();
      if (value.protocolVersion !== 1 || !Array.isArray(value.addresses)) throw new Error('No compatible server');
      if (destroyed) return;
      info = value;
      lanIntro.textContent = 'Local server ready. Create a room, or enter the room code your friend shared.';
      createRoom.disabled = joinRoom.disabled = false;
      const addresses = networkAddresses(value.addresses);
      addressList.replaceChildren();
      addressList.hidden = false;
      if (addresses.length) {
        addressList.hidden = false;
        addressList.append(make('p', { className: 'mp-muted' }, 'Other devices can open:'));
        for (const address of addresses) addressList.append(make('a', { href: address, target: '_blank', rel: 'noopener noreferrer' }, address));
      } else addressList.append(make('p', { className: 'mp-muted' }, 'No LAN address found. Connect this computer to Wi-Fi or Ethernet, then check the local server again.'));
      if (retry && selectionAtStart === methodSelection) selectMethod('lan');
      updateShare();
    } catch {
      if (destroyed) return;
      info = null;
      lanIntro.textContent = 'This page has no local multiplayer server. Use Connection codes now, or start a server on one computer using the setup below.';
      serverHelp.open = true;
      addressList.replaceChildren();
      addressList.hidden = true;
      if (!retry && activeMethod === 'lan' && selectionAtStart === methodSelection) selectMethod('webrtc');
    } finally {
      clearTimeout(timer);
      if (infoAbort === controller) infoAbort = null;
      retryServer.disabled = false;
    }
  }

  function open() {
    if (!backdrop.hidden) return;
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    window.dispatchEvent(new CustomEvent('multiplayerpanelchange', { detail: { open: true } }));
    closeButton.focus();
    detectServer();
  }

  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    window.dispatchEvent(new CustomEvent('multiplayerpanelchange', { detail: { open: false } }));
    if (lastFocus?.isConnected) lastFocus.focus();
    else trigger.focus();
  }

  async function runAction(source, action) {
    if (source.disabled) return;
    source.disabled = true;
    showError('');
    try { await action(); }
    catch (cause) { if (!destroyed) showError(cause?.message || 'Could not connect. Please try again.'); }
    finally { source.disabled = false; }
  }

  async function copyValue(input, label) {
    if (!input.value) return;
    try {
      if (!navigator.clipboard?.writeText || !window.isSecureContext) throw new Error('Manual copy needed');
      await navigator.clipboard.writeText(input.value);
      showError('');
      status.textContent = `${label} copied. Send it privately to your friend.`;
    } catch {
      input.focus();
      input.select();
      try { input.setSelectionRange(0, input.value.length); } catch { /* URL inputs support select(), but not selection ranges. */ }
      status.textContent = `${label} selected. Use your device’s Copy command, then send it to your friend.`;
    }
  }

  function joinLan(room) {
    if (!info) throw new Error('Start the local multiplayer server first, or use Connection codes.');
    const normalized = room.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,24}$/.test(normalized)) throw new Error('Use a room code with 3–24 letters or numbers.');
    roomInput.value = normalized;
    return session.connectLan({ url: new URL('/multiplayer', location.origin).href.replace(/^http/, 'ws'), room: normalized, name: displayName() });
  }

  trigger.addEventListener('click', () => backdrop.hidden ? open() : close());
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup']) backdrop.addEventListener(type, event => {
    if (type === 'keydown' && event.key === 'Escape') { event.preventDefault(); close(); }
    if (type === 'keydown' && event.key === 'Tab') {
      const focusable = Array.from(panel.querySelectorAll('button, input, textarea, a, summary, [tabindex="0"]')).filter(element => !element.disabled && element.getClientRects().length > 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    event.stopPropagation();
  });
  lanChoice.addEventListener('click', () => { methodSelection++; selectMethod('lan'); });
  codeChoice.addEventListener('click', () => { methodSelection++; selectMethod('webrtc'); });
  retryServer.addEventListener('click', () => {
    infoRequested = false;
    showError('');
    detectServer({ retry: true });
  });
  createRoom.addEventListener('click', () => runAction(createRoom, () => joinLan(randomRoom())));
  joinRoom.addEventListener('click', () => runAction(joinRoom, () => joinLan(roomInput.value)));
  copyLink.addEventListener('click', () => copyValue(roomLink, 'Invite link'));
  copyOffer.addEventListener('click', () => copyValue(offerOutput, 'Invitation'));
  copyAnswer.addEventListener('click', () => copyValue(answerOutput, 'Answer'));
  createInvitation.addEventListener('click', () => runAction(createInvitation, async () => {
    offerOutput.value = await session.createOffer({ name: displayName() });
    offerShare.hidden = false;
    answerField.hidden = connectAnswer.hidden = false;
    answerInput.value = '';
    createInvitation.textContent = 'Create a new invitation';
    offerOutput.focus();
  }));
  createAnswer.addEventListener('click', () => runAction(createAnswer, async () => {
    if (!offerInput.value.trim()) throw new Error('Paste the host’s invitation first.');
    answerOutput.value = await session.acceptOffer(offerInput.value.trim(), { name: displayName() });
    answerShare.hidden = false;
    answerOutput.focus();
  }));
  connectAnswer.addEventListener('click', () => runAction(connectAnswer, async () => {
    if (!answerInput.value.trim()) throw new Error('Paste your friend’s answer first.');
    await session.acceptAnswer(answerInput.value.trim());
    answerInput.value = '';
    offerShare.hidden = true;
    answerField.hidden = connectAnswer.hidden = true;
    createInvitation.textContent = 'Invite another friend';
  }));
  leaveButton.addEventListener('click', () => {
    session.leave();
    offerOutput.value = answerOutput.value = offerInput.value = answerInput.value = '';
    offerShare.hidden = answerShare.hidden = answerField.hidden = connectAnswer.hidden = true;
    createInvitation.textContent = 'Create invitation';
    showError('');
  });

  function updateStatus(value = {}) {
    latestStatus = value;
    status.dataset.state = value.state || 'offline';
    status.textContent = value.message || ({ offline: 'Not connected', connecting: 'Connecting… Keep this page open.', connected: 'Connected · drive together', error: 'Connection failed. Try again.' }[value.state] || 'Not connected');
    if (value.state === 'error') showError(value.message || 'Could not connect. Check that both devices are on the same Wi-Fi.');
    trigger.dataset.connected = String(value.state === 'connected');
    trigger.textContent = value.state === 'connected' ? `Multiplayer · ${Math.min(8, currentPeers.length + 1)}` : 'Multiplayer';
    leaveButton.hidden = value.state === 'offline';
    if (value.state === 'offline') {
      offerOutput.value = answerOutput.value = offerInput.value = answerInput.value = '';
      offerShare.hidden = answerShare.hidden = answerField.hidden = connectAnswer.hidden = true;
      createInvitation.textContent = 'Create invitation';
    }
    if (value.transport === 'lan' && value.state === 'connected') {
      roomInput.value = value.room || session.room || roomInput.value;
    }
    updateShare();
  }

  function updatePeers(peers = []) {
    currentPeers = Array.isArray(peers) ? peers : Array.from(peers.values?.() || []);
    const signature = JSON.stringify([nameInput.value.trim(), currentPeers.map(peer => [peer.id, peer.name, Boolean(peer.state && Number.isFinite(peer.state.lat) && Number.isFinite(peer.state.lng))])]);
    if (latestStatus.state === 'connected') trigger.textContent = `Multiplayer · ${Math.min(8, currentPeers.length + 1)}`;
    if (signature === rosterSignature) return;
    rosterSignature = signature;
    if (latestStatus.state === 'connected' && /^Connected(?:\s*[·–-]|$)/i.test(latestStatus.message || '')) {
      const count = Math.min(8, currentPeers.length + 1);
      status.textContent = `Connected · ${count} driver${count === 1 ? '' : 's'}`;
    }
    playersTitle.textContent = `Drivers · ${Math.min(8, currentPeers.length + 1)} / 8`;
    playersList.replaceChildren();
    const self = make('li');
    self.append(make('span', {}, `${nameInput.value.trim() || 'You'} · you`));
    playersList.append(self);
    for (const peer of currentPeers) {
      const item = make('li');
      item.append(make('span', {}, String(peer.name || 'Driver').slice(0, MAX_NAME)));
      if (peer.state && Number.isFinite(peer.state.lat) && Number.isFinite(peer.state.lng)) {
        const meet = button('Meet', { 'aria-label': `Meet ${String(peer.name || 'driver').slice(0, MAX_NAME)}` });
        meet.addEventListener('click', () => {
          try {
            const latest = currentPeers.find(candidate => candidate.id === peer.id);
            if (!latest?.state) throw new Error('This driver is no longer connected.');
            onJoinPeer(latest.state);
            close();
          }
          catch (cause) { showError(cause?.message || 'Could not move to this driver.'); }
        });
        item.append(meet);
      }
      playersList.append(item);
    }
  }

  nameInput.addEventListener('change', () => updatePeers(currentPeers));
  updatePeers(Array.from(session.peers?.values?.() || []));
  if (initialRoom && roomInput.value) open();

  return {
    updateStatus,
    updatePeers,
    open,
    close,
    destroy() {
      destroyed = true;
      infoAbort?.abort();
      close();
      trigger.remove();
      backdrop.remove();
    }
  };
}
