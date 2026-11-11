// ══════════════════════════════════════════════════════
// API SOURCES — tried in order
// ══════════════════════════════════════════════════════
const API_SOURCES = [
  (n) => `https://api.alquran.cloud/v1/surah/${n}`,
  (n) => `https://api.alquran.cloud/v1/surah/${n}/ar.asad`,
  (n) => `https://cdn.jsdelivr.net/npm/quran-json@3.1.2/data/surah/ar/${n}.json`,
];

// Parse response based on which source returned it
function parseResponse(data, sourceIdx) {
  if (sourceIdx <= 1) {
    // alquran.cloud format
    return data.data.ayahs.map(a => ({ num: a.numberInSurah, text: a.text }));
  } else {
    // quran-json CDN format: array of {id, text}
    return data.map((a,i) => ({ num: i+1, text: a.text || a }));
  }
}

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
let ayahs = [], curIdx = 0, currentSurah = null;
let recognizing = false, recognition = null;
let fontSizeMode = 'medium';
let lang = 'ar'; // 'ar' | 'en'

const FONT_SIZES = {
  small:  { far:'1.2rem', near:'1.45rem', active:'1.85rem' },
  medium: { far:'1.45rem', near:'1.75rem', active:'2.2rem'  },
  large:  { far:'1.65rem', near:'2.0rem',  active:'2.6rem'  },
  xlarge: { far:'1.9rem',  near:'2.3rem',  active:'3.1rem'  }
};
const fontOrder = ['small','medium','large','xlarge'];

// ══════════════════════════════════════════════════════
// DOM REFS
// ══════════════════════════════════════════════════════
const splash         = document.getElementById('splash');
const appEl          = document.getElementById('app');
const surahSelect    = document.getElementById('surahSelect');
const jumpSurahSel   = document.getElementById('jumpSurah');
const ayahStartInput = document.getElementById('ayahStart');
const fontSizeSelect = document.getElementById('fontSizeSelect');
const loadingWrap    = document.getElementById('loadingWrap');
const loadingTxt     = document.getElementById('loadingTxt');
const startBtn       = document.getElementById('startBtn');
const quranScroll    = document.getElementById('quranScroll');
const ayahContainer  = document.getElementById('ayahContainer');
const topSurah       = document.getElementById('topSurah');
const topJuz         = document.getElementById('topJuz');
const progressFill   = document.getElementById('progressFill');
const progressLabel  = document.getElementById('progressLabel');
const prevBtn        = document.getElementById('prevBtn');
const nextBtn        = document.getElementById('nextBtn');
const micBtn         = document.getElementById('micBtn');
const voiceHint      = document.getElementById('voiceHint');
const jumpPanel      = document.getElementById('jumpPanel');
const jumpBtn        = document.getElementById('jumpBtn');
const jumpAyahInput  = document.getElementById('jumpAyah');
const jumpGo         = document.getElementById('jumpGo');
const jumpCancel     = document.getElementById('jumpCancel');
const toastEl        = document.getElementById('toast');

// ══════════════════════════════════════════════════════
// LANGUAGE
// ══════════════════════════════════════════════════════
function setLang(l) {
  lang = l;
  document.body.classList.toggle('lang-ar', l==='ar');
  document.body.classList.toggle('lang-en', l==='en');
  document.body.dir = l==='ar' ? 'rtl' : 'ltr';
  // Splash buttons
  document.getElementById('langAr').classList.toggle('active', l==='ar');
  document.getElementById('langEn').classList.toggle('active', l==='en');
  // Update all .t elements
  document.querySelectorAll('.t[data-ar][data-en]').forEach(el => {
    el.textContent = el.dataset[l];
  });
  // Rebuild selects with current lang
  populateSelects();
  // Update topbar if app is running
  updateHUD();
}
document.getElementById('langToggleApp').addEventListener('click', () => setLang(lang==='ar'?'en':'ar'));

// ══════════════════════════════════════════════════════
// POPULATE SELECTS
// ══════════════════════════════════════════════════════
function populateSelects() {
  const prevMain = surahSelect.value;
  const prevJump = jumpSurahSel.value;
  [surahSelect, jumpSurahSel].forEach(sel => {
    sel.innerHTML = '';
    SURAHS.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.n;
      const name = lang==='en' ? `${s.n}. ${s.en} (${s.ayat})` : `${s.n}. ${s.ar} (${s.ayat})`;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  });
  if (prevMain) surahSelect.value = prevMain;
  if (prevJump) jumpSurahSel.value = prevJump;
}

