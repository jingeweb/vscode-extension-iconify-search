// import { iconsPlugin, dynamicIconsPlugin } from '@egoist/tailwindcss-icons';
import plugin from 'tailwindcss/plugin';

import { vscodeColors, themeColors, themeDarkColors } from './src/theme-colors';

const antdColors = Object.keys(themeColors);

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'selector',
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    colors: {
      ...Object.fromEntries(antdColors.map((clr) => [clr, `var(--antd-${clr})`])),
      ...vscodeColors,
    },
  },
  plugins: [
    // dynamic icon selectors: @plugin '@iconify/tailwind4' in src/iconifyWebView/style.css
    // iconsPlugin(),
    // dynamicIconsPlugin(),
    plugin((api) => {
      // v4 only accepts class selectors in addComponents, so register the CSS
      // variables in the base layer instead (works for `:root` / attribute selectors).
      api.addBase({
        ':root': Object.fromEntries(antdColors.map((clr) => [`--antd-${clr}`, themeColors[clr]])),
        '[data-theme=dark]': Object.fromEntries(
          antdColors.map((clr) => [`--antd-${clr}`, themeDarkColors[clr]]),
        ),
      });
    }),
  ],
};
