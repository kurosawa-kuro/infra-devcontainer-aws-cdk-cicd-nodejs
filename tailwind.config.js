/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/views/**/*.ejs',
    './src/views/layouts/*.ejs',
    './src/views/partials/*.ejs',
    './src/views/pages/*.ejs'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#0070f3',
          dark: '#3b82f6'
        },
        bg: {
          DEFAULT: '#ffffff',
          dark: '#111827',
          card: {
            DEFAULT: '#ffffff',
            dark: '#1f2937'
          }
        },
        text: {
          DEFAULT: '#1f2937',
          dark: '#f3f4f6',
          secondary: {
            DEFAULT: '#4b5563',
            dark: '#d1d5db'
          }
        },
        border: {
          DEFAULT: '#e5e7eb',
          dark: '#374151'
        }
      },
      borderRadius: {
        'airbnb': '12px'
      },
      boxShadow: {
        'airbnb': '0 6px 16px rgba(0, 0, 0, 0.12)',
        'airbnb-sm': '0 2px 8px rgba(0, 0, 0, 0.08)',
        'card': '0 2px 4px rgba(0, 0, 0, 0.1)',
        'card-dark': '0 2px 4px rgba(0, 0, 0, 0.25)'
      }
    }
  },
  plugins: []
};

