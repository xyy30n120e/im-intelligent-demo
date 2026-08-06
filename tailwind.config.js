/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f5ff',
          100: '#e0ebff',
          200: '#b8d4fe',
          300: '#7cb4fc',
          400: '#4a94f8',
          500: '#1a73e8',
          600: '#0d5cc7',
          700: '#0f4aa0',
          800: '#124084',
          900: '#14376d',
        },
        sidebar: {
          light: '#f7f8fa',
          dark: '#e8eaed',
          active: '#e8f0fe',
        },
        chat: {
          sent: '#d1e7ff',
          received: '#f0f0f0',
        }
      },
    },
  },
  plugins: [],
}
