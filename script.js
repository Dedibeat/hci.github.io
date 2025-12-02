// === main.js ===
// Cleaned main UI + phase switching and faster spell checking

import * as recognizer from "./recognizer.js";
import { data } from "./data.js";

const time_progress = document.querySelector(".time-progress");
const mic = document.getElementById("mic");
const dialog = document.getElementById("bee-text");
const phase1 = 60; // seconds
const phase2 = 20; // seconds

let current_idx = 0;
let current_task = data[0];
let seconds = 0;
let answer_loop = null;
let spell_loop = null;
let lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: true };

// Replace your speak() with this (increased restart delay)
function speak(text, rate = 1, pitch = 1) {
  return new Promise((resolve, reject) => {
    try {
      // Stop recognition right away to avoid self-capture
      recognizer.stopRecognize();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = rate;
      utter.pitch = pitch;

      utter.onend = () => {
        // restart recognition later where caller expects it
        // (we don't automatically restart here — callers will call recognizer.recognize after await)
        // but keep a tiny buffer in case someone relies on speak() to restart
        setTimeout(() => {
          resolve();
        }, 400); // longer buffer to avoid TTS tail being picked up
      };

      utter.onerror = (err) => reject(err);

      speechSynthesis.speak(utter);
    } catch (err) {
      reject(err);
    }
  });
}

function add_dailog(t) {
  dialog.innerHTML += "\n" + t;
}
function set_dialog(t) {
  dialog.innerText = t;
}
function clear_dialog() {
  dialog.innerText = "";
}
function set_time_bar(p) {
  time_progress.style.width = p + "%";
}

async function answerQ(q) {
  let ans = "";
  if (q === "repeat") ans = current_task.pronunciation;
  else if (q === "definition") ans = current_task.definition;
  else if (q === "part") ans = current_task.part;
  else if (q === "example") ans = current_task.example;

  set_dialog(ans);
  if (q === "repeat") await speak(current_task.word);
  else await speak(ans);
  recognizer.recognize(dialog, mic, lastRecognizeOptions);
}

// Replace start_answer_loop() with this:
async function start_answer_loop() {
  clear_dialog();
  clearInterval(answer_loop);
  clearInterval(spell_loop);
  recognizer.textClear();

  // prepare options but DO NOT start recognition yet
  lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: true };

  seconds = 0;
  // show the prompt in dialog BEFORE speech so users see it
  set_dialog(
    `Your word is ${current_task.pronunciation}. You have ${phase1} seconds to ask questions`
  );
  // speak and wait for it to finish (recognizer remains stopped during speak)
  await speak(
    `Your word is ${current_task.word}. You have ${phase1} seconds to ask questions`
  );

  // now start recognition AFTER speech finishes
  recognizer.recognize(dialog, mic, lastRecognizeOptions);

  // start the answer polling loop
  answer_loop = setInterval(() => {
    let answered = false;
    if (
      recognizer.textIncludes("part of speech") ||
      recognizer.textIncludes("part")
    ) {
      answerQ("part");
      answered = true;
    } else if (recognizer.textIncludes("repeat")) {
      answerQ("repeat");
      answered = true;
    } else if (recognizer.textIncludes("definition")) {
      answerQ("definition");
      answered = true;
    } else if (recognizer.textIncludes("example")) {
      answerQ("example");
      answered = true;
    } else if (recognizer.textIncludes("sentence")) {
      answerQ("example");
      answered = true;
    }


    if (answered) recognizer.textClear();

    // advance timer and check transition
    seconds += 0.5;
    set_time_bar(Math.round((seconds * 100) / phase1));

    if (seconds >= phase1 || recognizer.textIncludes(current_task.word)) {
      clearInterval(answer_loop);
      start_spell_loop();
    }
  }, 500);
}

// Replace start_spell_loop() with this:
async function start_spell_loop() {
  clearInterval(spell_loop);
  recognizer.textClear();

  // show instruction before speech
  set_dialog(`Spell the word carefully. You have ${phase2} seconds.`);
  await speak(`Spell the word carefully. You have ${phase2} seconds.`);

  // start alphabet recognition
  lastRecognizeOptions = { prioritizeAlphabet: true, showDebug: true };
  recognizer.recognize(dialog, mic, lastRecognizeOptions);

  seconds = 0;

  spell_loop = setInterval(() => {
    seconds += 0.25;
    set_time_bar(Math.round((seconds * 100) / phase2));

    // get live spelling
    const liveSpelling = recognizer.getFinalText().replace(/\s+/g, "");

    
    if (liveSpelling.length > current_task.word.length){
      clearInterval(spell_loop);
      recognizer.stopRecognize();
      add_dailog("\nYou spelled: " + liveSpelling)
      add_dailog("\nWrong spelling! " + current_task.word);
      add_dailog("\nSay next to spell next word");
      start_wait_loop();
      return;
    }
    if ( liveSpelling.toLowerCase() === current_task.word.toLowerCase() )
     {
      clearInterval(spell_loop);
      recognizer.stopRecognize();
      const finalSpelling = liveSpelling;
      if (finalSpelling.toLowerCase() === current_task.word.toLowerCase()) {
        add_dailog("\nCorrect! You spelled " + finalSpelling);
      } else {
        add_dailog("\nWrong spelling! " + current_task.word);
      }

      add_dailog("\nSay next to spell next word");
      start_wait_loop();
      return;
    }

    // time limit check
    if (seconds >= phase2) {
      clearInterval(spell_loop);
      recognizer.stopRecognize();

      const finalSpelling = liveSpelling;
      set_dialog("Time up! You spelled: " + finalSpelling);

      if (finalSpelling.toLowerCase() === current_task.word.toLowerCase()) {
        add_dailog("\nCorrect");
      } else {
        add_dailog("\nWrong spelling! " + current_task.word);
      }

      add_dailog("\nSay next to spell next word");
      start_wait_loop();
    }
  }, 250);
}

async function start_wait_loop() {
  await speak(dialog.innerText);
  lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: true };
  recognizer.recognize(dialog, mic, lastRecognizeOptions);

  let wait_loop = setInterval(() => {
    if (recognizer.textIncludes("next")) {
      clearInterval(wait_loop);
      current_idx = (current_idx + 1) % 4;
      current_task = data[current_idx];
      start_answer_loop();
    }
  }, 500);
}

// start
clear_dialog();
start_answer_loop();
set_time_bar(0);
