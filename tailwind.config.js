/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/views/**/*.ejs"],
  theme: {
    extend: {
      colors: {
        primary: '#FF385C',
        secondary: '#222222',
        border: '#DDDDDD',
        bg: '#F7F7F7',
        text: '#717171',
        'text-dark': '#222222',
      },
      borderRadius: {
        'airbnb': '12px',
      },
      boxShadow: {
        'airbnb': '0 6px 16px rgba(0,0,0,0.12)',
        'airbnb-sm': '0 2px 8px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
}

