// === script.js ===
// Frontend-only spelling bee game (no backend, stable)

import * as recognizer from "./recognizer.js";
import { data } from "./data.js";

const time_progress = document.querySelector(".time-progress");
const mic = document.getElementById("mic");
const dialog = document.getElementById("bee-text");

const PHASE_ASK = 60;   // seconds
const PHASE_SPELL = 20;

let current_idx = 0;
let current_task = data[0];

let seconds = 0;
let answer_loop = null;
let spell_loop = null;
let gameStarted = false;

let lastRecognizeOptions = {
  prioritizeAlphabet: false,
  showDebug: false
};

// ===============================
// INIT
// ===============================
export function init_game_start() {
  mic.addEventListener("click", () => {
    if (gameStarted) return;
    gameStarted = true;
    mic.classList.add("active");
    start_answer_loop();
  });
}

// ===============================
// SPEECH (TTS-safe)
// ===============================
function speak(text, rate = 1, pitch = 1) {
  return new Promise((resolve) => {
    recognizer.stopRecognize(); // always stop before speaking

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = rate;
    utter.pitch = pitch;

    utter.onend = () => setTimeout(resolve, 400);
    speechSynthesis.speak(utter);
  });
}

// ===============================
// UI HELPERS
// ===============================
function set_dialog(t) {
  dialog.innerText = t;
}
function add_dialog(t) {
  dialog.innerText += "\n" + t;
}
function clear_dialog() {
  dialog.innerText = "";
}
function set_time_bar(p) {
  time_progress.style.width = Math.min(100, p) + "%";
}

// ===============================
// ANSWER QUESTIONS
// ===============================
async function answerQ(type) {
  let ans = "";
  if (type === "repeat") ans = current_task.pronunciation;
  else if (type === "definition") ans = current_task.definition;
  else if (type === "part") ans = current_task.part;
  else if (type === "example") ans = current_task.example;

  set_dialog(ans);
  await speak(type === "repeat" ? current_task.word : ans);

  recognizer.recognize(dialog, mic, lastRecognizeOptions);
}

// ===============================
// PHASE 1 — ASK
// ===============================
async function start_answer_loop() {
  clear_dialog();
  clearInterval(answer_loop);
  clearInterval(spell_loop);
  recognizer.textClear();

  lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: false };
  seconds = 0;

  set_dialog(
    `Your word is ${current_task.pronunciation}. You have ${PHASE_ASK} seconds to ask questions`
  );

  await speak(
    `Your word is ${current_task.word}. You have ${PHASE_ASK} seconds to ask questions`
  );

  recognizer.recognize(dialog, mic, lastRecognizeOptions);

  answer_loop = setInterval(() => {
    let answered = false;

    if (recognizer.textIncludes("part")) {
      answerQ("part"); answered = true;
    } else if (recognizer.textIncludes("repeat")) {
      answerQ("repeat"); answered = true;
    } else if (recognizer.textIncludes("definition")) {
      answerQ("definition"); answered = true;
    } else if (
      recognizer.textIncludes("example") ||
      recognizer.textIncludes("sentence")
    ) {
      answerQ("example"); answered = true;
    }

    if (answered) recognizer.textClear();

    seconds += 0.5;
    set_time_bar((seconds / PHASE_ASK) * 100);

    if (
      seconds >= PHASE_ASK ||
      recognizer.textIncludes(current_task.word)
    ) {
      clearInterval(answer_loop);
      start_spell_loop();
    }
  }, 500);
}

// ===============================
// PHASE 2 — SPELL
// ===============================
async function start_spell_loop() {
  clearInterval(spell_loop);
  recognizer.textClear();

  set_dialog(`Spell the word carefully. You have ${PHASE_SPELL} seconds.`);
  await speak(`Spell the word carefully. You have ${PHASE_SPELL} seconds.`);

  lastRecognizeOptions = { prioritizeAlphabet: true, showDebug: false };
  recognizer.recognize(dialog, mic, lastRecognizeOptions);

  seconds = 0;

  spell_loop = setInterval(() => {
    seconds += 0.25;
    set_time_bar((seconds / PHASE_SPELL) * 100);

    const spelled = recognizer.getFinalText().replace(/\s+/g, "");
    const target = current_task.word.toLowerCase();

    // Too long → fail early
    if (spelled.length > target.length) {
      end_spell(false, spelled);
      return;
    }

    // Correct
    if (spelled.toLowerCase() === target) {
      end_spell(true, spelled);
      return;
    }

    // Time up
    if (seconds >= PHASE_SPELL) {
      end_spell(spelled.toLowerCase() === target, spelled);
    }
  }, 250);
}

function end_spell(correct, spelled) {
  clearInterval(spell_loop);
  recognizer.stopRecognize();

  if (correct) {
    add_dialog(`Correct! You spelled ${spelled}`);
  } else {
    add_dialog(`Wrong spelling! The word was ${current_task.word}`);
  }

  add_dialog("Say next to continue");
  start_wait_loop();
}

// ===============================
// PHASE 3 — WAIT
// ===============================
async function start_wait_loop() {
  await speak(dialog.innerText);

  lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: false };
  recognizer.recognize(dialog, mic, lastRecognizeOptions);

  const wait_loop = setInterval(() => {
    if (recognizer.textIncludes("next")) {
      clearInterval(wait_loop);
      recognizer.textClear();

      current_idx = (current_idx + 1) % data.length;
      current_task = data[current_idx];
      start_answer_loop();
    }
  }, 500);
}

// ===============================
// MIC PERMISSION
// ===============================
(async function requestMicPermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    alert("Please allow microphone access.");
  }
})();

set_time_bar(0);
