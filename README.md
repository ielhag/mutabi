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

## How it works
- The Quran text for the chosen surah is loaded from the [alquran.cloud](https://alquran.cloud/api) API.
- The browser's speech recognition listens in Arabic, and the app matches the recognized words against the current ayah to follow along.
- Everything runs in the browser: no build step, no backend, no account.

## Contributing
Issues and pull requests are welcome, especially for:
- better matching of recited words to the text (diacritics, recitation styles)
- offline support, so a surah keeps working without a connection
- accessibility and more interface languages

Keep it dependency-free: plain HTML, CSS and JavaScript.

## Credits
- Quran text: [alquran.cloud](https://alquran.cloud)
- Fonts: Amiri, Amiri Quran, Tajawal and Inter, via Google Fonts (SIL Open Font License)

## License
The code is [MIT](LICENSE). The Quran text and fonts belong to their sources above.
