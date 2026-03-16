(function () {
  const API = '/api';

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  function showError(elId, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  function apiJson(url, opts) {
    return fetch(url, opts).then(r => {
      const status = r.status;
      return r.json().then(data => ({ ok: r.ok, data, status })).catch(() => {
        if (status === 404) return { ok: false, data: { error: '接口不存在(404)，请确认访问地址与后端已启动' }, status };
        return { ok: false, data: { error: '登录接口返回异常，请确认后端已启动且地址正确（如部署后请等服务就绪）' }, status };
      });
    });
  }

  function showModal(modalId, show) {
    const m = document.getElementById(modalId);
    if (!m) return;
    m.classList.toggle('hidden', !show);
    m.style.display = show ? 'flex' : '';
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function appendMessage(container, m) {
    const isChat = container.id === 'chat-messages';
    const isMe = isChat && window._member && (m.memberId === window._member.id || (m.memberName && m.memberName === window._member.displayName));
    const avatarSrc = m.memberId ? '/api/avatar/' + m.memberId : '';
    const time = m.time ? new Date(m.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    const msgClass = 'msg' + (m.isHuman ? ' human' : '') + (isChat ? (isMe ? ' msg-me' : ' msg-other') : ' msg-other');
    const header = '<div class="msg-header">' + escapeHtml(m.memberName || '') + ' · ' + time + '</div>';
    const body = '<div class="msg-body">' + escapeHtml(m.text || '') + '</div>';
    const content = '<div class="msg-content">' + header + body + '</div>';
    const initial = (m.memberName || m.memberId || '')[0] || '?';
    const avatarHtml = m.memberId
      ? '<div class="msg-avatar-wrap" data-member-id="' + escapeHtml(m.memberId) + '" data-member-name="' + escapeHtml(m.memberName || '') + '" data-initial="' + escapeHtml(initial) + '" title="点击查看人物小传"><img class="msg-avatar" src="' + escapeHtml(avatarSrc) + '" alt="" onerror="var w=this.parentElement;w.classList.add(\'no-img\');this.style.display=\'none\'"></div>'
      : '';
    const div = document.createElement('div');
    div.className = msgClass;
    if (m.memberId) {
      div.setAttribute('data-member-id', m.memberId);
      div.setAttribute('data-member-name', m.memberName || '');
      div.title = '点击查看人物小传';
    }
    div.innerHTML = isChat && isMe ? content + avatarHtml : avatarHtml + content;
    container.appendChild(div);
  }

  function fetchMessages(sinceId, token, date, memberId) {
    const params = new URLSearchParams();
    if (sinceId) params.set('sinceId', sinceId);
    if (date) params.set('date', date);
    if (memberId) params.set('memberId', memberId);
    const qs = params.toString();
    const url = API + '/messages' + (qs ? '?' + qs : '');
    const opts = token ? { headers: { Authorization: 'Bearer ' + token } } : {};
    return fetch(url, opts).then(r => r.json());
  }

  function fetchDates(token) {
    const opts = token ? { headers: { Authorization: 'Bearer ' + token } } : {};
    return fetch(API + '/messages/dates', opts).then(r => r.json());
  }

  function fetchMembers() {
    return fetch(API + '/auth/members').then(r => r.json());
  }

  function fillMemberSelect(selectId, members) {
    const el = document.getElementById(selectId);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">全部</option>';
    (members || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.displayName || m.name;
      el.appendChild(opt);
    });
    if (cur) el.value = cur;
  }

  function renderMessageList(containerId, list, lastIdRef) {
    const container = document.getElementById(containerId);
    if (!container) return;
    (list || []).forEach(m => appendMessage(container, m));
    if (list.length && lastIdRef) lastIdRef.current = Math.max(lastIdRef.current || 0, ...list.map(m => m.id));
    container.scrollTop = container.scrollHeight;
  }

  // ——— 入口：诗句后显示 观/改 ———
  setTimeout(() => document.getElementById('choice-boxes')?.classList.remove('hidden'), 1200);

  document.getElementById('choice-observe')?.addEventListener('click', function (e) {
    e.preventDefault();
    showScreen('screen-observe');
    startObservePolling();
  });

  document.getElementById('choice-edit')?.addEventListener('click', function (e) {
    e.preventDefault();
    showScreen('screen-login');
    showError('login-error', '');
  });

  // ——— 观：只读 ———
  let observeTimer = null;
  const observeLastId = { current: 0 };

  function getObserveFilters() {
    const dateEl = document.getElementById('observe-date');
    const memberEl = document.getElementById('observe-member');
    return { date: (dateEl && dateEl.value) ? dateEl.value.trim() : '', memberId: (memberEl && memberEl.value) ? memberEl.value.trim() : '' };
  }

  function hasObserveFilter() {
    const f = getObserveFilters();
    return !!(f.date || f.memberId);
  }

  function loadObserveMessages(date, memberId) {
    const filtered = !!(date || memberId);
    const lastIdRef = filtered ? null : observeLastId;
    fetchMessages(null, null, date || undefined, memberId || undefined).then(data => {
      const list = data.messages || [];
      const container = document.getElementById('observe-messages');
      if (!container) return;
      container.innerHTML = '';
      renderMessageList('observe-messages', list, lastIdRef);
    }).catch(() => {});
  }

  function startObservePolling() {
    const dateEl = document.getElementById('observe-date');
    if (dateEl) dateEl.value = '';
    fetchMembers().then(fillMemberSelect.bind(null, 'observe-member')).catch(() => {});
    if (observeTimer) clearInterval(observeTimer);
    loadObserveMessages();
    observeTimer = setInterval(() => {
      if (hasObserveFilter()) return;
      fetchMessages(observeLastId.current).then(data => {
        const list = data.messages || [];
        if (list.length) renderMessageList('observe-messages', list, observeLastId);
      }).catch(() => {});
    }, 3000);
  }

  document.getElementById('observe-date')?.addEventListener('change', function () {
    const f = getObserveFilters();
    loadObserveMessages(f.date || undefined, f.memberId || undefined);
  });
  document.getElementById('observe-member')?.addEventListener('change', function () {
    const f = getObserveFilters();
    loadObserveMessages(f.date || undefined, f.memberId || undefined);
  });

  document.getElementById('back-from-observe')?.addEventListener('click', function () {
    if (observeTimer) clearInterval(observeTimer);
    observeTimer = null;
    showScreen('screen-intro');
  });

  // ——— 改：登录 ———
  const loginForm = document.getElementById('login-form');
  const loginUsername = document.getElementById('login-username');
  const loginPassword = document.getElementById('login-password');
  loginForm?.addEventListener('submit', function (e) {
    e.preventDefault();
    const username = (loginUsername?.value || '').trim();
    const password = loginPassword?.value || '';
    showError('login-error', '');
    if (!username) { showError('login-error', '请输入用户名'); return; }
    apiJson(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(({ ok, data, status }) => {
      if (ok && data.token) {
        window._token = data.token;
        window._member = data.member;
        window._role = data.role || null;
        if (data.role === 'admin') {
          showScreen('screen-admin');
          loadAdminPersonas();
        } else {
          showScreen('screen-chat');
          const titleEl = document.getElementById('my-identity');
          if (titleEl) titleEl.textContent = data.member?.displayName || data.member?.name || '';
          startChatPolling();
          reportPresence();
          if (window._presenceTimer) clearInterval(window._presenceTimer);
          window._presenceTimer = setInterval(reportPresence, 2 * 60 * 1000);
        }
      } else {
        let msg = data.error || '登录失败';
        if (status === 503 || /未配置|credentials|请先在服务端/.test(msg)) {
          msg = '服务暂时不可用。请确认已在项目目录执行 npm start 启动后端，默认密码 123456，无需单独配置 credentials。';
        } else if (msg === '密码错误' && username.toLowerCase() === 'admin') {
          msg = '密码错误。管理员默认密码为 Cc921（可通过环境变量 ADMIN_PASSWORD 修改）';
        }
        showError('login-error', msg);
      }
    }).catch(() => showError('login-error', '网络错误或后端未启动，请确认已执行 npm start 后重试。'));
  });
  document.getElementById('back-from-login')?.addEventListener('click', () => showScreen('screen-intro'));

  // ——— 改：聊天 ———
  const chatLastId = { current: 0 };
  let chatPollTimer = null;

  function getChatFilters() {
    const dateEl = document.getElementById('chat-date');
    const memberEl = document.getElementById('chat-member');
    return { date: (dateEl && dateEl.value) ? dateEl.value.trim() : '', memberId: (memberEl && memberEl.value) ? memberEl.value.trim() : '' };
  }

  function hasChatFilter() {
    const f = getChatFilters();
    return !!(f.date || f.memberId);
  }

  function loadChatMessages(date, memberId) {
    const token = window._token;
    const filtered = !!(date || memberId);
    const lastIdRef = filtered ? null : chatLastId;
    fetchMessages(null, token, date || undefined, memberId || undefined).then(data => {
      const list = data.messages || [];
      const container = document.getElementById('chat-messages');
      if (!container) return;
      container.innerHTML = '';
      renderMessageList('chat-messages', list, lastIdRef);
    }).catch(() => {});
  }

  function startChatPolling() {
    const dateEl = document.getElementById('chat-date');
    if (dateEl) dateEl.value = '';
    fetchMembers().then(fillMemberSelect.bind(null, 'chat-member')).catch(() => {});
    loadChatMessages();
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = setInterval(() => {
      if (!window._token || hasChatFilter()) return;
      fetchMessages(chatLastId.current, window._token).then(data => {
        const list = data.messages || [];
        if (list.length) renderMessageList('chat-messages', list, chatLastId);
      }).catch(() => {});
    }, 2000);
  }

  document.getElementById('chat-date')?.addEventListener('change', function () {
    const f = getChatFilters();
    loadChatMessages(f.date || undefined, f.memberId || undefined);
  });
  document.getElementById('chat-member')?.addEventListener('change', function () {
    const f = getChatFilters();
    loadChatMessages(f.date || undefined, f.memberId || undefined);
  });

  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  chatForm?.addEventListener('submit', function (e) {
    e.preventDefault();
    const text = (chatInput?.value || '').trim();
    if (!text || !window._token) return;
    fetch(API + '/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window._token },
      body: JSON.stringify({ text })
    })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.message) {
          const container = document.getElementById('chat-messages');
          appendMessage(container, data.message);
          chatLastId.current = Math.max(chatLastId.current, data.message.id);
          container.scrollTop = container.scrollHeight;
          if (chatInput) chatInput.value = '';
        }
      })
      .catch(() => {});
  });
  function reportPresence() {
    if (!window._token || !window._member || window._member.id === 'admin') return;
    fetch(API + '/presence', { method: 'POST', headers: { Authorization: 'Bearer ' + window._token } }).catch(() => {});
  }
  function clearPresence() {
    if (window._presenceTimer) { clearInterval(window._presenceTimer); window._presenceTimer = null; }
    if (window._token) {
      fetch(API + '/presence', { method: 'DELETE', headers: { Authorization: 'Bearer ' + window._token } }).catch(() => {});
    }
  }
  document.getElementById('back-from-chat')?.addEventListener('click', function () {
    clearPresence();
    window._token = null;
    window._member = null;
    showScreen('screen-intro');
  });

  document.getElementById('collect-btn')?.addEventListener('click', function (e) {
    e.preventDefault();
    if (!window._token) return;
    showScreen('screen-collect');
    document.getElementById('collect-intro').classList.remove('hidden');
    document.getElementById('collect-chat').classList.add('hidden');
    document.getElementById('collect-done').classList.add('hidden');
  });

  // ——— 人物小传弹窗（点击整条消息或头像） ———
  function openProfileModal(memberId, fallbackName) {
    const modal = document.getElementById('profile-view-modal');
    const setContent = (name, bio) => {
      modal.querySelector('.profile-view-name').textContent = name || '未知';
      modal.querySelector('.profile-view-bio').textContent = bio || '暂无人物小传';
    };
    fetch(API + '/profile/' + memberId)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const avatarEl = modal.querySelector('.profile-view-avatar');
        const name = data.displayName || fallbackName || '';
        const initialChar = (name || '?').trim()[0] || '?';
        const initial = escapeHtml(initialChar);
        const avatarUrl = (data.avatarUrl || '').trim();
        avatarEl.className = 'profile-view-avatar';
        if (avatarUrl) {
          avatarEl.innerHTML = '<img src="' + avatarUrl + '?t=' + Date.now() + '" alt="" onerror="var p=this.parentElement;p.classList.add(\'no-avatar\');var s=p.querySelector(\'.avatar-initial\');if(s)s.style.display=\'block\';this.style.display=\'none\'"><span class="avatar-initial" style="display:none" aria-hidden="true">' + initial + '</span>';
        } else {
          avatarEl.classList.add('no-avatar');
          avatarEl.innerHTML = '<span class="avatar-initial" aria-hidden="true">' + initial + '</span>';
        }
        setContent(name, (data.bio && data.bio.trim()) ? data.bio : null);
        showModal('profile-view-modal', true);
      })
      .catch(() => {
        const avatarEl = modal.querySelector('.profile-view-avatar');
        const initialChar = (fallbackName || '?').trim()[0] || '?';
        avatarEl.className = 'profile-view-avatar no-avatar';
        avatarEl.innerHTML = '<span class="avatar-initial" aria-hidden="true">' + escapeHtml(initialChar) + '</span>';
        setContent(fallbackName, null);
        modal.querySelector('.profile-view-bio').textContent = '加载失败，请稍后再试。';
        showModal('profile-view-modal', true);
      });
  }
  document.getElementById('app').addEventListener('click', function (e) {
    if (e.target.closest('input, button, textarea, .modal-close')) return;
    const msg = e.target.closest('.msg[data-member-id]');
    const wrap = e.target.closest('.msg-avatar-wrap[data-member-id]');
    const memberId = (msg && msg.getAttribute('data-member-id')) || (wrap && wrap.getAttribute('data-member-id'));
    if (!memberId) return;
    e.preventDefault();
    e.stopPropagation();
    const fallbackName = (msg && msg.getAttribute('data-member-name')) || (wrap && wrap.getAttribute('data-member-name')) || '';
    openProfileModal(memberId, fallbackName);
  }, true);
  document.getElementById('profile-view-close')?.addEventListener('click', () => showModal('profile-view-modal', false));
  document.querySelector('#profile-view-modal .modal-backdrop')?.addEventListener('click', () => showModal('profile-view-modal', false));

  // ——— 编辑资料（头像、小传、修改密码） ———
  const editBtn = document.getElementById('edit-profile-btn');
  const editModal = document.getElementById('profile-edit-modal');
  const editAvatarPreview = document.getElementById('profile-edit-avatar-preview');
  const editAvatarInput = document.getElementById('profile-edit-avatar-input');
  const editBio = document.getElementById('profile-edit-bio');
  const editOldPwd = document.getElementById('profile-edit-old-pwd');
  const editNewPwd = document.getElementById('profile-edit-new-pwd');
  const editStatus = document.getElementById('profile-edit-status');
  const editSave = document.getElementById('profile-edit-save');

  function showEditStatus(msg, isError) {
    if (!editStatus) return;
    editStatus.textContent = msg || '';
    editStatus.classList.toggle('hidden', !msg);
    editStatus.style.color = isError ? '#a44' : '';
  }

  editBtn?.addEventListener('click', function () {
    if (!window._member || !window._token) return;
    editAvatarPreview.style.display = '';
    editAvatarPreview.onerror = function () { this.alt = '暂无头像'; this.style.background = 'var(--border)'; };
    editAvatarPreview.onload = function () { this.alt = ''; this.style.background = ''; };
    editAvatarPreview.src = '/api/avatar/' + window._member.id + '?t=' + Date.now();
    editAvatarInput.value = '';
    editBio.value = '';
    if (editOldPwd) editOldPwd.value = '';
    if (editNewPwd) editNewPwd.value = '';
    showEditStatus('');
    fetch(API + '/profile/' + window._member.id)
      .then(r => r.ok ? r.json() : {})
      .then(data => { if (data.bio) editBio.value = data.bio; })
      .catch(() => {});
    editModal.classList.remove('hidden');
  });

  document.getElementById('profile-edit-close')?.addEventListener('click', () => editModal?.classList.add('hidden'));
  document.querySelector('#profile-edit-modal .modal-backdrop')?.addEventListener('click', () => editModal?.classList.add('hidden'));

  editAvatarInput?.addEventListener('change', function () {
    const f = this.files && this.files[0];
    if (!f) return;
    editAvatarPreview.src = URL.createObjectURL(f);
    editAvatarPreview.style.display = '';
  });

  editSave?.addEventListener('click', function () {
    if (!window._token) return;
    const newPwd = editNewPwd?.value?.trim();
    const oldPwd = editOldPwd?.value || '';
    if (newPwd) {
      if (newPwd.length < 6) { showEditStatus('新密码不少于 6 位', true); return; }
      if (!oldPwd) { showEditStatus('修改密码请先输入当前密码', true); return; }
    }
    showEditStatus('保存中…');
    const fd = new FormData();
    fd.append('bio', editBio.value || '');
    if (editAvatarInput.files && editAvatarInput.files[0]) fd.append('avatar', editAvatarInput.files[0]);
    const doSave = () => {
      apiJson(API + '/profile', { method: 'POST', headers: { Authorization: 'Bearer ' + window._token }, body: fd })
        .then(({ ok, data }) => {
          if (!ok) { showEditStatus(data.error || '保存失败', true); return; }
          showEditStatus('已保存');
          editAvatarPreview.src = '/api/avatar/' + window._member.id + '?t=' + Date.now();
          editAvatarInput.value = '';
          if (editOldPwd) editOldPwd.value = '';
          if (editNewPwd) editNewPwd.value = '';
          setTimeout(() => { editModal.classList.add('hidden'); showEditStatus(''); }, 800);
        })
        .catch(() => showEditStatus('网络错误', true));
    };
    if (newPwd && oldPwd) {
      apiJson(API + '/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + window._token },
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
      }).then(({ ok, data }) => {
        if (!ok) { showEditStatus(data.error || '密码修改失败', true); return; }
        doSave();
      }).catch(() => showEditStatus('网络错误', true));
    } else {
      doSave();
    }
  });

  // ——— 对话采集（和 AI 聊 10 分钟） ———
  let collectCountdownTimer = null;
  let collectRemainingMs = 0;

  function formatCollectTime(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return '剩余 ' + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function appendCollectLine(role, text) {
    const container = document.getElementById('collect-messages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'msg msg-' + (role === 'user' ? 'me' : 'other');
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const header = '<div class="msg-header">' + (role === 'user' ? '我' : 'AI') + ' · ' + time + '</div>';
    const body = '<div class="msg-body">' + escapeHtml(text) + '</div>';
    div.innerHTML = '<div class="msg-content">' + header + body + '</div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  document.getElementById('collect-start-btn')?.addEventListener('click', function () {
    if (!window._token) return;
    fetch(API + '/collect/start', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + window._token }
    })
      .then(r => r.json())
      .then(function (data) {
        if (!data.ok && !data.reply) { return; }
        document.getElementById('collect-intro').classList.add('hidden');
        document.getElementById('collect-chat').classList.remove('hidden');
        document.getElementById('collect-messages').innerHTML = '';
        appendCollectLine('assistant', data.reply);
        collectRemainingMs = data.remainingMs || 10 * 60 * 1000;
        document.getElementById('collect-countdown').textContent = formatCollectTime(collectRemainingMs);
        if (collectCountdownTimer) clearInterval(collectCountdownTimer);
        collectCountdownTimer = setInterval(function () {
          collectRemainingMs -= 1000;
          if (collectRemainingMs <= 0) {
            clearInterval(collectCountdownTimer);
            collectCountdownTimer = null;
            document.getElementById('collect-countdown').textContent = '时间到，请点击「结束并合并人设」';
            document.getElementById('collect-input').disabled = true;
            document.getElementById('collect-form').querySelector('button[type="submit"]').disabled = true;
          } else {
            document.getElementById('collect-countdown').textContent = formatCollectTime(collectRemainingMs);
          }
        }, 1000);
      })
      .catch(function () {});
  });

  document.getElementById('collect-form')?.addEventListener('submit', function (e) {
    e.preventDefault();
    const input = document.getElementById('collect-input');
    const text = (input?.value || '').trim();
    if (!text || !window._token) return;
    appendCollectLine('user', text);
    input.value = '';
    fetch(API + '/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + window._token },
      body: JSON.stringify({ text: text })
    })
      .then(r => r.json())
      .then(function (data) {
        if (data.reply) appendCollectLine('assistant', data.reply);
        if (data.remainingMs !== undefined) collectRemainingMs = data.remainingMs;
        if (data.code === 'TIME_UP') {
          if (collectCountdownTimer) clearInterval(collectCountdownTimer);
          collectCountdownTimer = null;
          document.getElementById('collect-countdown').textContent = '时间到，请点击「结束并合并人设」';
          document.getElementById('collect-input').disabled = true;
          document.getElementById('collect-form').querySelector('button[type="submit"]').disabled = true;
        }
      })
      .catch(function () {});
  });

  document.getElementById('collect-end-btn')?.addEventListener('click', function () {
    if (!window._token) return;
    if (collectCountdownTimer) clearInterval(collectCountdownTimer);
    collectCountdownTimer = null;
    fetch(API + '/collect/end', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + window._token }
    })
      .then(r => r.json())
      .then(function () {
        document.getElementById('collect-chat').classList.add('hidden');
        document.getElementById('collect-done').classList.remove('hidden');
      })
      .catch(function () {});
  });

  document.getElementById('back-from-collect')?.addEventListener('click', function () {
    if (collectCountdownTimer) clearInterval(collectCountdownTimer);
    collectCountdownTimer = null;
    showScreen('screen-chat');
  });
  document.getElementById('collect-done-back')?.addEventListener('click', function () {
    showScreen('screen-chat');
  });

  // ——— 管理员：微调人设 ———
  function loadAdminPersonas() {
    if (!window._token) return;
    fetch(API + '/admin/personas', { headers: { Authorization: 'Bearer ' + window._token } })
      .then(r => r.json())
      .then(function (data) {
        const list = data.personas || [];
        const container = document.getElementById('admin-personas');
        if (!container) return;
        container.innerHTML = list.map(function (p) {
          const hoursStr = (p.activeHours || []).join(', ');
          const samplesCount = (p.sampleMessages || []).length;
          const habits = escapeHtml(p.replyHabits || '');
          return '<div class="admin-persona" data-name="' + escapeHtml(p.name) + '">' +
            '<div class="admin-persona-head">' +
              '<span class="admin-persona-name">' + escapeHtml(p.displayName || p.name) + '</span>' +
              ' <span class="admin-persona-id">' + escapeHtml(p.name) + '</span>' +
            '</div>' +
            '<label>活跃时段（0–23 点，逗号分隔）</label>' +
            '<input type="text" class="admin-hours" value="' + escapeHtml(hoursStr) + '" placeholder="如 9,10,14,20,21">' +
            '<label>回复习惯（会喂给 AI，如：喜欢用哈哈哈结尾、爱发表情包）</label>' +
            '<textarea class="admin-habits" rows="2" placeholder="选填，描述该成员说话习惯">' + habits + '</textarea>' +
            '<p class="admin-meta">样本消息 ' + samplesCount + ' 条</p>' +
            '<button type="button" class="admin-save-btn">保存</button>' +
            '</div>';
        }).join('');
        container.querySelectorAll('.admin-save-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            const card = btn.closest('.admin-persona');
            const name = card.getAttribute('data-name');
            const hoursInput = card.querySelector('.admin-hours');
            const habitsInput = card.querySelector('.admin-habits');
            const raw = (hoursInput.value || '').trim();
            const activeHours = raw ? raw.split(/[\s,，]+/).map(function (h) { const n = parseInt(h, 10); return isNaN(n) ? null : n; }).filter(function (n) { return n != null && n >= 0 && n <= 23; }) : [];
            const replyHabits = habitsInput ? (habitsInput.value || '').trim() : '';
            fetch(API + '/admin/personas', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + window._token },
              body: JSON.stringify({ name: name, activeHours: activeHours, replyHabits: replyHabits })
            })
              .then(r => r.json())
              .then(function (res) {
                if (res.ok) { btn.textContent = '已保存'; setTimeout(function () { btn.textContent = '保存'; }, 1500); }
              })
              .catch(function () {});
          });
        });
      })
      .catch(function () {});
  }

  document.getElementById('back-from-admin')?.addEventListener('click', function () {
    window._token = null;
    window._member = null;
    window._role = null;
    showScreen('screen-intro');
  });

  document.getElementById('admin-clear-messages-btn')?.addEventListener('click', function () {
    if (!window._token) return;
    if (!confirm('确定要清空所有聊天记录吗？此操作不可恢复。')) return;
    var btn = this;
    btn.disabled = true;
    fetch(API + '/admin/messages/clear', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + window._token }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) alert('已清空 ' + (data.deleted || 0) + ' 条聊天记录。');
        else alert(data.error || '清空失败');
      })
      .catch(function () { alert('请求失败'); })
      .finally(function () { btn.disabled = false; });
  });
})();
