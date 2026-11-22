/* ui.js — 直接编排 + 详细编辑器 + 抽屉 / 角色池 */
(function () {
  'use strict';
  const CM = window.CM;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = CM.esc;
  const tr = (zh, en, vars) => CM.i18n.tr(zh, en, vars);
  const NARROW = () => window.matchMedia('(max-width: 1180px)').matches;
  const OVERLAY = () => document.body.dataset.page === 'chat' || NARROW();

  const S = {
    sessionId: null,
    selectedId: null,
    freshEventId: null,
    composerUid: '',
    previewLayout: null,
    previewToken: 0,
    drag: null,
    dropIndex: null,
    dropY: 0,
    suppressClickAt: 0,
    saveWarned: false,
    rolePopOpen: false,
    modalKind: '',
    modalUid: '',
    confirmResolve: null,
    confirmOpts: null,
    saveStatus: null,
    exportInfo: null,
    longPressTimer: 0,
    longPressStart: null,
    ctx: null,
    ctxPrevFocus: null,
    ctxOpenedAt: 0,
    hold: null,
  };

  document.addEventListener('DOMContentLoaded', init);

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    CM.store.init();
    loadUI();
    ensureSession();
    ensureComposer();
    CM.store.onStatus = onSaveStatus;
    bind();
    renderAll();
    onSaveStatus({ ok: true, bytes: CM.store.bytes(), at: new Date() });
    CM.i18n.onChange(onLanguageChange);
    if (!CM.store.available) {
      toast(tr('浏览器本地存储不可用，修改只留在当前页面', 'Browser local storage is unavailable; changes stay on this page only'), true);
    }
  }

  /** Re-render every dynamic surface after a zh/en switch. Static markup is
      handled by CM.i18n.apply(); here we rebuild templates and open dialogs. */
  function onLanguageChange() {
    closeContextMenu();
    renderAll();
    if (S.saveStatus) onSaveStatus(S.saveStatus);
    if (S.modalKind === 'export') {
      openExport();
    } else if (S.modalKind === 'character') {
      openCharacterModal(S.modalUid, false);
    } else if (S.modalKind === 'confirm' && S.confirmOpts) {
      openConfirmModal(S.confirmOpts);
    }
  }

  function loadUI() {
    try {
      const raw =
        localStorage.getItem(CM.UI_KEY) ||
        localStorage.getItem(CM.LEGACY_UI_KEY) ||
        '{}';
      if (!localStorage.getItem(CM.UI_KEY) && raw !== '{}') {
        try {
          localStorage.setItem(CM.UI_KEY, raw);
        } catch (e) {}
      }
      const ui = JSON.parse(raw);
      if (ui.sessionId && D().sessions.some((s) => s.id === ui.sessionId)) S.sessionId = ui.sessionId;
      if (ui.composerUid) S.composerUid = String(ui.composerUid);
    } catch (e) {}
  }

  function saveUI() {
    try {
      localStorage.setItem(
        CM.UI_KEY,
        JSON.stringify({ sessionId: S.sessionId, composerUid: S.composerUid })
      );
    } catch (e) {}
  }

  function D() {
    return CM.store.data;
  }

  function session() {
    const d = D();
    return d.sessions.find((s) => s.id === S.sessionId) || d.sessions[0];
  }

  function findSession(d, id) {
    return (d.sessions || []).find((s) => s.id === id);
  }

  function findEventById(d, id) {
    for (const s of d.sessions || []) {
      const ev = (s.events || []).find((e) => e.id === id);
      if (ev) return ev;
    }
    return null;
  }

  function currentEvent() {
    const s = session();
    if (!s || !S.selectedId) return null;
    return (s.events || []).find((e) => e.id === S.selectedId) || null;
  }

  function ensureSession() {
    const d = D();
    if (!d.sessions.some((s) => s.id === S.sessionId)) S.sessionId = d.sessions[0].id;
  }

  function allowedChars(s) {
    const d = D();
    if (!s || s.detail_type !== 'private') return d.characters;
    const ids = new Set([String(CM.selfId(d)), String(s.user_id || '')]);
    return d.characters.filter((c) => ids.has(String(c.user_id)));
  }

  function ensureComposer() {
    const s = session();
    const allowed = allowedChars(s);
    if (!S.composerUid || !allowed.some((c) => String(c.user_id) === String(S.composerUid))) {
      S.composerUid = CM.selfId(D());
    }
  }

  function selfChar() {
    return CM.charOf(D(), CM.selfId(D())) || { name: tr('我', 'Me'), avatar: '🙂', color: '#93b4ff' };
  }

  function avatarHTML(ch) {
    if (!ch) return '🙂';
    if (ch.avatarImage) return `<img src="${esc(ch.avatarImage)}" alt="">`;
    return esc(ch.avatar || '🙂');
  }

  function randomGroupId() {
    return String(100000000 + Math.floor(Math.random() * 899999999));
  }

  function firstOtherId(d) {
    const self = CM.selfId(d);
    const c = (d.characters || []).find((x) => String(x.user_id) !== String(self));
    return c ? c.user_id : self;
  }

  function shortTime(ts) {
    const d = new Date(ts * 1000);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return CM.fmtClock(ts);
    if (d.getFullYear() === now.getFullYear()) return d.getMonth() + 1 + '/' + d.getDate();
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function recalledSet(s) {
    const set = new Set();
    (s.events || []).forEach((ev) => {
      if (ev.type === 'notice' && ev.detail_type === 'group_message_delete' && ev.message_id) {
        set.add(String(ev.message_id));
      }
    });
    return set;
  }

  function isEmptyMessage(ev) {
    if (!ev || ev.type !== 'message') return false;
    return (ev.message || []).every(
      (seg) => seg.type === 'text' && !String((seg.data && seg.data.text) || '').trim()
    );
  }

  /* ------------------------------------------------------------------ */
  /* global render                                                       */
  /* ------------------------------------------------------------------ */

  function renderAll(opts) {
    opts = opts || {};
    ensureSession();
    ensureComposer();
    if (S.selectedId && !findEventById(D(), S.selectedId)) S.selectedId = null;

    const drawerOpen = document.body.classList.contains('drawer-open');
    const drawerScroll = drawerOpen && $('#drawer-body') ? $('#drawer-body').scrollTop : 0;

    renderTopbar();
    renderPhoneChrome();
    renderPool();
    renderDetail();
    updateComposer();
    if (drawerOpen) {
      renderDrawer();
      const db = $('#drawer-body');
      if (db) db.scrollTop = drawerScroll;
    }
    if (!opts.skipPreview) schedulePreview();
  }

  function renderTopbar() {
    const st = D().settings;
    $$('[data-action="set-platform"]').forEach((b) =>
      b.classList.toggle('active', b.dataset.platform === st.platform)
    );
    const mi = $('#mode-icon');
    if (mi) mi.textContent = st.mode === 'dark' ? '☀' : '☾';
    updateUndoButtons();
  }

  function updateUndoButtons() {
    $$('[data-action="undo"]').forEach((b) => (b.disabled = !CM.store.canUndo()));
    $$('[data-action="redo"]').forEach((b) => (b.disabled = !CM.store.canRedo()));
  }

  function renderPhoneChrome() {
    const st = D().settings;
    const s = session();
    const phone = $('#phone');
    if (phone) {
      phone.dataset.platform = st.platform;
      phone.dataset.mode = st.mode;
    }
    const title = $('#chat-title');
    if (title) title.textContent = s.title || tr('未命名会话', 'Untitled chat');
    let sub = '';
    if (st.platform === 'qq') {
      sub =
        s.detail_type === 'group'
          ? s.member_count
            ? tr('{n}人', '{n} members', { n: s.member_count })
            : tr('群聊', 'Group chat')
          : tr('在线', 'Online');
    }
    const subEl = $('#chat-sub');
    if (subEl) subEl.textContent = sub;

    const last = CM.sessionLastTime(s);
    const t = /^\d{1,2}:\d{2}$/.test(st.statusTime || '')
      ? st.statusTime
      : CM.fmtClock(last || CM.nowSec());
    const sb = $('#sb-time');
    if (sb) sb.textContent = t;

    const screen = $('#phone-screen');
    if (screen) screen.style.background = st.backgroundTint || CM.theme(st).bg;
  }

  function renderPool() {
    const s = session();
    const d = D();
    const counts = {};
    (s.events || []).forEach((ev) => {
      if (ev.type === 'message') counts[ev.user_id] = (counts[ev.user_id] || 0) + 1;
    });
    const allowed = new Set(allowedChars(s).map((c) => String(c.user_id)));
    const html = d.characters
      .map((c) => {
        const isSelf = String(c.user_id) === String(CM.selfId(d));
        const active = String(c.user_id) === String(S.composerUid);
        const canSend = allowed.has(String(c.user_id));
        return `<div class="pool-card${active ? ' active' : ''}" draggable="true" data-action="pick-composer-role" data-uid="${esc(c.user_id)}" title="${esc(tr('点击设为输入身份；拖到聊天页直接插入消息', 'Click to set as input identity; drag into the chat to insert a message'))}">
          <span class="pool-avatar" style="background:${esc(c.color)}">${avatarHTML(c)}</span>
          <span class="pool-meta">
            <span class="pool-name"><span data-char-name="${esc(c.user_id)}">${esc(c.name)}</span>${isSelf ? `<span class="pool-tag">${esc(tr('本人', 'You'))}</span>` : ''}</span>
            <span class="pool-id">#${esc(c.user_id)} · ${esc(tr('{n} 条', '{n} msg', { n: counts[c.user_id] || 0 }))}${canSend ? '' : ' · ' + esc(tr('仅查看', 'View only'))}</span>
          </span>
          <button type="button" class="pool-edit" data-action="edit-character" data-uid="${esc(c.user_id)}" aria-label="${esc(tr('编辑角色', 'Edit character'))}" title="${esc(tr('编辑角色', 'Edit character'))}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
              <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="m14 8 2 2" stroke="currentColor" stroke-width="1.7"/>
            </svg>
          </button>
        </div>`;
      })
      .join('');
    const box = $('#character-pool');
    if (box) box.innerHTML = html;
  }

  function updateComposer() {
    const s = session();
    const allowed = allowedChars(s);
    if (!allowed.some((c) => String(c.user_id) === String(S.composerUid))) {
      S.composerUid = CM.selfId(D());
    }
    const ch = CM.charOf(D(), S.composerUid) || selfChar();
    const av = $('#role-avatar');
    if (av) {
      av.innerHTML = avatarHTML(ch);
      av.style.background = ch.color || '#eef2f8';
    }
    const roleBtn = $('#role-btn');
    if (roleBtn) roleBtn.title = tr('当前身份：{name}（点击切换）', 'Current identity: {name} (click to change)', { name: ch.name });
    const input = $('#composer-input');
    if (input) input.placeholder = tr('以 {name} 的身份输入…', 'Type as {name}…', { name: ch.name });
    const send = $('#composer-send') || $('.composer-send');
    if (send && input) send.disabled = !input.value.trim();
    if (S.rolePopOpen) renderRolePop();
  }

  function updateDetailSub() {
    const ev = currentEvent();
    const s = session();
    const el = $('#dh-sub');
    if (!ev || !el) return;
    const idx = (s.events || []).indexOf(ev);
    const fresh = S.freshEventId === ev.id;
    el.textContent =
      CM.fmtAbs(ev.time) +
      ' · ' +
      (ev.type === 'notice'
        ? tr('通知事件', 'Notice event')
        : s.detail_type === 'group'
        ? tr('群聊', 'Group chat')
        : tr('私聊', 'Private chat')) +
      ' · ' +
      (idx + 1) +
      '/' +
      s.events.length +
      (fresh ? ' · ' + tr('新消息', 'New') : '');
  }

  /* ------------------------------------------------------------------ */
  /* detail                                                              */
  /* ------------------------------------------------------------------ */

  function renderDetail() {
    const s = session();
    const ev = currentEvent();
    const head = $('#detail-head');
    const body = $('#detail-body');
    if (!head || !body) return;
    if (!ev) {
      renderEmptyDetail(head, body, s);
      return;
    }
    if (ev.type === 'notice') renderNoticeDetail(head, body, ev, s);
    else renderMessageDetail(head, body, ev, s);
    body.scrollTop = 0;
  }

  function detailActions(ev, s, extra) {
    const idx = (s.events || []).indexOf(ev);
    return `<div class="dh-actions">
      <button type="button" class="btn btn-sm" data-action="move-event" data-dir="-1" ${idx === 0 ? 'disabled' : ''} title="${esc(tr('上移', 'Move up'))}">↑</button>
      <button type="button" class="btn btn-sm" data-action="move-event" data-dir="1" ${idx === s.events.length - 1 ? 'disabled' : ''} title="${esc(tr('下移', 'Move down'))}">↓</button>
      <button type="button" class="btn btn-sm" data-action="duplicate-event" title="${esc(tr('复制', 'Duplicate'))}">${esc(tr('复制', 'Duplicate'))}</button>
      <button type="button" class="btn btn-sm btn-danger" data-action="delete-event" title="${esc(tr('删除', 'Delete'))}">${esc(tr('删除', 'Delete'))}</button>
      <button type="button" class="icon-btn sm" data-action="close-detail" title="${esc(tr('关闭详细编辑', 'Close detailed editor'))}" aria-label="${esc(tr('关闭详细编辑', 'Close detailed editor'))}">×</button>
    </div>`;
  }

  function renderMessageDetail(head, body, ev, s) {
    const ch = CM.charOf(D(), ev.user_id);
    const fresh = S.freshEventId === ev.id;
    head.innerHTML = `
      <span class="dh-avatar" style="background:${ch ? esc(ch.color) : '#dfe4eb'}">${avatarHTML(ch)}</span>
      <div class="dh-main">
        <div class="dh-title"><span data-char-name="${esc(ev.user_id)}">${esc(CM.charName(D(), ev.user_id))}</span> · ${esc(tr('消息', 'Message'))}${fresh ? ' · ' + esc(tr('新消息', 'New')) : ''}</div>
        <div class="dh-sub" id="dh-sub">${esc(CM.fmtAbs(ev.time))} · ${esc(s.detail_type === 'group' ? tr('群聊', 'Group chat') : tr('私聊', 'Private chat'))} · ${esc(tr('第 {n}/{total} 条', 'Item {n}/{total}', { n: s.events.indexOf(ev) + 1, total: s.events.length }))}</div>
      </div>
      ${detailActions(ev, s)}`;

    const segs = ev.message || [];
    const segHTML = segs.length
      ? segs.map((seg, i) => segmentEditor(seg, i, ev, s)).join('')
      : `<div class="seg-note" style="padding:9px 2px">${esc(tr('这条消息还没有内容。添加一个消息段，或直接在输入框里发送文字。', 'This message is still empty. Add a segment, or type in the composer.'))}</div>`;
    const gap = gapText(ev, s);
    body.innerHTML = `
      ${fresh ? `<div class="empty-hero" style="margin-bottom:12px;border-style:solid;padding:9px 10px"><div class="empty-icon" style="width:30px;height:30px;font-size:14px">＋</div><div><h3 style="font-size:12px">${esc(tr('正在编辑一条新消息', 'Editing a new message'))}</h3><p style="font-size:10px">${esc(tr('关闭时如果仍然为空，会自动从聊天里移除。', 'If it is still empty when closed, it will be removed from the chat.'))}</p></div></div>` : ''}
      <div class="meta-grid">
        <label class="field"><span>${esc(tr('发送者（user_id）', 'Sender (user_id)'))}</span><select class="select" data-bind="event.user_id">${charOptions(ev.user_id, s, true)}</select></label>
        <label class="field"><span>${esc(tr('时间（本地时间）', 'Time (local)'))}</span><input class="input" type="datetime-local" step="60" data-bind="event.time" value="${CM.toLocalInput(ev.time)}"></label>
      </div>
      <div class="meta-note">${esc(gap)} · OneBot 12 ${esc(tr('消息事件', 'message event'))} · message_id ${esc(ev.message_id)}</div>

      <div class="section-label" style="margin-top:13px">${esc(tr('消息段', 'Segments'))} <span class="count">${segs.length}</span></div>
      ${segHTML}
      ${segAddBar()}
      <div class="seg-note" style="margin-top:9px">${esc(tr('仅使用 OneBot 12 定义的消息段；图片、语音、文件等素材的名称 / 大小 / 时长存在本地文件表里，事件中只保留 file_id。', 'Only OneBot 12 segments are used; asset name / size / duration for images, voice and files live in the local file table, and events keep only file_id.'))}</div>
      <details class="json-block"><summary>${esc(tr('查看 OneBot 12 事件 JSON', 'View OneBot 12 event JSON'))}</summary><pre>${esc(JSON.stringify(ev, null, 2))}</pre></details>`;
  }

  function renderNoticeDetail(head, body, ev, s) {
    const meta = CM.NOTICE_META[ev.detail_type];
    const label = CM.noticeLabel(ev.detail_type);
    head.innerHTML = `
      <span class="dh-avatar" style="background:#eaf4ff;color:#0b84ff;font-weight:800">!</span>
      <div class="dh-main">
        <div class="dh-title">${esc(tr('系统提示 · {label}', 'System notice · {label}', { label }))}</div>
        <div class="dh-sub" id="dh-sub">${esc(CM.fmtAbs(ev.time))} · OneBot ${esc(tr('通知事件', 'notice event'))} · ${esc(ev.detail_type)}</div>
      </div>
      ${detailActions(ev, s)}`;

    const types = Object.keys(CM.NOTICE_META);
    if (!types.includes(ev.detail_type)) types.push(ev.detail_type);
    const subTypes = (meta ? meta.subTypes : []).slice();
    if (ev.sub_type && !subTypes.includes(ev.sub_type)) subTypes.push(ev.sub_type);
    const msgOptions = (s.events || [])
      .filter((e) => e.type === 'message')
      .map(
        (e) =>
          `<option value="${esc(e.message_id)}" ${String(e.message_id) === String(ev.message_id) ? 'selected' : ''}>${esc(CM.fmtClock(e.time))} ${esc(CM.charName(D(), e.user_id))}：${esc(truncate(CM.altMessage(e.message, D()), 26))}</option>`
      )
      .join('');
    body.innerHTML = `
      <div class="inline-fields">
        <label class="field"><span>detail_type</span><select class="select" data-bind="notice.detail_type">${types.map((t) => `<option value="${esc(t)}" ${t === ev.detail_type ? 'selected' : ''}>${esc(CM.noticeLabel(t))}</option>`).join('')}</select></label>
        <label class="field"><span>sub_type</span><select class="select" data-bind="notice.sub_type"><option value="" ${!ev.sub_type ? 'selected' : ''}>${esc(tr('（空）', '(empty)'))}</option>${subTypes.map((t) => `<option value="${esc(t)}" ${t === ev.sub_type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(tr('成员 user_id', 'Member user_id'))}</span><select class="select" data-bind="notice.user_id">${charOptions(ev.user_id, s, true)}</select></label>
        <label class="field"><span>${esc(tr('操作者 operator_id', 'Operator operator_id'))}</span><select class="select" data-bind="notice.operator_id">${charOptions(ev.operator_id, s, true)}</select></label>
        <label class="field"><span>${esc(tr('时间（本地）', 'Time (local)'))}</span><input class="input" type="datetime-local" step="60" data-bind="notice.time" value="${CM.toLocalInput(ev.time)}"></label>
        ${ev.detail_type === 'group_message_delete' ? `<label class="field"><span>${esc(tr('目标 message_id', 'Target message_id'))}</span><select class="select" data-bind="notice.message_id"><option value="">${esc(tr('选择消息…', 'Choose a message…'))}</option>${msgOptions}</select></label>` : ''}
      </div>
      <div class="seg-note" style="margin-top:10px">${esc(tr('标准 OneBot 12 群通知事件，在聊天页里渲染成居中的系统提示。', 'Standard OneBot 12 group notice event, rendered as a centered system message in the chat.'))}</div>
      <details class="json-block"><summary>${esc(tr('查看 OneBot 12 事件 JSON', 'View OneBot 12 event JSON'))}</summary><pre>${esc(JSON.stringify(ev, null, 2))}</pre></details>`;
  }

  function renderEmptyDetail(head, body, s) {
    head.innerHTML = `
      <span class="dh-avatar" style="background:#eef4ff;color:#0b84ff;font-size:17px">⌁</span>
      <div class="dh-main">
        <div class="dh-title">${esc(tr('详细编辑器', 'Detailed editor'))}</div>
        <div class="dh-sub">${esc(tr('选一条消息，或长按输入框新建', 'Select a message, or long-press the input to create one'))}</div>
      </div>`;
    const events = s.events || [];
    const recalled = recalledSet(s);
    const rows = events.length
      ? events
          .map((ev) => {
            const active = ev.id === S.selectedId;
            if (ev.type === 'notice') {
              return `<div class="flow-row${active ? ' active' : ''}" data-action="select-event" data-eid="${esc(ev.id)}">
                <span class="flow-time">${esc(shortTime(ev.time))}</span>
                <span class="flow-main"><span class="flow-who">${esc(tr('系统', 'System'))}</span> <span class="flow-text">${esc(truncate(CM.noticeText(D(), ev), 40))}</span></span>
                <span class="flow-kind">${esc(tr('通知', 'Notice'))}</span>
              </div>`;
            }
            const text = CM.altMessage(ev.message, D());
            const isRecalled = recalled.has(String(ev.message_id));
            return `<div class="flow-row${active ? ' active' : ''}" data-action="select-event" data-eid="${esc(ev.id)}">
              <span class="flow-time">${esc(shortTime(ev.time))}</span>
              <span class="flow-main"><span class="flow-who">${esc(CM.charName(D(), ev.user_id))}</span> <span class="flow-text">${esc(isRecalled ? tr('（已撤回）', '(recalled)') : truncate(text, 44) || tr('（空消息）', '(empty message)'))}</span></span>
              <span class="flow-kind">${esc(isRecalled ? tr('已撤回', 'Recalled') : tr('消息', 'Message'))}</span>
            </div>`;
          })
          .join('')
      : `<div class="seg-note" style="padding:10px 2px">${esc(tr('还没有消息。把角色拖到聊天页，或在下面新建一条。', 'No messages yet. Drag a character into the chat, or create one below.'))}</div>`;

    body.innerHTML = `
      <div class="detail-empty">
        <div class="empty-hero">
          <div class="empty-icon">＋</div>
          <div>
            <h3>${esc(tr('从聊天页开始编排', 'Compose from the chat page'))}</h3>
            <p>${esc(tr('输入框打字 + 发送就是直接编排；长按输入框进入这里的详细编辑，可以逐段添加图片、表情、语音、文件、位置和回复。所有字段只使用 OneBot 12 定义的内容。', 'Type and send in the composer to compose directly; long-press the input to open this detailed editor and add images, faces, voice, files, locations and replies segment by segment. All fields follow the OneBot 12 definitions.'))}</p>
          </div>
        </div>
        <div class="quick-actions">
          <button type="button" class="btn btn-sm btn-primary" data-action="new-message">${esc(tr('＋ 新建一条消息', '+ New message'))}</button>
          <button type="button" class="btn btn-sm" data-action="add-notice" ${s.detail_type === 'group' ? '' : 'disabled'}>${esc(tr('＋ 系统提示', '+ System notice'))}</button>
          <button type="button" class="btn btn-sm" data-action="sort-events">${esc(tr('按时间排序', 'Sort by time'))}</button>
        </div>
        <div class="meta-note">${esc(s.detail_type === 'group' ? tr('群聊', 'Group chat') : tr('私聊', 'Private chat'))} · ${s.detail_type === 'group' ? esc(tr('群号 {id}', 'Group ID {id}', { id: s.group_id || '—' })) + ' · ' + esc(tr('{n} 人', '{n} members', { n: s.member_count || 0 })) : esc(tr('对象 {name}', 'Peer {name}', { name: CM.charName(D(), s.user_id) }))} · ${esc(tr('{n} 个事件', '{n} events', { n: events.length }))}</div>
        <div class="section-label" style="margin-top:13px">${esc(tr('消息流', 'Message flow'))} <span class="count">${events.length}</span></div>
        <div class="flow">${rows}</div>
      </div>`;
  }

  function segmentEditor(seg, i, ev, s) {
    const d = (seg && seg.data) || {};
    const meta = CM.SEGMENT_META[seg.type] || { standard: false };
    const files = D().files || {};
    let body = '';
    let note = '';
    let spec = '';

    switch (seg.type) {
      case 'text':
        spec = 'data.text';
        body = `<textarea class="input" rows="3" data-esi="${i}" data-seg-field="text" placeholder="${esc(tr('输入文本，可换行', 'Type text; line breaks are allowed'))}">${esc(d.text || '')}</textarea>`;
        break;
      case 'mention':
        spec = 'data.user_id';
        body = `<label class="field"><span>${esc(tr('被提及的用户 user_id', 'Mentioned user user_id'))}</span><select class="select" data-esi="${i}" data-seg-field="user_id">${charOptions(d.user_id, s, true)}</select></label>`;
        note = tr('渲染为 @昵称；事件里只保存 user_id。', 'Rendered as @name; the event stores only user_id.');
        break;
      case 'mention_all':
        spec = tr('无参数', 'No parameters');
        body = `<div class="seg-note" style="margin-top:0">${esc(tr('标准消息段 mention_all，不带参数。', 'Standard mention_all segment with no parameters.'))}</div>`;
        break;
      case 'image': {
        spec = 'data.file_id';
        const f = files[d.file_id] || {};
        body = `<div class="media-edit">
          <div class="media-thumb">${f.dataUrl ? `<img src="${esc(f.dataUrl)}" alt="">` : esc(tr('无图', 'No image'))}</div>
          <div class="media-info">
            <div class="file-name">${esc(f.name || tr('未选择图片', 'No image selected'))}</div>
            <div class="mono">file_id: ${esc(d.file_id || '—')} · ${esc(CM.fmtBytes(f.size || 0))}</div>
            <div class="media-actions"><button type="button" class="chip-btn" data-action="pick-image" data-esi="${i}">${esc(tr('选择 / 替换图片', 'Choose / replace image'))}</button></div>
          </div>
        </div>`;
        note = tr('图片会压缩成 WebP 后存进本地文件表；消息段只带 file_id。', 'Images are compressed to WebP in the local file table; the segment only carries file_id.');
        break;
      }
      case 'voice': {
        spec = 'data.file_id';
        const f = files[d.file_id] || {};
        body = `<label class="field"><span>${esc(tr('时长（秒）', 'Duration (s)'))}</span><input class="input" type="number" min="1" max="60" step="1" data-esi="${i}" data-file-meta="duration" value="${Number(f.duration) || 3}"></label>`;
        note = tr('voice 段只保存 file_id；时长属于本地素材信息，不写进事件。', 'The voice segment stores only file_id; duration is local asset metadata and is not written into the event.');
        break;
      }
      case 'audio':
      case 'video': {
        spec = 'data.file_id';
        const f = files[d.file_id] || {};
        body = `<div class="inline-fields">
          <label class="field span-2"><span>${esc(tr('名称', 'Name'))}</span><input class="input" data-esi="${i}" data-file-meta="name" value="${esc(f.name || (seg.type === 'video' ? tr('视频', 'Video') : tr('音频', 'Audio')))}"></label>
          <label class="field"><span>${esc(tr('时长（秒）', 'Duration (s)'))}</span><input class="input" type="number" min="0" max="3600" step="1" data-esi="${i}" data-file-meta="duration" value="${Number(f.duration) || 0}"></label>
        </div>`;
        break;
      }
      case 'file': {
        spec = 'data.file_id';
        const f = files[d.file_id] || {};
        body = `<div class="inline-fields">
          <label class="field span-2"><span>${esc(tr('文件名', 'File name'))}</span><input class="input" data-esi="${i}" data-file-meta="name" value="${esc(f.name || '')}"></label>
          <label class="field"><span>${esc(tr('大小（KB）', 'Size (KB)'))}</span><input class="input" type="number" min="0" step="0.1" data-esi="${i}" data-file-meta="sizeKb" value="${((Number(f.size) || 0) / 1024).toFixed(1)}"></label>
        </div>`;
        break;
      }
      case 'location':
        spec = 'data.latitude / longitude / title / content';
        body = `<div class="inline-fields">
          <label class="field span-2"><span>${esc(tr('标题', 'Title'))}</span><input class="input" data-esi="${i}" data-seg-field="title" value="${esc(d.title || '')}"></label>
          <label class="field span-2"><span>${esc(tr('地址', 'Address'))}</span><input class="input" data-esi="${i}" data-seg-field="content" value="${esc(d.content || '')}"></label>
          <label class="field"><span>${esc(tr('纬度', 'Latitude'))}</span><input class="input" type="number" step="0.000001" data-esi="${i}" data-seg-field="latitude" value="${Number(d.latitude) || 0}"></label>
          <label class="field"><span>${esc(tr('经度', 'Longitude'))}</span><input class="input" type="number" step="0.000001" data-esi="${i}" data-seg-field="longitude" value="${Number(d.longitude) || 0}"></label>
        </div>`;
        break;
      case 'reply':
        spec = 'data.message_id / user_id';
        body = `<label class="field"><span>${esc(tr('回复的消息', 'Replied message'))}</span><select class="select" data-esi="${i}" data-seg-field="message_id">${replyOptions(ev, s, d.message_id)}</select></label>`;
        note = tr('reply 段同时保存 message_id 与 user_id，渲染成引用块。', 'The reply segment stores both message_id and user_id and renders as a quote block.');
        break;
      case 'qq.face': {
        spec = 'data.id';
        const face = CM.faceOf(d.id);
        body = `<div class="inline-fields">
          <label class="field"><span>${esc(tr('QQ 表情', 'QQ face'))}</span><select class="select" data-esi="${i}" data-seg-field="id">${CM.FACES.map((f) => `<option value="${f.id}" ${String(f.id) === String(d.id) ? 'selected' : ''}>${f.emoji} ${esc(CM.faceName(f.id))} · ${f.id}</option>`).join('')}</select></label>
          <div class="face-preview"><span class="emoji">${face.emoji}</span><span class="seg-note" style="margin:0">${esc(CM.faceName(d.id))} · id ${esc(face.id)}</span></div>
        </div>`;
        note = tr('扩展消息段，命名符合 OneBot 扩展规则（qq.face）。', 'Extended segment named per the OneBot extension rule (qq.face).');
        break;
      }
      default:
        spec = tr('未知扩展', 'Unknown extension');
        body = `<div class="seg-note" style="margin-top:0">${esc(tr('扩展消息段 {type}，本工具只渲染已知类型。', 'Extended segment {type}; this tool renders known types only.', { type: seg.type }))}</div>`;
    }

    return `<div class="seg">
      <div class="seg-head">
        <span class="seg-type ${meta.standard ? '' : 'ext'}">${esc(CM.segLabel(seg.type))}</span>
        <span class="seg-spec">${esc(spec)}</span>
        <div class="seg-tools">
          <button type="button" class="icon-btn sm" data-action="seg-up" data-esi="${i}" title="${esc(tr('上移消息段', 'Move segment up'))}">↑</button>
          <button type="button" class="icon-btn sm" data-action="seg-down" data-esi="${i}" title="${esc(tr('下移消息段', 'Move segment down'))}">↓</button>
          <button type="button" class="icon-btn sm" data-action="del-seg" data-esi="${i}" title="${esc(tr('删除消息段', 'Delete segment'))}">×</button>
        </div>
      </div>
      <div class="seg-body">${body}${note ? `<div class="seg-note">${esc(note)}</div>` : ''}</div>
    </div>`;
  }

  function segAddBar() {
    return `<div class="seg-add">
      <span class="seg-add-label">${esc(tr('添加消息段', 'Add segment'))}</span>
      <button type="button" class="chip-btn add" data-action="add-seg" data-type="text">${esc(tr('＋ 文本', '+ Text'))}</button>
      <button type="button" class="chip-btn add" data-action="add-seg" data-type="image">${esc(tr('＋ 图片', '+ Image'))}</button>
      <button type="button" class="chip-btn add" data-action="add-seg" data-type="qq.face">${esc(tr('＋ 表情', '+ Face'))}</button>
      <button type="button" class="chip-btn add" data-action="add-seg" data-type="mention">${esc(tr('＋ @', '+ @'))}</button>
      <select class="select" data-action="add-seg-select">
        <option value="">${esc(tr('更多标准消息段…', 'More standard segments…'))}</option>
        <option value="mention_all">${esc(tr('@全体成员', '@all'))}</option>
        <option value="voice">${esc(tr('语音', 'Voice'))}</option>
        <option value="audio">${esc(tr('音频', 'Audio'))}</option>
        <option value="video">${esc(tr('视频', 'Video'))}</option>
        <option value="file">${esc(tr('文件', 'File'))}</option>
        <option value="location">${esc(tr('位置', 'Location'))}</option>
        <option value="reply">${esc(tr('回复', 'Reply'))}</option>
      </select>
    </div>`;
  }

  function charOptions(selected, s, includeCurrent) {
    let list = allowedChars(s).slice();
    const id = String(selected || '');
    if (includeCurrent !== false && id && !list.some((c) => String(c.user_id) === id)) {
      list.push({ user_id: id, name: tr('用户 {id}', 'User {id}', { id }), avatar: '🙂', color: '#dfe4eb' });
    }
    return list
      .map((c) => {
        const self = String(c.user_id) === String(CM.selfId(D()));
        return `<option value="${esc(c.user_id)}" ${String(c.user_id) === id ? 'selected' : ''}>${esc(c.name)} · ${esc(c.user_id)}${self ? esc(tr('（本人）', ' (you)')) : ''}</option>`;
      })
      .join('');
  }

  function replyOptions(ev, s, selected) {
    const list = (s.events || []).filter((e) => e.type === 'message' && e.id !== ev.id);
    if (!list.length) return `<option value="">${esc(tr('没有可回复的消息', 'No messages to reply to'))}</option>`;
    return (
      `<option value="">${esc(tr('选择一条消息…', 'Choose a message…'))}</option>` +
      list
        .map(
          (e) =>
            `<option value="${esc(e.message_id)}" ${String(e.message_id) === String(selected) ? 'selected' : ''}>${esc(CM.fmtClock(e.time))} ${esc(CM.charName(D(), e.user_id))}：${esc(truncate(CM.altMessage(e.message, D()), 24))}</option>`
        )
        .join('')
    );
  }

  function gapText(ev, s) {
    const idx = (s.events || []).indexOf(ev);
    if (idx <= 0) return tr('会话中的第一条事件', 'First event in this conversation');
    const diff = (ev.time - s.events[idx - 1].time) / 60;
    const gap = diff < 0 ? '—' : tr('{n} 分钟', '{n} min', { n: Math.round(diff) });
    return tr('距上一条 {gap}', 'Gap after previous event: {gap}', { gap });
  }

  function truncate(str, n) {
    const text = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
    return Array.from(text).length > n ? Array.from(text).slice(0, n).join('') + '…' : text;
  }

  /* ------------------------------------------------------------------ */
  /* drawer                                                              */
  /* ------------------------------------------------------------------ */

  function openDrawer() {
    closeContextMenu();
    hideRolePop();
    document.body.classList.add('drawer-open');
    renderDrawer();
    const db = $('#drawer-body');
    if (db) db.scrollTop = 0;
  }

  function closeDrawer() {
    document.body.classList.remove('drawer-open');
  }

  function renderDrawer() {
    const body = $('#drawer-body');
    if (!body) return;
    const s = session();
    const st = D().settings;
    body.innerHTML =
      drawerNavSection() +
      drawerSessionSection(s) +
      drawerAppearanceSection(s, st) +
      drawerDataSection() +
      drawerAboutSection();
    updateSettingOutputs();
    updateUndoButtons();
    const sub = $('#drawer-sub');
    if (sub) {
      sub.textContent = CM.store.canUndo()
        ? tr('修改会自动保存在本机', 'Changes are saved automatically on this device')
        : tr('只保存在本机', 'Stored on this device only');
    }
  }

  function drawerNavSection() {
    const page = document.body.dataset.page || 'editor';
    const item = (href, key, title, desc) =>
      `<a class="nav-link${page === key ? ' active' : ''}" href="${href}">
        <span class="nav-link-title">${title}</span>
        <span class="nav-link-desc">${desc}</span>
      </a>`;
    return `<div class="drawer-section drawer-nav">
      <div class="drawer-section-title">${esc(tr('页面', 'Pages'))}</div>
      <div class="nav-grid">
        ${item('chat.html', 'chat', esc(tr('聊天页', 'Chat page')), esc(tr('直接编排', 'Direct compose')))}
        ${item('editor.html', 'editor', esc(tr('编辑页', 'Editor page')), esc(tr('角色池 + 消息段', 'Character pool + segments')))}
        ${item('index.html', 'shell', esc(tr('工作台', 'Workspace')), esc(tr('返回主页面', 'Back to home')))}
      </div>
    </div>`;
  }

  function drawerSessionSection(s) {
    const d = D();
    const peers = d.characters.filter((c) => String(c.user_id) !== String(CM.selfId(d)));
    const isGroup = s.detail_type === 'group';
    const peerOptions = peers
      .map(
        (c) =>
          `<option value="${esc(c.user_id)}" ${String(c.user_id) === String(s.user_id) ? 'selected' : ''}>${esc(c.name)} · ${esc(c.user_id)}</option>`
      )
      .join('');
    return `<div class="drawer-section">
      <div class="drawer-section-head">
        <div class="drawer-section-title">${esc(tr('会话', 'Sessions'))}</div>
        <span class="data-note" style="margin:0">${esc(tr('{n} 个', '{n} total', { n: d.sessions.length }))}</span>
      </div>
      <label class="field"><span>${esc(tr('切换会话', 'Switch session'))}</span><select class="select" id="drawer-session">${d.sessions
        .map(
          (x) =>
            `<option value="${esc(x.id)}" ${x.id === s.id ? 'selected' : ''}>${esc(x.title || tr('未命名', 'Untitled'))} · ${esc(x.detail_type === 'group' ? tr('群聊', 'Group chat') : tr('私聊', 'Private chat'))}</option>`
        )
        .join('')}</select></label>
      <div class="data-actions" style="margin-top:6px">
        <button type="button" class="btn btn-sm" data-action="new-session">${esc(tr('＋ 新建会话', '+ New session'))}</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="delete-session" ${d.sessions.length <= 1 ? 'disabled' : ''}>${esc(tr('删除当前', 'Delete current'))}</button>
      </div>
      <label class="field" style="margin-top:11px"><span>${esc(tr('聊天名称', 'Chat name'))}</span><input class="input" id="drawer-title-input" data-bind="session.title" value="${esc(s.title || '')}" placeholder="${esc(tr('聊天名称', 'Chat name'))}"></label>
      <div class="field-row">
        <label class="field"><span>${esc(tr('类型', 'Type'))}</span><select class="select" data-bind="session.detail_type"><option value="group" ${isGroup ? 'selected' : ''}>${esc(tr('群聊', 'Group chat'))}</option><option value="private" ${!isGroup ? 'selected' : ''}>${esc(tr('私聊', 'Private chat'))}</option></select></label>
        ${isGroup
          ? `<label class="field"><span>${esc(tr('成员数', 'Members'))}</span><input class="input" type="number" min="0" step="1" data-bind="session.member_count" value="${Number(s.member_count) || 0}"></label>`
          : `<label class="field"><span>${esc(tr('聊天对象', 'Chat peer'))}</span><select class="select" data-bind="session.user_id"><option value="">${esc(tr('选择角色…', 'Choose a character…'))}</option>${peerOptions}</select></label>`}
      </div>
      ${isGroup ? `<label class="field" style="margin-top:9px"><span>${esc(tr('群号', 'Group ID'))}</span><input class="input" data-bind="session.group_id" value="${esc(s.group_id || '')}" placeholder="${esc(tr('群号', 'Group ID'))}"></label>` : ''}
      <div class="drawer-note">${esc(tr('聊天名、群号、成员数只影响聊天页展示；OneBot 消息事件里不会保存这些字段。', 'Chat name, group ID and member count only affect the preview; OneBot message events do not store these fields.'))}</div>
    </div>`;
  }

  function drawerAppearanceSection(s, st) {
    return `<div class="drawer-section">
      <div class="drawer-section-head">
        <div class="drawer-section-title">${esc(tr('外观', 'Appearance'))}</div>
        <span class="data-note" style="margin:0">${esc(tr('实时预览', 'Live preview'))}</span>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('语言', 'Language'))}</div><div class="setting-desc">${esc(tr('界面与导出图的语言', 'Language of the interface and exported image'))}</div></div>
        <div class="setting-control"><div class="segctl"><button type="button" data-action="set-lang" data-lang="zh" class="${CM.i18n.lang === 'zh' ? 'active' : ''}">中文</button><button type="button" data-action="set-lang" data-lang="en" class="${CM.i18n.lang === 'en' ? 'active' : ''}">English</button></div></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('平台主题', 'Platform theme'))}</div><div class="setting-desc">${esc(tr('QQ / 微信的聊天页样式', 'QQ / WeChat chat style'))}</div></div>
        <div class="setting-control"><div class="segctl"><button type="button" data-action="set-platform" data-platform="qq" class="${st.platform === 'qq' ? 'active' : ''}">QQ</button><button type="button" data-action="set-platform" data-platform="wechat" class="${st.platform === 'wechat' ? 'active' : ''}">${esc(tr('微信', 'WeChat'))}</button></div></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('深浅模式', 'Light / dark mode'))}</div><div class="setting-desc">${esc(tr('聊天页与导出图一起切换', 'Switches the chat page and exports together'))}</div></div>
        <div class="setting-control"><div class="segctl"><button type="button" data-action="set-mode" data-mode="light" class="${st.mode === 'light' ? 'active' : ''}">${esc(tr('浅色', 'Light'))}</button><button type="button" data-action="set-mode" data-mode="dark" class="${st.mode === 'dark' ? 'active' : ''}">${esc(tr('深色', 'Dark'))}</button></div></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('聊天背景', 'Chat background'))}</div><div class="setting-desc">${esc(tr('留空使用主题默认色', 'Leave empty to use the theme default'))}</div></div>
        <div class="setting-control"><input type="color" data-bind="settings.backgroundTint" value="${st.backgroundTint || '#f2f4f7'}" aria-label="${esc(tr('聊天背景色', 'Chat background color'))}"><button type="button" class="btn btn-sm" data-action="reset-background">${esc(tr('默认', 'Default'))}</button></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('背景图片', 'Background image'))}</div><div class="setting-desc">${esc(tr('本地图片，导出时一起绘制', 'Local image, drawn into exports'))}</div></div>
        <div class="setting-control">${st.backgroundImage ? `<button type="button" class="btn btn-sm" data-action="remove-background">${esc(tr('移除', 'Remove'))}</button>` : ''}<button type="button" class="btn btn-sm" data-action="upload-background">${esc(tr('上传', 'Upload'))}</button></div>
      </div>
      ${st.backgroundImage ? `<div class="media-thumb" style="width:100%;height:88px;margin-top:6px"><img src="${esc(st.backgroundImage)}" alt=""></div>` : ''}
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('显示昵称', 'Show names'))}</div><div class="setting-desc">${esc(tr('群聊里别人消息上方的昵称', "Names above other people's messages in group chats"))}</div></div>
        <label class="switch"><input type="checkbox" data-bind="settings.showNames" ${st.showNames !== false ? 'checked' : ''}><span></span></label>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('字号', 'Font size'))}</div><div class="setting-desc">${esc(tr('气泡文字大小', 'Bubble text size'))}</div></div>
        <div class="setting-control"><input type="range" min="13" max="19" step="1" data-bind="settings.fontSize" value="${st.fontSize}"><span class="output-value" data-out="fontSize">${st.fontSize}</span></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('气泡最大宽度', 'Max bubble width'))}</div><div class="setting-desc">${esc(tr('相对 390px 逻辑宽度', 'Relative to the 390px design width'))}</div></div>
        <div class="setting-control"><input type="range" min="200" max="310" step="2" data-bind="settings.bubbleWidth" value="${st.bubbleWidth}"><span class="output-value" data-out="bubbleWidth">${st.bubbleWidth}</span></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('时间间隔', 'Time gap'))}</div><div class="setting-desc">${esc(tr('超过这个间隔就显示时间', 'Show a time divider after this gap'))}</div></div>
        <div class="setting-control"><select class="select" data-bind="settings.gapMinutes">${[0, 1, 3, 5, 10, 30, 60]
          .map((m) => `<option value="${m}" ${Number(st.gapMinutes) === m ? 'selected' : ''}>${m === 0 ? esc(tr('每条', 'Every message')) : esc(tr('{m} 分钟', '{m} min', { m }))}</option>`)
          .join('')}</select></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('状态栏时间', 'Status bar time'))}</div><div class="setting-desc">${esc(tr('留空则用最后一条消息的时间', 'Empty uses the last message time'))}</div></div>
        <div class="setting-control"><input class="input" maxlength="5" data-bind="settings.statusTime" value="${esc(st.statusTime || '')}" placeholder="${esc(tr('自动', 'Auto'))}"></div>
      </div>
      <div class="setting-row">
        <div class="setting-text"><div class="setting-name">${esc(tr('导出宽度', 'Export width'))}</div><div class="setting-desc">${esc(tr('导出图片时重新绘制，不是截屏', 'Redrawn for export, not a screenshot'))}</div></div>
        <div class="setting-control"><select class="select" data-bind="settings.exportWidth"><option value="720" ${Number(st.exportWidth) === 720 ? 'selected' : ''}>720 px</option><option value="1080" ${Number(st.exportWidth) === 1080 ? 'selected' : ''}>1080 px</option><option value="1440" ${Number(st.exportWidth) === 1440 ? 'selected' : ''}>1440 px</option></select></div>
      </div>
    </div>`;
  }

  function drawerDataSection() {
    const d = D();
    const bytes = CM.store.bytes();
    const quota = 5 * 1024 * 1024;
    const pct = Math.min(100, (bytes / quota) * 100);
    const files = Object.entries(d.files || {});
    const used = CM.usedFileIds(d);
    const unused = files.filter(([id]) => !used.has(id));
    const fileBytes = files.reduce((a, [, f]) => a + CM.byteSize(f.dataUrl || ''), 0);
    const events = d.sessions.reduce((a, s) => a + s.events.length, 0);
    const v = CM.validate(d);
    const issues = v.slice(0, 5);
    return `<div class="drawer-section">
      <div class="drawer-section-title">${esc(tr('本地数据', 'Local data'))}</div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value" id="stat-bytes">${esc(CM.fmtBytes(bytes))}</div><div class="stat-label">${esc(tr('本地占用', 'Storage used'))}</div></div>
        <div class="stat"><div class="stat-value" id="stat-files">${files.length}</div><div class="stat-label">${esc(tr('素材', 'Assets'))}</div></div>
        <div class="stat"><div class="stat-value" id="stat-events">${events}</div><div class="stat-label">${esc(tr('事件', 'Events'))}</div></div>
      </div>
      <div class="progress ${pct > 85 ? 'danger' : pct > 65 ? 'warn' : ''}"><span id="drawer-bar" style="width:${pct.toFixed(1)}%"></span></div>
      <div class="data-note" id="drawer-usage">${esc(tr('已用 {used} / 约 5 MB · 素材 {n} 个（{files}）', 'Used {used} / about 5 MB · {n} assets ({files})', { used: CM.fmtBytes(bytes), n: files.length, files: CM.fmtBytes(fileBytes) }))}</div>
      <div class="data-actions">
        <button type="button" class="btn btn-sm btn-dark" data-action="open-export">${esc(tr('导出图片', 'Export image'))}</button>
        <button type="button" class="btn btn-sm" data-action="export-json">${esc(tr('导出 JSON', 'Export JSON'))}</button>
        <button type="button" class="btn btn-sm" data-action="import-json">${esc(tr('导入 JSON', 'Import JSON'))}</button>
        <button type="button" class="btn btn-sm" data-action="undo">${esc(tr('撤销', 'Undo'))}</button>
        <button type="button" class="btn btn-sm" data-action="redo">${esc(tr('重做', 'Redo'))}</button>
      </div>
      <div class="data-actions">
        <button type="button" class="btn btn-sm" data-action="cleanup-files">${esc(unused.length ? tr('清理未引用素材（{n}）', 'Clean unused assets ({n})', { n: unused.length }) : tr('清理未引用素材', 'Clean unused assets'))}</button>
        <button type="button" class="btn btn-sm" data-action="reset-demo">${esc(tr('恢复示例', 'Restore demo'))}</button>
        <button type="button" class="btn btn-sm btn-danger" data-action="clear-data">${esc(tr('清空全部', 'Clear all'))}</button>
      </div>
      <div class="section-label" style="margin-top:16px">${esc(tr('数据校验', 'Validation'))} <span class="count">${esc(tr('{errors} 错误 / {warnings} 提示', '{errors} errors / {warnings} warnings', { errors: v.errors, warnings: v.warnings }))}</span></div>
      ${
        issues.length
          ? `<div class="issue-list">${issues
              .map((i) => `<div class="issue ${i.level}">${esc(i.text)}</div>`)
              .join('')}</div>${v.length > issues.length ? `<div class="data-note">${esc(tr('还有 {n} 条…', '{n} more…', { n: v.length - issues.length }))}</div>` : ''}`
          : `<div class="data-note">${esc(tr('没有发现结构问题；事件满足 OneBot 12 的基础字段要求。', 'No structural issues found; events meet the OneBot 12 baseline field requirements.'))}</div>`
      }
      <div class="data-note">${esc(tr('localStorage 通常约 5 MB，图片会自动压缩。JSON 备份包含角色、消息、素材数据和 OneBot 事件。', 'localStorage is usually about 5 MB and images are compressed automatically. JSON backups include characters, messages, asset data and OneBot events.'))}</div>
    </div>`;
  }

  function drawerAboutSection() {
    const example = {
      id: 'b6e65187-5ac0-489c-b431-53078e9d2bbb',
      self: { platform: 'qq', user_id: '10000' },
      time: 1790000000,
      type: 'message',
      detail_type: 'group',
      sub_type: '',
      message_id: '1001',
      message: [{ type: 'text', data: { text: '你好' } }],
      alt_message: '你好',
      user_id: '10001',
      group_id: '872341256',
    };
    return `<div class="drawer-section">
      <div class="drawer-section-title">${esc(tr('关于', 'About'))}</div>
      <div class="data-note" style="font-size:10.5px;line-height:1.8">
        ${tr(
          '聊天记录工坊 v{version}。纯本地运行：角色、消息、图片都保存在这个浏览器的 localStorage 里，不上传任何内容。事件和消息段使用 <b>OneBot 12</b> 的结构；QQ 表情是 OneBot 扩展规则允许的 <code>qq.face</code> 扩展消息段。',
          'Chatlog Studio v{version}. Runs fully locally: characters, messages and images stay in this browser\'s localStorage, and nothing is uploaded. Events and segments use the <b>OneBot 12</b> structure; QQ faces are the <code>qq.face</code> extended segment allowed by OneBot extension rules.',
          { version: CM.VERSION }
        )}
      </div>
      <details class="json-block">
        <summary>${esc(tr('OneBot 12 事件示例', 'Example OneBot 12 event'))}</summary>
        <pre>${esc(JSON.stringify(example, null, 2))}</pre>
      </details>
      <div class="data-note">${esc(tr('直接排版：在输入框选角色、打字、发送。详细编辑：长按输入框，或点击任意消息。快捷键：Ctrl+Z 撤销，Ctrl+Shift+Z 重做。', 'Direct compose: pick a character, type and send. Detailed edit: long-press the input or click any message. Shortcuts: Ctrl+Z undo, Ctrl+Shift+Z redo.'))}</div>
    </div>`;
  }

  function updateSettingOutputs() {
    const st = D().settings;
    $$('[data-out]').forEach((el) => {
      const key = el.dataset.out;
      const v = st[key];
      if (v == null) return;
      el.textContent = key === 'bubbleWidth' ? v + 'px' : String(v);
    });
  }

  /* ------------------------------------------------------------------ */
  /* preview                                                             */
  /* ------------------------------------------------------------------ */

  const schedulePreview = CM.debounce(() => renderPreview(), 60);

  async function renderPreview() {
    const token = ++S.previewToken;
    const s = session();
    if (!s) return null;
    const canvas = $('#preview-canvas');
    const wrap = $('#canvas-wrap');
    if (!canvas || !wrap) return null;
    const cssW = wrap.clientWidth || 390;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const scale = Math.max(0.5, (cssW / CM.DESIGN_WIDTH) * dpr);
    try {
      const layout = await CM.render.render(canvas, D(), s, {
        scale,
        selectedId: S.selectedId || '',
        includeHeader: false,
        includeStatus: false,
      });
      if (token !== S.previewToken) return null;
      S.previewLayout = layout;
      const meta = $('#preview-meta');
      if (meta) meta.textContent = '390 × ' + Math.round(layout.height + 94);
      return layout;
    } catch (err) {
      console.error(err);
      toast(err && err.message ? err.message : tr('预览绘制失败', 'Preview render failed'), true);
      return null;
    }
  }

  function scrollPreviewToEvent(id) {
    const layout = S.previewLayout;
    const canvas = $('#preview-canvas');
    const screen = $('#phone-screen');
    if (!layout || !canvas || !screen || !layout.session || layout.session.id !== session().id) return;
    const item = layout.items.find((i) => i.eventId === id);
    if (!item) return;
    const k = canvas.clientHeight / layout.height;
    const top = Math.max(0, item.y * k - 56);
    screen.scrollTo({ top, behavior: 'smooth' });
  }

  function scrollToBottom() {
    const screen = $('#phone-screen');
    if (!screen) return;
    screen.scrollTo({ top: screen.scrollHeight, behavior: 'smooth' });
  }

  /* ------------------------------------------------------------------ */
  /* event helpers                                                       */
  /* ------------------------------------------------------------------ */

  function makeMessage(d, ses, uid, time) {
    return {
      id: CM.uid('evt'),
      time,
      type: 'message',
      detail_type: ses.detail_type,
      sub_type: '',
      self: { platform: d.self.platform, user_id: d.self.user_id },
      message_id: String(CM.nextMessageId(d)),
      message: [{ type: 'text', data: { text: '' } }],
      alt_message: '',
      user_id: String(uid),
      ...(ses.detail_type === 'group' ? { group_id: String(ses.group_id) } : {}),
    };
  }

  function nextTime(events) {
    const last = [...(events || [])].reverse().find((e) => e && Number.isFinite(e.time));
    return last ? last.time + 60 : CM.nowSec();
  }

  function timeAt(events, index) {
    const prev = events[index - 1];
    const next = events[index];
    if (prev && next) return Math.round(((prev.time + next.time) / 2) * 10) / 10;
    if (prev) return prev.time + 60;
    if (next) return Math.max(1, next.time - 60);
    return CM.nowSec();
  }

  function cleanupFreshEmpty() {
    const id = S.freshEventId;
    S.freshEventId = null;
    if (!id) return;
    const ev = findEventById(D(), id);
    if (!ev || !isEmptyMessage(ev)) return;
    CM.store.commit(
      (d) => {
        const s = findSession(d, S.sessionId);
        if (!s) return;
        s.events = s.events.filter((e) => e.id !== id);
      },
      { history: false }
    );
  }

  function selectEvent(id, scroll) {
    if (S.freshEventId && S.freshEventId !== id) cleanupFreshEmpty();
    const s = session();
    const ev = (s.events || []).find((e) => e.id === id);
    if (!ev) return;
    S.selectedId = id;
    openDetailSheet();
    renderDetail();
    renderPreview().then(() => {
      if (scroll) scrollPreviewToEvent(id);
    });
  }

  function openDetailSheet() {
    closeContextMenu();
    if (!OVERLAY()) return;
    document.body.classList.remove('pool-open');
    document.body.classList.add('detail-open');
  }

  function closeDetail() {
    cleanupFreshEmpty();
    S.selectedId = null;
    document.body.classList.remove('detail-open');
    renderDetail();
    renderPreview();
  }

  function openPool() {
    closeContextMenu();
    hideRolePop();
    if (!OVERLAY()) {
      const p = $('#pool-panel');
      if (p) {
        p.classList.add('flash');
        setTimeout(() => p.classList.remove('flash'), 700);
        p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      return;
    }
    if (document.body.classList.contains('detail-open')) closeDetail();
    document.body.classList.add('pool-open');
    renderPool();
  }

  function closePool() {
    document.body.classList.remove('pool-open');
  }

  function closeSheets() {
    document.body.classList.remove('pool-open');
    if (document.body.classList.contains('detail-open')) closeDetail();
  }

  /* ------------------------------------------------------------------ */
  /* messages                                                            */
  /* ------------------------------------------------------------------ */

  function sendComposer() {
    const input = $('#composer-input');
    if (!input) return;
    const text = input.value;
    if (!text.trim()) return;
    cleanupFreshEmpty();
    ensureComposer();
    let created = null;
    CM.store.commit((d) => {
      const ses = findSession(d, S.sessionId);
      if (!ses) return;
      created = makeMessage(d, ses, S.composerUid, nextTime(ses.events));
      created.message = [{ type: 'text', data: { text } }];
      ses.events.push(created);
    });
    input.value = '';
    input.style.height = '';
    S.selectedId = null;
    S.freshEventId = null;
    document.body.classList.remove('detail-open');
    renderAll({ skipPreview: true });
    renderPreview().then(() => scrollToBottom());
    if (input) input.focus();
    updateComposer();
  }

  function openDetailedCompose(text) {
    cleanupFreshEmpty();
    ensureComposer();
    const input = $('#composer-input');
    const txt = text !== undefined ? String(text) : input ? input.value : '';
    let created = null;
    CM.store.commit((d) => {
      const ses = findSession(d, S.sessionId);
      if (!ses) return;
      created = makeMessage(d, ses, S.composerUid, nextTime(ses.events));
      created.message = [{ type: 'text', data: { text: txt } }];
      ses.events.push(created);
    });
    if (!created) return;
    if (input) {
      input.value = '';
      input.style.height = '';
    }
    S.selectedId = created.id;
    S.freshEventId = created.id;
    renderAll({ skipPreview: true });
    renderPreview().then(() => {
      openDetailSheet();
      scrollPreviewToEvent(created.id);
      setTimeout(() => focusSegment(0), 80);
    });
    updateComposer();
  }

  function insertMessageAt(index, uid) {
    const s = session();
    if (!s) return;
    if (s.detail_type === 'private' && !allowedChars(s).some((c) => String(c.user_id) === String(uid))) {
      toast(tr('私聊只能由本人或聊天对象发送', 'In a private chat, only you or the peer can send'), true);
      return;
    }
    cleanupFreshEmpty();
    let created = null;
    CM.store.commit((d) => {
      const ses = findSession(d, S.sessionId);
      const at = Math.max(0, Math.min(index, ses.events.length));
      created = makeMessage(d, ses, uid, timeAt(ses.events, at));
      ses.events.splice(at, 0, created);
    });
    if (!created) return;
    S.selectedId = created.id;
    S.freshEventId = created.id;
    renderAll({ skipPreview: true });
    renderPreview().then(() => {
      openDetailSheet();
      scrollPreviewToEvent(created.id);
      setTimeout(() => focusSegment(0), 80);
    });
  }

  function addNotice() {
    const s = session();
    if (!s) return;
    if (s.detail_type !== 'group') {
      toast(tr('OneBot 群通知只用于群聊会话', 'OneBot group notices are only for group chats'), true);
      return;
    }
    cleanupFreshEmpty();
    const user = String(firstOtherId(D()));
    let created = null;
    CM.store.commit((d) => {
      const ses = findSession(d, S.sessionId);
      created = {
        id: CM.uid('evt'),
        time: nextTime(ses.events),
        type: 'notice',
        detail_type: 'group_member_increase',
        sub_type: 'join',
        self: { platform: d.self.platform, user_id: d.self.user_id },
        group_id: String(ses.group_id || ''),
        user_id: user,
        operator_id: user,
      };
      ses.events.push(created);
    });
    S.selectedId = created.id;
    S.freshEventId = null;
    renderAll({ skipPreview: true });
    renderPreview().then(() => {
      openDetailSheet();
      scrollPreviewToEvent(created.id);
    });
  }

  function moveEvent(id, dir) {
    const s = session();
    const i = (s.events || []).findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= s.events.length) return;
    CM.store.commit((d) => {
      const ses = findSession(d, S.sessionId);
      const [ev] = ses.events.splice(i, 1);
      ses.events.splice(j, 0, ev);
      const prev = ses.events[j - 1];
      const next = ses.events[j + 1];
      if (prev && next) ev.time = Math.round(((prev.time + next.time) / 2) * 10) / 10;
      else if (prev) ev.time = prev.time + 60;
      else if (next) ev.time = Math.max(1, next.time - 60);
    });
    S.selectedId = id;
    renderDetail();
    renderPreview().then(() => scrollPreviewToEvent(id));
  }

  function duplicateEvent() {
    const ev = currentEvent();
    if (!ev) return;
    let copy = null;
    CM.store.commit((d) => {
      const ses = findSession(d, S.sessionId);
      const i = ses.events.findIndex((e) => e.id === ev.id);
      copy = CM.clone(ev);
      copy.id = CM.uid('evt');
      if (copy.type === 'message') copy.message_id = String(CM.nextMessageId(d));
      const prev = ses.events[i];
      const next = ses.events[i + 1];
      copy.time = next ? Math.round(((prev.time + next.time) / 2) * 10) / 10 : prev.time + 60;
      ses.events.splice(i + 1, 0, copy);
    });
    S.selectedId = copy.id;
    S.freshEventId = null;
    renderAll({ skipPreview: true });
    renderPreview().then(() => scrollPreviewToEvent(copy.id));
  }

  async function deleteEvent() {
    const ev = currentEvent();
    if (!ev) return;
    const fresh = S.freshEventId === ev.id;
    if (!fresh) {
      const ok = await confirmDialog({
        title: ['删除这条事件？', 'Delete this event?'],
        message:
          ev.type === 'message'
            ? ['消息会从对话里移除；可以用 Ctrl+Z 撤销。', 'The message will be removed from the chat; Ctrl+Z to undo.']
            : ['系统提示会从对话里移除；可以用 Ctrl+Z 撤销。', 'The system notice will be removed from the chat; Ctrl+Z to undo.'],
        confirmText: ['删除', 'Delete'],
      });
      if (!ok) return;
    }
    const s = session();
    const i = (s.events || []).findIndex((e) => e.id === ev.id);
    CM.store.commit((d) => {
      const ses = findSession(d, S.sessionId);
      ses.events.splice(i, 1);
    });
    S.freshEventId = null;
    const list = session().events;
    S.selectedId = list.length ? list[Math.min(i, list.length - 1)].id : null;
    document.body.classList.remove('detail-open');
    renderAll({ skipPreview: true });
    renderPreview();
  }

  function sortEvents() {
    CM.store.commit((d) => {
      const s = findSession(d, S.sessionId);
      s.events.sort((a, b) => a.time - b.time);
    });
    renderAll();
    toast(tr('已按时间排序', 'Sorted by time'));
  }

  /* ------------------------------------------------------------------ */
  /* segments                                                            */
  /* ------------------------------------------------------------------ */

  function addSegment(type) {
    const ev = currentEvent();
    if (!ev || ev.type !== 'message') return;
    if (type === 'reply') {
      const s = session();
      if (!(s.events || []).some((e) => e.type === 'message' && e.id !== ev.id)) {
        toast(tr('还没有可回复的消息', 'No messages to reply to yet'), true);
        return;
      }
    }
    let index = -1;
    CM.store.commit((d) => {
      const e = findEventById(d, ev.id);
      if (!e) return;
      const seg = makeSegment(d, e, type);
      e.message = e.message || [];
      e.message.push(seg);
      index = e.message.length - 1;
    });
    renderDetail();
    renderPreview();
    setTimeout(() => focusSegment(index), 60);
  }

  function makeSegment(d, ev, type) {
    const file = (props) => {
      const id = CM.uid('f');
      d.files = d.files || {};
      d.files[id] = props;
      return id;
    };
    switch (type) {
      case 'text':
        return { type: 'text', data: { text: '' } };
      case 'mention':
        return { type: 'mention', data: { user_id: String(firstOtherId(d)) } };
      case 'mention_all':
        return { type: 'mention_all', data: {} };
      case 'image':
        return { type: 'image', data: { file_id: file({ name: '', mime: 'image/webp', size: 0 }) } };
      case 'voice':
        return {
          type: 'voice',
          data: { file_id: file({ name: tr('语音', 'Voice'), mime: 'audio/ogg', size: 0, duration: 3 }) },
        };
      case 'audio':
        return {
          type: 'audio',
          data: { file_id: file({ name: tr('音频', 'Audio'), mime: 'audio/mpeg', size: 0, duration: 0 }) },
        };
      case 'video':
        return {
          type: 'video',
          data: { file_id: file({ name: tr('视频', 'Video'), mime: 'video/mp4', size: 0, duration: 0 }) },
        };
      case 'file':
        return {
          type: 'file',
          data: { file_id: file({ name: tr('未命名文件', 'Untitled file'), mime: 'application/octet-stream', size: 0 }) },
        };
      case 'location':
        return {
          type: 'location',
          data: { latitude: 0, longitude: 0, title: tr('位置', 'Location'), content: '' },
        };
      case 'reply': {
        const s = d.sessions.find((x) => x.events.includes(ev)) || session();
        const idx = s.events.indexOf(ev);
        const target =
          [...s.events.slice(0, idx)].reverse().find((x) => x.type === 'message') ||
          s.events.find((x) => x.type === 'message' && x.id !== ev.id);
        return {
          type: 'reply',
          data: {
            message_id: target ? String(target.message_id) : '',
            user_id: target ? String(target.user_id) : '',
          },
        };
      }
      case 'qq.face':
        return { type: 'qq.face', data: { id: '13' } };
      default:
        return { type: 'text', data: { text: '' } };
    }
  }

  function deleteSegment(i) {
    const ev = currentEvent();
    if (!ev || ev.type !== 'message') return;
    CM.store.commit((d) => {
      const e = findEventById(d, ev.id);
      if (e && e.message) e.message.splice(i, 1);
    });
    renderDetail();
    renderPreview();
  }

  function moveSegment(i, dir) {
    const ev = currentEvent();
    if (!ev || ev.type !== 'message') return;
    const j = i + dir;
    if (j < 0 || j >= ev.message.length) return;
    CM.store.commit((d) => {
      const e = findEventById(d, ev.id);
      if (!e || !e.message[j]) return;
      const [seg] = e.message.splice(i, 1);
      e.message.splice(j, 0, seg);
    });
    renderDetail();
    renderPreview();
  }

  function focusSegment(i) {
    const el = $('#detail-body .seg [data-esi="' + i + '"]');
    if (!el) return;
    const input = el.matches('input,textarea,select') ? el : el.querySelector('input,textarea,select');
    if (!input) return;
    input.focus();
    if (input.tagName === 'TEXTAREA' && input.setSelectionRange) {
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch (e) {}
    }
  }

  async function pickImageForSegment(esi) {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const out = await compressImage(file, 1280, 0.86);
      const ev = currentEvent();
      if (!ev || ev.type !== 'message') return;
      let fid = '';
      CM.store.commit((d) => {
        const e = findEventById(d, ev.id);
        const seg = e && e.message && e.message[esi];
        if (!seg) return;
        seg.data = seg.data || {};
        fid = seg.data.file_id || CM.uid('f');
        seg.data.file_id = fid;
        d.files[fid] = {
          name: file.name || tr('图片', 'Image'),
          mime: out.mime,
          size: out.size,
          dataUrl: out.dataUrl,
          width: out.width,
          height: out.height,
        };
      });
      renderDetail();
      renderPreview();
      toast(tr('图片已压缩并保存在本机', 'Image compressed and saved locally'));
    } catch (err) {
      toast(tr('图片读取失败：{message}', 'Failed to read image: {message}', { message: err && err.message ? err.message : err }), true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* field bindings                                                      */
  /* ------------------------------------------------------------------ */

  function handleField(el) {
    if (!el || !el.dataset) return;
    if (el.id === 'composer-input') return;
    if (el.dataset.bind) bindField(el);
    else if (el.dataset.segField) bindSegField(el);
    else if (el.dataset.fileMeta) bindFileMeta(el);
    if (el.tagName === 'TEXTAREA') autoGrow(el);
  }

  function bindField(el) {
    const path = el.dataset.bind;
    const s = session();
    const raw = el.type === 'checkbox' ? el.checked : el.value;

    if (path === 'session.title') {
      CM.store.live((d) => {
        const ses = findSession(d, S.sessionId);
        if (ses) ses.title = raw;
      });
      const t = $('#chat-title');
      if (t) t.textContent = raw || tr('未命名会话', 'Untitled chat');
      const sel = $('#drawer-session');
      if (sel) {
        const opt = Array.from(sel.options).find((o) => o.value === S.sessionId);
        if (opt) {
          opt.textContent =
            (raw || tr('未命名', 'Untitled')) +
            ' · ' +
            (s.detail_type === 'group' ? tr('群聊', 'Group chat') : tr('私聊', 'Private chat'));
        }
      }
      schedulePreview();
      return;
    }

    if (path === 'session.detail_type') {
      const type = raw;
      if (type === 'private' && !D().characters.some((c) => String(c.user_id) !== String(CM.selfId(D())))) {
        toast(tr('先添加一个角色，再切换为私聊', 'Add a character before switching to a private chat'), true);
        renderDrawer();
        return;
      }
      CM.store.commit((d) => {
        const ses = findSession(d, S.sessionId);
        if (!ses) return;
        ses.detail_type = type;
        if (type === 'private') {
          ses.group_id = '';
          ses.member_count = 0;
          if (!ses.user_id || String(ses.user_id) === String(CM.selfId(d))) ses.user_id = String(firstOtherId(d));
        } else {
          ses.user_id = '';
          if (!ses.group_id) ses.group_id = randomGroupId();
          if (!ses.member_count) ses.member_count = 8;
        }
      });
      S.selectedId = null;
      S.freshEventId = null;
      document.body.classList.remove('detail-open');
      ensureComposer();
      renderAll();
      return;
    }

    if (path === 'session.group_id') {
      CM.store.live((d) => {
        const ses = findSession(d, S.sessionId);
        if (ses) ses.group_id = raw;
      });
      schedulePreview();
      return;
    }
    if (path === 'session.member_count') {
      CM.store.live((d) => {
        const ses = findSession(d, S.sessionId);
        if (ses) ses.member_count = Math.max(0, Number(raw) || 0);
      });
      renderPhoneChrome();
      schedulePreview();
      return;
    }
    if (path === 'session.user_id') {
      CM.store.live((d) => {
        const ses = findSession(d, S.sessionId);
        if (ses) ses.user_id = raw;
      });
      ensureComposer();
      updateComposer();
      renderPool();
      renderPhoneChrome();
      schedulePreview();
      return;
    }

    if (path === 'character.name') {
      const uid = el.dataset.uid;
      CM.store.live((d) => {
        const c = CM.charOf(d, uid);
        if (c) c.name = raw;
      });
      refreshCharName(uid, raw);
      updateComposer();
      renderDetail();
      schedulePreview();
      return;
    }

    if (path.startsWith('settings.')) {
      const key = path.slice(9);
      let v = raw;
      if (el.type === 'checkbox') v = !!raw;
      if (['fontSize', 'bubbleWidth', 'gapMinutes', 'exportWidth'].includes(key)) v = Number(raw);
      CM.store.live((d) => {
        d.settings[key] = v;
      });
      updateSettingOutputs();
      if (key === 'statusTime') renderPhoneChrome();
      if (key === 'showNames' || key === 'fontSize' || key === 'bubbleWidth' || key === 'gapMinutes' || key === 'backgroundTint') {
        renderPhoneChrome();
        schedulePreview();
      }
      return;
    }

    if (path === 'event.time') {
      const ts = CM.fromLocalInput(raw);
      if (ts == null) return;
      CM.store.live((d) => {
        const e = findEventById(d, S.selectedId);
        if (e) e.time = ts;
      });
      updateDetailSub();
      renderPhoneChrome();
      schedulePreview();
      return;
    }
    if (path === 'event.user_id') {
      CM.store.live((d) => {
        const e = findEventById(d, S.selectedId);
        if (e) e.user_id = raw;
      });
      renderDetail();
      schedulePreview();
      return;
    }

    if (path === 'notice.detail_type') {
      CM.store.commit((d) => {
        const e = findEventById(d, S.selectedId);
        if (!e) return;
        e.detail_type = raw;
        const meta = CM.NOTICE_META[raw];
        e.sub_type = meta ? meta.subTypes[0] : '';
        if (raw === 'group_message_delete') {
          const ses = d.sessions.find((x) => x.events.includes(e));
          const msgs = (ses ? ses.events : []).filter((x) => x.type === 'message');
          const t = msgs[msgs.length - 1];
          if (t) {
            e.message_id = t.message_id;
            e.user_id = t.user_id;
            e.operator_id = t.user_id;
          }
        }
      });
      renderDetail();
      schedulePreview();
      return;
    }
    if (path === 'notice.sub_type' || path === 'notice.user_id' || path === 'notice.operator_id') {
      const key = path.split('.')[1];
      CM.store.live((d) => {
        const e = findEventById(d, S.selectedId);
        if (e) e[key] = raw;
      });
      schedulePreview();
      return;
    }
    if (path === 'notice.time') {
      const ts = CM.fromLocalInput(raw);
      if (ts == null) return;
      CM.store.live((d) => {
        const e = findEventById(d, S.selectedId);
        if (e) e.time = ts;
      });
      updateDetailSub();
      renderPhoneChrome();
      schedulePreview();
      return;
    }
    if (path === 'notice.message_id') {
      CM.store.live((d) => {
        const e = findEventById(d, S.selectedId);
        if (!e) return;
        e.message_id = raw;
        const ses = d.sessions.find((x) => x.events.includes(e));
        const target = (ses ? ses.events : []).find(
          (x) => x.type === 'message' && String(x.message_id) === String(raw)
        );
        if (target) e.user_id = target.user_id;
      });
      renderDetail();
      schedulePreview();
      return;
    }
  }

  function bindSegField(el) {
    const ev = currentEvent();
    if (!ev || ev.type !== 'message') return;
    const i = Number(el.dataset.esi);
    const field = el.dataset.segField;
    let value = el.type === 'number' ? Number(el.value) : el.value;
    if (field === 'latitude' || field === 'longitude') value = Number(value) || 0;
    CM.store.live((d) => {
      const e = findEventById(d, ev.id);
      if (!e || !e.message || !e.message[i]) return;
      const seg = e.message[i];
      seg.data = seg.data || {};
      seg.data[field] = value;
      if (field === 'message_id') {
        const ses = d.sessions.find((x) => x.events.includes(e));
        const target = (ses ? ses.events : []).find(
          (x) => x.type === 'message' && String(x.message_id) === String(value)
        );
        if (target) seg.data.user_id = target.user_id;
      }
    });
    if (field === 'message_id') renderDetail();
    schedulePreview();
  }

  function bindFileMeta(el) {
    const ev = currentEvent();
    if (!ev || ev.type !== 'message') return;
    const i = Number(el.dataset.esi);
    const key = el.dataset.fileMeta;
    let value = el.value;
    if (key === 'duration') value = Math.max(0, Number(value) || 0);
    if (key === 'sizeKb') value = Math.max(0, Math.round((Number(value) || 0) * 1024));
    CM.store.live((d) => {
      const e = findEventById(d, ev.id);
      if (!e || !e.message || !e.message[i]) return;
      const fid = e.message[i].data && e.message[i].data.file_id;
      if (!fid) return;
      if (!d.files[fid]) d.files[fid] = { name: '', size: 0 };
      const f = d.files[fid];
      if (key === 'sizeKb') f.size = value;
      else if (key === 'duration') f.duration = value;
      else f.name = value;
    });
    schedulePreview();
  }

  function refreshCharName(uid, name) {
    $$('[data-char-name="' + uid + '"]').forEach((el) => {
      el.textContent = name;
    });
  }

  function autoGrow(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = Math.min(420, el.scrollHeight + 2) + 'px';
  }

  /* ------------------------------------------------------------------ */
  /* composer                                                            */
  /* ------------------------------------------------------------------ */

  function renderRolePop() {
    const s = session();
    const list = allowedChars(s);
    const pop = $('#role-pop');
    if (!pop) return;
    pop.innerHTML = list.length
      ? list
          .map((c) => {
            const active = String(c.user_id) === String(S.composerUid);
            return `<button type="button" class="role-pop-row${active ? ' active' : ''}" data-action="pick-role" data-uid="${esc(c.user_id)}">
              <span class="role-pop-avatar" style="background:${esc(c.color)}">${avatarHTML(c)}</span>
              <span><span class="role-pop-name">${esc(c.name)}</span><span class="role-pop-id">#${esc(c.user_id)}</span></span>
              ${active ? '<span class="role-pop-check">✓</span>' : ''}
            </button>`;
          })
          .join('')
      : `<div class="data-note" style="padding:8px">${esc(tr('没有可用的角色', 'No available characters'))}</div>`;
  }

  function toggleRolePop() {
    S.rolePopOpen = !S.rolePopOpen;
    const pop = $('#role-pop');
    if (!pop) return;
    if (S.rolePopOpen) renderRolePop();
    pop.hidden = !S.rolePopOpen;
  }

  function hideRolePop() {
    S.rolePopOpen = false;
    const pop = $('#role-pop');
    if (pop) pop.hidden = true;
  }

  function pickRole(uid) {
    const s = session();
    if (!allowedChars(s).some((c) => String(c.user_id) === String(uid))) {
      toast(tr('私聊只能由本人或聊天对象发送', 'In a private chat, only you or the peer can send'), true);
      return;
    }
    S.composerUid = String(uid);
    saveUI();
    hideRolePop();
    updateComposer();
    renderPool();
    const input = $('#composer-input');
    if (input) input.focus();
    return true;
  }

  function startLongPress(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    S.longPressStart = { x: e.clientX, y: e.clientY };
    clearTimeout(S.longPressTimer);
    S.longPressTimer = setTimeout(() => {
      S.longPressTimer = 0;
      if (!S.longPressStart) return;
      S.longPressStart = null;
      const input = $('#composer-input');
      if (input) openDetailedCompose(input.value);
    }, 560);
  }

  function moveLongPress(e) {
    if (!S.longPressStart) return;
    if (Math.abs(e.clientX - S.longPressStart.x) > 9 || Math.abs(e.clientY - S.longPressStart.y) > 9) {
      cancelLongPress();
    }
  }

  function cancelLongPress() {
    clearTimeout(S.longPressTimer);
    S.longPressTimer = 0;
    S.longPressStart = null;
  }

  /* ------------------------------------------------------------------ */
  /* context menu (right click + long press)                             */
  /* ------------------------------------------------------------------ */

  const CTX_SHEET = () => window.matchMedia('(max-width: 760px)').matches;

  function previewEventAt(clientY) {
    const canvas = $('#preview-canvas');
    const layout = S.previewLayout;
    if (!canvas || !layout) return null;
    const rect = canvas.getBoundingClientRect();
    const y = ((clientY - rect.top) / Math.max(1, rect.height)) * layout.height;
    return layout.items.find((i) => i.eventId && y >= i.y && y <= i.y + i.h) || null;
  }

  function ctxItemHTML(action, icon, label, opts) {
    const o = opts || {};
    return `<button type="button" class="ctx-item${o.danger ? ' danger' : ''}" role="menuitem" data-ctx-action="${action}"${o.disabled ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}><span class="ctx-ico" aria-hidden="true">${icon}</span><span class="ctx-label">${esc(label)}</span></button>`;
  }

  function ensureContextMenu() {
    let menu = $('#ctx-menu');
    let back = $('#ctx-backdrop');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'ctx-menu';
      menu.className = 'ctx-menu';
      menu.hidden = true;
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-hidden', 'true');
      document.body.appendChild(menu);
      menu.addEventListener('click', (e) => {
        const item = e.target.closest('[data-ctx-action]');
        if (!item || item.disabled) return;
        e.preventDefault();
        runContextAction(item.dataset.ctxAction);
      });
      menu.addEventListener('keydown', (e) => {
        if (!S.ctx) return;
        const items = $$('#ctx-menu .ctx-item:not(:disabled)');
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          items[(i + 1) % items.length].focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          items[(i - 1 + items.length) % items.length].focus();
        }
      });
    }
    if (!back) {
      back = document.createElement('div');
      back.id = 'ctx-backdrop';
      back.className = 'ctx-backdrop';
      back.hidden = true;
      back.setAttribute('aria-hidden', 'true');
      document.body.appendChild(back);
      back.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        closeContextMenu();
      });
    }
    return menu;
  }

  function renderContextMenu() {
    const ctx = S.ctx;
    if (!ctx) return;
    const menu = ensureContextMenu();
    const d = D();
    if (ctx.kind === 'event') {
      const s = session();
      const ev = (s.events || []).find((e) => e.id === ctx.id);
      if (!ev) {
        S.ctx = null;
        return;
      }
      const idx = s.events.indexOf(ev);
      const notice = ev.type !== 'message';
      const ch = notice ? null : CM.charOf(d, ev.user_id);
      const who = notice ? tr('系统提示', 'System notice') : CM.charName(d, ev.user_id);
      const text = notice ? CM.noticeText(d, ev) : CM.altMessage(ev.message, d);
      const kind = notice ? tr('通知', 'Notice') : tr('消息', 'Message');
      const canCopy = !!(text && String(text).trim());
      const av = notice
        ? `<span class="ctx-avatar notice" aria-hidden="true">⌁</span>`
        : `<span class="ctx-avatar" style="background:${esc(ch ? ch.color : '#93b4ff')}" aria-hidden="true">${avatarHTML(ch)}</span>`;
      menu.innerHTML =
        `<div class="ctx-head">${av}<div class="ctx-head-main"><div class="ctx-title">${esc(who)}</div><div class="ctx-sub">${esc(CM.fmtClock(ev.time))} · ${esc(kind)}${canCopy ? ` · ${esc(text)}` : ''}</div></div></div>` +
        ctxItemHTML('edit', '✎', tr('详细编辑', 'Edit details')) +
        ctxItemHTML('copy', '⧉', tr('复制文本', 'Copy text'), { disabled: !canCopy }) +
        ctxItemHTML('duplicate', '＋', tr('复制', 'Duplicate')) +
        `<div class="ctx-sep"></div>` +
        ctxItemHTML('up', '↑', tr('上移', 'Move up'), { disabled: idx <= 0 }) +
        ctxItemHTML('down', '↓', tr('下移', 'Move down'), { disabled: idx >= s.events.length - 1 }) +
        `<div class="ctx-sep"></div>` +
        ctxItemHTML('delete', '×', notice ? tr('删除通知', 'Delete notice') : tr('删除消息', 'Delete message'), { danger: true });
    } else if (ctx.kind === 'character') {
      const ch = CM.charOf(d, ctx.uid);
      if (!ch) {
        S.ctx = null;
        return;
      }
      const s = session();
      const canSend = allowedChars(s).some((c) => String(c.user_id) === String(ctx.uid));
      const isSelf = String(ctx.uid) === String(CM.selfId(d));
      const refs = countCharRefs(d, ctx.uid);
      const av = `<span class="ctx-avatar" style="background:${esc(ch.color)}" aria-hidden="true">${avatarHTML(ch)}</span>`;
      const delTitle = isSelf
        ? tr('本人角色不能删除', 'The self character cannot be deleted')
        : refs > 0
          ? tr('仍被 {n} 处引用，不能删除', 'Referenced {n} times; cannot delete', { n: refs })
          : '';
      menu.innerHTML =
        `<div class="ctx-head">${av}<div class="ctx-head-main"><div class="ctx-title">${esc(ch.name)}</div><div class="ctx-sub">#${esc(ch.user_id)}${isSelf ? ' · ' + esc(tr('本人', 'You')) : ''}</div></div></div>` +
        ctxItemHTML('sender', '✓', tr('设为发送身份', 'Set as sender'), {
          disabled: !canSend,
          title: canSend ? '' : tr('私聊只能由本人或聊天对象发送', 'In a private chat, only you or the peer can send'),
        }) +
        ctxItemHTML('insert', '＋', tr('插入一条消息', 'Insert message'), { disabled: !canSend }) +
        `<div class="ctx-sep"></div>` +
        ctxItemHTML('char-edit', '✎', tr('编辑角色', 'Edit character')) +
        ctxItemHTML('char-delete', '×', tr('删除角色', 'Delete character'), {
          danger: true,
          title: delTitle,
        });
    }
    menu.setAttribute('aria-label', tr('操作', 'Actions'));
  }

  function showContextMenu(x, y) {
    const menu = ensureContextMenu();
    const back = $('#ctx-backdrop');
    const sheet = CTX_SHEET();
    menu.hidden = false;
    menu.setAttribute('aria-hidden', 'false');
    if (back) back.hidden = !sheet;
    document.body.classList.add('ctx-open');
    menu.style.left = '';
    menu.style.top = '';
    if (!sheet) {
      const pad = 8;
      const w = menu.offsetWidth;
      const h = menu.offsetHeight;
      menu.style.left = Math.max(pad, Math.min(x, window.innerWidth - w - pad)) + 'px';
      menu.style.top = Math.max(pad, Math.min(y, window.innerHeight - h - pad)) + 'px';
    }
    S.ctxOpenedAt = Date.now();
    const first = menu.querySelector('.ctx-item:not(:disabled)');
    if (first) {
      try {
        first.focus({ preventScroll: true });
      } catch (e) {
        first.focus();
      }
    }
  }

  function openEventMenu(id, x, y) {
    if (!id) return;
    if (S.ctx && S.ctx.kind === 'event' && S.ctx.id === String(id) && Date.now() - S.ctxOpenedAt < 600) return;
    S.ctx = { kind: 'event', id: String(id) };
    S.ctxPrevFocus = document.activeElement;
    renderContextMenu();
    if (!S.ctx) return;
    showContextMenu(x, y);
  }

  function openCharacterMenu(uid, x, y) {
    if (!uid) return;
    if (S.ctx && S.ctx.kind === 'character' && S.ctx.uid === String(uid) && Date.now() - S.ctxOpenedAt < 600) return;
    S.ctx = { kind: 'character', uid: String(uid) };
    S.ctxPrevFocus = document.activeElement;
    renderContextMenu();
    if (!S.ctx) return;
    showContextMenu(x, y);
  }

  function closeContextMenu() {
    const menu = $('#ctx-menu');
    const back = $('#ctx-backdrop');
    if (!S.ctx && (!menu || menu.hidden)) return;
    if (menu) {
      menu.hidden = true;
      menu.setAttribute('aria-hidden', 'true');
    }
    if (back) back.hidden = true;
    document.body.classList.remove('ctx-open');
    S.ctx = null;
    const prev = S.ctxPrevFocus;
    S.ctxPrevFocus = null;
    if (prev && prev.focus && document.contains(prev)) {
      try {
        prev.focus({ preventScroll: true });
      } catch (e) {}
    }
  }

  function selectForMenu(id) {
    if (S.selectedId === id) return;
    S.selectedId = id;
    renderDetail();
    renderPreview();
  }

  function eventPlainText(ev) {
    if (!ev) return '';
    return ev.type === 'message' ? CM.altMessage(ev.message, D()) || '' : CM.noticeText(D(), ev) || '';
  }

  function fallbackCopy(value, done) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {}
    ta.remove();
    if (ok) done();
    else toast(tr('复制失败', 'Copy failed'), true);
  }

  function copyPlainText(text) {
    const value = String(text || '').trim();
    if (!value) {
      toast(tr('没有可复制的文本', 'No text to copy'), true);
      return;
    }
    const done = () => toast(tr('已复制文本', 'Text copied'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, () => fallbackCopy(value, done));
    } else {
      fallbackCopy(value, done);
    }
  }

  function runContextAction(action) {
    const ctx = S.ctx;
    if (!ctx) return;
    closeContextMenu();
    if (ctx.kind === 'event') {
      const ev = (session().events || []).find((e) => e.id === ctx.id);
      if (!ev) return;
      if (action === 'edit') {
        selectEvent(ctx.id, false);
        return;
      }
      if (action === 'copy') {
        copyPlainText(eventPlainText(ev));
        return;
      }
      selectForMenu(ctx.id);
      if (action === 'duplicate') duplicateEvent();
      else if (action === 'up') moveEvent(ctx.id, -1);
      else if (action === 'down') moveEvent(ctx.id, 1);
      else if (action === 'delete') deleteEvent();
      return;
    }
    if (ctx.kind === 'character') {
      if (action === 'sender') {
        if (pickRole(ctx.uid) && OVERLAY()) closePool();
      } else if (action === 'insert') {
        insertMessageAt(session().events.length, ctx.uid);
      } else if (action === 'char-edit') {
        openCharacterModal(ctx.uid, false);
      } else if (action === 'char-delete') {
        deleteCharacter(ctx.uid);
      }
    }
  }

  function startHold(e) {
    if (S.ctx) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    let kind = '';
    let id = '';
    let uid = '';
    const canvas = e.target.closest ? e.target.closest('#preview-canvas') : null;
    if (canvas) {
      const item = previewEventAt(e.clientY);
      if (!item) return;
      kind = 'event';
      id = item.eventId;
    } else {
      const row = e.target.closest ? e.target.closest('.flow-row[data-eid]') : null;
      if (row) {
        kind = 'event';
        id = row.dataset.eid;
      } else {
        const card = e.target.closest ? e.target.closest('.pool-card[data-uid]') : null;
        if (card) {
          kind = 'character';
          uid = card.dataset.uid;
        }
      }
    }
    if (!kind) return;
    clearHold();
    S.hold = {
      x: e.clientX,
      y: e.clientY,
      kind,
      id,
      uid,
      timer: setTimeout(() => {
        const h = S.hold;
        if (!h) return;
        S.hold = null;
        S.suppressClickAt = Date.now();
        if (h.kind === 'event') openEventMenu(h.id, h.x, h.y);
        else openCharacterMenu(h.uid, h.x, h.y);
      }, 520),
    };
  }

  function clearHold() {
    if (S.hold && S.hold.timer) clearTimeout(S.hold.timer);
    S.hold = null;
  }

  function moveHold(e) {
    if (!S.hold) return;
    if (Math.abs(e.clientX - S.hold.x) > 9 || Math.abs(e.clientY - S.hold.y) > 9) clearHold();
  }

  function endHold() {
    clearHold();
  }

  /* ------------------------------------------------------------------ */
  /* sessions                                                            */
  /* ------------------------------------------------------------------ */

  function selectSession(id) {
    if (!D().sessions.some((s) => s.id === id)) return;
    closeContextMenu();
    cleanupFreshEmpty();
    hideRolePop();
    S.sessionId = id;
    S.selectedId = null;
    S.freshEventId = null;
    document.body.classList.remove('detail-open', 'pool-open');
    ensureComposer();
    saveUI();
    renderAll();
    const screen = $('#phone-screen');
    if (screen) screen.scrollTop = 0;
  }

  function newSession() {
    cleanupFreshEmpty();
    let id = '';
    CM.store.commit((d) => {
      const s = {
        id: CM.uid('sess'),
        title: tr('新群聊', 'New group chat'),
        detail_type: 'group',
        group_id: randomGroupId(),
        user_id: '',
        member_count: 8,
        avatar: '👥',
        events: [],
      };
      d.sessions.push(s);
      id = s.id;
    });
    S.sessionId = id;
    S.selectedId = null;
    S.freshEventId = null;
    ensureComposer();
    saveUI();
    hideRolePop();
    document.body.classList.remove('detail-open', 'pool-open');
    renderAll();
    setTimeout(() => {
      const el = $('#drawer-title-input');
      if (el) {
        el.focus();
        el.select();
      }
    }, 70);
  }

  async function deleteSession() {
    const d = D();
    if (d.sessions.length <= 1) {
      toast(tr('至少保留一个会话', 'Keep at least one session'), true);
      return;
    }
    const s = session();
    const ok = await confirmDialog({
      title: ['删除会话？', 'Delete this session?'],
      message: function () {
        return tr('「{title}」里的消息会一起删除；可以用 Ctrl+Z 撤销。', 'Messages in "{title}" will be deleted too; Ctrl+Z to undo.', {
          title: s.title || tr('未命名', 'Untitled'),
        });
      },
      confirmText: ['删除会话', 'Delete session'],
    });
    if (!ok) return;
    CM.store.commit((dd) => {
      dd.sessions = dd.sessions.filter((x) => x.id !== s.id);
    });
    cleanupFreshEmpty();
    S.sessionId = D().sessions[0].id;
    S.selectedId = null;
    S.freshEventId = null;
    ensureComposer();
    saveUI();
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* characters                                                          */
  /* ------------------------------------------------------------------ */

  function newCharacter() {
    const d = D();
    const used = new Set(d.characters.map((c) => String(c.user_id)));
    let id = 10001;
    while (used.has(String(id))) id++;
    const c = {
      user_id: String(id),
      name: tr('新角色', 'New character'),
      avatar: CM.EMOJIS[id % CM.EMOJIS.length],
      avatarImage: '',
      color: CM.AVATAR_COLORS[id % CM.AVATAR_COLORS.length],
    };
    CM.store.commit((dd) => {
      dd.characters.push(c);
    });
    renderAll();
    openCharacterModal(c.user_id, true);
  }

  function openCharacterModal(uid, focus) {
    const ch = CM.charOf(D(), uid);
    if (!ch) return;
    const isSelf = String(uid) === String(CM.selfId(D()));
    const refs = countCharRefs(D(), uid);
    openModal(
      `<div class="modal-head">
        <div><div class="modal-title">${esc(tr('编辑角色', 'Edit character'))}</div><div class="modal-sub">${esc(tr('只影响展示；消息事件里保存的是 user_id。', 'Display only; message events store user_id.'))}</div></div>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="${esc(tr('关闭', 'Close'))}">×</button>
      </div>
      <div class="char-top">
        <div class="char-big" id="char-big" style="background:${esc(ch.color)}">${avatarHTML(ch)}</div>
        <div class="char-top-meta">
          <div class="char-top-name" data-char-name="${esc(uid)}">${esc(ch.name)}</div>
          <div class="char-top-id">user_id ${esc(uid)}${isSelf ? ' · ' + esc(tr('本人', 'You')) : ''}</div>
          <div class="char-top-id">${esc(isSelf ? tr('本人角色不能删除', 'The self character cannot be deleted') : tr('拖到聊天页可以插入 TA 的消息', 'Drag into the chat to insert their messages'))}</div>
        </div>
      </div>
      <div class="form-grid">
        <label class="field span-2"><span>${esc(tr('昵称', 'Nickname'))}</span><input class="input" id="char-name-input" data-bind="character.name" data-uid="${esc(uid)}" value="${esc(ch.name)}" placeholder="${esc(tr('角色昵称', 'Character name'))}"></label>
        <label class="field span-2"><span>${esc(tr('user_id（创建后不可改）', 'user_id (cannot be changed after creation)'))}</span><input class="input" readonly value="${esc(uid)}"></label>
        <div class="field span-2"><span>${esc(tr('头像表情', 'Avatar emoji'))}</span><div class="emoji-grid">${CM.EMOJIS.map((e) => `<button type="button" class="emoji-cell ${!ch.avatarImage && ch.avatar === e ? 'active' : ''}" data-action="set-avatar-emoji" data-emoji="${e}">${e}</button>`).join('')}</div></div>
        <div class="field span-2"><span>${esc(tr('头像底色', 'Avatar background'))}</span><div class="swatches">${CM.AVATAR_COLORS.map((c) => `<button type="button" class="swatch ${ch.color === c ? 'active' : ''}" style="background:${c}" data-action="set-avatar-color" data-color="${c}" aria-label="${c}"></button>`).join('')}</div></div>
        <div class="span-2 media-actions">
          <button type="button" class="btn btn-sm" data-action="upload-avatar">${esc(tr('上传头像图片', 'Upload avatar image'))}</button>
          <button type="button" class="btn btn-sm" data-action="remove-avatar">${esc(tr('移除图片', 'Remove image'))}</button>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-sm btn-danger" data-action="delete-character" ${isSelf ? 'disabled' : ''}>${esc(tr('删除角色', 'Delete character'))}</button>
        <span class="spacer"></span>
        <span class="data-note" style="margin:0">${esc(refs ? tr('仍被 {n} 处引用', 'Referenced {n} times', { n: refs }) : tr('未被消息引用', 'Not referenced by messages'))}</span>
        <button type="button" class="btn" data-action="close-modal">${esc(tr('完成', 'Done'))}</button>
      </div>`,
      { kind: 'character', uid }
    );
    if (focus) {
      setTimeout(() => {
        const el = $('#char-name-input');
        if (el) {
          el.focus();
          el.select();
        }
      }, 60);
    }
  }

  function countCharRefs(d, uid) {
    let n = 0;
    (d.sessions || []).forEach((s) =>
      (s.events || []).forEach((ev) => {
        if (String(ev.user_id) === String(uid)) n++;
        if (String(ev.operator_id) === String(uid)) n++;
        if (ev.type === 'message') {
          (ev.message || []).forEach((seg) => {
            if (seg.type === 'reply' && String(seg.data && seg.data.user_id) === String(uid)) n++;
          });
        }
      })
    );
    return n;
  }

  async function deleteCharacter(uid) {
    const d = D();
    if (!uid) return;
    if (String(uid) === String(CM.selfId(d))) {
      toast(tr('本人角色不能删除', 'The self character cannot be deleted'), true);
      return;
    }
    const refs = countCharRefs(d, uid);
    if (refs > 0) {
      toast(tr('这个角色还被 {n} 处消息或通知引用，先改派或删除再试', 'This character is still referenced by {n} messages or notices; reassign or delete them first.', { n: refs }), true);
      return;
    }
    const ok = await confirmDialog({
      title: ['删除角色？', 'Delete this character?'],
      message: function () {
        return tr('确定删除「{name}」？', 'Delete "{name}"?', { name: CM.charName(d, uid) });
      },
      confirmText: ['删除角色', 'Delete character'],
    });
    if (!ok) return;
    CM.store.commit((dd) => {
      dd.characters = dd.characters.filter((c) => String(c.user_id) !== String(uid));
    });
    if (String(S.composerUid) === String(uid)) S.composerUid = CM.selfId(D());
    closeModal();
    ensureComposer();
    renderAll();
    toast(tr('已删除角色', 'Character deleted'));
  }

  function setAvatarEmoji(emoji) {
    const uid = S.modalUid;
    if (!uid) return;
    CM.store.commit((d) => {
      const c = CM.charOf(d, uid);
      if (c) {
        c.avatar = emoji;
        c.avatarImage = '';
      }
    });
    renderAll();
    openCharacterModal(uid, false);
  }

  function setAvatarColor(color) {
    const uid = S.modalUid;
    if (!uid) return;
    CM.store.commit((d) => {
      const c = CM.charOf(d, uid);
      if (c) c.color = color;
    });
    renderAll();
    openCharacterModal(uid, false);
  }

  async function uploadAvatar() {
    const uid = S.modalUid;
    if (!uid) return;
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const out = await compressImage(file, 240, 0.86);
      CM.store.commit((d) => {
        const c = CM.charOf(d, uid);
        if (c) c.avatarImage = out.dataUrl;
      });
      renderAll();
      openCharacterModal(uid, false);
    } catch (err) {
      toast(tr('头像读取失败', 'Failed to read avatar'), true);
    }
  }

  function removeAvatar() {
    const uid = S.modalUid;
    if (!uid) return;
    CM.store.commit((d) => {
      const c = CM.charOf(d, uid);
      if (c) c.avatarImage = '';
    });
    renderAll();
    openCharacterModal(uid, false);
  }

  /* ------------------------------------------------------------------ */
  /* theme / settings                                                    */
  /* ------------------------------------------------------------------ */

  function setPlatform(p) {
    if (D().settings.platform === p) return;
    CM.store.commit((d) => {
      d.settings.platform = p;
      d.self.platform = p;
    });
    renderAll();
  }

  function setMode(mode) {
    if (D().settings.mode === mode) return;
    CM.store.commit((d) => {
      d.settings.mode = mode;
    });
    renderAll();
  }

  function toggleMode() {
    setMode(D().settings.mode === 'dark' ? 'light' : 'dark');
  }

  function resetBackground() {
    CM.store.commit((d) => {
      d.settings.backgroundTint = '';
    });
    renderAll();
  }

  async function uploadBackground() {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const out = await compressImage(file, 1600, 0.8);
      CM.store.commit((d) => {
        d.settings.backgroundImage = out.dataUrl;
      });
      renderAll();
      toast(tr('背景图已保存到本机', 'Background saved locally'));
    } catch (err) {
      toast(tr('背景图读取失败', 'Failed to read background image'), true);
    }
  }

  function removeBackground() {
    CM.store.commit((d) => {
      d.settings.backgroundImage = '';
    });
    renderAll();
  }

  /* ------------------------------------------------------------------ */
  /* data                                                                */
  /* ------------------------------------------------------------------ */

  function exportJson() {
    const d = D();
    const json = JSON.stringify(d, null, 2);
    const stamp = fileStamp();
    downloadBlob(new Blob([json], { type: 'application/json' }), 'mock_chatui-backup-' + stamp + '.json');
    toast(tr('已导出 JSON 备份', 'JSON backup exported'));
  }

  async function importJson() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.characters)) {
        throw new Error(tr('不是本工具的备份（缺少 sessions / characters）', 'Not a Chatlog Studio backup (missing sessions / characters)'));
      }
      CM.store.replace(parsed);
      CM.render.clearCache();
      S.sessionId = D().sessions[0].id;
      S.selectedId = null;
      S.freshEventId = null;
      ensureComposer();
      saveUI();
      document.body.classList.remove('detail-open', 'pool-open');
      renderAll();
      toast(tr('已导入本地数据', 'Local data imported'));
    } catch (err) {
      toast(tr('导入失败：{message}', 'Import failed: {message}', { message: err && err.message ? err.message : err }), true);
    }
  }

  async function resetDemo() {
    const ok = await confirmDialog({
      title: ['恢复示例数据？', 'Restore demo data?'],
      message: ['当前角色、会话和消息会被示例替换；可以用 Ctrl+Z 撤销。', 'Current characters, sessions and messages will be replaced by the demo; Ctrl+Z to undo.'],
      confirmText: ['恢复示例', 'Restore demo'],
    });
    if (!ok) return;
    CM.store.replace(CM.buildDemo());
    CM.render.clearCache();
    S.sessionId = D().sessions[0].id;
    S.selectedId = null;
    S.freshEventId = null;
    ensureComposer();
    saveUI();
    document.body.classList.remove('detail-open', 'pool-open');
    renderAll();
    toast(tr('已恢复示例', 'Demo restored'));
  }

  async function clearData() {
    const ok = await confirmDialog({
      title: ['清空全部数据？', 'Clear all data?'],
      message: ['角色、会话、消息和图片都会从本机移除；可以用 Ctrl+Z 撤销。', 'Characters, sessions, messages and images will be removed from this device; Ctrl+Z to undo.'],
      confirmText: ['清空', 'Clear'],
    });
    if (!ok) return;
    CM.store.replace(CM.emptyDataset());
    CM.render.clearCache();
    S.sessionId = D().sessions[0].id;
    S.selectedId = null;
    S.freshEventId = null;
    ensureComposer();
    saveUI();
    document.body.classList.remove('detail-open', 'pool-open');
    renderAll();
    toast(tr('已清空', 'Cleared'));
  }

  function cleanupFiles() {
    const d = D();
    const used = CM.usedFileIds(d);
    const unused = Object.keys(d.files || {}).filter((id) => !used.has(id));
    if (!unused.length) {
      toast(tr('没有未引用的素材', 'No unused assets'));
      return;
    }
    CM.store.commit((dd) => {
      unused.forEach((id) => delete dd.files[id]);
    });
    renderAll();
    toast(tr('已清理 {n} 个未引用素材', 'Removed {n} unused assets', { n: unused.length }));
  }

  /* ------------------------------------------------------------------ */
  /* export                                                              */
  /* ------------------------------------------------------------------ */

  async function openExport() {
    const s = session();
    if (!s) return;
    hideRolePop();
    await CM.render.prepare(D());
    if (S.exportInfo) revokeExport();
    const st = D().settings;
    openModal(
      `<div class="modal-head">
        <div><div class="modal-title">${esc(tr('导出为图片', 'Export as image'))}</div><div class="modal-sub">${esc(tr('Canvas 本地重新绘制，不经过网络；输出 PNG。', 'Redrawn locally on Canvas with no network; outputs PNG.'))}</div></div>
        <button type="button" class="icon-btn" data-action="close-modal" aria-label="${esc(tr('关闭', 'Close'))}">×</button>
      </div>
      <div class="export-form">
        <div class="export-row">
          <div class="setting-text"><div class="setting-name">${esc(tr('图片宽度', 'Image width'))}</div><div class="setting-desc">${esc(tr('按 390px 逻辑宽度等比放大，文字重新光栅化。', 'Scaled proportionally from the 390px design width; text is re-rasterized.'))}</div></div>
          <select class="select" id="export-width" style="width:120px">
            <option value="720" ${Number(st.exportWidth) === 720 ? 'selected' : ''}>720 px</option>
            <option value="1080" ${Number(st.exportWidth) === 1080 ? 'selected' : ''}>1080 px</option>
            <option value="1440" ${Number(st.exportWidth) === 1440 ? 'selected' : ''}>1440 px</option>
          </select>
        </div>
        <div class="export-row">
          <div class="setting-text"><div class="setting-name">${esc(tr('包含顶部标题栏', 'Include top header'))}</div><div class="setting-desc">${esc(tr('状态栏 + 聊天标题', 'Status bar + chat title'))}</div></div>
          <label class="switch"><input type="checkbox" id="export-header" ${st.showHeader !== false ? 'checked' : ''}><span></span></label>
        </div>
        <div class="export-row">
          <div class="setting-text"><div class="setting-name">${esc(tr('包含状态栏', 'Include status bar'))}</div><div class="setting-desc">${esc(tr('顶部时间与信号图标', 'Time and signal icons at the top'))}</div></div>
          <label class="switch"><input type="checkbox" id="export-status" ${st.showStatus !== false ? 'checked' : ''}><span></span></label>
        </div>
        <div class="export-row">
          <div class="setting-text"><div class="setting-name">${esc(tr('预计尺寸', 'Estimated size'))}</div><div class="setting-desc">${esc(tr('实际以生成结果为准', 'Actual size depends on the generated result'))}</div></div>
          <span class="output-value" id="export-size" style="min-width:120px">—</span>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">${esc(tr('取消', 'Cancel'))}</button>
        <button type="button" class="btn btn-primary" data-action="generate-export">${esc(tr('生成图片', 'Generate image'))}</button>
      </div>
      <div id="export-result" hidden></div>`,
      { kind: 'export' }
    );
    updateExportEstimate();
  }

  function updateExportEstimate() {
    const wEl = $('#export-width');
    if (!wEl) return;
    const width = Number(wEl.value) || 1080;
    const header = $('#export-header');
    const status = $('#export-status');
    if (status) status.disabled = !(header && header.checked);
    const includeHeader = !header || header.checked;
    const includeStatus = includeHeader && (!status || status.checked);
    const s = session();
    if (!s) return;
    const layout = CM.render.layout(D(), s, { includeHeader, includeStatus });
    const h = Math.round((layout.height * width) / CM.DESIGN_WIDTH);
    const el = $('#export-size');
    if (el) el.textContent = width + ' × ' + h + ' px';
  }

  async function generateExport() {
    const s = session();
    if (!s) return;
    const btn = $('[data-action="generate-export"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = tr('生成中…', 'Generating…');
    }
    try {
      const width = Number(($('#export-width') || {}).value) || 1080;
      const header = $('#export-header');
      const status = $('#export-status');
      const includeHeader = !header || header.checked;
      const includeStatus = includeHeader && (!status || status.checked);
      const out = await CM.render.exportCanvas(D(), s, { width, includeHeader, includeStatus });
      const blob = await CM.render.canvasToBlob(out.canvas);
      if (!blob) throw new Error(tr('PNG 编码失败', 'PNG encoding failed'));
      if (S.exportInfo) revokeExport();
      const url = URL.createObjectURL(blob);
      S.exportInfo = {
        url,
        blob,
        filename: tr('聊天记录-', 'mock_chatui-') + safeName(s.title || 'chat') + '-' + fileStamp() + '.png',
      };
      const box = $('#export-result');
      if (box) {
        box.hidden = false;
        box.innerHTML = `<div class="export-preview"><img src="${url}" alt="${esc(tr('导出预览', 'Export preview'))}"></div>
          <div class="export-meta"><span>${out.width} × ${out.height} px · ${esc(CM.fmtBytes(blob.size))}</span><span class="export-actions"><button type="button" class="btn btn-sm btn-primary" data-action="download-export">${esc(tr('下载 PNG', 'Download PNG'))}</button><button type="button" class="btn btn-sm" data-action="copy-export">${esc(tr('复制图片', 'Copy image'))}</button></span></div>`;
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = tr('重新生成', 'Regenerate');
      }
    } catch (err) {
      toast(tr('导出失败：{message}', 'Export failed: {message}', { message: err && err.message ? err.message : err }), true);
      if (btn) {
        btn.disabled = false;
        btn.textContent = tr('生成图片', 'Generate image');
      }
    }
  }

  function downloadExport() {
    if (!S.exportInfo) return;
    const a = document.createElement('a');
    a.href = S.exportInfo.url;
    a.download = S.exportInfo.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast(tr('已开始下载 PNG', 'PNG download started'));
  }

  async function copyExport() {
    if (!S.exportInfo) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error(tr('不支持剪贴板', 'Clipboard not supported'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': S.exportInfo.blob })]);
      toast(tr('已复制图片到剪贴板', 'Image copied to clipboard'));
    } catch (err) {
      toast(tr('浏览器不允许复制图片，请下载 PNG', 'The browser does not allow copying images; please download the PNG'), true);
    }
  }

  function revokeExport() {
    if (!S.exportInfo) return;
    URL.revokeObjectURL(S.exportInfo.url);
    S.exportInfo = null;
  }

  function safeName(s) {
    return String(s || 'chat').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  }

  function fileStamp() {
    const d = new Date();
    return (
      d.getFullYear() +
      CM.pad(d.getMonth() + 1) +
      CM.pad(d.getDate()) +
      '-' +
      CM.pad(d.getHours()) +
      CM.pad(d.getMinutes())
    );
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  /* ------------------------------------------------------------------ */
  /* files                                                               */
  /* ------------------------------------------------------------------ */

  let filePickerHandler = null;

  function pickFile(accept) {
    const input = $('#file-input');
    if (!input) return Promise.resolve(null);
    if (filePickerHandler) input.removeEventListener('change', filePickerHandler);
    return new Promise((resolve) => {
      filePickerHandler = () => {
        input.removeEventListener('change', filePickerHandler);
        filePickerHandler = null;
        resolve(input.files && input.files[0] ? input.files[0] : null);
      };
      input.accept = accept || '';
      input.value = '';
      input.addEventListener('change', filePickerHandler);
      input.click();
    });
  }

  function loadImageEl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(tr('图片读取失败', 'Failed to read image')));
      img.src = url;
    });
  }

  async function compressImage(file, maxSide, quality) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageEl(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/webp', quality);
      const mime = dataUrl.indexOf('data:image/webp') === 0 ? 'image/webp' : 'image/png';
      return { dataUrl, mime, size: CM.byteSize(dataUrl), width: w, height: h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ------------------------------------------------------------------ */
  /* drag & drop                                                         */
  /* ------------------------------------------------------------------ */

  function updateDrop(clientY) {
    const layout = S.previewLayout;
    const s = session();
    if (!layout || !layout.session || layout.session.id !== s.id) {
      S.dropIndex = s.events.length;
      return;
    }
    const canvas = $('#preview-canvas');
    const line = $('#drop-line');
    if (!canvas || !line) return;
    const rect = canvas.getBoundingClientRect();
    const designY = Math.max(0, ((clientY - rect.top) / Math.max(1, rect.height)) * layout.height);
    const msgs = layout.items.filter((i) => i.kind === 'msg');
    let target = null;
    for (const m of msgs) {
      if (designY < m.y + m.h / 2) {
        target = m;
        break;
      }
    }
    S.dropIndex = target ? target.eventIndex : s.events.length;
    let y = 10;
    if (target) y = target.y - 4;
    else if (msgs.length) {
      const last = msgs[msgs.length - 1];
      y = last.y + last.h + 4;
    } else {
      y = 22;
    }
    const k = rect.height / layout.height;
    line.style.top = Math.max(0, y * k) + 'px';
    line.hidden = false;
  }

  function cleanupDrag() {
    S.drag = null;
    S.dropIndex = null;
    document.body.classList.remove('is-dragging');
    const line = $('#drop-line');
    if (line) line.hidden = true;
  }

  /* ------------------------------------------------------------------ */
  /* modal / confirm / toast                                             */
  /* ------------------------------------------------------------------ */

  function openModal(html, opts) {
    opts = opts || {};
    const dlg = $('#modal');
    if (!dlg) return;
    dlg.classList.toggle('wide', !!opts.wide);
    dlg.innerHTML = '<div class="modal-card">' + html + '</div>';
    S.modalKind = opts.kind || '';
    S.modalUid = opts.uid || '';
    if (!dlg.open) dlg.showModal();
  }

  function closeModal() {
    const dlg = $('#modal');
    if (dlg && dlg.open) dlg.close();
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      S.confirmResolve = resolve;
      S.confirmOpts = opts;
      openConfirmModal(opts);
    });
  }

  /** Resolve a confirm-dialog string that may be a zh/en pair or a function,
      so re-rendering after a language switch uses the current language. */
  function localizeConfirm(value, vars) {
    if (typeof value === 'function') return String(value());
    if (Array.isArray(value)) return tr(value[0], value[1], vars);
    return value == null ? '' : String(value);
  }

  function openConfirmModal(opts) {
    const vars = opts.vars || null;
    const title = localizeConfirm(opts.title, vars) || tr('确认', 'Confirm');
    const message = localizeConfirm(opts.message, vars);
    const confirmText = localizeConfirm(opts.confirmText, vars) || tr('确认', 'Confirm');
    openModal(
      `<div class="modal-head">
        <div><div class="modal-title">${esc(title)}</div><div class="modal-sub">${esc(message)}</div></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="confirm-no">${esc(tr('取消', 'Cancel'))}</button>
        <button type="button" class="btn ${opts.danger === false ? 'btn-primary' : 'btn-danger'}" data-action="confirm-yes">${esc(confirmText)}</button>
      </div>`,
      { kind: 'confirm' }
    );
  }

  function finishConfirm(value) {
    const resolve = S.confirmResolve;
    S.confirmResolve = null;
    if (S.modalKind === 'confirm') {
      S.modalKind = '';
      S.confirmOpts = null;
      const dlg = $('#modal');
      if (dlg && dlg.open) dlg.close();
    }
    if (resolve) resolve(value);
  }

  let toastTimer = 0;
  function toast(message, isError) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }

  function onSaveStatus(info) {
    S.saveStatus = info;
    const el = $('#save-status');
    if (el) {
      el.textContent = info.ok
        ? tr('已保存 · {time}', 'Saved · {time}', { time: CM.fmtClock(Date.now() / 1000) })
        : tr('未保存：{message}', 'Not saved: {message}', { message: info.message || tr('错误', 'Error') });
      el.className = 'save-status ' + (info.ok ? 'ok' : 'error');
      el.title = tr('本地存储 {size}', 'Local storage {size}', { size: CM.fmtBytes(info.bytes) });
    }
    const sub = $('#drawer-sub');
    if (sub) {
      sub.textContent = info.ok
        ? tr('已保存到本机 · {size}', 'Saved locally · {size}', { size: CM.fmtBytes(info.bytes) })
        : tr('保存失败：{message}', 'Save failed: {message}', { message: info.message || tr('错误', 'Error') });
    }
    const bar = $('#drawer-bar');
    const usage = $('#drawer-usage');
    const quota = 5 * 1024 * 1024;
    const pct = Math.min(100, (info.bytes / quota) * 100);
    if (bar) bar.style.width = pct.toFixed(1) + '%';
    if (usage) {
      usage.textContent = tr(
        '已用 {used} / 约 5 MB · 素材 {n} 个',
        'Used {used} / about 5 MB · {n} assets',
        { used: CM.fmtBytes(info.bytes), n: Object.keys(D().files || {}).length }
      );
    }
    const sb = $('#stat-bytes');
    if (sb) sb.textContent = CM.fmtBytes(info.bytes);
    if (!info.ok && !S.saveWarned) {
      S.saveWarned = true;
      toast(
        tr('本地保存失败：{message}', 'Local save failed: {message}', {
          message: info.message || tr('容量不足', 'Storage full'),
        }),
        true
      );
    }
    if (info.ok) S.saveWarned = false;
  }

  /* ------------------------------------------------------------------ */
  /* actions                                                             */
  /* ------------------------------------------------------------------ */

  function handleAction(action, el) {
    switch (action) {
      case 'set-platform':
        setPlatform(el.dataset.platform);
        break;
      case 'set-mode':
        setMode(el.dataset.mode);
        break;
      case 'toggle-mode':
        toggleMode();
        break;
      case 'set-lang':
        CM.i18n.set(el.dataset.lang);
        break;
      case 'undo':
        undo();
        break;
      case 'redo':
        redo();
        break;
      case 'open-drawer':
        openDrawer();
        break;
      case 'close-drawer':
        closeDrawer();
        break;
      case 'open-pool':
        openPool();
        break;
      case 'close-pool':
        closePool();
        break;
      case 'close-sheets':
        closeSheets();
        break;
      case 'close-detail':
        closeDetail();
        break;
      case 'select-event':
        selectEvent(el.dataset.eid, true);
        break;
      case 'pick-role':
        pickRole(el.dataset.uid);
        break;
      case 'pick-composer-role':
        if (Date.now() - S.suppressClickAt < 420) return;
        if (pickRole(el.dataset.uid) && OVERLAY()) closePool();
        break;
      case 'edit-character':
        if (Date.now() - S.suppressClickAt < 420) return;
        openCharacterModal(el.dataset.uid, false);
        break;
      case 'new-character':
        newCharacter();
        break;
      case 'send-message':
        sendComposer();
        break;
      case 'detailed-compose':
        openDetailedCompose(($('#composer-input') || {}).value || '');
        break;
      case 'new-message':
        openDetailedCompose('');
        break;
      case 'open-export':
        openExport();
        break;
      case 'generate-export':
        generateExport();
        break;
      case 'download-export':
        downloadExport();
        break;
      case 'copy-export':
        copyExport();
        break;
      case 'new-session':
        newSession();
        break;
      case 'delete-session':
        deleteSession();
        break;
      case 'add-notice':
        addNotice();
        break;
      case 'sort-events':
        sortEvents();
        break;
      case 'move-event':
        moveEvent(S.selectedId, Number(el.dataset.dir));
        break;
      case 'duplicate-event':
        duplicateEvent();
        break;
      case 'delete-event':
        deleteEvent();
        break;
      case 'add-seg':
        addSegment(el.dataset.type);
        break;
      case 'del-seg':
        deleteSegment(Number(el.dataset.esi));
        break;
      case 'seg-up':
        moveSegment(Number(el.dataset.esi), -1);
        break;
      case 'seg-down':
        moveSegment(Number(el.dataset.esi), 1);
        break;
      case 'pick-image':
        pickImageForSegment(Number(el.dataset.esi));
        break;
      case 'set-avatar-emoji':
        setAvatarEmoji(el.dataset.emoji);
        break;
      case 'set-avatar-color':
        setAvatarColor(el.dataset.color);
        break;
      case 'upload-avatar':
        uploadAvatar();
        break;
      case 'remove-avatar':
        removeAvatar();
        break;
      case 'delete-character':
        deleteCharacter(S.modalUid);
        break;
      case 'upload-background':
        uploadBackground();
        break;
      case 'remove-background':
        removeBackground();
        break;
      case 'reset-background':
        resetBackground();
        break;
      case 'export-json':
        exportJson();
        break;
      case 'import-json':
        importJson();
        break;
      case 'cleanup-files':
        cleanupFiles();
        break;
      case 'reset-demo':
        resetDemo();
        break;
      case 'clear-data':
        clearData();
        break;
      case 'close-modal':
        closeModal();
        break;
      case 'confirm-yes':
        finishConfirm(true);
        break;
      case 'confirm-no':
        finishConfirm(false);
        break;
      default:
        break;
    }
  }

  function undo() {
    if (!CM.store.undo()) return;
    S.freshEventId = null;
    if (S.selectedId && !findEventById(D(), S.selectedId)) S.selectedId = null;
    ensureSession();
    ensureComposer();
    renderAll();
    toast(tr('已撤销', 'Undone'));
  }

  function redo() {
    if (!CM.store.redo()) return;
    S.freshEventId = null;
    if (S.selectedId && !findEventById(D(), S.selectedId)) S.selectedId = null;
    ensureSession();
    ensureComposer();
    renderAll();
    toast(tr('已重做', 'Redone'));
  }

  /* ------------------------------------------------------------------ */
  /* events wiring                                                       */
  /* ------------------------------------------------------------------ */

  function bind() {
    document.addEventListener('click', (e) => {
      if (Date.now() - S.suppressClickAt < 420) return;
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;
      if (action === 'add-seg-select') return;
      if (action === 'toggle-role-pop') {
        toggleRolePop();
        return;
      }
      handleAction(action, el);
    });

    document.addEventListener('click', (e) => {
      if (!S.rolePopOpen) return;
      if (e.target.closest('#role-pop') || e.target.closest('#role-btn')) return;
      hideRolePop();
    });

    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest && e.target.closest('#ctx-menu')) {
        e.preventDefault();
        return;
      }
      const canvas = e.target.closest ? e.target.closest('#preview-canvas') : null;
      if (canvas) {
        const item = previewEventAt(e.clientY);
        if (item) {
          e.preventDefault();
          openEventMenu(item.eventId, e.clientX, e.clientY);
        }
        return;
      }
      const row = e.target.closest ? e.target.closest('.flow-row[data-eid]') : null;
      if (row) {
        e.preventDefault();
        openEventMenu(row.dataset.eid, e.clientX, e.clientY);
        return;
      }
      const card = e.target.closest ? e.target.closest('.pool-card[data-uid]') : null;
      if (card) {
        e.preventDefault();
        openCharacterMenu(card.dataset.uid, e.clientX, e.clientY);
      }
    });

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!S.ctx) return;
        if (e.target.closest && e.target.closest('#ctx-menu')) return;
        closeContextMenu();
      },
      true
    );
    document.addEventListener('pointerdown', startHold);
    document.addEventListener('pointermove', moveHold);
    document.addEventListener('pointerup', endHold);
    document.addEventListener('pointercancel', endHold);

    document.addEventListener('input', (e) => {
      if (e.target.id === 'composer-input') return;
      handleField(e.target);
    });

    document.addEventListener('change', (e) => {
      const el = e.target;
      if (el.id === 'drawer-session') {
        selectSession(el.value);
        return;
      }
      if (el.id === 'export-width') {
        CM.store.live((d) => {
          d.settings.exportWidth = Number(el.value) || 1080;
        });
        updateExportEstimate();
        return;
      }
      if (el.id === 'export-header' || el.id === 'export-status') {
        updateExportEstimate();
        return;
      }
      if (el.dataset.action === 'add-seg-select') {
        const type = el.value;
        el.value = '';
        if (type) addSegment(type);
        return;
      }
      handleField(el);
    });

    document.addEventListener('focusin', (e) => {
      if (e.target.id === 'composer-input') return;
      if (e.target.matches('input, textarea, select')) CM.store.beginEdit();
    });

    document.addEventListener('keydown', (e) => {
      if (S.ctx) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeContextMenu();
        }
        return;
      }
      const editable = e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable="true"]');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !editable) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !editable) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Escape') {
        if (document.body.classList.contains('drawer-open')) {
          closeDrawer();
        } else if (document.body.classList.contains('detail-open')) {
          closeDetail();
        } else if (document.body.classList.contains('pool-open')) {
          closePool();
        } else if (S.rolePopOpen) {
          hideRolePop();
        }
      }
    });

    const modal = $('#modal');
    if (modal) {
      modal.addEventListener('close', () => {
        if (S.confirmResolve) {
          const resolve = S.confirmResolve;
          S.confirmResolve = null;
          resolve(false);
        }
        S.confirmOpts = null;
        if (S.modalKind === 'export') revokeExport();
        S.modalKind = '';
        S.modalUid = '';
      });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    const canvas = $('#preview-canvas');
    if (canvas) {
      canvas.addEventListener('click', (e) => {
        if (Date.now() - S.suppressClickAt < 420) return;
        const layout = S.previewLayout;
        if (!layout) return;
        const rect = canvas.getBoundingClientRect();
        const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * layout.height;
        const item = layout.items.find((i) => i.eventId && y >= i.y && y <= i.y + i.h);
        if (item) selectEvent(item.eventId, false);
      });
      canvas.addEventListener('mousemove', (e) => {
        const layout = S.previewLayout;
        if (!layout) return;
        const rect = canvas.getBoundingClientRect();
        const y = ((e.clientY - rect.top) / Math.max(1, rect.height)) * layout.height;
        const hit = layout.items.some((i) => i.eventId && y >= i.y && y <= i.y + i.h);
        canvas.style.cursor = hit ? 'pointer' : 'default';
      });
    }

    const input = $('#composer-input');
    if (input) {
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(86, Math.max(34, input.scrollHeight)) + 'px';
        const send = $('.composer-send');
        if (send) send.disabled = !input.value.trim();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          sendComposer();
        }
      });
      input.addEventListener('pointerdown', startLongPress);
      input.addEventListener('pointermove', moveLongPress);
      input.addEventListener('pointerup', cancelLongPress);
      input.addEventListener('pointercancel', cancelLongPress);
      input.addEventListener('pointerleave', cancelLongPress);
      input.addEventListener('contextmenu', (e) => {
        // Keep the native text menu on a mouse; suppress it on touch, where
        // the long-press gesture opens the detailed editor instead.
        if (window.matchMedia('(pointer: coarse)').matches) e.preventDefault();
      });
    }

    const screen = $('#phone-screen');
    if (screen) {
      screen.addEventListener('dragover', (e) => {
        if (!S.drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        updateDrop(e.clientY);
      });
      screen.addEventListener('dragleave', (e) => {
        if (!screen.contains(e.relatedTarget)) {
          const line = $('#drop-line');
          if (line) line.hidden = true;
          S.dropIndex = null;
        }
      });
      screen.addEventListener('drop', (e) => {
        if (!S.drag) return;
        e.preventDefault();
        const index = S.dropIndex == null ? session().events.length : S.dropIndex;
        const uid = S.drag.uid;
        cleanupDrag();
        insertMessageAt(index, uid);
      });
    }

    document.addEventListener('dragstart', (e) => {
      const card = e.target.closest && e.target.closest('.pool-card');
      if (!card) return;
      if (e.target.closest('.pool-edit')) {
        e.preventDefault();
        return;
      }
      S.drag = { kind: 'cast', uid: card.dataset.uid };
      document.body.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'cast:' + card.dataset.uid);
        e.dataTransfer.setDragImage(card, 26, 26);
      } catch (err) {}
    });

    document.addEventListener('dragend', () => {
      S.suppressClickAt = Date.now();
      cleanupDrag();
    });

    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('resize', CM.debounce(() => renderPreview(), 140));
  }
})();
