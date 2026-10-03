/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6e9',
          100: '#d7e8cb',
          400: '#6ea34d',
          500: '#578f3b',
          600: '#47782e',
          700: '#395f25',
          950: '#16240f',
        },
      },
    },
  },
  plugins: [],
};