surahSelect.addEventListener('change', () => {
  const s = SURAHS.find(x => x.n == surahSelect.value);
  if (s) { ayahStartInput.max = s.ayat; ayahStartInput.value = 1; }
});

// ══════════════════════════════════════════════════════
// FETCH — tries multiple sources
// ══════════════════════════════════════════════════════
async function fetchSurah(surahNum) {
  let lastErr;
  for (let i = 0; i < API_SOURCES.length; i++) {
    try {
      const url = API_SOURCES[i](surahNum);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return parseResponse(data, i);
    } catch(e) {
      lastErr = e;
      console.warn(`Source ${i} failed:`, e.message);
    }
  }
  throw lastErr || new Error('All sources failed');
}

// ══════════════════════════════════════════════════════
// CHUNKING — split long ayahs at Quran pause marks
// ══════════════════════════════════════════════════════
const CHUNK_THRESHOLD = 120; // stripped chars before we chunk
const PAUSE_RE = /([ۚۖۗۙۛۜ۩])/g; // Quran waqf marks

function stripForLength(text) {
  // strip tashkeel to get real character count
  return text.replace(/[\u064B-\u065F\u0670\u0640\u0671]/g,'').replace(/\s+/g,' ').trim();
}

// Returns array of {text, ayahIdx, chunkIdx, isLastChunk, ayahNum}
function buildDisplayBlocks(ayahsArr) {
  const blocks = [];
  ayahsArr.forEach((a, ayahIdx) => {
    const stripped = stripForLength(a.text);
    if (stripped.length <= CHUNK_THRESHOLD) {
      // Short ayah — single block
      blocks.push({ text: a.text, ayahIdx, chunkIdx: 0, isLastChunk: true, ayahNum: a.num, totalChunks: 1 });
    } else {
      // Long ayah — split at pause marks, keeping the mark at end of each chunk
      const parts = a.text.split(PAUSE_RE);
      // Recombine: each pause mark attaches to the preceding segment
      const chunks = [];
      let current = '';
      for (const part of parts) {
        if (/[ۚۖۗۙۛۜ۩]/.test(part)) {
          current += part;
          if (current.trim()) chunks.push(current.trim());
          current = '';
        } else {
          current += part;
        }
      }
      if (current.trim()) chunks.push(current.trim()); // remainder

      // Filter empty and merge tiny trailing chunks into previous
      const finalChunks = [];
      for (const c of chunks) {
        if (stripForLength(c).length < 8 && finalChunks.length > 0) {
          finalChunks[finalChunks.length-1] += ' ' + c;
        } else {
          finalChunks.push(c);
        }
      }

      finalChunks.forEach((chunkText, ci) => {
        blocks.push({
          text: chunkText,
          ayahIdx,
          chunkIdx: ci,
          isLastChunk: ci === finalChunks.length - 1,
          ayahNum: a.num,
          totalChunks: finalChunks.length
        });
      });
    }
  });
  return blocks;
}

let displayBlocks = []; // built after ayahs loaded
let curBlock = 0;       // index into displayBlocks

// Given an ayahIdx, find the first displayBlock for it
function blockIdxForAyah(ayahIdx) {
  return displayBlocks.findIndex(b => b.ayahIdx === ayahIdx);
}

// ══════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════
function renderAyahs() {
  ayahContainer.innerHTML = '';
  const s = currentSurah;
  const header = document.createElement('div');
  header.className = 'surah-header-inline';
  header.innerHTML = `
    <div class="shi-arabic">سورة ${s.ar}</div>
    <div class="shi-english">${s.en}</div>
    <div class="shi-meta">${lang==='ar'?'الجزء':'Juz'} ${s.juz} · ${s.ayat} ${lang==='ar'?'آية':'Ayahs'}</div>
    ${s.basmala ? '<div class="basmala">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>' : ''}
  `;
  ayahContainer.appendChild(header);

  const sz = FONT_SIZES[fontSizeMode];
  displayBlocks.forEach((b, i) => {
    const block = document.createElement('div');
    block.className = 'ayah-block far';
    block.dataset.bidx = i;          // block index
    block.dataset.aidx = b.ayahIdx;  // ayah index (for tap navigation)

    // Chunk label for multi-chunk ayahs
    const chunkLabel = b.totalChunks > 1
      ? `<span class="chunk-label">${b.ayahNum}${b.totalChunks > 1 ? ` · ${b.chunkIdx+1}/${b.totalChunks}` : ''}</span>`
      : `<span class="ayah-num">${b.ayahNum}</span>`;

    block.innerHTML = `<div class="ayah-text" style="font-size:${sz.far}">${b.text} ${chunkLabel}</div>`;
    ayahContainer.appendChild(block);
  });
  applyActive(curBlock, true);
}

