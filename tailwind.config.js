/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        swarm: {
          950: '#070a0f',
          900: '#0c121d',
          850: '#111927',
          800: '#162234',
          700: '#1e3048',
          600: '#2b4465',
          500: '#3d5f8c',
          400: '#5a82b8',
          300: '#89a8d8',
          200: '#bad0f1',
          100: '#e1ecfb',
        }
      }
    },
  },
  plugins: [],
}
