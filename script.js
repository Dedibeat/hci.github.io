// spellbee.main.js
// Refactored, modular Spell Bee game main file.
// - Encapsulates state in a SpellBeeGame class
// - Uses phases/enum and a single polling loop (configurable)
// - Keeps recognizer interactions isolated
// - Provides clear lifecycle: start(), stop(), next()

import * as recognizer from "./recognizer.js";
import { data } from "./data.js";

// Configurable phases (seconds)
const PHASES = {
  ANSWER: { name: "answer", seconds: 60 },
  SPELL: { name: "spell", seconds: 20 },
  WAIT: { name: "wait", seconds: 10 }
};

// Utility TTS wrapper that ensures recognizer is stopped while speaking
async function speak(text, { rate = 1, pitch = 1, bufferMs = 400 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      recognizer.stopRecognize();

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-US";
      utter.rate = rate;
      utter.pitch = pitch;

      utter.onend = () => setTimeout(resolve, bufferMs);
      utter.onerror = (e) => reject(e);

      speechSynthesis.speak(utter);
    } catch (err) {
      reject(err);
    }
  });
}

class SpellBeeGame {
  constructor({
    container = document,
    dataList = data,
    recognizerModule = recognizer,
    selectors = {
      timeProgress: ".time-progress",
      mic: "#mic",
      dialog: "#bee-text"
    },
    pollingIntervalMs = 250
  } = {}) {
    this.data = dataList;
    this.recognizer = recognizerModule;

    // UI nodes
    this.timeProgress = container.querySelector(selectors.timeProgress);
    this.mic = container.querySelector(selectors.mic);
    this.dialog = container.querySelector(selectors.dialog);

    // internal state
    this.currentIdx = 0;
    this.currentTask = this.data[this.currentIdx];
    this.state = "idle"; // idle | answer | spell | wait
    this.seconds = 0;
    this._poller = null;
    this._pollInterval = pollingIntervalMs;
    this._lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: true };
    this.gameStarted = false;

