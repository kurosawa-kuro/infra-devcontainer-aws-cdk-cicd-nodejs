/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/views/**/*.ejs"],
  theme: {
    extend: {
      colors: {
        primary: '#007bff',
        secondary: '#2c3e50',
        border: '#eee',
        bg: '#f5f5f5',
        text: '#666',
      },
    },
  },
  plugins: [],
}