function applyActive(bIdx, instant) {
  const sz = FONT_SIZES[fontSizeMode];
  const blocks = ayahContainer.querySelectorAll('.ayah-block');
  blocks.forEach((el, i) => {
    el.classList.remove('active','near','far');
    const dist = Math.abs(i - bIdx);
    const state = i===bIdx ? 'active' : dist<=2 ? 'near' : 'far';
    el.classList.add(state);
    const t = el.querySelector('.ayah-text');
    if (t) t.style.fontSize = sz[state];
  });

  // Sync curIdx to the ayah this block belongs to
  if (displayBlocks[bIdx]) curIdx = displayBlocks[bIdx].ayahIdx;

  const activeEl = blocks[bIdx];
  if (activeEl) {
    // Center active block — but cap so we don't over-scroll
    const scrollH  = quranScroll.clientHeight;
    const blockH   = activeEl.clientHeight;
    const blockTop = activeEl.offsetTop;
    // For tall blocks: align top of block to 15% from top of viewport
    const target = blockH > scrollH * 0.6
      ? blockTop - scrollH * 0.12
      : blockTop - scrollH / 2 + blockH / 2;
    if (instant) {
      quranScroll.scrollTop = Math.max(0, target);
    } else {
      smoothScrollTo(quranScroll, Math.max(0, target), 320);
    }
  }
  updateHUD();
}

// ══════════════════════════════════════════════════════
// HUD
// ══════════════════════════════════════════════════════
function updateHUD() {
  if (!currentSurah || !ayahs.length) return;
  const b = displayBlocks[curBlock];
  if (!b) return;
  const a = ayahs[b.ayahIdx];
  const sName = lang==='en' ? `${currentSurah.n}. ${currentSurah.en}` : `${currentSurah.n}. ${currentSurah.ar}`;
  const ayahLabel = lang==='ar' ? 'آية' : 'Ayah';
  topSurah.textContent = b.totalChunks > 1
    ? `${sName} — ${ayahLabel} ${a.num} (${b.chunkIdx+1}/${b.totalChunks})`
    : `${sName} — ${ayahLabel} ${a.num}`;
  topJuz.textContent = `${lang==='ar'?'الجزء':'Juz'} ${currentSurah.juz}`;
  const pct = Math.round(b.ayahIdx / (ayahs.length-1) * 100);
  progressFill.style.width = pct+'%';
  progressLabel.textContent = `${a.num} / ${currentSurah.ayat}`;
}

// ══════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════
function goNext() {
  if (curBlock < displayBlocks.length-1) {
    curBlock++; applyActive(curBlock); flash('⬇');
  } else flash(lang==='ar'?'نهاية السورة':'End of Surah');
}
function goPrev() {
  if (curBlock > 0) { curBlock--; applyActive(curBlock); flash('⬆'); }
}
function goHome() { curBlock=0; applyActive(curBlock,true); flash('⏮'); }
// Silent advance for voice — goes to next AYAH (skips remaining chunks)
function goNextSilent() {
  const nextAyahIdx = curIdx + 1;
  if (nextAyahIdx >= ayahs.length) return;
  const nextBlock = blockIdxForAyah(nextAyahIdx);
  if (nextBlock >= 0) { curBlock = nextBlock; applyActive(curBlock); }
}

// ══════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════
let toastT;
function flash(msg) {
  toastEl.textContent = msg; toastEl.classList.add('vis');
  clearTimeout(toastT); toastT = setTimeout(()=>toastEl.classList.remove('vis'), 500);
}

