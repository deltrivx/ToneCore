/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 深色科技风配色
        ink: {
          950: '#070a12',
          900: '#0a0e17',
          850: '#0f1420',
          800: '#141a28',
          700: '#1c2436',
          600: '#28324a',
        },
        neon: {
          DEFAULT: '#00e5ff',
          soft: '#5cf2ff',
          dim: '#0091a8',
        },
        violet: {
          DEFAULT: '#8b5cf6',
          soft: '#a78bfa',
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(0, 229, 255, 0.15)',
        'glow-lg': '0 0 48px rgba(0, 229, 255, 0.22)',
        card: '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
