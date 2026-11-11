# Media import fixtures

One-second 997 Hz tones at −6 dBFS, generated for Oxidal's import tests (no
third-party audio):

```bash
ffmpeg -f lavfi -i "aevalsrc=0.5*sin(2*PI*997*t)|0.5*sin(2*PI*997*t):s=44100:d=1" -c:a libmp3lame -b:a 128k tone-44k-stereo-cbr128.mp3
ffmpeg -f lavfi -i "aevalsrc=0.5*sin(2*PI*997*t):s=44100:d=1" -ac 1 -c:a libmp3lame -q:a 4 tone-44k-mono-vbr.mp3
ffmpeg -f lavfi -i "aevalsrc=0.5*sin(2*PI*997*t)|0.5*sin(2*PI*997*t):s=48000:d=1" -c:a libmp3lame -b:a 192k tone-48k-stereo-cbr192.mp3
```

WAV fixtures are generated in code by `media_import::tests::wav`.
