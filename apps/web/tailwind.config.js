/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 深色科技风配色（与新图标的天蓝主色对齐）
        ink: {
          950: '#070a12',
          900: '#0a0e17',
          850: '#0f1420',
          800: '#141a28',
          700: '#1c2436',
          600: '#28324a',
        },
        // 主色改为图标同款天蓝，比旧版青色更亮、更接近品牌色
        neon: {
          DEFAULT: '#4FC3F7',
          soft: '#8ad8ff',
          dim: '#2E9BE8',
        },
        amber: {
          DEFAULT: '#FFC13B',
          soft: '#ffd77a',
        },
        violet: {
          DEFAULT: '#8b5cf6',
          soft: '#a78bfa',
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(79, 195, 247, 0.18)',
        'glow-lg': '0 0 48px rgba(79, 195, 247, 0.26)',
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
