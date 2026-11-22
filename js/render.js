/* render.js — pure canvas renderer for the chat mockup (no DOM, no network) */
(function () {
  'use strict';
  const CM = window.CM;
  const R = (CM.render = {});
  const tr = (zh, en, vars) => CM.i18n.tr(zh, en, vars);

  const W = CM.DESIGN_WIDTH;
  const PAD = 14;
  const AV = 40;
  const AV_GAP = 10;
  const BPX = 12;
  const BPY = 9;
  const MAX_CANVAS = 32000;

  const mctx = document.createElement('canvas').getContext('2d');
  const imgCache = new Map();

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const font = (size, weight) => (weight || 400) + ' ' + size + 'px ' + CM.FONT;
  const textW = (s, f) => {
    mctx.font = f;
    return mctx.measureText(s).width;
  };

  function rr(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad);
    else {
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    }
  }

  function ellipsize(text, f, maxW) {
    if (textW(text, f) <= maxW) return text;
    let out = '';
    const chars = Array.from(String(text));
    for (let i = 0; i < chars.length; i++) {
      if (textW(out + chars[i] + '…', f) > maxW) break;
      out += chars[i];
    }
    return out + '…';
  }

  function wrapLines(text, f, maxW) {
    const lines = [];
    let line = '';
    for (const ch of Array.from(String(text))) {
      if (ch === '\n') {
        lines.push(line);
        line = '';
        continue;
      }
      const test = line + ch;
      if (textW(test, f) > maxW && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    lines.push(line);
    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* images                                                              */
  /* ------------------------------------------------------------------ */

  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (imgCache.has(url)) return imgCache.get(url);
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    imgCache.set(url, p);
    return p;
  }
  R.loadImage = loadImage;
  R.image = (url) => {
    const p = imgCache.get(url);
    return p && p.__img ? p.__img : null;
  };

  R.prepare = async function (data) {
    const urls = new Set();
    Object.keys(data.files || {}).forEach((id) => {
      const f = data.files[id];
      if (f && f.dataUrl) urls.add(f.dataUrl);
    });
    (data.characters || []).forEach((c) => {
      if (c.avatarImage) urls.add(c.avatarImage);
    });
    if (data.settings && data.settings.backgroundImage) urls.add(data.settings.backgroundImage);
    const jobs = [];
    urls.forEach((u) => {
      const p = loadImage(u);
      jobs.push(
        p.then((img) => {
          p.__img = img;
        })
      );
    });
    await Promise.all(jobs);
    await (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve());
    return true;
  };
  R.clearCache = () => imgCache.clear();

  /* ------------------------------------------------------------------ */
  /* inline text layout                                                  */
  /* ------------------------------------------------------------------ */

  function tokenize(str) {
    const out = [];
    let word = '';
    for (const ch of Array.from(str)) {
      const code = ch.codePointAt(0);
      const wide = code >= 0x2e80 || code >= 0x1f000;
      if (/\s/.test(ch) || wide) {
        if (word) {
          out.push(word);
          word = '';
        }
        out.push(ch);
      } else {
        word += ch;
      }
    }
    if (word) out.push(word);
    return out;
  }

  function wrapAtoms(atoms, maxW) {
    const lines = [];
    let cur = [];
    let curW = 0;
    const flush = () => {
      lines.push(cur);
      cur = [];
      curW = 0;
    };
    for (const atom of atoms) {
      if (atom.nl) {
        flush();
        continue;
      }
      const f = atom.font;
      for (const raw of tokenize(atom.text)) {
        const w = textW(raw, f);
        if (curW + w > maxW && curW > 0) flush();
        if (w > maxW) {
          for (const ch of Array.from(raw)) {
            const cw = textW(ch, f);
            if (curW + cw > maxW && curW > 0) flush();
            cur.push({ text: ch, font: f, color: atom.color, w: cw, emoji: atom.emoji });
            curW += cw;
          }
        } else {
          cur.push({ text: raw, font: f, color: atom.color, w, emoji: atom.emoji });
          curW += w;
        }
      }
    }
    if (cur.length || !lines.length) flush();
    while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
    const merged = lines.map((line) => {
      const runs = [];
      line.forEach((tok) => {
        const last = runs[runs.length - 1];
        if (last && last.font === tok.font && last.color === tok.color && !tok.emoji && !last.emoji) {
          last.text += tok.text;
          last.w += tok.w;
        } else {
          runs.push({ text: tok.text, font: tok.font, color: tok.color, w: tok.w, emoji: tok.emoji });
        }
      });
      return { runs, w: runs.reduce((a, b) => a + b.w, 0) };
    });
    return merged;
  }

  /* ------------------------------------------------------------------ */
  /* content measurement                                                 */
  /* ------------------------------------------------------------------ */

  function fileOf(data, id) {
    return (data.files && data.files[id]) || null;
  }

  function imgOfFile(data, id) {
    const f = fileOf(data, id);
    if (!f || !f.dataUrl) return null;
    return R.image(f.dataUrl);
  }

  function quoteInfo(data, session, seg) {
    const d = seg.data || {};
    let target = null;
    for (const ev of session.events || []) {
      if (ev.type === 'message' && String(ev.message_id) === String(d.message_id)) {
        target = ev;
        break;
      }
    }
    let name = '';
    let text = '';
    if (target) {
      name = CM.charName(data, target.user_id);
      text = CM.altMessage(target.message, data).replace(/\n+/g, ' ') || tr('[消息]', '[Message]');
    } else {
      name = d.user_id ? CM.charName(data, d.user_id) : tr('原消息', 'Original message');
      text = tr('消息已不存在', 'Message no longer exists');
    }
    return { name, text };
  }

  function buildContent(data, session, ev, theme, fs, maxContentW, isSelf) {
    const lh = Math.round(fs * 1.42);
    const padTopGap = 6;
    const parts = [];
    let atoms = [];
    let quote = null;

    const baseColor = isSelf ? theme.selfText : theme.otherText;
    const mentionColor = isSelf ? theme.selfAccent : theme.accent;

    const flush = () => {
      if (!atoms.length) return;
      const lines = wrapAtoms(atoms, maxContentW);
      const h = Math.max(1, lines.length) * lh;
      const w = lines.reduce((a, l) => Math.max(a, l.w), 0);
      parts.push({ kind: 'lines', lines, w, h });
      atoms = [];
    };

    for (const seg of ev.message || []) {
      const d = (seg && seg.data) || {};
      if (seg.type === 'reply') {
        if (!quote) {
          const info = quoteInfo(data, session, seg);
          const qf = font(11.5, 600);
          const sf = font(11.5, 400);
          const nameF = font(11.5, 600);
          const maxQ = maxContentW - 18;
          const nameW = Math.min(textW(info.name, nameF) + 2, maxQ * 0.45);
          const sumW = Math.max(40, maxQ - nameW - 10);
          const qw = Math.min(maxContentW, nameW + 10 + Math.min(sumW, textW(info.text, sf)) + 18);
          quote = {
            kind: 'quote',
            w: Math.max(120, qw),
            h: 36,
            name: info.name,
            text: info.text,
            nameF,
            sf,
            nameW,
            sumW,
          };
        }
        continue;
      }
      if (seg.type === 'text') {
        const raw = String(d.text == null ? '' : d.text);
        const pieces = raw.split('\n');
        pieces.forEach((p, i) => {
          if (i) atoms.push({ nl: true });
          if (p) atoms.push({ text: p, font: font(fs), color: baseColor });
        });
        continue;
      }
      if (seg.type === 'mention') {
        const name = CM.charName(data, d.user_id);
        atoms.push({ text: '@' + name, font: font(fs, 600), color: mentionColor, emoji: true });
        continue;
      }
      if (seg.type === 'mention_all') {
        atoms.push({ text: tr('@全体成员', '@all'), font: font(fs, 600), color: mentionColor, emoji: true });
        continue;
      }
      if (seg.type === 'qq.face') {
        const f = CM.faceOf(d.id);
        atoms.push({ text: f.emoji, font: font(Math.round(fs * 1.18)), color: baseColor, emoji: true });
        continue;
      }
      if (seg.type === 'image') {
        flush();
        const raw = imgOfFile(data, d.file_id);
        let iw = 210;
        let ih = 140;
        if (raw) {
          const maxW = Math.min(232, maxContentW);
          const maxH = 280;
          const scale = Math.min(maxW / raw.naturalWidth, maxH / raw.naturalHeight, 1);
          iw = Math.max(48, Math.round(raw.naturalWidth * scale));
          ih = Math.max(48, Math.round(raw.naturalHeight * scale));
        }
        parts.push({ kind: 'image', w: iw, h: ih, img: raw, id: d.file_id });
        continue;
      }
      if (seg.type === 'voice') {
        flush();
        const f = fileOf(data, d.file_id) || {};
        const dur = clamp(Number(f.duration) || 3, 1, 60);
        const vw = clamp(76 + dur * 13, 92, Math.min(210, maxContentW));
        parts.push({ kind: 'voice', w: vw, h: 36, duration: dur });
        continue;
      }
      if (seg.type === 'audio' || seg.type === 'video') {
        flush();
        const f = fileOf(data, d.file_id) || {};
        const dur = Number(f.duration) || 0;
        const label = f.name || (seg.type === 'video' ? tr('视频', 'Video') : tr('音频', 'Audio'));
        parts.push({
          kind: seg.type,
          w: Math.min(240, maxContentW),
          h: 62,
          label,
          duration: dur,
          size: f.size || 0,
        });
        continue;
      }
      if (seg.type === 'file') {
        flush();
        const f = fileOf(data, d.file_id) || {};
        parts.push({
          kind: 'file',
          w: Math.min(242, maxContentW),
          h: 64,
          name: f.name || tr('未命名文件', 'Untitled file'),
          size: f.size || 0,
        });
        continue;
      }
      if (seg.type === 'location') {
        flush();
        parts.push({
          kind: 'location',
          w: Math.min(242, maxContentW),
          h: 96,
          title: d.title || tr('位置', 'Location'),
          content: d.content || '',
        });
        continue;
      }
      // unknown / extended segment: render an inline marker
      atoms.push({ text: '[' + seg.type + ']', font: font(fs), color: theme.noticeText });
    }
    flush();

    if (quote) parts.unshift(quote);

    const contentW = parts.reduce((a, p) => Math.max(a, p.w), 0);
    const contentH = parts.reduce((a, p, i) => a + p.h + (i ? padTopGap : 0), 0);
    return { parts, contentW, contentH };
  }

  /* ------------------------------------------------------------------ */
  /* message layout                                                      */
  /* ------------------------------------------------------------------ */

  function layoutMessage(data, session, ev, theme, cfg, index) {
    const fs = cfg.fontSize;
    const isSelf = String(ev.user_id) === String(data.self.user_id);
    const chars = CM.charMap(data);
    const ch = chars[ev.user_id] || null;
    const name = CM.charName(data, ev.user_id);
    const maxContentW = cfg.bubbleMax - BPX * 2;
    const content = buildContent(data, session, ev, theme, fs, maxContentW, isSelf);

    if (!content.parts.length) return null;
    const onlyKind = content.parts.length === 1 ? content.parts[0].kind : '';
    const mediaOnly = onlyKind === 'image';
    const cardOnly = ['file', 'location', 'audio', 'video'].includes(onlyKind);
    const voiceOnly = onlyKind === 'voice';
    const padX = mediaOnly || cardOnly || voiceOnly ? 0 : BPX;
    const padY = mediaOnly ? 0 : BPY;

    let bubbleW = content.contentW + padX * 2;
    let bubbleH = content.contentH + padY * 2;
    if (mediaOnly && content.parts[0]) {
      bubbleW = content.parts[0].w;
      bubbleH = content.parts[0].h;
    }
    bubbleW = Math.min(cfg.bubbleMax, Math.max(44, bubbleW));
    const showName = session.detail_type === 'group' && !isSelf && cfg.showNames;
    const nameH = showName ? 17 : 0;
    const rowH = nameH + bubbleH;

    return {
      kind: 'msg',
      eventId: ev.id,
      eventIndex: index,
      y: 0,
      h: rowH,
      isSelf,
      name,
      ch,
      nameH,
      bubble: {
        w: bubbleW,
        h: bubbleH,
        padX,
        padY,
        mediaOnly,
        cardOnly,
        voiceOnly,
        content,
        radius: mediaOnly ? 8 : theme.bubbleRadius,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* layout                                                              */
  /* ------------------------------------------------------------------ */

  R.layout = function (data, session, opts) {
    opts = opts || {};
    const settings = data.settings || {};
    const cfg = {
      fontSize: clamp(Number(settings.fontSize) || 15, 13, 19),
      bubbleMax: clamp(Number(settings.bubbleWidth) || 258, 200, 310),
      gapMinutes: clamp(Number(settings.gapMinutes) || 5, 0, 1440),
      showNames: settings.showNames !== false,
      showHeader: opts.includeHeader != null ? !!opts.includeHeader : settings.showHeader !== false,
      showStatus:
        opts.includeStatus != null ? !!opts.includeStatus : settings.showStatus !== false,
      selectedId: opts.selectedId ? String(opts.selectedId) : '',
    };
    if (!cfg.showHeader) cfg.showStatus = false;
    const theme = CM.theme(settings);
    const statusH = cfg.showStatus ? 44 : 0;
    const headerH = cfg.showHeader ? 54 : 0;

    const recalled = new Set();
    (session.events || []).forEach((ev) => {
      if (ev.type === 'notice' && ev.detail_type === 'group_message_delete' && ev.message_id) {
        recalled.add(String(ev.message_id));
      }
    });

    const items = [];
    let y = statusH + headerH + (cfg.showHeader ? 6 : 10);
    let lastTime = null;

    (session.events || []).forEach((ev, index) => {
      if (ev.type === 'message' && recalled.has(String(ev.message_id))) return;
      const t = Number(ev.time) || 0;
      const prevDay = lastTime == null ? null : new Date(lastTime * 1000).toDateString();
      const day = new Date(t * 1000).toDateString();
      const needTime =
        lastTime == null || (t - lastTime) / 60 >= cfg.gapMinutes || (prevDay && day !== prevDay);
      if (needTime) {
        y += items.length ? 8 : 0;
        items.push({ kind: 'time', text: CM.fmtDivider(t), y, h: 22 });
        y += 22;
      }
      if (ev.type === 'notice') {
        y += 8;
        const text = CM.noticeText(data, ev);
        items.push({ kind: 'notice', text, y, h: 24, eventId: ev.id });
        y += 24;
      } else {
        const m = layoutMessage(data, session, ev, theme, cfg, index);
        if (m) {
          y += 14;
          m.y = y;
          items.push(m);
          y += m.h;
        }
      }
      lastTime = t;
    });

    const empty = !items.some((i) => i.kind === 'msg');
    if (empty) y += 120;
    const height = Math.max(y + 20, statusH + headerH + 120);

    return {
      width: W,
      height,
      theme,
      cfg,
      items,
      session,
      data,
      statusH,
      headerH,
      empty,
      lastTime,
    };
  };

  /* ------------------------------------------------------------------ */
  /* drawing primitives                                                  */
  /* ------------------------------------------------------------------ */

  function drawAvatar(ctx, ch, x, y, size, theme) {
    const r = theme.platform === 'wechat' ? theme.avatarRadius : size / 2;
    ctx.save();
    rr(ctx, x, y, size, size, r);
    ctx.clip();
    const img = ch && ch.avatarImage ? R.image(ch.avatarImage) : null;
    if (img && img.naturalWidth) {
      const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = (ch && ch.color) || '#93b4ff';
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(Math.round(size * 0.52), 400);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((ch && ch.avatar) || '🙂', x + size / 2, y + size / 2 + 1);
    }
    ctx.restore();
    ctx.save();
    rr(ctx, x, y, size, size, r);
    ctx.strokeStyle = 'rgba(0,0,0,.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawStatusBar(ctx, layout) {
    const { theme, cfg, session } = layout;
    const settings = layout.data.settings;
    const statusH = layout.statusH;
    if (!cfg.showStatus || !cfg.showHeader) return;
    ctx.save();
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(0, 0, W, statusH);

    const st = settings.statusTime && /^\d{1,2}:\d{2}$/.test(settings.statusTime)
      ? settings.statusTime
      : CM.fmtClock(layout.lastTime || CM.nowSec());
    ctx.fillStyle = theme.statusText;
    ctx.font = font(13, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(st, 24, 28);

    // signal
    const sx = W - 78;
    ctx.fillStyle = theme.statusText;
    [4, 6, 8, 10].forEach((h, i) => {
      rr(ctx, sx + i * 5, 28 - h, 3, h, 1);
      ctx.fill();
    });
    // wifi
    const wx = W - 48;
    const wy = 29;
    ctx.strokeStyle = theme.statusText;
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    [3.5, 6.5, 9.5].forEach((rad, i) => {
      ctx.beginPath();
      ctx.arc(wx, wy + 3, rad, Math.PI * 1.22, Math.PI * 1.78);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(wx, wy + 3, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = theme.statusText;
    ctx.fill();
    // battery
    const bx = W - 30;
    const by = 18;
    ctx.strokeStyle = theme.statusText;
    ctx.lineWidth = 1.2;
    rr(ctx, bx, by, 20, 10, 2.5);
    ctx.stroke();
    ctx.fillStyle = theme.statusText;
    rr(ctx, bx + 2.5, by + 2.5, 11, 5, 1);
    ctx.fill();
    rr(ctx, bx + 21, by + 3.5, 2, 3, 1);
    ctx.fill();
    ctx.restore();
  }

  function drawHeader(ctx, layout) {
    const { theme, cfg, session } = layout;
    if (!cfg.showHeader) return;
    const y0 = layout.statusH;
    const h = layout.headerH;
    ctx.save();
    ctx.fillStyle = theme.headerBg;
    ctx.fillRect(0, y0, W, h);
    // hairline
    ctx.fillStyle = theme.headerLine;
    ctx.fillRect(0, y0 + h - 1, W, 1);

    // back chevron
    ctx.strokeStyle = theme.headerText;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(23, y0 + h / 2 - 8);
    ctx.lineTo(15, y0 + h / 2);
    ctx.lineTo(23, y0 + h / 2 + 8);
    ctx.stroke();

    const subtitle =
      theme.platform === 'qq' && session.detail_type === 'group'
        ? session.member_count
          ? tr('{n}人', '{n} members', { n: session.member_count })
          : tr('群聊', 'Group chat')
        : theme.platform === 'qq'
        ? tr('在线', 'Online')
        : '';

    const titleY = subtitle ? y0 + 31 : y0 + h / 2 + 6;
    ctx.fillStyle = theme.headerText;
    ctx.font = font(17, 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(ellipsize(session.title || '', font(17, 600), W - 130), W / 2, titleY);
    if (subtitle) {
      ctx.fillStyle = theme.headerSub;
      ctx.font = font(10.5, 400);
      ctx.fillText(subtitle, W / 2, y0 + 46);
    }

    // three dots
    ctx.fillStyle = theme.headerText;
    const dx = W - 28;
    const dy = y0 + h / 2;
    [-6, 0, 6].forEach((o) => {
      ctx.beginPath();
      ctx.arc(dx + o, dy, 1.7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawBackground(ctx, layout) {
    const { theme, height } = layout;
    const settings = layout.data.settings;
    if (settings.backgroundImage) {
      const img = R.image(settings.backgroundImage);
      if (img && img.naturalWidth) {
        const s = Math.max(W / img.naturalWidth, height / img.naturalHeight);
        const dw = img.naturalWidth * s;
        const dh = img.naturalHeight * s;
        ctx.drawImage(img, (W - dw) / 2, (height - dh) / 2, dw, dh);
        ctx.fillStyle = theme.mode === 'dark' ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.08)';
        ctx.fillRect(0, 0, W, height);
        return;
      }
    }
    ctx.fillStyle = settings.backgroundTint || theme.bg;
    ctx.fillRect(0, 0, W, height);
  }

  function drawTime(ctx, item, layout) {
    const { theme } = layout;
    ctx.save();
    ctx.fillStyle = theme.time;
    ctx.font = font(11, 400);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.text, W / 2, item.y + item.h / 2 + 1);
    ctx.restore();
  }

  function drawNotice(ctx, item, layout) {
    const { theme } = layout;
    const f = font(11, 400);
    const label = ellipsize(item.text, f, W - 100);
    const tw = textW(label, f);
    const bw = tw + 22;
    const bh = 22;
    ctx.save();
    ctx.fillStyle = theme.noticeBg;
    rr(ctx, (W - bw) / 2, item.y + (item.h - bh) / 2, bw, bh, 5);
    ctx.fill();
    ctx.fillStyle = theme.noticeText;
    ctx.font = f;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, item.y + item.h / 2 + 0.5);
    ctx.restore();
  }

  function drawQuote(ctx, q, x, y, theme, isSelf) {
    ctx.save();
    ctx.fillStyle = isSelf ? theme.selfQuoteBg : theme.quoteBg;
    rr(ctx, x, y, q.w, q.h, 4);
    ctx.fill();
    ctx.fillStyle = isSelf ? 'rgba(255,255,255,.6)' : theme.quoteBar;
    rr(ctx, x, y, 2.5, q.h, 1.2);
    ctx.fill();
    ctx.font = q.nameF;
    ctx.fillStyle = isSelf ? '#ffffff' : theme.accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const nm = ellipsize(q.name, q.nameF, q.nameW);
    ctx.fillText(nm, x + 8, y + 13);
    const nw = textW(nm, q.nameF);
    ctx.font = q.sf;
    ctx.fillStyle = isSelf ? 'rgba(255,255,255,.78)' : theme.noticeText;
    const summary = ellipsize(q.text, q.sf, q.w - nw - 20);
    ctx.fillText(summary, x + 8 + nw + 5, y + 13);
    ctx.restore();
  }

  function drawLines(ctx, part, x, y, fs) {
    const lh = Math.round(fs * 1.42);
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    part.lines.forEach((line, i) => {
      let cx = x;
      const baseline = y + i * lh + lh / 2 + 0.5;
      line.runs.forEach((run) => {
        ctx.font = run.font;
        ctx.fillStyle = run.color;
        ctx.fillText(run.text, cx, baseline);
        cx += run.w;
      });
    });
    ctx.restore();
  }

  function drawVoice(ctx, part, x, y, theme, isSelf) {
    const color = isSelf ? theme.selfText : theme.otherText;
    const H = part.h;
    const bars = [7, 13, 19, 11, 16, 9];
    const bw = 3;
    const gap = 3;
    const startX = x + 14;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    bars.forEach((bh, i) => {
      rr(ctx, startX + i * (bw + gap), y + (H - bh) / 2, bw, bh, 1.5);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.font = font(12.5, 500);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(part.duration + '″', x + part.w - 12, y + H / 2 + 0.5);
    ctx.restore();
  }

  function drawFileIcon(ctx, x, y, size, theme) {
    ctx.save();
    ctx.fillStyle = theme.fileIconBg;
    rr(ctx, x, y, size, size, 8);
    ctx.fill();
    const pw = size * 0.42;
    const ph = size * 0.54;
    const px = x + (size - pw) / 2;
    const py = y + (size - ph) / 2;
    ctx.fillStyle = theme.fileIconText;
    rr(ctx, px, py, pw, ph, 2);
    ctx.fill();
    ctx.fillStyle = theme.fileIconBg;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(px + 4, py + 6 + i * 5, pw - 8, 1.6);
    }
    ctx.restore();
  }

  function drawFile(ctx, part, x, y, theme, isSelf) {
    const cardText = isSelf ? theme.otherText : theme.otherText;
    ctx.save();
    drawFileIcon(ctx, x + 12, y + (part.h - 38) / 2, 38, theme);
    ctx.fillStyle = cardText;
    ctx.font = font(13, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const name = ellipsize(part.name, font(13, 600), part.w - 70);
    ctx.fillText(name, x + 62, y + 24);
    ctx.fillStyle = theme.cardSub;
    ctx.font = font(10.5, 400);
    ctx.fillText(CM.fmtBytes(part.size), x + 62, y + 44);
    ctx.restore();
  }

  function drawMedia(ctx, part, x, y, theme, isSelf) {
    const c = isSelf ? theme.otherText : theme.otherText;
    ctx.save();
    ctx.fillStyle = theme.fileIconBg;
    ctx.beginPath();
    ctx.arc(x + 34, y + part.h / 2, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.fileIconText;
    ctx.beginPath();
    const cx = x + 37;
    const cy = y + part.h / 2;
    ctx.moveTo(cx - 4, cy - 7);
    ctx.lineTo(cx + 8, cy);
    ctx.lineTo(cx - 4, cy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c;
    ctx.font = font(13, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(part.label, font(13, 600), part.w - 82), x + 62, y + 25);
    if (part.duration) {
      ctx.fillStyle = theme.cardSub;
      ctx.font = font(10.5, 400);
      ctx.fillText(part.duration + '″', x + 62, y + 44);
    }
    ctx.restore();
  }

  function drawLocation(ctx, part, x, y, theme, clipW) {
    ctx.save();
    rr(ctx, x, y, clipW, part.h, 6);
    ctx.clip();
    ctx.fillStyle = theme.mapBg;
    ctx.fillRect(x, y, clipW, part.h);
    // roads
    ctx.strokeStyle = theme.mapRoad;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 10, y + 26);
    ctx.lineTo(x + clipW + 10, y + 44);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + 40, y - 8);
    ctx.lineTo(x + 62, y + part.h + 8);
    ctx.stroke();
    // park
    ctx.fillStyle = theme.mapPark;
    rr(ctx, x + clipW - 78, y + 6, 66, 40, 10);
    ctx.fill();
    // water
    ctx.fillStyle = 'rgba(120,180,210,.45)';
    ctx.beginPath();
    ctx.ellipse(x + 36, y + 74, 60, 26, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // pin
    const px = x + 42;
    const py = y + 40;
    ctx.fillStyle = '#ef5b5b';
    ctx.beginPath();
    ctx.arc(px, py - 8, 8, Math.PI * 0.15, Math.PI * 0.85);
    ctx.lineTo(px, py + 9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py - 8, 3, 0, Math.PI * 2);
    ctx.fill();
    // panel
    ctx.fillStyle = theme.mapPanel;
    ctx.fillRect(x, y + part.h - 40, clipW, 40);
    ctx.fillStyle = theme.mapText;
    ctx.font = font(12, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(part.title, font(12, 600), clipW - 24), x + 12, y + part.h - 24);
    ctx.fillStyle = theme.cardSub;
    ctx.font = font(10, 400);
    ctx.fillText(ellipsize(part.content, font(10, 400), clipW - 24), x + 12, y + part.h - 9);
    ctx.restore();
  }

  function drawImageBlock(ctx, part, x, y, theme) {
    if (!part.img) {
      ctx.save();
      ctx.fillStyle = theme.fileBg;
      rr(ctx, x, y, part.w, part.h, 6);
      ctx.fill();
      ctx.fillStyle = theme.cardSub;
      ctx.font = font(12, 400);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tr('图片不可用', 'Image unavailable'), x + part.w / 2, y + part.h / 2);
      ctx.restore();
      return;
    }
    ctx.save();
    rr(ctx, x, y, part.w, part.h, 6);
    ctx.clip();
    const s = Math.max(part.w / part.img.naturalWidth, part.h / part.img.naturalHeight);
    const dw = part.img.naturalWidth * s;
    const dh = part.img.naturalHeight * s;
    ctx.drawImage(part.img, x + (part.w - dw) / 2, y + (part.h - dh) / 2, dw, dh);
    ctx.restore();
  }

  function drawBubbleContent(ctx, msg, x, y, layout) {
    const { theme, cfg } = layout;
    const fs = cfg.fontSize;
    const isSelf = msg.isSelf;
    const b = msg.bubble;
    let cy = y;
    b.content.parts.forEach((part, i) => {
      if (i) cy += 6;
      if (part.kind === 'lines') {
        drawLines(ctx, part, x, cy, fs);
      } else if (part.kind === 'quote') {
        drawQuote(ctx, part, x, cy, theme, isSelf);
      } else if (part.kind === 'image') {
        drawImageBlock(ctx, part, x, cy, theme);
      } else if (part.kind === 'voice') {
        drawVoice(ctx, part, x, cy, theme, isSelf);
      } else if (part.kind === 'file') {
        drawFile(ctx, part, x, cy, theme, isSelf);
      } else if (part.kind === 'location') {
        drawLocation(ctx, part, x, cy, theme, part.w);
      } else if (part.kind === 'audio' || part.kind === 'video') {
        drawMedia(ctx, part, x, cy, theme, isSelf);
      }
      cy += part.h;
    });
  }

  function drawMessage(ctx, item, layout) {
    const { theme, cfg } = layout;
    const b = item.bubble;
    const avatarX = item.isSelf ? W - PAD - AV : PAD;
    const bubbleX = item.isSelf ? W - PAD - AV - AV_GAP - b.w : PAD + AV + AV_GAP;
    const bubbleY = item.y + item.nameH;

    if (item.nameH) {
      ctx.save();
      ctx.fillStyle = theme.name;
      ctx.font = font(11.5, 400);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ellipsize(item.name, font(11.5, 400), b.w - 4), bubbleX, bubbleY - 8);
      ctx.restore();
    }

    drawAvatar(ctx, item.ch, avatarX, bubbleY, AV, theme);

    if (!b.mediaOnly) {
      let bg = item.isSelf ? theme.selfBubble : theme.otherBubble;
      if (b.cardOnly) bg = theme.otherBubble;
      ctx.save();
      ctx.fillStyle = bg;
      rr(ctx, bubbleX, bubbleY, b.w, b.h, b.radius);
      ctx.fill();

      if (theme.tail && !b.cardOnly) {
        const ty = bubbleY + 13;
        ctx.beginPath();
        if (item.isSelf) {
          ctx.moveTo(bubbleX + b.w - 1, ty);
          ctx.lineTo(bubbleX + b.w + 7, ty + 4);
          ctx.lineTo(bubbleX + b.w - 1, ty + 10);
        } else {
          ctx.moveTo(bubbleX + 1, ty);
          ctx.lineTo(bubbleX - 7, ty + 4);
          ctx.lineTo(bubbleX + 1, ty + 10);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    const contentX = bubbleX + b.padX;
    const contentY = bubbleY + b.padY;
    drawBubbleContent(ctx, item, contentX, contentY, layout);
  }

  /* ------------------------------------------------------------------ */
  /* top-level draw                                                      */
  /* ------------------------------------------------------------------ */

  R.draw = function (ctx, layout) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    drawBackground(ctx, layout);
    drawStatusBar(ctx, layout);
    drawHeader(ctx, layout);

    for (const item of layout.items) {
      if (item.kind === 'time') drawTime(ctx, item, layout);
      else if (item.kind === 'notice') drawNotice(ctx, item, layout);
      else if (item.kind === 'msg') drawMessage(ctx, item, layout);
    }

    if (layout.empty) {
      ctx.fillStyle = layout.theme.noticeText;
      ctx.font = font(12, 400);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tr('还没有聊天记录', 'No chat history yet'), W / 2, layout.statusH + layout.headerH + 80);
    }

    if (layout.cfg.selectedId) {
      const sel = layout.items.find(
        (i) => i.kind === 'msg' && i.eventId === layout.cfg.selectedId
      );
      if (sel) drawSelection(ctx, sel, layout);
    }
    ctx.restore();
    return layout;
  };

  function drawSelection(ctx, item, layout) {
    const b = item.bubble;
    const bubbleX = item.isSelf ? W - PAD - AV - AV_GAP - b.w : PAD + AV + AV_GAP;
    const bubbleY = item.y + item.nameH;
    ctx.save();
    rr(ctx, bubbleX - 4, bubbleY - 4, b.w + 8, b.h + 8, b.radius + 4);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 5;
    ctx.stroke();
    rr(ctx, bubbleX - 2, bubbleY - 2, b.w + 4, b.h + 4, b.radius + 2);
    ctx.strokeStyle = '#0b84ff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  R.render = async function (canvas, data, session, opts) {
    opts = opts || {};
    await R.prepare(data);
    const layout = R.layout(data, session, opts);
    let scale = Number(opts.scale) || 2;
    if (layout.height * scale > MAX_CANVAS) scale = Math.max(0.35, MAX_CANVAS / layout.height);
    canvas.width = Math.max(1, Math.round(W * scale));
    canvas.height = Math.max(1, Math.round(layout.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    R.draw(ctx, layout);
    return layout;
  };

  R.exportCanvas = async function (data, session, opts) {
    opts = opts || {};
    await R.prepare(data);
    const width = clamp(Number(opts.width) || 1080, 360, 2160);
    const scale = width / W;
    const layout = R.layout(data, session, opts);
    if (layout.height * scale > MAX_CANVAS || layout.height * scale * width > 268000000) {
      throw new Error(tr('聊天记录过长，无法导出为一张图片', 'The chat log is too long to export as a single image'));
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(layout.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    R.draw(ctx, layout);
    return { canvas, layout, width: canvas.width, height: canvas.height };
  };

  R.canvasToBlob = (canvas) =>
    new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
      else resolve(null);
    });

  R.hitTest = function (layout, designY) {
    for (const item of layout.items) {
      if (item.kind !== 'msg') continue;
      if (designY >= item.y && designY <= item.y + item.h) return item;
    }
    return null;
  };
})();
