/* Ducts On Call — Video Archive */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    grid: $('#grid'), empty: $('#empty'), count: $('#archive-title'), more: $('#btn-more'),
    search: $('#search'), heroSearch: $('#hero-search'), heroForm: $('#hero-search-form'),
    clearSearch: $('#btn-clear-search'), reset: $('#btn-reset'), emptyReset: $('#btn-empty-reset'),
    topicRow: $('#topic-row'), yearSelect: $('#year-select'), sortSelect: $('#sort-select'),
    kindButtons: $$('.segmented button'), random: $('#btn-random'),
    player: $('#player'), playerInner: $('.player-inner'), playerMedia: $('#player-media'),
    playerTitle: $('#player-title'), playerMeta: $('#player-meta'), playerTopics: $('#player-topics'),
    playerDesc: $('#player-desc'), playerYt: $('#player-yt'), playerShare: $('#player-share'),
    playerClose: $('#player-close'), playerPrev: $('#player-prev'), playerNext: $('#player-next'),
    copied: $('#copied'), updated: $('#updated'), year: $('#year'),
  };

  const PAGE = 24;
  const state = { q: '', kind: 'all', year: '', topic: '', sort: 'newest', shown: PAGE };
  let videos = [];
  let visible = [];
  let current = null;

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtNum = (n) => Number(n ?? 0).toLocaleString('en-US');
  const fmtDur = (s) => {
    if (!s && s !== 0) return '';
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  };
  const tokens = (q) => q.toLowerCase().split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const highlight = (text, toks) => {
    let out = esc(text);
    if (!toks.length) return out;
    const re = new RegExp('(' + toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'ig');
    return out.replace(re, '<mark>$1</mark>');
  };
  const thumbFor = (v) => v.kind === 'short'
    ? `https://i.ytimg.com/vi/${v.id}/frame0.jpg`
    : `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
  const linkify = (text) => esc(text).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\//, '')}</a>`);

  // ---------- URL state ----------
  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    state.kind = ['video', 'short'].includes(p.get('type')) ? p.get('type') : 'all';
    state.year = p.get('year') || '';
    state.topic = p.get('topic') || '';
    state.sort = ['newest', 'oldest', 'views', 'title'].includes(p.get('sort')) ? p.get('sort') : 'newest';
    return p.get('v');
  }
  function writeUrl(videoId) {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.kind !== 'all') p.set('type', state.kind);
    if (state.year) p.set('year', state.year);
    if (state.topic) p.set('topic', state.topic);
    if (state.sort !== 'newest') p.set('sort', state.sort);
    if (videoId) p.set('v', videoId);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  // ---------- filtering ----------
  function score(v, toks) {
    if (!toks.length) return 1;
    const title = v.title.toLowerCase(), desc = (v.description || '').toLowerCase(), topics = (v.topics.join(' ') + ' ' + (v.playlists || []).join(' ')).toLowerCase();
    let s = 0;
    for (const t of toks) {
      if (title.includes(t)) s += 3;
      else if (topics.includes(t)) s += 2;
      else if (desc.includes(t)) s += 1;
      else return 0;
    }
    return s;
  }

  function apply() {
    const toks = tokens(state.q);
    visible = videos
      .map((v) => ({ v, s: score(v, toks) }))
      .filter(({ v, s }) => s > 0
        && (state.kind === 'all' || v.kind === state.kind)
        && (!state.year || v.year === state.year)
        && (!state.topic || v.topics.includes(state.topic)))
      .sort((a, b) => {
        if (toks.length && b.s !== a.s) return b.s - a.s;
        switch (state.sort) {
          case 'oldest': return a.v.published.localeCompare(b.v.published);
          case 'views': return (b.v.views ?? -1) - (a.v.views ?? -1);
          case 'title': return a.v.title.localeCompare(b.v.title);
          default: return b.v.published.localeCompare(a.v.published);
        }
      })
      .map(({ v }) => v);
    render(toks);
    syncControls();
    writeUrl(current ? current.id : null);
  }

  // ---------- rendering ----------
  function cardHtml(v, toks) {
    const isShort = v.kind === 'short';
    const thumb = thumbFor(v);
    return `
      <button type="button" class="card ${isShort ? 'is-short' : ''}" data-id="${v.id}" aria-label="Play: ${esc(v.title)}">
        <div class="thumb" ${isShort ? `style="--bg:url('${thumb}')"` : ''}>
          <img src="${thumb}" alt="" loading="lazy" decoding="async" width="480" height="270"
               onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'" />
          <span class="badge ${isShort ? 'short' : ''}">${isShort ? 'Short' : 'Video'}</span>
          ${v.duration ? `<span class="dur">${fmtDur(v.duration)}</span>` : ''}
          <span class="play" aria-hidden="true"><span><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span></span>
        </div>
        <div class="card-body">
          <h3 class="card-title">${highlight(v.title, toks)}</h3>
          <p class="card-meta">${fmtDate(v.published)}${v.views != null ? ` · ${fmtNum(v.views)} views` : ''}</p>
          <div class="card-topics">${v.topics.slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        </div>
      </button>`;
  }

  function render(toks) {
    const slice = visible.slice(0, state.shown);
    els.grid.innerHTML = slice.map((v) => cardHtml(v, toks)).join('');
    els.grid.setAttribute('aria-busy', 'false');
    els.empty.hidden = visible.length > 0;
    els.more.hidden = visible.length <= state.shown;
    if (!els.more.hidden) els.more.textContent = `Show more (${visible.length - state.shown} remaining)`;

    const filtered = state.q || state.kind !== 'all' || state.year || state.topic;
    els.reset.hidden = !filtered;
    const parts = [];
    if (state.q) parts.push(`matching “${esc(state.q)}”`);
    if (state.topic) parts.push(`in ${esc(state.topic)}`);
    if (state.year) parts.push(`from ${state.year}`);
    const noun = state.kind === 'short' ? 'Shorts' : state.kind === 'video' ? 'videos' : 'videos';
    els.count.innerHTML = `<strong>${visible.length}</strong> ${noun}${parts.length ? ' ' + parts.join(' ') : ''}${!filtered ? ' in the archive' : ''}`;
  }

  function syncControls() {
    els.search.value = state.q;
    els.clearSearch.hidden = !state.q;
    els.kindButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.kind === state.kind));
    els.yearSelect.value = state.year;
    els.sortSelect.value = state.sort;
    $$('.chip', els.topicRow).forEach((c) => c.classList.toggle('is-active', c.dataset.topic === state.topic));
  }

  function buildTopics() {
    const counts = {};
    videos.forEach((v) => v.topics.forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    const order = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    els.topicRow.innerHTML = `<button type="button" class="chip" data-topic="">All topics <small>${videos.length}</small></button>` +
      order.map((t) => `<button type="button" class="chip" data-topic="${esc(t)}">${esc(t)} <small>${counts[t]}</small></button>`).join('');
    const years = Array.from(new Set(videos.map((v) => v.year))).sort().reverse();
    els.yearSelect.innerHTML = '<option value="">All years</option>' + years.map((y) => `<option value="${y}">${y}</option>`).join('');
  }

  function animateCount(el, target) {
    const start = performance.now(), dur = 900;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtNum(Math.round(target * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---------- player ----------
  function openVideo(v, { fromUrl = false } = {}) {
    current = v;
    const isShort = v.kind === 'short';
    els.playerInner.classList.toggle('is-short', isShort);
    els.playerMedia.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${v.id}?autoplay=${fromUrl ? 0 : 1}&rel=0&modestbranding=1" title="${esc(v.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    els.playerTitle.textContent = v.title;
    els.playerMeta.textContent = [isShort ? 'Short' : 'Video', fmtDate(v.published), v.duration ? fmtDur(v.duration) : null, v.views != null ? `${fmtNum(v.views)} views` : null, ...(v.playlists || []).map((p) => `Series: ${p}`)].filter(Boolean).join(' · ');
    els.playerTopics.innerHTML = v.topics.map((t) => `<button type="button" data-topic="${esc(t)}">${esc(t)}</button>`).join('');
    const desc = (v.description || '').trim();
    els.playerDesc.innerHTML = desc ? linkify(desc) : 'No description was added to this video on YouTube.';
    els.playerDesc.classList.toggle('is-empty', !desc);
    els.playerYt.href = v.url;
    els.copied.textContent = '';
    const idx = visible.indexOf(v);
    els.playerPrev.disabled = idx <= 0;
    els.playerNext.disabled = idx < 0 || idx >= visible.length - 1;
    if (!els.player.open) els.player.showModal();
    els.playerBodyScroll && (els.playerBodyScroll.scrollTop = 0);
    writeUrl(v.id);
  }

  function closeVideo() {
    current = null;
    els.playerMedia.innerHTML = '';
    if (els.player.open) els.player.close();
    writeUrl(null);
  }

  function stepVideo(dir) {
    if (!current) return;
    const idx = visible.indexOf(current);
    const next = visible[idx + dir];
    if (next) openVideo(next);
  }

  // ---------- events ----------
  function bind() {
    let t;
    const onSearch = (val) => { state.q = val; state.shown = PAGE; clearTimeout(t); t = setTimeout(apply, 120); };
    els.search.addEventListener('input', (e) => onSearch(e.target.value));
    els.heroForm.addEventListener('submit', (e) => {
      e.preventDefault();
      state.q = els.heroSearch.value; state.shown = PAGE; apply();
      document.getElementById('archive').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => els.search.focus({ preventScroll: true }), 400);
    });
    els.clearSearch.addEventListener('click', () => { state.q = ''; state.shown = PAGE; apply(); els.search.focus(); });
    els.kindButtons.forEach((b) => b.addEventListener('click', () => { state.kind = b.dataset.kind; state.shown = PAGE; apply(); }));
    els.yearSelect.addEventListener('change', (e) => { state.year = e.target.value; state.shown = PAGE; apply(); });
    els.sortSelect.addEventListener('change', (e) => { state.sort = e.target.value; apply(); });
    els.topicRow.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      state.topic = chip.dataset.topic === state.topic ? '' : chip.dataset.topic; state.shown = PAGE; apply();
      chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    const wrap = $('#topic-wrap');
    const updateTopicEdges = () => {
      const r = els.topicRow;
      wrap.classList.toggle('at-start', r.scrollLeft <= 2);
      wrap.classList.toggle('at-end', r.scrollLeft + r.clientWidth >= r.scrollWidth - 2);
    };
    els.topicRow.addEventListener('scroll', updateTopicEdges, { passive: true });
    window.addEventListener('resize', updateTopicEdges);
    $('#topic-left').addEventListener('click', () => els.topicRow.scrollBy({ left: -els.topicRow.clientWidth * 0.7 }));
    $('#topic-right').addEventListener('click', () => els.topicRow.scrollBy({ left: els.topicRow.clientWidth * 0.7 }));
    requestAnimationFrame(updateTopicEdges);
    const resetAll = () => { Object.assign(state, { q: '', kind: 'all', year: '', topic: '', sort: 'newest', shown: PAGE }); els.heroSearch.value = ''; apply(); };
    els.reset.addEventListener('click', resetAll);
    els.emptyReset.addEventListener('click', resetAll);
    els.more.addEventListener('click', () => { state.shown += PAGE; apply(); });
    els.random.addEventListener('click', () => { const pool = visible.length ? visible : videos; openVideo(pool[Math.floor(Math.random() * pool.length)]); });

    els.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.card[data-id]'); if (!card) return;
      const v = videos.find((x) => x.id === card.dataset.id); if (v) openVideo(v);
    });

    els.playerClose.addEventListener('click', closeVideo);
    els.player.addEventListener('close', closeVideo);
    els.player.addEventListener('click', (e) => { if (e.target === els.player) closeVideo(); });
    els.playerPrev.addEventListener('click', () => stepVideo(-1));
    els.playerNext.addEventListener('click', () => stepVideo(1));
    els.playerTopics.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-topic]'); if (!b) return;
      state.topic = b.dataset.topic; state.q = ''; state.kind = 'all'; state.year = ''; state.shown = PAGE;
      closeVideo(); apply();
      document.getElementById('archive').scrollIntoView({ behavior: 'smooth' });
    });
    els.playerShare.addEventListener('click', async () => {
      const url = location.href;
      try {
        if (navigator.share) { await navigator.share({ title: current.title, url }); els.copied.textContent = 'Shared'; }
        else { await navigator.clipboard.writeText(url); els.copied.textContent = 'Link copied'; }
      } catch (_) {
        try { await navigator.clipboard.writeText(url); els.copied.textContent = 'Link copied'; }
        catch (__) { els.copied.textContent = url; }
      }
      setTimeout(() => { els.copied.textContent = ''; }, 2500);
    });

    document.addEventListener('keydown', (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (e.key === '/' && !typing && !els.player.open) { e.preventDefault(); els.search.focus(); els.search.select(); document.getElementById('archive').scrollIntoView({ behavior: 'smooth' }); }
      if (els.player.open) {
        if (e.key === 'ArrowRight') stepVideo(1);
        if (e.key === 'ArrowLeft') stepVideo(-1);
      }
    });
  }

  // ---------- init ----------
  async function init() {
    els.year.textContent = new Date().getFullYear();
    const deepLink = readUrl();
    let data;
    try {
      const res = await fetch('./data/videos.json', { cache: 'no-cache' });
      data = await res.json();
    } catch (err) {
      els.grid.innerHTML = '';
      els.count.textContent = 'The archive could not be loaded. Please refresh the page.';
      return;
    }
    videos = data.videos;
    els.updated.textContent = fmtDate(data.generated);
    const longCount = videos.filter((v) => v.kind === 'video').length;
    animateCount($('[data-count="videos"]'), videos.length);
    animateCount($('[data-count="long"]'), longCount);
    animateCount($('[data-count="shorts"]'), videos.length - longCount);
    animateCount($('[data-count="views"]'), data.channel.views);
    buildTopics();
    bind();
    els.heroSearch.value = state.q;
    apply();
    if (deepLink) {
      const v = videos.find((x) => x.id === deepLink);
      if (v) openVideo(v, { fromUrl: true });
    }
  }

  init();
})();
