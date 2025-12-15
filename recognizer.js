// === recognizer.js ===
// Stable speech recognizer with STRICT spelling mode

let recognition = null;
let isRecognizing = false;
let shouldBeRecognizing = false;
let dialogEl = null;
let micEl = null;
let currentOptions = { prioritizeAlphabet: false, showDebug: false };

let finalText = "";
let lastFinalResultIndex = -1;

// ==========================
// Browser detection
// ==========================
if ("webkitSpeechRecognition" in window) {
  recognition = new webkitSpeechRecognition();
} else if ("SpeechRecognition" in window) {
  recognition = new SpeechRecognition();
} else {
  alert("Speech Recognition not supported in this browser.");
}

if (recognition) {
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 5;
}

// ==========================
// Safe restart
// ==========================
function restartRecognitionSafely() {
  try { recognition.stop(); } catch {}
  setTimeout(() => {
    try { recognition.start(); } catch {}
  }, 400);
}

// ==========================
// PHONETIC MAP
// ==========================
const phoneticMap = {
  a: "A", ay: "A", alpha: "A", alfa: "A",
  b: "B", bee: "B", bravo: "B",
  c: "C", see: "C", sea: "C", charlie: "C",
  d: "D", dee: "D", delta: "D",
  e: "E", ee: "E", echo: "E",
  f: "F", ef: "F", foxtrot: "F",
  g: "G", gee: "G", golf: "G",
  h: "H", aitch: "H", hotel: "H",
  i: "I", eye: "I", india: "I",
  j: "J", jay: "J", juliet: "J",
  k: "K", kay: "K", kilo: "K",
  l: "L", el: "L", lima: "L",
  m: "M", em: "M", mike: "M",
  n: "N", en: "N", november: "N",
  o: "O", oh: "O", oscar: "O",
  p: "P", pee: "P", papa: "P",
  q: "Q", cue: "Q", quebec: "Q",
  r: "R", are: "R", romeo: "R",
  s: "S", ess: "S", sierra: "S",
  t: "T", tee: "T", tango: "T",
  u: "U", you: "U", uniform: "U",
  v: "V", vee: "V", victor: "V",
  w: "W", doubleyou: "W", whiskey: "W",
  x: "X", ex: "X", "x-ray": "X",
  y: "Y", why: "Y", yankee: "Y",
  z: "Z", zee: "Z", zed: "Z", zulu: "Z"
};

// ==========================
// Helpers
// ==========================
function filterAlphabetOnly(str) {
  return (str || "").replace(/[^A-Z]/gi, "").toUpperCase();
}

function interpretLetters(raw) {
  if (!raw) return "";

  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .trim()
    .split(/\s+/);

  const letters = [];

  for (const tok of tokens) {
    if (phoneticMap[tok]) {
      letters.push(phoneticMap[tok]);
    } else if (/^[a-z]$/.test(tok)) {
      letters.push(tok.toUpperCase());
    }
    // ❌ NO word → letter fallback
  }

  return letters.join("");
}

function pickBestAlternative(result, alphabetMode) {
  if (!result || !result.length) return { text: "" };

  if (!alphabetMode) {
    let best = result[0];
    return { text: best.transcript.trim() };
  }

  const candidates = new Map();

  for (const alt of result) {
    const seq = interpretLetters(alt.transcript);
    if (!seq) continue;

    const score = seq.length * 1000 + (alt.confidence || 0) * 100;
    candidates.set(seq, (candidates.get(seq) || 0) + score);
  }

  if (!candidates.size) return { text: "" };

  let bestSeq = "";
  let bestScore = -1;

  for (const [seq, score] of candidates) {
    if (score > bestScore) {
      bestScore = score;
      bestSeq = seq;
    }
  }

  return { text: bestSeq };
}

// ==========================
// Recognition handlers
// ==========================
function setupRecognitionHandlers() {
  if (!recognition) return;

  recognition.onstart = () => {
    isRecognizing = true;
    micEl?.classList.add("recording");
    if (dialogEl && !finalText) dialogEl.innerHTML = "🎙️ Listening...";
  };

  recognition.onresult = (event) => {
    if (!dialogEl) return;
    let interim = "";

    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];

      if (res.isFinal && i > lastFinalResultIndex) {
        const { text } =
          pickBestAlternative(res, currentOptions.prioritizeAlphabet);

        if (currentOptions.prioritizeAlphabet) {
          for (const ch of text) {
            if (/[A-Z]/.test(ch)) finalText += ch;
          }
        } else {
          if (text) finalText = (finalText + " " + text).trim();
        }

        lastFinalResultIndex = i;
      }

      if (!res.isFinal) {
        const { text } =
          pickBestAlternative(res, currentOptions.prioritizeAlphabet);
        interim += text ? text + " " : "";
      }
    }

    dialogEl.innerHTML = currentOptions.prioritizeAlphabet
      ? `<b>${finalText}</b> <span style="color:#888">${filterAlphabetOnly(interim)}</span>`
      : `<b>${finalText}</b> <span style="color:#888">${interim}</span>`;
  };

  recognition.onerror = (e) => {
    if (e.error === "no-speech" && shouldBeRecognizing) {
      restartRecognitionSafely();
      return;
    }
    shouldBeRecognizing = false;
  };

  recognition.onend = () => {
    isRecognizing = false;
    micEl?.classList.remove("recording");
    if (shouldBeRecognizing) {
      setTimeout(() => {
        try { recognition.start(); } catch {}
      }, 300);
    }
  };
}

setupRecognitionHandlers();

// ==========================
// Public API
// ==========================
export function recognize(dialog, mic, opts = {}) {
  if (!recognition) return;

  dialogEl = dialog;
  micEl = mic;
  currentOptions = opts;

  finalText = "";
  lastFinalResultIndex = -1;

  shouldBeRecognizing = true;

  if (!isRecognizing) {
    try { recognition.start(); }
    catch { restartRecognitionSafely(); }
  }
}

export function stopRecognize() {
  shouldBeRecognizing = false;
  try { recognition.stop(); } catch {}
}

export function getFinalText() {
  return finalText;
}

export function textIncludes(sub) {
  return finalText.toLowerCase().includes(sub.toLowerCase());
}

export function textClear() {
  finalText = "";
  lastFinalResultIndex = -1;
}
