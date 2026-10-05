# Kanz Al Lulu (Arabic web font)

Place the licensed font file here as:

    KanzAlLulu.woff2

`src/index.css` already declares the @font-face for it. If you only have a .ttf/.otf,
convert it to WOFF2 first (e.g. with `woff2_compress` or any online converter).

The font is only applied to Arabic text (elements with lang="ar" or dir="rtl").
Until the file is added, the browser falls back to Noto Naskh Arabic.