// ══════════════════════════════════════════════════════
// SMOOTH SCROLL POLYFILL (iOS Safari ignores native smooth)
// ══════════════════════════════════════════════════════
function smoothScrollTo(el, target, duration) {
  const start = el.scrollTop;
  const diff  = target - start;
  if (Math.abs(diff) < 2) return;
  let startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    el.scrollTop = start + diff * ease;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
const MATCH_RATIO  = 0.25;   // 25% — very lenient, Quran speech recognition is imprecise
const BUF_MAX      = 150;    // bigger buffer
const MIN_GAP_MS   = 180;    // faster advance

// Don't over-filter Quran — keep stopwords minimal
const STOPWORDS = new Set([
  'هذا','هذه','ذلك','التي','الذي','هم','هن','نحن','انتم'
]);
const PREFIXES = ['وال','فال','بال','كال','ال','وا','فا','و','ف','ل','ب','ك'];

function normAr(w) {
  return w
    .replace(/[\u064B-\u065F\u0670\u0640]/g,'')   // strip all tashkeel + shadda + tatweel
    .replace(/\u0671/g,'ا')                         // alef wasla (ٱ) → alef — KEY FIX for Quran API text
    .replace(/[أإآٱ]/g,'ا')                         // all alef variants → bare alef
    .replace(/ة/g,'ه')                              // ta marbuta → ha
    .replace(/ى/g,'ي')                              // alef maqsura → ya
    .replace(/ؤ/g,'و').replace(/ئ/g,'ي')            // hamza on waw/ya
    .replace(/ـ/g,'')                               // tatweel
    .trim();
}
function allForms(w) {
  const s = new Set([w]);
  for (const p of PREFIXES)
    if (w.startsWith(p) && w.length - p.length >= 2) s.add(w.slice(p.length));
  return [...s];
}
function tokeniseAr(text) {
  return (text.match(/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF\u0671]{2,}/g) || [])
    .map(normAr).filter(w => w.length >= 2);  // min 2 chars, not 3 — catches short Quran words
}
// A word is meaningful if >= 2 chars and not a stopword
function isMeaningful(w) { return w.length >= 2 && !STOPWORDS.has(w); }
function wordsMatch(a, b) {
  for (const x of allForms(a)) for (const y of allForms(b)) {
    if (x === y) return true;
    const sh = x.length <= y.length ? x : y, lg = x.length > y.length ? x : y;
    if (sh.length >= 3 && lg.startsWith(sh)) return true;
    if (sh.length >= 4 && lg.includes(sh))   return true;
  }
  return false;
}
function ayahMatches(ayahText, buf) {
  const words = tokeniseAr(ayahText).filter(isMeaningful);
  if (!words.length) return true;
  // also check: if ANY single word from buf matches ANY word in the ayah, count it
  const matched = words.filter(lw => buf.some(bw => wordsMatch(bw, lw))).length;
  return matched / words.length >= MATCH_RATIO;
}

// ══════════════════════════════════════════════════════
// VOICE ENGINE — iOS Safari + Chrome desktop compatible
// ══════════════════════════════════════════════════════
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

// iOS detection
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Chrome on iOS uses WKWebView — Apple blocks SpeechRecognition there entirely
// Only Safari on iOS supports it via webkitSpeechRecognition
const isIOSChrome = isIOS && /CriOS/.test(navigator.userAgent);
const isIOSSafari = isIOS && !isIOSChrome && /Safari/.test(navigator.userAgent);

// Show iOS Chrome warning on splash immediately
if (isIOSChrome) {
  const banner = document.getElementById('iosBanner');
  if (banner) banner.style.display = 'block';
}

let voiceBuffer = [];
let lastVoiceAdvance = 0;
let voiceDrainTimer = null;
let iosRestartTimer = null;