    // bind handlers
    this._onMicClick = this._onMicClick.bind(this);
    this._poll = this._poll.bind(this);
  }

  init() {
    // attach events
    if (this.mic) this.mic.addEventListener("click", this._onMicClick);

    this._setTimeBar(0);
    this._requestMicPermission();

    // keep recognizer clean
    this.recognizer.textClear && this.recognizer.textClear();
  }

  destroy() {
    // cleanup
    if (this.mic) this.mic.removeEventListener("click", this._onMicClick);
    this.stop();
  }

  async start() {
    if (this.gameStarted) return;
    this.gameStarted = true;
    this._setActive(true);
    await this._startAnswerPhase();
    this._startPoller();
  }

  stop() {
    this.gameStarted = false;
    this._setActive(false);
    this._clearPoller();
    this.recognizer.stopRecognize && this.recognizer.stopRecognize();
  }

  next() {
    this.currentIdx = (this.currentIdx + 1) % this.data.length;
    this.currentTask = this.data[this.currentIdx];
    this._transitionToAnswer();
  }

  // ----- internal helpers -----
  _onMicClick() {
    if (!this.gameStarted) this.start();
    else {
      // allow mic toggling behavior in future
    }
  }

  _setActive(active) {
    if (!this.mic) return;
    this.mic.classList.toggle("active", !!active);
  }

  _setDialog(text) {
    if (!this.dialog) return;
    this.dialog.innerText = text;
  }

  _appendDialog(text) {
    if (!this.dialog) return;
    this.dialog.innerText += "\n" + text;
  }

  _setTimeBar(percent) {
    if (!this.timeProgress) return;
    this.timeProgress.style.width = percent + "%";
  }

  async _requestMicPermission() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Microphone permission granted!");
    } catch (err) {
      console.warn("Microphone permission denied:", err);
      alert("Please allow microphone access to play the spelling game.");
    }
  }

  // ---- Phase transitions ----
  async _startAnswerPhase() {
    this.state = "answer";
    this.seconds = 0;

    this._lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: true };

    this._setDialog(`Your word is ${this.currentTask.pronunciation}. You have ${PHASES.ANSWER.seconds} seconds to ask questions`);

    // speak prompt then start recognition
    await speak(`Your word is ${this.currentTask.word}. You have ${PHASES.ANSWER.seconds} seconds to ask questions`);

    // start recognition after TTS
    this.recognizer.recognize && this.recognizer.recognize(this.dialog, this.mic, this._lastRecognizeOptions);
  }

  async _startSpellPhase() {
    this.state = "spell";
    this.seconds = 0;

    this._lastRecognizeOptions = { prioritizeAlphabet: true, showDebug: true };

    this._setDialog(`Spell the word carefully. You have ${PHASES.SPELL.seconds} seconds.`);
    await speak(`Spell the word carefully. You have ${PHASES.SPELL.seconds} seconds.`);

    this.recognizer.recognize && this.recognizer.recognize(this.dialog, this.mic, this._lastRecognizeOptions);
  }

  async _startWaitPhase() {
    this.state = "wait";
    this.seconds = 0;

    // announce dialog contents and listen for 'next'
    await speak(this.dialog.innerText || "Say next to continue");

    this._lastRecognizeOptions = { prioritizeAlphabet: false, showDebug: true };
    this.recognizer.recognize && this.recognizer.recognize(this.dialog, this.mic, this._lastRecognizeOptions);
  }

  _transitionToAnswer() {
    // safely stop recognizer and switch to answer phase
    this.recognizer.stopRecognize && this.recognizer.stopRecognize();
    this._startAnswerPhase();
  }

  _startPoller() {
    if (this._poller) this._clearPoller();
    this._poller = setInterval(this._poll, this._pollInterval);
  }

  _clearPoller() {
    if (!this._poller) return;
    clearInterval(this._poller);
    this._poller = null;
  }

  _endCurrentPhaseAndStartNext() {
    // Stop recognizer for the transition
    this.recognizer.stopRecognize && this.recognizer.stopRecognize();

    if (this.state === "answer") this._startSpellPhase();
    else if (this.state === "spell") this._startWaitPhase();
    else if (this.state === "wait") {
      // default: go to next word and answer phase
      this.next();
    }
  }

  // central poller checks recognizer text and timers
  _poll() {
    // update time and bar
    const phaseDuration = this._getPhaseDuration();
    if (phaseDuration > 0) {
      // increment time according to poll interval
      this.seconds += this._pollInterval / 1000;
      this._setTimeBar(Math.round((this.seconds * 100) / phaseDuration));
    }

    // check phase-specific triggers
    if (this.state === "answer") {
      // recognized queries
      if (this.recognizer.textIncludes("part of speech") || this.recognizer.textIncludes("part")) {
        this._answerQ("part");
        this.recognizer.textClear && this.recognizer.textClear();
      } else if (this.recognizer.textIncludes("repeat")) {
        this._answerQ("repeat");
        this.recognizer.textClear && this.recognizer.textClear();
      } else if (this.recognizer.textIncludes("definition")) {
        this._answerQ("definition");
        this.recognizer.textClear && this.recognizer.textClear();
      } else if (this.recognizer.textIncludes("example") || this.recognizer.textIncludes("sentence")) {
        this._answerQ("example");
        this.recognizer.textClear && this.recognizer.textClear();
      }

      // if student says the word or time up -> go to spell
      if (this.recognizer.textIncludes(this.currentTask.word) || this.seconds >= PHASES.ANSWER.seconds) {
        this._endCurrentPhaseAndStartNext();
      }
    } else if (this.state === "spell") {
      // get live spelling without whitespace
      const liveSpelling = (this.recognizer.getFinalText && this.recognizer.getFinalText() || "").replace(/\s+/g, "");

      // guard: too long -> wrong
      if (liveSpelling.length > this.currentTask.word.length) {
        this._appendDialog("You spelled: " + liveSpelling);
        this._appendDialog("Wrong spelling! " + this.currentTask.word);
        this._appendDialog("Say next to spell next word");
        this._endCurrentPhaseAndStartNext();
        return;
      }

      if (liveSpelling && liveSpelling.toLowerCase() === this.currentTask.word.toLowerCase()) {
        this._appendDialog("Correct! You spelled " + liveSpelling);
        this._appendDialog("Say next to spell next word");
        this._endCurrentPhaseAndStartNext();
        return;
      }

      if (this.seconds >= PHASES.SPELL.seconds) {
        const finalSpelling = liveSpelling;
        this._setDialog("Time up! You spelled: " + finalSpelling);
        if (finalSpelling.toLowerCase() === this.currentTask.word.toLowerCase()) {
          this._appendDialog("Correct");
        } else {
          this._appendDialog("Wrong spelling! " + this.currentTask.word);
        }
        this._appendDialog("Say next to spell next word");
        this._endCurrentPhaseAndStartNext();
      }
    } else if (this.state === "wait") {
      if (this.recognizer.textIncludes("next")) {
        this.recognizer.textClear && this.recognizer.textClear();
        this.next();
      }

      // optional timeout for wait phase
      if (this.seconds >= PHASES.WAIT.seconds) {
        this.next();
      }
    }
  }

  _getPhaseDuration() {
    if (this.state === "answer") return PHASES.ANSWER.seconds;
    if (this.state === "spell") return PHASES.SPELL.seconds;
    if (this.state === "wait") return PHASES.WAIT.seconds;
    return 0;
  }

  async _answerQ(type) {
    let ans = "";
    if (type === "repeat") ans = this.currentTask.pronunciation;
    else if (type === "definition") ans = this.currentTask.definition;
    else if (type === "part") ans = this.currentTask.part;
    else if (type === "example") ans = this.currentTask.example;

    this._setDialog(ans);
    if (type === "repeat") await speak(this.currentTask.word);
    else await speak(ans);

    // resume recognition (caller expects recognizer to be running)
    this.recognizer.recognize && this.recognizer.recognize(this.dialog, this.mic, this._lastRecognizeOptions);
  }
}

// ---- Exported factory for ease of use -----
export function createSpellBeeGame(opts = {}) {
  const game = new SpellBeeGame(opts);
  game.init();
  return game;
}

// Example auto-init when included as main script
if (document.readyState !== "loading") {
  const game = createSpellBeeGame();
  // expose for debugging
  window.spellBeeGame = game;
} else {
  document.addEventListener("DOMContentLoaded", () => {
    const game = createSpellBeeGame();
    window.spellBeeGame = game;
  });
}
