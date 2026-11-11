# Mutabi' · مُتابِع

Quran follow-along in the browser. Pick a surah and recite; the page follows along with your voice. Arabic and English interface.

Live: https://ielhag.github.io/mutabi/

## Run locally
Open `index.html` in a browser, or serve the folder:
```
python3 -m http.server 8000
```
Voice uses the browser's Web Speech API. On iPhone, use Safari.

## Files
| File | What it holds |
|---|---|
| `index.html` | Page markup |
| `css/styles.css` | All styles |
| `js/surahs.js` | Metadata for all 114 surahs |
| `js/app.js` | App logic: language switch, Quran text loading (alquran.cloud), voice follow-along |