function setupVoice() {
  if (!SR || isIOSChrome) {
    micBtn.style.opacity = '0.35';
    if (isIOSChrome) {
      setVoiceStatus('⚠️ افتح في Safari — Chrome لا يدعم الميك في iOS');
    } else {
      setVoiceStatus(lang==='ar'
        ? '⚠️ التعرف على الصوت غير مدعوم — استخدم Chrome أو Safari'
        : '⚠️ Voice not supported — use Chrome or Safari');
    }
    return;
  }

  if (recognition) { try { recognition.abort(); } catch(e){} }
  recognition = new SR();
  recognition.lang            = 'ar-SA';
  recognition.interimResults  = true;
  recognition.maxAlternatives = 3;
  // iOS Safari MUST use continuous:false — it crashes silently with true
  // Desktop Chrome works best with continuous:true
  recognition.continuous = !isIOS;

  recognition.onstart = () => {
    setVoiceStatus(lang==='ar' ? '🔴 يستمع...' : '🔴 Listening...');
  };

  recognition.onresult = e => {
    let interimTxt = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      let txt = '';
      for (let j = 0; j < e.results[i].length; j++) txt += ' ' + e.results[i][j].transcript;
      txt = txt.trim();
      if (!txt) continue;

      // Always push to buffer for matching — both interim and final
      // On iOS, isFinal often never fires; on desktop both work
      const words = tokeniseAr(txt);
      if (words.length) {
        voiceBuffer.push(...words);
        if (voiceBuffer.length > BUF_MAX) voiceBuffer = voiceBuffer.slice(-BUF_MAX);
        scheduleVoiceDrain();
      }

      if (e.results[i].isFinal) {
        // final result already pushed above
      } else {
        interimTxt += ' ' + txt;
      }
    }
    if (interimTxt.trim()) {
      setVoiceStatus('🎙 ' + interimTxt.trim().slice(0, 50));
    }
  };

  recognition.onspeechstart = () => setVoiceStatus(lang==='ar' ? '🔴 يستمع...' : '🔴 Listening...');
  recognition.onspeechend   = () => setVoiceStatus(lang==='ar' ? '⏳ معالجة...' : '⏳ Processing...');

  recognition.onerror = e => {
    const ignored = ['no-speech', 'aborted', 'network'];
    if (ignored.includes(e.error)) {
      setVoiceStatus(lang==='ar' ? '🔴 في انتظار الكلام...' : '🔴 Waiting for speech...');
      if (recognizing && isIOS) scheduleIosRestart();
      return;
    }
    if (e.error === 'not-allowed') {
      const msg = isIOS
        ? (lang==='ar'
          ? 'اسمح بالميكروفون:\nالإعدادات ← Safari ← الميكروفون ← مسموح'
          : 'Allow mic:\nSettings → Safari → Microphone → Allow')
        : (lang==='ar' ? 'اسمح بالوصول للميكروفون في المتصفح' : 'Allow microphone in browser settings');
      alert(msg);
      recognizing = false; updateMicUI();
    }
  };

  recognition.onend = () => {
    if (recognizing) {
      // iOS Safari ends after each utterance — must restart
      if (isIOS) {
        scheduleIosRestart();
      } else {
        try { recognition.start(); } catch(e) {}
      }
    }
  };
}

function scheduleIosRestart() {
  clearTimeout(iosRestartTimer);
  iosRestartTimer = setTimeout(() => {
    if (!recognizing) return;
    try { recognition.start(); } catch(e) {
      setupVoice();
      try { recognition.start(); } catch(e2) {}
    }
  }, 80); // fast restart — minimize gap between utterances
}

function scheduleVoiceDrain() {
  clearTimeout(voiceDrainTimer);
  voiceDrainStep();
}
function voiceDrainStep() {
  if (curIdx >= ayahs.length) return;
  const ayahText = ayahs[curIdx]?.text || '';

  // DEBUG: show normalized form of current ayah vs buffer
  if (window._debugVoice) {
    const expected = tokeniseAr(ayahText).filter(isMeaningful).join(' · ');
    const heard    = voiceBuffer.slice(-8).join(' · ');
    setVoiceStatus(`📖 ${expected}\n🎙 ${heard}`);
  }

  if (!ayahMatches(ayahText, voiceBuffer)) return;

  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastVoiceAdvance));
  voiceDrainTimer = setTimeout(() => {
    if (curIdx >= ayahs.length || !ayahMatches(ayahs[curIdx]?.text || '', voiceBuffer)) return;
    const words = tokeniseAr(ayahs[curIdx].text).filter(isMeaningful);
    let buf = [...voiceBuffer];
    for (const lw of words) { const i = buf.findIndex(bw => wordsMatch(bw, lw)); if (i !== -1) buf.splice(i, 1); }
    voiceBuffer = buf;
    lastVoiceAdvance = Date.now();
    goNextSilent();
    voiceDrainStep();
  }, wait);
}

