/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 层次：sunken < surface < raised < overlay（靠亮度差分层，不靠描边堆叠）
        surface: {
          DEFAULT: '#0F1116',
          raised: '#15181F',
          overlay: '#1C2027',
          sunken: '#0B0D11',
        },
        // 文字：高对比主色，逐级降饱和
        fg: {
          DEFAULT: '#ECEDEF',
          muted: '#9BA1AC',
          subtle: '#6C7280',
          inverse: '#0B0D11',
        },
        // 描边：低不透明度白，避免实色灰硬边
        line: {
          DEFAULT: 'rgba(255,255,255,0.08)',
          strong: 'rgba(255,255,255,0.16)',
        },
        // 强调色：单一主色，与品牌图标同款天蓝
        accent: {
          DEFAULT: '#4FC3F7',
          hover: '#6ECDF9',
          press: '#2E9BE8',
          soft: '#8AD8FF',
          weak: 'rgba(79,195,247,0.14)',
        },
        // 兼容旧类名（逐步迁移后可删）
        neon: { DEFAULT: '#4FC3F7', soft: '#8AD8FF', dim: '#2E9BE8' },
        ink: {
          950: '#08090C',
          900: '#0B0D11',
          850: '#111318',
          800: '#161920',
          700: '#1F232C',
          600: '#2B313C',
        },
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        elev: '0 1px 2px rgba(0,0,0,0.4)',
        card: '0 1px 3px rgba(0,0,0,0.35)',
        pop: '0 12px 32px rgba(0,0,0,0.55)',
        glow: '0 0 24px rgba(79,195,247,0.18)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      transitionDuration: { 250: '250ms' },
    },
  },
  plugins: [],
};
