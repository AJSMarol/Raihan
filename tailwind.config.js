/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Lapis ink on cool paper, with saffron for emphasis and teal reserved for Raihan itself.
        paper: '#F4F6FA',
        pearl: '#E6EBF4',
        ink: { DEFAULT: '#14213D', soft: '#44516E', faint: '#5F6B86' },
        lapis: {
          100: '#DCE5F7',
          400: '#6F8DDB',
          500: '#2F55B8',
          600: '#23408E',
          700: '#1B3270',
          900: '#0F1D44',
        },
        saffron: { 100: '#FBF0D9', 400: '#E0AE4F', 500: '#C8962E', 700: '#7A5714' },
        raihan: { 100: '#D9EFEA', 500: '#1F7A6D', 700: '#145248' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['"Bricolage Grotesque"', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        // Used automatically by :lang(ar) / [dir="rtl"] (see index.css) and by the .font-arabic utility.
        arabic: ['"Kanz Al Lulu"', '"Noto Naskh Arabic"', 'serif'],
      },
    },
  },
  plugins: [],
};
