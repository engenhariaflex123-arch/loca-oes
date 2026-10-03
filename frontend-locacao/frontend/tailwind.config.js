/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          // Azul Flex Locações (antes era o verde da Flex Medições Ambientais)
          50: '#eaf2fb',
          100: '#cfe0f5',
          400: '#3d82d1',
          500: '#2a6fbd',
          600: '#1f5ca3',
          700: '#1a4c86',
          950: '#0b1b30',
        },
      },
    },
  },
  plugins: [],
};
