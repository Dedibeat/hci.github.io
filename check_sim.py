"""
embed_compare.py

Requires:
    pip install torch torchaudio transformers soundfile pydub numpy

Notes:
- pydub requires ffmpeg to read .m4a: `sudo apt install ffmpeg` (Linux)
- The script loads the Wav2Vec2 Mongolian model once (tugstugi/...)
"""

import os
import numpy as np
import torch
import torch.nn.functional as F
import soundfile as sf
from pydub import AudioSegment
import torchaudio
from transformers import Wav2Vec2Processor, Wav2Vec2Model

# -------- CONFIG ----------
MODEL_ID = "tugstugi/wav2vec2-large-xlsr-53-mongolian"
TARGET_SR = 16000
POOL_METHOD = "mean"  # "mean" or "max"
DEBUG = False
# --------------------------

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# load processor + model once
processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
model = Wav2Vec2Model.from_pretrained(MODEL_ID).to(device)
model.eval()


def read_wav_with_soundfile(path: str):
    """Read .wav using soundfile (avoids ffmpeg/torchcodec). Returns (np.ndarray, sr)."""
    data, sr = sf.read(path)
    # data: shape (samples,) or (samples, channels)
    if data.ndim > 1:
        data = data.mean(axis=1)  # to mono
    return data.astype(np.float32), sr


def read_m4a_with_pydub(path: str):
    """Read .m4a via pydub+ffmpeg. Returns (np.ndarray, sr)."""
    audio = AudioSegment.from_file(path)
    if DEBUG:
        print("pydub loaded:", audio.frame_rate, "Hz,", audio.channels, "ch,", audio.sample_width * 8, "bits")
    audio = audio.set_channels(1).set_frame_rate(TARGET_SR)
    samples = np.array(audio.get_array_of_samples(), dtype=np.int16)  # integer samples
    # normalize to float32 in [-1, 1]
    data = samples.astype(np.float32) / 32768.0
    return data, TARGET_SR


def load_audio(path: str):
    """
    Universal audio loader.
    Returns: waveform: torch.Tensor (1D, float32), sample_rate: int
    """
    ext = os.path.splitext(path)[1].lower()
    if ext in [".wav", ".wave"]:
        data, sr = read_wav_with_soundfile(path)
    elif ext in [".m4a", ".mp4", ".aac", ".ogg", ".flac"]:
        # for m4a we use pydub; pydub supports more formats if ffmpeg is installed
        data, sr = read_m4a_with_pydub(path)
    else:
        # try soundfile as fallback
        data, sr = read_wav_with_soundfile(path)

    # ensure 1D numpy array
    if data.ndim > 1:
        data = data.squeeze()
    # convert to torch tensor (1D)
    waveform = torch.from_numpy(data).to(torch.float32)

    # resample if needed (torchaudio.Resample expects [channels, time] or [batch, channels, time])
    if sr != TARGET_SR:
        if DEBUG:
            print(f"Resampling from {sr} -> {TARGET_SR}")
        resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=TARGET_SR)
        # add fake channel dimension for resampler: [1, time]
        waveform = resampler(waveform.unsqueeze(0)).squeeze(0)
        sr = TARGET_SR

    if DEBUG:
        print("Final waveform shape (1D):", waveform.shape, "sr:", sr)

    return waveform, sr


def waveform_to_embedding(waveform: torch.Tensor, sr: int, pool: str = POOL_METHOD):
    """
    Given a 1D waveform torch.Tensor and its sampling rate, return a pooled embedding (1D tensor).
    - waveform: 1D tensor [time]
    - returns: 1D tensor [hidden_size] on CPU
    """
    assert waveform.ndim == 1, f"waveform must be 1D, got shape {waveform.shape}"

    # processor accepts 1D or list; it will add batch dim
    inputs = processor(waveform, sampling_rate=sr, return_tensors="pt", padding=True)
    input_values = inputs["input_values"].to(device)        # shape [1, seq_len]
    attention_mask = inputs.get("attention_mask", None)
    if attention_mask is not None:
        attention_mask = attention_mask.to(device)

    # forward
    with torch.no_grad():
        outputs = model(input_values, attention_mask=attention_mask)
        last_hidden = outputs.last_hidden_state  # shape [1, seq_len', hidden_size]

    if DEBUG:
        print("Model last_hidden_state shape:", last_hidden.shape)

    # pool over time to get one vector
    if pool == "mean":
        pooled = last_hidden.mean(dim=1).squeeze(0)  # [hidden_size]
    elif pool == "max":
        pooled = last_hidden.max(dim=1).values.squeeze(0)
    else:
        raise ValueError("pool must be 'mean' or 'max'")

    # move to cpu for easier downstream use
    return pooled.cpu()


def get_embedding_from_file(path: str):
    waveform, sr = load_audio(path)
    emb = waveform_to_embedding(waveform, sr)
    return emb


def cos_sim(a: torch.Tensor, b: torch.Tensor):
    """Normalized cosine similarity between two 1D tensors."""
    a_n = F.normalize(a, dim=0)
    b_n = F.normalize(b, dim=0)
    return float((a_n * b_n).sum())


def euclidean(a: torch.Tensor, b: torch.Tensor):
    return float(torch.norm(a - b).item())


# ------------------- Example usage / CLI-like -------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Compute embeddings and similarity for audio files.")
    parser.add_argument("file1", help="path to first audio file (.wav/.m4a)")
    parser.add_argument("file2", help="path to second audio file (.wav/.m4a)")
    parser.add_argument("--pool", choices=["mean", "max"], default=POOL_METHOD, help="pooling method")
    parser.add_argument("--debug", action="store_true", help="print debug info")
    args = parser.parse_args()

    DEBUG = args.debug

    print("Loading and embedding:", args.file1)
    emb1 = get_embedding_from_file(args.file1)
    print("Embedding1 shape:", emb1.shape)

    print("Loading and embedding:", args.file2)
    emb2 = get_embedding_from_file(args.file2)
    print("Embedding2 shape:", emb2.shape)

    print(f"\nCosine similarity ({args.pool} pooling):", cos_sim(emb1, emb2))
    print("Euclidean distance:", euclidean(emb1, emb2))