function setVoiceStatus(msg) {
  const hint = document.querySelector('#voiceHint .t');
  if (hint) hint.textContent = msg;
}

function toggleMic() {
  if (!SR) {
    // No SR at all — show instructions depending on platform
    if (isIOS) {
      alert(lang==='ar'
        ? 'للاستخدام على iPhone:\n١. افتح هذا الرابط في Safari (ليس Chrome)\n٢. اضغط الميك مرة أخرى'
        : 'To use voice on iPhone:\n1. Open this page in Safari (not Chrome)\n2. Tap mic again');
    }
    return;
  }
  if (!recognition) setupVoice();
  if (!recognition) return;

  recognizing = !recognizing;
  if (recognizing) {
    voiceBuffer = [];
    try { recognition.start(); } catch(e) {
      // Might need rebuild if object is stale
      setupVoice();
      try { recognition.start(); } catch(e2) { recognizing = false; }
    }
    if (recognizing) {
      setVoiceStatus(lang==='ar'
        ? (isIOS ? '🔴 يستمع... (Safari مُوصى به)' : '🔴 يستمع... تكلم والسطر يتقدم')
        : (isIOS ? '🔴 Listening... (Safari recommended)' : '🔴 Listening... speak and it follows'));
      voiceHint.classList.add('active');
    }
  } else {
    clearTimeout(iosRestartTimer);
    clearTimeout(voiceDrainTimer);
    try { recognition.stop(); } catch(e) {}
    voiceBuffer = [];
    setVoiceStatus(lang==='ar'
      ? 'اضغط الميك — يتابع الإمام تلقائياً بالصوت'
      : 'Tap mic — auto-follows the imam by voice');
    voiceHint.classList.remove('active');
  }
  updateMicUI();
}

function updateMicUI() {
  micBtn.classList.toggle('listening', recognizing);
  micBtn.innerHTML = recognizing
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
}

// ══════════════════════════════════════════════════════
// JUMP
// ══════════════════════════════════════════════════════
function openJump() {
  if (currentSurah) { jumpSurahSel.value = currentSurah.n; jumpAyahInput.value = ayahs[curIdx]?.num||1; }
  jumpPanel.classList.add('vis');
}
async function doJump() {
  const sNum = parseInt(jumpSurahSel.value);
  const aNum = parseInt(jumpAyahInput.value)||1;
  jumpPanel.classList.remove('vis');
  if (sNum === currentSurah?.n) {
    const ayahIdx = ayahs.findIndex(a=>a.num>=aNum);
    curIdx   = ayahIdx>=0 ? ayahIdx : 0;
    curBlock = blockIdxForAyah(curIdx);
    if (curBlock < 0) curBlock = 0;
    applyActive(curBlock);
  } else { await loadSurah(sNum, aNum); }
}

// ══════════════════════════════════════════════════════
// LOAD SURAH
// ══════════════════════════════════════════════════════
async function loadSurah(surahNum, startAyah=1) {
  currentSurah = SURAHS.find(s=>s.n===surahNum);
  if (!currentSurah) return;

  const sName = lang==='en' ? currentSurah.en : currentSurah.ar;
  ayahContainer.innerHTML = `
    <div class="loading-wrap vis" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px">
      <div class="loading-ring"></div>
      <div class="loading-txt">${lang==='ar'?'جاري تحميل':'Loading'} ${sName}...</div>
    </div>`;

  try {
    ayahs = await fetchSurah(surahNum);
    // Build display blocks (chunked for long ayahs)
    displayBlocks = buildDisplayBlocks(ayahs);
    // Find starting block
    const ayahIdx = ayahs.findIndex(a=>a.num>=startAyah);
    curIdx   = ayahIdx>=0 ? ayahIdx : 0;
    curBlock = blockIdxForAyah(curIdx);
    if (curBlock < 0) curBlock = 0;
    renderAyahs();
  } catch(e) {
    const errMsg = lang==='ar'
      ? 'فشل التحميل. تأكد من اتصالك بالإنترنت وأعد المحاولة.'
      : 'Failed to load. Please check your internet connection and retry.';
    const retryLabel = lang==='ar' ? '↺ أعد المحاولة' : '↺ Retry';
    ayahContainer.innerHTML = `
      <div class="error-notice">
        <div class="error-icon">⚠️</div>
        <div class="error-msg">${errMsg}</div>
        <button class="retry-btn" onclick="loadSurah(${surahNum},${startAyah})">${retryLabel}</button>
      </div>`;
  }
}

