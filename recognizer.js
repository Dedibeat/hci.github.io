// === recognizer.js ===
// Improved speech recognizer with safer start/stop, faster letter interim handling

let recognition = null;
let isRecognizing = false;
let dialogEl = null;
let micEl = null;
let currentOptions = { prioritizeAlphabet: false, showDebug: false };
let finalText = "";

if ("webkitSpeechRecognition" in window)
  recognition = new webkitSpeechRecognition();
else if ("SpeechRecognition" in window) recognition = new SpeechRecognition();
else {
  alert("Speech Recognition not supported in this browser.");
}

if (recognition) {
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.maxAlternatives = 5;
}

// phonetic map (unchanged)
const phoneticMap = {
  alpha: "A",
  alfa: "A",
  a: "A",
  ay: "A",
  eight: "A",
  hey: "A",
  bravo: "B",
  b: "B",
  bee: "B",
  be: "B",
  charlie: "C",
  c: "C",
  see: "C",
  sea: "C",
  delta: "D",
  d: "D",
  dee: "D",
  echo: "E",
  e: "E",
  ee: "E",
  foxtrot: "F",
  f: "F",
  ef: "F",
  golf: "G",
  g: "G",
  gee: "G",
  hotel: "H",
  h: "H",
  aitch: "H",
  india: "I",
  i: "I",
  eye: "I",
  juliet: "J",
  juliett: "J",
  j: "J",
  jay: "J",
  kilo: "K",
  k: "K",
  kay: "K",
  lima: "L",
  l: "L",
  el: "L",
  mike: "M",
  m: "M",
  em: "M",
  november: "N",
  n: "N",
  en: "N",
  oscar: "O",
  o: "O",
  oh: "O",
  zero: "O",
  papa: "P",
  p: "P",
  pee: "P",
  quebec: "Q",
  q: "Q",
  cue: "Q",
  queue: "Q",
  romeo: "R",
  r: "R",
  are: "R",
  sierra: "S",
  s: "S",
  ess: "S",
  tango: "T",
  t: "T",
  tee: "T",
  uniform: "U",
  u: "U",
  you: "U",
  victor: "V",
  v: "V",
  vee: "V",
  whiskey: "W",
  w: "W",
  doubleyou: "W",
  "double you": "W",
  "x-ray": "X",
  x: "X",
  ex: "X",
  yankee: "Y",
  y: "Y",
  why: "Y",
  zulu: "Z",
  z: "Z",
  zee: "Z",
  zed: "Z",
};

// 🔵 Keep only letters A–Z
function filterAlphabetOnly(str) {
  if (!str) return "";
  return str.replace(/[^A-Za-z]/g, "").toUpperCase();
}

function interpretLetters(rawText) {
  if (!rawText) return "";
  rawText = rawText
    .toLowerCase()
    .replace(/[^a-z\s-]+/g, " ")
    .trim();
  const tokens = rawText.split(/\s+/).filter(Boolean);
  const letters = [];

  for (let tok of tokens) {
    if (phoneticMap[tok]) letters.push(phoneticMap[tok]);
    else if (/^[a-z]$/.test(tok)) letters.push(tok.toUpperCase());
    else if (/^[a-z]+$/.test(tok))
      for (let ch of tok) letters.push(ch.toUpperCase());
  }

  return letters.join(""); // e.g. "APPLE"
}

function pickBestAlternative(result, prioritizeAlphabet) {
  let best = "";
  let bestConf = -1;
  let bestRaw = "";

  for (let alt of result) {
    const raw = alt.transcript.trim();
    const conf = alt.confidence || 0;

    let mapped = prioritizeAlphabet ? interpretLetters(raw) : raw;

    // 🔵 enforce alphabet only for spelling mode
    if (prioritizeAlphabet) {
      mapped = filterAlphabetOnly(mapped);
    }

    const score = mapped.length * 1000 + Math.round(conf * 100);
    const bestScore = best.length * 1000 + Math.round(bestConf * 100);

    if (score > bestScore) {
      best = mapped;
      bestRaw = raw;
      bestConf = conf;
    }
  }

  return { text: best, raw: bestRaw, conf: bestConf };
}

// Internal handlers setup
function setupRecognitionHandlers() {
  if (!recognition) return;

  recognition.onstart = () => {
    isRecognizing = true;
    if (micEl) micEl.classList.add("recording");
    if (dialogEl && !finalText.trim()) dialogEl.innerHTML = "🎙️ Listening...";
  };

  recognition.onresult = (event) => {
    if (!dialogEl) return;
    let interim = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const res = event.results[i];
      const { text, raw, conf } = pickBestAlternative(
        res,
        currentOptions.prioritizeAlphabet
      );

      if (res.isFinal) {
        let out = text;

        if (currentOptions.prioritizeAlphabet) {
          // Only accept SINGLE letters (A-Z or phonetic-mapped)
          for (let ch of out) {
            if (/^[A-Z]$/.test(ch)) {
              finalText += ch; // append only single letters
            } else {
              console.log("Ignored non-letter in spelling mode:", ch);
            }
          }
        } else {
          // Normal mode → append full words
          if (out) finalText = (finalText + " " + out).trim();
        }
      } else {
        // interim
        interim += text ? text + " " : "";
      }

      if (currentOptions.showDebug)
        console.debug(
          `[${res.isFinal ? "FINAL" : "INTERIM"}]`,
          raw,
          "→",
          text,
          `(conf ${(conf * 100).toFixed(1)}%)`
        );
    }

    // build display string
    let display;

    if (currentOptions.prioritizeAlphabet) {
      const displayInterim = filterAlphabetOnly(interim);
      display = `<span style="font-weight:600;color:#222;">${finalText}</span> <span style="color:#888;">${displayInterim}</span>`;
    } else {
      display = `<span style="font-weight:600;color:#222;">${finalText}</span> <span style="color:#888;">${interim}</span>`;
    }

    if (display.replace(/<[^>]*>/g, "").trim() !== "") {
      dialogEl.innerHTML = display;
    }
  };

  recognition.onerror = (e) => {
    console.error("recognition error", e);
    if (dialogEl) dialogEl.innerHTML = "⚠️ " + (e.error || "error");
    if (micEl) micEl.classList.remove("recording");
  };

  recognition.onend = () => {
    isRecognizing = false;
    if (micEl) micEl.classList.remove("recording");
  };
}

setupRecognitionHandlers();

export function recognize(dialog, mic, opts = {}) {
  if (!recognition) return;
  dialogEl = dialog;
  micEl = mic;
  currentOptions = Object.assign({}, currentOptions, opts);

  if (isRecognizing) {
    if (dialogEl && !finalText.trim()) dialogEl.innerHTML = "🎙️ Listening...";
    return;
  }

  try {
    recognition.start();
  } catch (err) {
    try {
      recognition.stop();
    } catch (_) {}
    try {
      recognition.start();
    } catch (err2) {
      console.warn("recognition.start failed:", err2);
    }
  }
}

export function stopRecognize() {
  if (!recognition) return;
  if (!isRecognizing) return;
  try {
    recognition.stop();
  } catch (err) {}
}

export function getFinalText() {
  finalText = finalText.trim();
  if (finalText.length > 200)
    finalText = finalText.slice(finalText.length - 200);
  return finalText;
}

export function textIncludes(substring) {
  const text = getFinalText().toLowerCase();
  return text.includes(substring.toLowerCase());
}

export function textClear() {
  finalText = "";
}
