/* core.js — data model, OneBot 12 helpers, themes, local storage */
(function () {
  'use strict';
  const CM = (window.CM = window.CM || {});

  CM.VERSION = '1.0.0';
  CM.FORMAT = 'mock_chatui/onebot12';
  CM.STORAGE_KEY = 'mock_chatui:dataset:v1';
  CM.UI_KEY = 'mock_chatui:ui:v1';
  // Read-only fallbacks from the old project name; migrated once on load.
  CM.LEGACY_STORAGE_KEY = 'chatlog-mock:dataset:v1';
  CM.LEGACY_UI_KEY = 'chatlog-mock:ui:v1';
  CM.DESIGN_WIDTH = 390;
  CM.FONT =
    '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI", system-ui, ' +
    '"Apple Color Emoji", "Segoe UI Emoji", sans-serif';

  /* i18n helper: inline zh/en pairs, evaluated on every call so a live
     language switch is reflected by the next render. */
  const tr = (zh, en, vars) => (CM.i18n ? CM.i18n.tr(zh, en, vars) : zh);

  /* ------------------------------------------------------------------ */
  /* small helpers                                                       */
  /* ------------------------------------------------------------------ */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  CM.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  CM.uid = (prefix) =>
    (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  CM.nowSec = () => Math.floor(Date.now() / 1000);
  CM.clone = (v) => {
    if (typeof structuredClone === 'function') return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  };
  CM.pad = (n) => String(n).padStart(2, '0');

  CM.fmtClock = (ts) => {
    const d = new Date(ts * 1000);
    return CM.pad(d.getHours()) + ':' + CM.pad(d.getMinutes());
  };
  CM.fmtAbs = (ts) => {
    const d = new Date(ts * 1000);
    return (
      d.getFullYear() + '-' + CM.pad(d.getMonth() + 1) + '-' + CM.pad(d.getDate()) +
      ' ' + CM.pad(d.getHours()) + ':' + CM.pad(d.getMinutes())
    );
  };
  CM.fmtDivider = (ts) => {
    const d = new Date(ts * 1000);
    const now = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOf(now) - startOf(d)) / 86400000);
    const hm = CM.pad(d.getHours()) + ':' + CM.pad(d.getMinutes());
    if (dayDiff === 0) return hm;
    if (dayDiff === 1) return tr('昨天 {time}', 'Yesterday {time}', { time: hm });
    if (dayDiff === -1) return tr('明天 {time}', 'Tomorrow {time}', { time: hm });
    const sameYear = d.getFullYear() === now.getFullYear();
    const locale = CM.i18n && CM.i18n.lang === 'en' ? 'en-US' : 'zh-CN';
    try {
      return new Intl.DateTimeFormat(locale, {
        year: sameYear ? undefined : 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
    } catch (e) {
      const date = sameYear
        ? d.getMonth() + 1 + '月' + d.getDate() + '日'
        : d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
      return date + ' ' + hm;
    }
  };
  CM.toLocalInput = (ts) => {
    const d = new Date(ts * 1000);
    return (
      d.getFullYear() + '-' + CM.pad(d.getMonth() + 1) + '-' + CM.pad(d.getDate()) +
      'T' + CM.pad(d.getHours()) + ':' + CM.pad(d.getMinutes())
    );
  };
  CM.fromLocalInput = (s) => {
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t / 1000 : null;
  };
  CM.fmtBytes = (n) => {
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  };
  CM.debounce = (fn, ms) => {
    let t = 0;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  };

  /* ------------------------------------------------------------------ */
  /* OneBot 12 vocabulary                                                */
  /* ------------------------------------------------------------------ */

  CM.SEGMENT_META = {
    text: { get label() { return CM.segLabel('text'); }, standard: true },
    mention: { get label() { return CM.segLabel('mention'); }, standard: true },
    mention_all: { get label() { return CM.segLabel('mention_all'); }, standard: true },
    image: { get label() { return CM.segLabel('image'); }, standard: true },
    voice: { get label() { return CM.segLabel('voice'); }, standard: true },
    audio: { get label() { return CM.segLabel('audio'); }, standard: true },
    video: { get label() { return CM.segLabel('video'); }, standard: true },
    file: { get label() { return CM.segLabel('file'); }, standard: true },
    location: { get label() { return CM.segLabel('location'); }, standard: true },
    reply: { get label() { return CM.segLabel('reply'); }, standard: true },
    'qq.face': {
      get label() { return CM.segLabel('qq.face'); },
      standard: false,
      get note() {
        return tr(
          '扩展消息段，命名符合 OneBot 扩展规则（<prefix>. 前缀）',
          'Extended segment named per the OneBot extension rule (<prefix>. prefix)'
        );
      },
    },
  };

  CM.NOTICE_META = {
    group_member_increase: {
      get label() { return CM.noticeLabel('group_member_increase'); },
      subTypes: ['join', 'invite'],
      groupOnly: true,
    },
    group_member_decrease: {
      get label() { return CM.noticeLabel('group_member_decrease'); },
      subTypes: ['leave', 'kick'],
      groupOnly: true,
    },
    group_message_delete: {
      get label() { return CM.noticeLabel('group_message_delete'); },
      subTypes: ['recall', 'delete'],
      groupOnly: true,
    },
  };

  /* Display labels live in functions: a static label captured at load time
     would go stale after a language switch. */
  CM.segLabel = function (type) {
    switch (type) {
      case 'text': return tr('文本', 'Text');
      case 'mention': return tr('提及 @', 'Mention @');
      case 'mention_all': return tr('@全体成员', '@all');
      case 'image': return tr('图片', 'Image');
      case 'voice': return tr('语音', 'Voice');
      case 'audio': return tr('音频', 'Audio');
      case 'video': return tr('视频', 'Video');
      case 'file': return tr('文件', 'File');
      case 'location': return tr('位置', 'Location');
      case 'reply': return tr('回复', 'Reply');
      case 'qq.face': return tr('QQ 表情', 'QQ face');
      default: return String(type);
    }
  };
  CM.noticeLabel = function (detailType) {
    switch (detailType) {
      case 'group_member_increase': return tr('成员加入', 'Member joined');
      case 'group_member_decrease': return tr('成员退出', 'Member left');
      case 'group_message_delete': return tr('消息撤回 / 删除', 'Message recall / delete');
      default: return String(detailType);
    }
  };

  CM.FACES = [
    { id: '0', name: '惊讶', emoji: '😮' },
    { id: '1', name: '撇嘴', emoji: '😒' },
    { id: '2', name: '色', emoji: '😍' },
    { id: '3', name: '发呆', emoji: '😳' },
    { id: '4', name: '得意', emoji: '😎' },
    { id: '5', name: '流泪', emoji: '😢' },
    { id: '6', name: '害羞', emoji: '😊' },
    { id: '7', name: '闭嘴', emoji: '🤐' },
    { id: '8', name: '睡', emoji: '😴' },
    { id: '9', name: '大哭', emoji: '😭' },
    { id: '10', name: '尴尬', emoji: '😅' },
    { id: '11', name: '发怒', emoji: '😡' },
    { id: '12', name: '调皮', emoji: '😜' },
    { id: '13', name: '呲牙', emoji: '😁' },
    { id: '14', name: '微笑', emoji: '🙂' },
    { id: '15', name: '难过', emoji: '🙁' },
    { id: '16', name: '酷', emoji: '🕶️' },
    { id: '18', name: '抓狂', emoji: '😫' },
    { id: '19', name: '吐', emoji: '🤮' },
    { id: '20', name: '偷笑', emoji: '🤭' },
    { id: '21', name: '可爱', emoji: '😚' },
    { id: '22', name: '白眼', emoji: '🙄' },
    { id: '23', name: '傲慢', emoji: '😤' },
    { id: '24', name: '饥饿', emoji: '😋' },
    { id: '25', name: '困', emoji: '😪' },
    { id: '26', name: '惊恐', emoji: '😱' },
    { id: '27', name: '流汗', emoji: '😓' },
    { id: '28', name: '憨笑', emoji: '😄' },
    { id: '30', name: '奋斗', emoji: '💪' },
    { id: '31', name: '咒骂', emoji: '🤬' },
    { id: '32', name: '疑问', emoji: '❓' },
    { id: '33', name: '嘘', emoji: '🤫' },
    { id: '34', name: '晕', emoji: '😵' },
    { id: '38', name: '敲打', emoji: '🔨' },
    { id: '39', name: '再见', emoji: '👋' },
    { id: '41', name: '抠鼻', emoji: '😏' },
    { id: '42', name: '鼓掌', emoji: '👏' },
    { id: '43', name: '糗大了', emoji: '😳' },
    { id: '49', name: '委屈', emoji: '🥺' },
    { id: '50', name: '快哭了', emoji: '😖' },
    { id: '52', name: '亲亲', emoji: '😘' },
    { id: '53', name: '吓', emoji: '😨' },
    { id: '54', name: '可怜', emoji: '🥺' },
    { id: '56', name: '西瓜', emoji: '🍉' },
    { id: '60', name: '咖啡', emoji: '☕' },
    { id: '63', name: '玫瑰', emoji: '🌹' },
    { id: '64', name: '凋谢', emoji: '🥀' },
    { id: '66', name: '爱心', emoji: '❤️' },
    { id: '67', name: '心碎', emoji: '💔' },
    { id: '68', name: '蛋糕', emoji: '🎂' },
    { id: '74', name: '便便', emoji: '💩' },
    { id: '75', name: '月亮', emoji: '🌙' },
    { id: '76', name: '太阳', emoji: '☀️' },
    { id: '77', name: '礼物', emoji: '🎁' },
    { id: '78', name: '拥抱', emoji: '🤗' },
    { id: '79', name: '强', emoji: '👍' },
    { id: '80', name: '弱', emoji: '👎' },
    { id: '81', name: '握手', emoji: '🤝' },
    { id: '82', name: '胜利', emoji: '✌️' },
    { id: '83', name: '抱拳', emoji: '🙏' },
    { id: '85', name: '拳头', emoji: '👊' },
    { id: '89', name: 'OK', emoji: '👌' },
    { id: '96', name: '磕头', emoji: '🙇' },
    { id: '99', name: '挥手', emoji: '👋' },
    { id: '105', name: '双喜', emoji: '🎉' },
    { id: '107', name: '灯笼', emoji: '🏮' },
    { id: '112', name: '喝彩', emoji: '🎊' },
    { id: '116', name: '喝奶', emoji: '🍼' },
    { id: '119', name: '飞机', emoji: '✈️' },
    { id: '128', name: '熊猫', emoji: '🐼' },
    { id: '129', name: '灯泡', emoji: '💡' },
    { id: '131', name: '闹钟', emoji: '⏰' },
    { id: '136', name: '纸巾', emoji: '🧻' },
    { id: '138', name: '手枪', emoji: '🔫' },
    { id: '140', name: '茶', emoji: '🍵' },
    { id: '144', name: '卖萌', emoji: '😜' },
    { id: '147', name: '斜眼笑', emoji: '😏' },
    { id: '148', name: 'doge', emoji: '🐶' },
    { id: '151', name: '笑哭', emoji: '😂' },
    { id: '152', name: '我最美', emoji: '💃' },
    { id: '153', name: '河蟹', emoji: '🦀' },
    { id: '178', name: '斜眼笑', emoji: '😏' },
  ];
  CM.FACE_BY_ID = {};
  CM.FACES.forEach((f) => (CM.FACE_BY_ID[f.id] = f));
  CM.faceOf = (id) => CM.FACE_BY_ID[String(id)] || { id: String(id), name: '表情', emoji: '🙂' };

  // English labels for the QQ face picker; the Chinese names remain the
  // canonical platform names. Unknown ids fall back to "Face <id>".
  CM.FACE_EN = {
    '0': 'Surprised', '1': 'Pout', '2': 'Love', '3': 'Blank', '4': 'Smug',
    '5': 'Tears', '6': 'Shy', '7': 'Zipped', '8': 'Sleep', '9': 'Sob',
    '10': 'Awkward', '11': 'Angry', '12': 'Naughty', '13': 'Grin', '14': 'Smile',
    '15': 'Sad', '16': 'Cool', '18': 'Crazy', '19': 'Vomit', '20': 'Giggle',
    '21': 'Cute', '22': 'Eye-roll', '23': 'Arrogant', '24': 'Hungry', '25': 'Sleepy',
    '26': 'Shocked', '27': 'Sweat', '28': 'Laugh', '30': 'Strive', '31': 'Curse',
    '32': 'Question', '33': 'Shush', '34': 'Dizzy', '38': 'Knock', '39': 'Bye',
    '41': 'Pick nose', '42': 'Clap', '43': 'Embarrassed', '49': 'Wronged', '50': 'Almost crying',
    '52': 'Kiss', '53': 'Scared', '54': 'Pitiful', '56': 'Watermelon', '60': 'Coffee',
    '63': 'Rose', '64': 'Withered', '66': 'Heart', '67': 'Broken heart', '68': 'Cake',
    '74': 'Poop', '75': 'Moon', '76': 'Sun', '77': 'Gift', '78': 'Hug',
    '79': 'Thumbs up', '80': 'Thumbs down', '81': 'Handshake', '82': 'Victory', '83': 'Salute',
    '85': 'Fist', '89': 'OK', '96': 'Kowtow', '99': 'Wave', '105': 'Double joy',
    '107': 'Lantern', '112': 'Cheer', '116': 'Milk', '119': 'Plane', '128': 'Panda',
    '129': 'Bulb', '131': 'Alarm', '136': 'Tissue', '138': 'Gun', '140': 'Tea',
    '144': 'Cute', '147': 'Smirk', '148': 'Doge', '151': 'LOL', '152': 'Beauty',
    '153': 'Crab', '178': 'Smirk',
  };
  CM.faceName = (id) => {
    if (CM.i18n && CM.i18n.lang === 'en') return CM.FACE_EN[String(id)] || 'Face ' + String(id);
    return CM.faceOf(id).name;
  };

  CM.EMOJIS = [
    '🐈', '🐕', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧',
    '🐦', '🦄', '🐙', '🦖', '🌸', '🍑', '🍊', '🍋', '🍓', '🍉',
    '🍇', '🌙', '⭐', '☁️', '🎧', '🎮', '📚', '☕', '🍜', '🧋',
    '🐳', '🐰', '🐹', '🌻', '🍀', '✨', '🔥', '🎈', '🍰', '🧸',
  ];
  CM.AVATAR_COLORS = [
    '#f3b26d', '#8fd3c7', '#93b4ff', '#f2a3b7', '#c3a6ff',
    '#ffd166', '#a8d08d', '#7fc8f8', '#f0a07c', '#b8b8ff',
    '#e58f8f', '#8fc9a8',
  ];

  /* ------------------------------------------------------------------ */
  /* themes (canvas tokens)                                              */
  /* ------------------------------------------------------------------ */

  function qqLight() {
    return {
      bg: '#f2f4f7',
      headerBg: '#ffffff',
      headerText: '#12151a',
      headerSub: '#8b919b',
      headerLine: 'rgba(0,0,0,.065)',
      statusText: '#12151a',
      otherBubble: '#ffffff',
      otherText: '#14171c',
      selfBubble: '#0099ff',
      selfText: '#ffffff',
      name: '#8b919b',
      time: '#9aa1ab',
      accent: '#0b84ff',
      selfAccent: '#eaf5ff',
      noticeBg: 'rgba(0,0,0,.05)',
      noticeText: '#7f8792',
      quoteBg: 'rgba(0,0,0,.055)',
      selfQuoteBg: 'rgba(255,255,255,.18)',
      quoteBar: '#8b919b',
      fileBg: '#f4f6f9',
      fileIconBg: '#e7f2ff',
      fileIconText: '#0b84ff',
      icon: '#12151a',
      bubbleRadius: 14,
      avatarRadius: 20,
      tail: false,
      cardSub: '#8b919b',
      mapBg: '#e7e3d8',
      mapRoad: '#f7f4ea',
      mapPark: '#cfe0c4',
      mapPanel: 'rgba(255,255,255,.94)',
      mapText: '#1d2126',
    };
  }
  function qqDark() {
    return {
      bg: '#0f1115',
      headerBg: '#171a1f',
      headerText: '#f1f3f5',
      headerSub: '#8b919b',
      headerLine: 'rgba(255,255,255,.07)',
      statusText: '#f1f3f5',
      otherBubble: '#23272e',
      otherText: '#e8eaed',
      selfBubble: '#0a84ff',
      selfText: '#ffffff',
      name: '#8b919b',
      time: '#6f7783',
      accent: '#4da3ff',
      selfAccent: '#eaf5ff',
      noticeBg: 'rgba(255,255,255,.06)',
      noticeText: '#8b919b',
      quoteBg: 'rgba(255,255,255,.07)',
      selfQuoteBg: 'rgba(255,255,255,.17)',
      quoteBar: '#6f7783',
      fileBg: '#2a2f37',
      fileIconBg: '#1d3550',
      fileIconText: '#6fb4ff',
      icon: '#f1f3f5',
      bubbleRadius: 14,
      avatarRadius: 20,
      tail: false,
      cardSub: '#8b919b',
      mapBg: '#2a2d2a',
      mapRoad: '#3a3e3a',
      mapPark: '#33452f',
      mapPanel: 'rgba(23,26,31,.92)',
      mapText: '#e8eaed',
    };
  }
  function wxLight() {
    return {
      bg: '#ededed',
      headerBg: '#ededed',
      headerText: '#111111',
      headerSub: '#8c8c8c',
      headerLine: 'rgba(0,0,0,.08)',
      statusText: '#111111',
      otherBubble: '#ffffff',
      otherText: '#111111',
      selfBubble: '#95ec69',
      selfText: '#111111',
      name: '#9a9a9a',
      time: '#a6a6a6',
      accent: '#576b95',
      selfAccent: '#2f5b22',
      noticeBg: 'rgba(0,0,0,.045)',
      noticeText: '#8a8a8a',
      quoteBg: 'rgba(0,0,0,.055)',
      selfQuoteBg: 'rgba(0,0,0,.06)',
      quoteBar: '#a6a6a6',
      fileBg: '#f7f7f7',
      fileIconBg: '#eef0f2',
      fileIconText: '#576b95',
      icon: '#111111',
      bubbleRadius: 6,
      avatarRadius: 5,
      tail: true,
      cardSub: '#8a8a8a',
      mapBg: '#e5e0d4',
      mapRoad: '#f7f4ea',
      mapPark: '#cfe0c4',
      mapPanel: 'rgba(255,255,255,.94)',
      mapText: '#1d2126',
    };
  }
  function wxDark() {
    return {
      bg: '#111111',
      headerBg: '#1c1c1c',
      headerText: '#e6e6e6',
      headerSub: '#8c8c8c',
      headerLine: 'rgba(255,255,255,.07)',
      statusText: '#e6e6e6',
      otherBubble: '#2c2c2c',
      otherText: '#e6e6e6',
      selfBubble: '#2f5d33',
      selfText: '#eaf5e4',
      name: '#8c8c8c',
      time: '#7a7a7a',
      accent: '#8aa9d2',
      selfAccent: '#bfe0b6',
      noticeBg: 'rgba(255,255,255,.06)',
      noticeText: '#8c8c8c',
      quoteBg: 'rgba(255,255,255,.075)',
      selfQuoteBg: 'rgba(0,0,0,.18)',
      quoteBar: '#6f6f6f',
      fileBg: '#333333',
      fileIconBg: '#27323d',
      fileIconText: '#8aa9d2',
      icon: '#e6e6e6',
      bubbleRadius: 6,
      avatarRadius: 5,
      tail: true,
      cardSub: '#8c8c8c',
      mapBg: '#26292a',
      mapRoad: '#353a3a',
      mapPark: '#2f402c',
      mapPanel: 'rgba(20,20,20,.9)',
      mapText: '#e6e6e6',
    };
  }

  CM.theme = function (settings) {
    const platform = settings && settings.platform === 'wechat' ? 'wechat' : 'qq';
    const mode = settings && settings.mode === 'dark' ? 'dark' : 'light';
    const t = platform === 'wechat' ? (mode === 'dark' ? wxDark() : wxLight()) : (mode === 'dark' ? qqDark() : qqLight());
    t.platform = platform;
    t.mode = mode;
    return t;
  };

  /* ------------------------------------------------------------------ */
  /* dataset                                                             */
  /* ------------------------------------------------------------------ */

  CM.defaultSettings = function () {
    return {
      platform: 'qq',
      mode: 'light',
      fontSize: 15,
      bubbleWidth: 258,
      gapMinutes: 5,
      showHeader: true,
      showStatus: true,
      showNames: true,
      statusTime: '',
      backgroundImage: '',
      backgroundTint: '',
      exportWidth: 1080,
    };
  };

  CM.charMap = function (data) {
    const map = {};
    (data.characters || []).forEach((c) => (map[c.user_id] = c));
    return map;
  };
  CM.selfId = function (data) {
    return data && data.self ? String(data.self.user_id) : '';
  };
  CM.charOf = function (data, userId) {
    const id = String(userId);
    return (data.characters || []).find((c) => String(c.user_id) === id) || null;
  };
  CM.charName = function (data, userId) {
    const c = CM.charOf(data, userId);
    if (c) return c.name;
    if (String(userId) === CM.selfId(data)) return tr('我', 'Me');
    return tr('用户 {id}', 'User {id}', { id: userId });
  };

  CM.altMessage = function (segments, data) {
    const chars = CM.charMap(data);
    return (segments || [])
      .map((seg) => {
        const d = (seg && seg.data) || {};
        switch (seg && seg.type) {
          case 'text':
            return d.text || '';
          case 'mention':
            return '@' + ((chars[d.user_id] && chars[d.user_id].name) || d.user_id || '');
          case 'mention_all':
            return tr('@全体成员', '@all');
          case 'image':
            return tr('[图片]', '[Image]');
          case 'voice':
            return tr('[语音]', '[Voice]');
          case 'audio':
            return tr('[音频]', '[Audio]');
          case 'video':
            return tr('[视频]', '[Video]');
          case 'file':
            return tr('[文件]', '[File]');
          case 'location':
            return tr('[位置] ', '[Location] ') + (d.title || '');
          case 'reply':
            return '';
          case 'qq.face':
            return tr('[表情:{name}]', '[Face: {name}]', { name: CM.faceName(d.id) });
          default:
            return '[' + (seg && seg.type) + ']';
        }
      })
      .join('');
  };

  CM.emptyDataset = function () {
    const s = CM.defaultSettings();
    return {
      format: CM.FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: { nextMessageId: 1001, source: 'local' },
      self: { platform: 'qq', user_id: '10000' },
      characters: [
        { user_id: '10000', name: tr('我', 'Me'), avatar: '🙂', avatarImage: '', color: '#93b4ff' },
      ],
      files: {},
      sessions: [
        {
          id: 'sess_' + CM.uid('s'),
          title: tr('新群聊', 'New group chat'),
          detail_type: 'group',
          group_id: '100000001',
          user_id: '',
          member_count: 3,
          avatar: '👥',
          events: [],
        },
      ],
      settings: s,
    };
  };

  CM.buildDemo = function () {
    const assets = window.DEMO_ASSETS || {};
    const selfId = '10000';
    const chars = [
      { user_id: selfId, name: '林深', avatar: '🐈', avatarImage: '', color: '#93b4ff' },
      { user_id: '10001', name: '夏末', avatar: '🍑', avatarImage: '', color: '#f3b26d' },
      { user_id: '10002', name: '阿哲', avatar: '🐧', avatarImage: '', color: '#8fd3c7' },
      { user_id: '10003', name: '小鹿', avatar: '🦌', avatarImage: '', color: '#a8d08d' },
    ];
    const files = {};
    const fileId = (name) => 'f_' + name + '_' + Math.random().toString(36).slice(2, 7);
    const imageFile = (key) => {
      const a = assets[key];
      if (!a) return null;
      const id = fileId(key);
      files[id] = { name: a.name || key + '.jpg', mime: 'image/jpeg', size: a.size || 0, dataUrl: a.dataUrl };
      return id;
    };
    const sunset = imageFile('sunset');
    const latte = imageFile('latte');

    const groupId = '872341256';
    const base = CM.nowSec() - 52 * 60;
    let seq = 1001;
    const events = [];
    const self = { platform: 'qq', user_id: selfId };

    function msg(userId, minute, segments, opts) {
      const ev = {
        id: CM.uid('evt'),
        time: base + minute * 60,
        type: 'message',
        detail_type: 'group',
        sub_type: '',
        self: { ...self },
        message_id: String(seq++),
        message: segments,
        alt_message: '',
        user_id: String(userId),
        group_id: groupId,
      };
      if (opts && opts.replyTo) {
        ev.message.unshift({
          type: 'reply',
          data: { message_id: opts.replyTo.message_id, user_id: opts.replyTo.user_id },
        });
      }
      events.push(ev);
      return ev;
    }
    function notice(detail, subType, minute, userId, operatorId, messageId) {
      const ev = {
        id: CM.uid('evt'),
        time: base + minute * 60,
        type: 'notice',
        detail_type: detail,
        sub_type: subType,
        self: { ...self },
        group_id: groupId,
        user_id: String(userId),
        operator_id: String(operatorId),
      };
      if (messageId) ev.message_id = String(messageId);
      events.push(ev);
      return ev;
    }
    function text(t) {
      return { type: 'text', data: { text: t } };
    }
    function face(id) {
      return { type: 'qq.face', data: { id: String(id) } };
    }
    function mention(uid) {
      return { type: 'mention', data: { user_id: String(uid) } };
    }
    function image(fid) {
      return { type: 'image', data: { file_id: fid } };
    }

    notice('group_member_increase', 'join', 0, '10003', '10001');
    const welcome = msg('10001', 1, [text('欢迎新同学 🎉 群规在公告里，摸鱼随意')]);
    msg('10003', 2, [text('大家好呀～'), face('13')]);
    msg('10002', 4, [text('欢迎欢迎，小鹿是隔壁工位的')], { replyTo: welcome });
    msg('10002', 5, [mention('10003'), text(' 有什么不懂的随时问')]);
    if (sunset) msg(selfId, 8, [image(sunset)]);
    msg(selfId, 9, [text('刚在楼下拍的，今天晚霞炸了')]);
    const sunsetMsg = events[events.length - 2];
    msg('10001', 11, [text('这个颜色也太好看了吧')], { replyTo: sunsetMsg });
    msg('10003', 12, [text('像橘子汽水 🍊')]);
    msg('10002', 15, [
      { type: 'voice', data: { file_id: 'f_demo_voice' } },
    ]);
    msg('10001', 18, [mention(selfId), text(' 明天还去吗')]);
    msg(selfId, 19, [text('去，六点老地方')], {
      replyTo: events[events.length - 1],
    });
    msg('10003', 23, [
      text('周报模板我放群里了，需要的自取'),
      { type: 'file', data: { file_id: 'f_demo_doc' } },
    ]);
    msg('10002', 26, [
      {
        type: 'location',
        data: {
          latitude: 31.2214,
          longitude: 121.4773,
          title: '滨江公园 · 东门',
          content: '上海市浦东新区滨江大道 2967 号',
        },
      },
    ]);
    msg('10001', 30, [text('周报我摆烂了，别催 🫠')]);
    if (latte) msg(selfId, 34, [image(latte)]);
    msg(selfId, 35, [text('顺手带了杯咖啡，放茶水间了')]);
    msg('10003', 37, [text('谢谢林深哥！'), face('14')]);
    const typo = msg('10002', 40, [text('那我先下班了，明天见')]);
    notice('group_message_delete', 'recall', 41, '10002', '10002', typo.message_id);

    files['f_demo_voice'] = { name: '语音', mime: 'audio/ogg', size: 18432, duration: 4 };
    files['f_demo_doc'] = {
      name: '摸鱼周报-第46周.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 25190,
    };

    // second session: private chat, yesterday evening
    const y = new Date();
    y.setDate(y.getDate() - 1);
    y.setHours(21, 40, 0, 0);
    const pbase = Math.floor(y.getTime() / 1000);
    let pseq = 2001;
    const pevents = [];
    function pmsg(userId, minute, segments) {
      const ev = {
        id: CM.uid('evt'),
        time: pbase + minute * 60,
        type: 'message',
        detail_type: 'private',
        sub_type: '',
        self: { ...self },
        message_id: String(pseq++),
        message: segments,
        alt_message: '',
        user_id: String(userId),
      };
      pevents.push(ev);
      return ev;
    }
    pmsg('10001', 0, [text('到家了吗')]);
    pmsg(selfId, 2, [text('刚到，外面有点冷')]);
    pmsg('10001', 3, [text('多穿点，明天降温')]);
    pmsg(selfId, 5, [text('知道啦，你也早点睡'), face('52')]);
    pmsg('10001', 7, [text('晚安 🌙')]);
    pmsg(selfId, 8, [text('晚安')]);

    const data = {
      format: CM.FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      meta: { nextMessageId: 3001, source: 'demo' },
      self: { platform: 'qq', user_id: selfId },
      characters: chars,
      files,
      sessions: [
        {
          id: 'sess_demo_group',
          title: '摸鱼研究所',
          detail_type: 'group',
          group_id: groupId,
          user_id: '',
          member_count: 12,
          avatar: '🐟',
          events,
        },
        {
          id: 'sess_demo_private',
          title: '夏末',
          detail_type: 'private',
          group_id: '',
          user_id: '10001',
          member_count: 0,
          avatar: '',
          events: pevents,
        },
      ],
      settings: CM.defaultSettings(),
    };
    data.settings.exportWidth = 1080;
    CM.refreshDerived(data);
    return data;
  };

  /* ------------------------------------------------------------------ */
  /* derived data                                                        */
  /* ------------------------------------------------------------------ */

  CM.nextMessageId = function (data) {
    let max = 1000;
    (data.sessions || []).forEach((s) =>
      (s.events || []).forEach((e) => {
        const n = parseInt(e && e.message_id, 10);
        if (Number.isFinite(n) && n > max) max = n;
      })
    );
    const metaNext = data.meta && Number(data.meta.nextMessageId);
    if (Number.isFinite(metaNext) && metaNext > max) max = metaNext - 1;
    return max + 1;
  };

  CM.refreshDerived = function (data) {
    if (!data || typeof data !== 'object') return data;
    data.format = CM.FORMAT;
    data.version = 1;
    data.settings = Object.assign(CM.defaultSettings(), data.settings || {});
    data.self = data.self || { platform: data.settings.platform, user_id: '10000' };
    data.self.platform = data.settings.platform === 'wechat' ? 'wechat' : 'qq';
    data.self.user_id = String(data.self.user_id || '10000');
    data.characters = Array.isArray(data.characters) ? data.characters : [];
    data.files = data.files && typeof data.files === 'object' ? data.files : {};
    data.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    if (!data.sessions.length) {
      data.sessions.push({
        id: CM.uid('sess'),
        title: tr('新群聊', 'New group chat'),
        detail_type: 'group',
        group_id: '100000001',
        user_id: '',
        member_count: 3,
        avatar: '👥',
        events: [],
      });
    }
    data.meta = data.meta || {};

    if (!data.characters.some((c) => String(c.user_id) === String(data.self.user_id))) {
      data.characters.unshift({
        user_id: String(data.self.user_id),
        name: tr('我', 'Me'),
        avatar: '🙂',
        avatarImage: '',
        color: '#93b4ff',
      });
    }
    data.characters.forEach((c, i) => {
      c.user_id = String(c.user_id || 10000 + i);
      c.name = c.name || tr('角色 {id}', 'Character {id}', { id: c.user_id });
      c.avatar = c.avatar || '🙂';
      c.avatarImage = c.avatarImage || '';
      c.color = c.color || CM.AVATAR_COLORS[i % CM.AVATAR_COLORS.length];
    });

    let nextId = CM.nextMessageId(data);
    data.sessions.forEach((s) => {
      s.id = s.id || CM.uid('sess');
      s.title = s.title || (s.detail_type === 'private' ? tr('私聊', 'Private chat') : tr('群聊', 'Group chat'));
      s.detail_type = s.detail_type === 'private' ? 'private' : 'group';
      s.group_id = String(s.group_id || '');
      s.user_id = String(s.user_id || '');
      s.member_count = Number(s.member_count) || 0;
      s.events = Array.isArray(s.events) ? s.events : [];
      s.events.forEach((ev) => {
        ev.id = ev.id || CM.uid('evt');
        ev.time = Number(ev.time) || CM.nowSec();
        ev.type = ev.type === 'notice' ? 'notice' : 'message';
        ev.sub_type = ev.sub_type == null ? '' : String(ev.sub_type);
        ev.self = { platform: data.self.platform, user_id: data.self.user_id };
        if (ev.type === 'message') {
          ev.detail_type = s.detail_type;
          ev.user_id = String(ev.user_id || '');
          ev.message_id = String(ev.message_id || nextId++);
          ev.message = Array.isArray(ev.message) ? ev.message : [];
          ev.message.forEach((seg) => {
            seg.data = seg.data && typeof seg.data === 'object' ? seg.data : {};
          });
          ev.alt_message = CM.altMessage(ev.message, data);
          if (s.detail_type === 'group') {
            ev.group_id = String(s.group_id || ev.group_id || '');
          } else {
            delete ev.group_id;
          }
        } else {
          ev.detail_type = ev.detail_type || 'group_member_increase';
          ev.user_id = String(ev.user_id || '');
          ev.operator_id = String(ev.operator_id || ev.user_id);
          if (s.detail_type === 'group' || CM.NOTICE_META[ev.detail_type]) {
            ev.group_id = String(ev.group_id || s.group_id || '');
          }
          if (ev.message_id) ev.message_id = String(ev.message_id);
        }
      });
    });
    data.meta.nextMessageId = nextId;
    data.updatedAt = new Date().toISOString();
    return data;
  };

  /* ------------------------------------------------------------------ */
  /* validation                                                          */
  /* ------------------------------------------------------------------ */

  const SEG_ALLOWED = {
    text: { text: 'string' },
    mention: { user_id: 'string' },
    mention_all: {},
    image: { file_id: 'string' },
    voice: { file_id: 'string' },
    audio: { file_id: 'string' },
    video: { file_id: 'string' },
    file: { file_id: 'string' },
    location: { latitude: 'number', longitude: 'number', title: 'string', content: 'string' },
    reply: { message_id: 'string', user_id: 'string' },
    'qq.face': { id: 'string' },
  };
  CM.SEG_ALLOWED = SEG_ALLOWED;

  function typeOk(v, t) {
    if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
    if (t === 'string') return typeof v === 'string';
    return true;
  }

  CM.validate = function (data) {
    const out = [];
    const err = (text) => out.push({ level: 'error', text });
    const warn = (text) => out.push({ level: 'warn', text });

    if (!data || typeof data !== 'object') {
      err(tr('数据集不是对象', 'Dataset is not an object'));
      return out;
    }
    if (data.format !== CM.FORMAT) {
      warn(tr('format 字段不是 {format}，仍可尝试使用', 'format field is not {format}; it may still work', { format: CM.FORMAT }));
    }
    if (!data.self || !data.self.platform || !data.self.user_id) {
      err(tr('缺少机器人自身标识 self', 'Missing bot self identity (self)'));
    }
    if (!Array.isArray(data.characters)) err(tr('characters 不是数组', 'characters is not an array'));
    if (!Array.isArray(data.sessions)) err(tr('sessions 不是数组', 'sessions is not an array'));

    const seenUsers = {};
    (data.characters || []).forEach((c, i) => {
      if (!c || typeof c !== 'object') {
        return err(tr('角色 #{n} 不是对象', 'Character #{n} is not an object', { n: i + 1 }));
      }
      if (!c.user_id) err(tr('角色 #{n} 缺少 user_id', 'Character #{n} is missing user_id', { n: i + 1 }));
      if (c.user_id && seenUsers[c.user_id]) {
        err(tr('角色 user_id 重复：{id}', 'Duplicate character user_id: {id}', { id: c.user_id }));
      }
      if (c.user_id) seenUsers[c.user_id] = true;
      if (!c.name) {
        warn(tr('角色 {id} 没有昵称', 'Character {id} has no name', { id: c.user_id || '#' + (i + 1) }));
      }
    });

    const messageIds = {};
    (data.sessions || []).forEach((s, si) => {
      const label = tr('会话「{title}」', 'Session "{title}"', {
        title: (s && s.title) || tr('未命名', 'Untitled'),
      });
      if (!s || typeof s !== 'object') {
        return err(tr('{label} 不是对象', '{label} is not an object', { label }));
      }
      if (!s.id) err(tr('{label} 缺少 id', '{label} is missing id', { label }));
      if (s.detail_type !== 'group' && s.detail_type !== 'private') {
        err(tr('{label} detail_type 必须是 group/private', '{label} detail_type must be group/private', { label }));
      }
      if (!Array.isArray(s.events)) {
        return err(tr('{label} events 不是数组', '{label} events is not an array', { label }));
      }
      s.events.forEach((ev, ei) => {
        const tag = tr('{label} 第 {n} 条', '{label} item {n}', { label, n: ei + 1 });
        if (!ev || typeof ev !== 'object') {
          return err(tr('{tag} 不是对象', '{tag} is not an object', { tag }));
        }
        ['id', 'type', 'detail_type', 'sub_type', 'self'].forEach((k) => {
          if (ev[k] == null) err(tr('{tag} 缺少 {key}', '{tag} is missing {key}', { tag, key: k }));
        });
        if (typeof ev.time !== 'number' || !Number.isFinite(ev.time)) {
          err(tr('{tag} time 必须是数字（Unix 秒）', '{tag} time must be a number (Unix seconds)', { tag }));
        }
        if (!['message', 'notice', 'request', 'meta'].includes(ev.type)) {
          err(tr('{tag} type 非法：{type}', '{tag} has invalid type: {type}', { tag, type: ev.type }));
        }
        if (ev.self && (!ev.self.platform || !ev.self.user_id)) {
          err(tr('{tag} self 缺少 platform/user_id', '{tag} self is missing platform/user_id', { tag }));
        }

        if (ev.type === 'message') {
          if (!['private', 'group'].includes(ev.detail_type)) {
            err(tr('{tag} detail_type 必须是 private/group', '{tag} detail_type must be private/group', { tag }));
          }
          if (!ev.message_id) err(tr('{tag} 缺少 message_id', '{tag} is missing message_id', { tag }));
          if (messageIds[ev.message_id]) {
            warn(tr('{tag} message_id 重复：{id}', '{tag} has duplicate message_id: {id}', { tag, id: ev.message_id }));
          }
          messageIds[ev.message_id] = true;
          if (!Array.isArray(ev.message)) {
            return err(tr('{tag} message 必须是消息段数组', '{tag} message must be an array of segments', { tag }));
          }
          if (typeof ev.alt_message !== 'string') {
            warn(tr('{tag} alt_message 建议为字符串', '{tag} alt_message should be a string', { tag }));
          }
          if (!ev.user_id) err(tr('{tag} 缺少 user_id', '{tag} is missing user_id', { tag }));
          if (ev.detail_type === 'group' && !ev.group_id) {
            err(tr('{tag} 群消息缺少 group_id', '{tag} group message is missing group_id', { tag }));
          }
          ev.message.forEach((seg, gi) => {
            const stag = tr('{tag} 消息段 {n}', '{tag} segment {n}', { tag, n: gi + 1 });
            if (!seg || typeof seg !== 'object') {
              return err(tr('{stag} 不是对象', '{stag} is not an object', { stag }));
            }
            if (typeof seg.type !== 'string') {
              return err(tr('{stag} 缺少 type', '{stag} is missing type', { stag }));
            }
            if (!seg.data || typeof seg.data !== 'object') {
              return err(tr('{stag} 缺少 data 对象', '{stag} is missing the data object', { stag }));
            }
            if (Object.prototype.hasOwnProperty.call(seg.data, 'type')) {
              err(tr('{stag} data 不得包含保留字段 type', '{stag} data must not contain the reserved field type', { stag }));
            }
            const allowed = SEG_ALLOWED[seg.type];
            if (!allowed) {
              warn(
                tr('{stag} 使用了扩展消息段 {type}，渲染器可能忽略', '{stag} uses extended segment {type}; the renderer may ignore it', {
                  stag,
                  type: seg.type,
                })
              );
              return;
            }
            Object.keys(allowed).forEach((k) => {
              if (seg.data[k] == null) {
                warn(tr('{stag} 缺少参数 {key}', '{stag} is missing parameter {key}', { stag, key: k }));
              } else if (!typeOk(seg.data[k], allowed[k])) {
                err(
                  tr('{stag} 参数 {key} 类型应为 {type}', '{stag} parameter {key} should be of type {type}', {
                    stag,
                    key: k,
                    type: allowed[k],
                  })
                );
              }
            });
            Object.keys(seg.data).forEach((k) => {
              if (!(k in allowed)) {
                warn(tr('{stag} 包含非标准参数 {key}', '{stag} contains non-standard parameter {key}', { stag, key: k }));
              }
            });
            if (['image', 'voice', 'audio', 'video', 'file'].includes(seg.type) && seg.data.file_id) {
              if (!data.files || !data.files[seg.data.file_id]) {
                warn(
                  tr(
                    '{stag} 引用的文件 {id} 不在本地文件表中',
                    '{stag} references file {id}, which is not in the local file table',
                    { stag, id: seg.data.file_id }
                  )
                );
              }
            }
          });
        } else if (ev.type === 'notice') {
          const meta = CM.NOTICE_META[ev.detail_type];
          if (!meta) {
            warn(tr('{tag} 使用扩展通知事件 {type}', '{tag} uses extended notice event {type}', {
              tag,
              type: ev.detail_type,
            }));
          } else if (!meta.subTypes.includes(ev.sub_type) && ev.sub_type !== '') {
            warn(
              tr('{tag} sub_type 不在标准取值内：{sub}', '{tag} sub_type is not a standard value: {sub}', {
                tag,
                sub: ev.sub_type,
              })
            );
          }
          if (!ev.user_id) err(tr('{tag} 缺少 user_id', '{tag} is missing user_id', { tag }));
          if (!ev.operator_id) err(tr('{tag} 缺少 operator_id', '{tag} is missing operator_id', { tag }));
          if (ev.detail_type === 'group_message_delete' && !ev.message_id) {
            err(tr('{tag} 缺少 message_id', '{tag} is missing message_id', { tag }));
          }
        }
      });
    });

    const errCount = out.filter((x) => x.level === 'error').length;
    const warnCount = out.length - errCount;
    return Object.assign(out, { errors: errCount, warnings: warnCount });
  };

  /* ------------------------------------------------------------------ */
  /* local storage                                                       */
  /* ------------------------------------------------------------------ */

  CM.store = {
    data: null,
    available: true,
    undoStack: [],
    redoStack: [],
    maxUndo: 40,
    onStatus: null,
    _saveTimer: 0,
    _pendingUndo: false,
    _lastBytes: 0,

    init() {
      let raw = null;
      try {
        raw = localStorage.getItem(CM.STORAGE_KEY);
        if (!raw) {
          const legacy = localStorage.getItem(CM.LEGACY_STORAGE_KEY);
          if (legacy) {
            raw = legacy;
            // Keep the old key for rollback, but make the new key canonical.
            try {
              localStorage.setItem(CM.STORAGE_KEY, legacy);
            } catch (_) {}
          }
        }
      } catch (e) {
        this.available = false;
      }
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.sessions) && Array.isArray(parsed.characters)) {
            this.data = CM.refreshDerived(parsed);
          }
        } catch (e) {
          try {
            localStorage.setItem(CM.STORAGE_KEY + ':broken', raw);
          } catch (_) {}
        }
      }
      if (!this.data) this.data = CM.buildDemo();
      CM.refreshDerived(this.data);
      this.saveNow();
      return this.data;
    },

    snapshot() {
      try {
        this.undoStack.push(CM.clone(this.data));
        if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
        this.redoStack.length = 0;
      } catch (e) {}
    },

    beginEdit() {
      this._pendingUndo = true;
    },

    commit(fn, opts) {
      const history = !opts || opts.history !== false;
      if (history) this.snapshot();
      fn(this.data);
      CM.refreshDerived(this.data);
      this._pendingUndo = false;
      this.saveSoon();
      return this.data;
    },

    /** live edit: snapshot once per focus session, then update in place */
    live(fn) {
      if (this._pendingUndo) {
        this.snapshot();
        this._pendingUndo = false;
      }
      fn(this.data);
      CM.refreshDerived(this.data);
      this.saveSoon();
      return this.data;
    },

    undo() {
      if (!this.undoStack.length) return false;
      this.redoStack.push(CM.clone(this.data));
      this.data = this.undoStack.pop();
      CM.refreshDerived(this.data);
      this.saveNow();
      return true;
    },
    redo() {
      if (!this.redoStack.length) return false;
      this.undoStack.push(CM.clone(this.data));
      this.data = this.redoStack.pop();
      CM.refreshDerived(this.data);
      this.saveNow();
      return true;
    },
    canUndo() {
      return this.undoStack.length > 0;
    },
    canRedo() {
      return this.redoStack.length > 0;
    },

    replace(data, opts) {
      if (!data) return false;
      if (!opts || opts.history !== false) this.snapshot();
      this.data = CM.refreshDerived(data);
      this.saveNow();
      return true;
    },

    saveSoon() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveNow(), 260);
    },

    saveNow() {
      clearTimeout(this._saveTimer);
      if (!this.data) return;
      const json = JSON.stringify(this.data);
      try {
        if (!this.available) throw new Error(tr('localStorage 不可用', 'localStorage is unavailable'));
        localStorage.setItem(CM.STORAGE_KEY, json);
        this._lastBytes = new Blob([json]).size;
        if (this.onStatus) this.onStatus({ ok: true, bytes: this._lastBytes, at: new Date() });
      } catch (e) {
        this._lastBytes = new Blob([json]).size;
        if (this.onStatus) {
          this.onStatus({
            ok: false,
            bytes: this._lastBytes,
            at: new Date(),
            message:
              e && e.name === 'QuotaExceededError'
                ? tr('本地存储空间已满', 'Local storage is full')
                : e.message || tr('保存失败', 'Save failed'),
          });
        }
      }
    },

    bytes() {
      try {
        return new Blob([JSON.stringify(this.data)]).size;
      } catch (e) {
        return 0;
      }
    },
  };

  /** bytes referenced by a data URL, for the storage panel */
  CM.byteSize = function (str) {
    if (!str) return 0;
    if (str.indexOf('base64,') >= 0) {
      const b64 = str.slice(str.indexOf('base64,') + 7);
      return Math.floor((b64.length * 3) / 4);
    }
    return new Blob([str]).size;
  };

  CM.usedFileIds = function (data) {
    const used = new Set();
    (data.sessions || []).forEach((s) =>
      (s.events || []).forEach((ev) => {
        if (ev.type !== 'message') return;
        (ev.message || []).forEach((seg) => {
          if (seg && seg.data && seg.data.file_id) used.add(String(seg.data.file_id));
        });
      })
    );
    return used;
  };

  CM.noticeText = function (data, ev) {
    const name = (id) => CM.charName(data, id);
    switch (ev.detail_type) {
      case 'group_member_increase':
        if (ev.sub_type === 'invite') {
          return tr('{operator} 邀请 {user} 加入了群聊', '{operator} invited {user} to the group chat', {
            operator: name(ev.operator_id),
            user: name(ev.user_id),
          });
        }
        return tr('{user} 加入了群聊', '{user} joined the group chat', { user: name(ev.user_id) });
      case 'group_member_decrease':
        if (ev.sub_type === 'kick') {
          return tr('{user} 被 {operator} 移出了群聊', '{user} was removed from the group chat by {operator}', {
            user: name(ev.user_id),
            operator: name(ev.operator_id),
          });
        }
        return tr('{user} 退出了群聊', '{user} left the group chat', { user: name(ev.user_id) });
      case 'group_message_delete': {
        const who = String(ev.operator_id) === CM.selfId(data) ? tr('你', 'You') : name(ev.operator_id);
        if (ev.sub_type === 'delete') {
          return tr('{who} 删除了一条消息', '{who} deleted a message', { who });
        }
        return tr('{who} 撤回了一条消息', '{who} recalled a message', { who });
      }
      case 'friend_increase':
        return tr('你们已成为好友', 'You are now friends');
      case 'friend_decrease':
        return tr('{user} 与你解除了好友关系', '{user} removed you as a friend', { user: name(ev.user_id) });
      default:
        return '[' + ev.detail_type + ']';
    }
  };

  CM.sessionLastTime = function (s) {
    let t = 0;
    (s.events || []).forEach((e) => {
      if (e.time > t) t = e.time;
    });
    return t;
  };
  CM.sessionPreview = function (data, s) {
    const ev = (s.events || [])[s.events.length - 1];
    if (!ev) return tr('还没有消息', 'No messages yet');
    if (ev.type === 'notice') return CM.noticeText(data, ev);
    let text = ev.alt_message || CM.altMessage(ev.message, data);
    if (!text) text = tr('[消息]', '[Message]');
    return text.replace(/\n+/g, ' ');
  };
})();