// ══════════════════════════════════════════════════════
// FONT CYCLE
// ══════════════════════════════════════════════════════
document.getElementById('fontBtn').addEventListener('click', () => {
  const i = fontOrder.indexOf(fontSizeMode);
  fontSizeMode = fontOrder[(i+1)%fontOrder.length];
  const labels = {small:'S',medium:'M',large:'L',xlarge:'XL'};
  flash(labels[fontSizeMode]);
  if (ayahs.length) { renderAyahs(); }
});

// ══════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════
startBtn.addEventListener('click', async () => {
  const sNum = parseInt(surahSelect.value);
  const startAyah = parseInt(ayahStartInput.value)||1;
  fontSizeMode = fontSizeSelect.value;
  startBtn.disabled = true;
  loadingWrap.classList.add('vis');
  loadingTxt.textContent = lang==='ar' ? 'جاري التحميل...' : 'Loading...';

  splash.classList.add('fade-out');
  setTimeout(()=>splash.style.display='none', 500);
  appEl.classList.add('vis');

  await loadSurah(sNum, startAyah);
  // Voice set up lazily when user taps mic
  requestWakeLock();
});

// ══════════════════════════════════════════════════════
// EVENTS
// ══════════════════════════════════════════════════════
nextBtn.addEventListener('click', goNext);
prevBtn.addEventListener('click', goPrev);
micBtn.addEventListener('click', toggleMic);
jumpBtn.addEventListener('click', openJump);
jumpCancel.addEventListener('click', ()=>jumpPanel.classList.remove('vis'));
jumpGo.addEventListener('click', doJump);

// Triple-tap voice hint to toggle debug mode (see what's being matched)
let _vhTapCount = 0, _vhTapTimer;
voiceHint.addEventListener('click', () => {
  _vhTapCount++;
  clearTimeout(_vhTapTimer);
  _vhTapTimer = setTimeout(() => { _vhTapCount = 0; }, 600);
  if (_vhTapCount >= 3) {
    _vhTapCount = 0;
    window._debugVoice = !window._debugVoice;
    flash(window._debugVoice ? '🔍 Debug ON' : '🔍 Debug OFF');
  }
});

// Tap ayah
ayahContainer.addEventListener('click', e => {
  const b = e.target.closest('.ayah-block');
  if (b) {
    const bi = parseInt(b.dataset.bidx);
    if (!isNaN(bi)) { curBlock = bi; applyActive(curBlock); }
  }
});

// Swipe — only trigger on fast deliberate swipes, not normal scrolling
let swipeStartY=0, swipeStartX=0, swipeStartTime=0;
quranScroll.addEventListener('touchstart',e=>{
  swipeStartY=e.touches[0].clientY;
  swipeStartX=e.touches[0].clientX;
  swipeStartTime=Date.now();
},{passive:true});
quranScroll.addEventListener('touchend',e=>{
  const dy=swipeStartY-e.changedTouches[0].clientY;
  const dx=Math.abs(swipeStartX-e.changedTouches[0].clientX);
  const dt=Date.now()-swipeStartTime;
  // Only trigger if: fast (<300ms), mostly vertical (not horizontal swipe), big enough
  if(dt<300 && Math.abs(dy)>60 && Math.abs(dy)>dx*1.5){
    dy>0?goNext():goPrev();
  }
},{passive:true});

// Keyboard
document.addEventListener('keydown',e=>{
  if(jumpPanel.classList.contains('vis'))return;
  if(e.key==='ArrowRight'||e.key==='ArrowDown')goNext();
  if(e.key==='ArrowLeft' ||e.key==='ArrowUp')goPrev();
  if(e.key==='Home')goHome();
});

// Wake lock
let wakeLock=null;
async function requestWakeLock(){
  try{if('wakeLock'in navigator)wakeLock=await navigator.wakeLock.request('screen');}catch(e){}
}
document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState==='visible')await requestWakeLock();
});

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
populateSelects();
setLang('ar'); // default Arabic

// Show iOS Chrome warning if applicable
(function() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (isIOS && !isSafari) {
    document.getElementById('iosBanner').style.display = 'block';
  }
})();
